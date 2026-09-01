import { ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { getCurrentUser } from 'aws-amplify/auth'
import { RatingParticipantRole } from '@/constants/enums'
import { throwIfGraphqlError } from '@/services/graphql-error-service'

// Notation par étoiles bidirectionnelle PRIVÉE (2026-08-26, étape 4/5) — modèle `Rating`,
// `amplify/data/resource.ts`, docs/adr/0015 (clé composite + résidus) et docs/adr/0017
// (agrégats serveur).
//
// Ce composable est INDÉPENDANT de la double validation de Mission : il n'est JAMAIS appelé en
// chaîne depuis `closeMission` (useMissionClosure.js) ni `submitDonationValidation`
// (useOwnerMissions.js), et aucune de ces deux fonctions n'attend son résultat. C'est une
// exigence produit du CdC ("la notation ne bloque jamais la validation de la Mission") traduite
// en contrainte d'architecture : un échec de notation ne doit pas pouvoir faire échouer, ni même
// retarder, l'enregistrement d'un don. Le chaînage éventuel (proposer la notation APRÈS la
// validation) appartient à la vue, pas à ces composables.
//
// PAS de méthode de lecture d'agrégat ici (moyenne/nombre d'avis) : `Clinic.averageRatingAsClinic`
// /`ratingCountAsClinic` et `Owner.averageRatingAsOwner`/`ratingCountAsOwner` sont écrits côté
// serveur (Lambda sur flux DynamoDB, ADR-0017) et lisibles directement via
// `client.models.Clinic.get()`/`client.models.Owner.get()` avec un `selectionSet` explicite posé
// par l'appelant — un wrapper dédié n'ajouterait qu'une indirection, contre la convention
// `selectionSet` de ce repo (CLAUDE.md). Voir aussi le rapport de cette sous-tâche : l'alerte
// tableau de bord clinique mentionnée par ADR-0017 §4 ("sous 3,5 étoiles avec au moins 3 avis")
// est un calcul de LECTURE sur ces deux champs, explicitement hors périmètre ici (elle suppose
// un câblage de vue, lui-même différé à la PR de suivi).

// Bornes de l'échelle de notation, côté client UNIQUEMENT. `Rating.stars` est un
// `a.integer().required()` sans contrainte de domaine côté schéma (Gen2 ne sait pas borner la
// VALEUR d'un champ, seulement l'ensemble d'opérations — même limite que celle documentée depuis
// ADR-0002) : cette garde est la seule qui existe. Exportées pour qu'une future UI d'étoiles
// n'ait pas à redéclarer 1..5 de son côté.
export const RATING_MIN_STARS = 1
export const RATING_MAX_STARS = 5

// Rôle du NOTEUR déduit du rôle de la CIBLE : une Mission n'oppose que deux parties, donc noter
// un Owner, c'est nécessairement noter EN TANT QUE clinique, et inversement. C'est ce qui permet
// à `submitRating` de n'accepter aucun `raterRole` en paramètre (voir sa doc) — un appelant ne
// peut pas déclarer être quelqu'un d'autre, il ne peut que désigner qui il note.
const RATER_ROLE_BY_TARGET_ROLE = Object.freeze({
  [RatingParticipantRole.OWNER]: RatingParticipantRole.CLINIC,
  [RatingParticipantRole.CLINIC]: RatingParticipantRole.OWNER,
})

const SUBMIT_RATING_ERROR_MESSAGES = {
  RATING_ALREADY_SUBMITTED: 'Vous avez déjà noté cette mission.',
  INVALID_STARS: `Choisissez une note entre ${RATING_MIN_STARS} et ${RATING_MAX_STARS} étoiles.`,
  INVALID_TARGET_ROLE: 'Destinataire de la notation invalide.',
  INVALID_RATING_TARGET: 'Mission ou destinataire manquant pour cette notation.',
  CLINIC_NOT_FOUND: 'Aucune clinique rattachée à votre compte : notation impossible.',
}

/**
 * Traduit une erreur levée par `submitRating` (son `.message`, l'un des codes ci-dessus) en
 * message utilisateur clair. Même forme et mêmes raisons que `mapAcceptMissionError`
 * (useOwnerMissions.js) : fonction pure exportée à côté du composable, testable sans monter de
 * composant `.vue`.
 *
 * @param {string} errorMessage
 * @param {string} [fallback]
 * @returns {string}
 */
export function mapSubmitRatingError(
  errorMessage,
  fallback = 'Impossible d’enregistrer votre note.',
) {
  return SUBMIT_RATING_ERROR_MESSAGES[errorMessage] || fallback
}

/**
 * Détecte le rejet d'une SECONDE notation pour le même couple `(missionID, raterRole)`.
 *
 * `Rating.identifier(['missionID', 'raterRole'])` (clé composite, ADR-0015 §1) fait porter cette
 * unicité par la clé primaire DynamoDB elle-même. Vérifié dans le paquet INSTALLÉ plutôt que
 * supposé : le resolver de création généré ajoute, pour chaque composante de la clé du modèle,
 * une condition `attributeExists: false` (`generateKeyConditionTemplate(false)` appelé depuis le
 * template `create`, node_modules/@aws-amplify/data-construct/node_modules/@aws-amplify/
 * graphql-model-transformer/lib/resolvers/dynamodb/mutation.js). Une seconde `create` sur le même
 * couple échoue donc en `DynamoDB:ConditionalCheckFailedException` — le même code d'erreur que la
 * condition anti-course d'ADR-0001, mais pour une raison différente.
 *
 * Duplication assumée avec `isConditionalCheckFailure` (useOwnerMissions.js) : les deux détectent
 * la même signature d'erreur DynamoDB, mais l'importer d'un autre composable violerait la
 * convention de ce repo (un composable n'importe pas les internes d'un autre) et l'extraire vers
 * `graphql-error-service.js` obligerait à toucher `useOwnerMissions.js` hors du périmètre de
 * cette sous-tâche. Candidat à une extraction groupée si un troisième cas apparaît — signalé
 * plutôt que fait en douce.
 */
const isDuplicateRatingError = (error) => {
  const graphQLErrors = error?.errors
  if (!Array.isArray(graphQLErrors)) return false

  return graphQLErrors.some((e) => {
    const errorType = e?.errorType || ''
    const message = (e?.message || '').toLowerCase()
    return (
      errorType.includes('ConditionalCheckFailedException') ||
      message.includes('conditionalcheckfailedexception') ||
      message.includes('conditional request failed')
    )
  })
}

/**
 * Notation d'une Mission par l'une des deux parties (Owner -> Clinic, ou Clinic -> Owner).
 *
 * MITIGATION ADR-0015 §3, la raison d'être de ce composable — à lire avant toute modification
 * de la signature de `submitRating` :
 *
 * `Rating` n'impose côté serveur AUCUNE contrainte sur la VALEUR de `raterID`/`raterRole`
 * (`allow.group('Veterinarians').to(['create'])` ne borne qu'un ensemble d'opérations ; et
 * `raterRole` a même perdu la validation gratuite d'un enum GraphQL en devenant `a.string()`
 * pour entrer dans la clé composite). Un vétérinaire appelant l'API directement peut donc écrire
 * une notation au nom d'un autre. L'ADR acte ce résidu ET nomme sa mitigation : elle est
 * CÔTÉ CLIENT, et c'est ici.
 *
 * Concrètement, `submitRating` n'accepte NI `raterID` NI `raterRole` en paramètre — ils ne sont
 * pas ignorés, ils n'existent tout simplement pas dans sa signature :
 * - `raterRole` est déduit de `targetRole` (`RATER_ROLE_BY_TARGET_ROLE`), et vaut donc toujours
 *   l'une des deux valeurs de `RatingParticipantRole` (constants/enums.js), jamais une chaîne
 *   construite à partir d'une saisie utilisateur — c'est la mitigation du SECOND résidu
 *   d'ADR-0015 §3 (`raterRole` non typé côté schéma).
 * - `raterID` est dérivé de l'identité authentifiée COURANTE : `getCurrentUser().userId` pour un
 *   Owner, ou le `clinicID` du profil `Veterinarian` de l'utilisateur courant pour une clinique
 *   (relu ici, pas reçu en paramètre — même pattern de résolution que `fetchClinicId()`
 *   (useClinicRequest.js) / `fetchClinicContext()` (useClinicDonors.js) / `useClinicStats.js`).
 *
 * Limite honnête de cette mitigation, à ne pas surestimer : elle protège l'application contre
 * une erreur de câblage d'une vue, pas contre un appelant malveillant, qui peut toujours
 * contourner tout le front. Sa fermeture réelle serait une mutation custom dérivant `raterID` de
 * `ctx.identity` côté serveur — écartée par ADR-0015 comme disproportionnée pour ce pilote.
 *
 * Résidu NON traité ici, signalé : `targetID` reste, lui, un paramètre libre (c'est la
 * contrepartie de la Mission, que l'appelant doit bien désigner). Le dériver de la Mission
 * elle-même (Mission -> Request.clinicID côté Owner, Mission -> Animal.ownerID côté clinique)
 * fermerait aussi cette moitié du résidu, au prix de lectures supplémentaires — hors périmètre de
 * cette sous-tâche, à trancher si `Rating` sort du pilote.
 */
export function useRatings() {
  const client = generateClient()

  const isSubmitting = ref(false)

  // Mémoïsé sur l'instance du composable, comme `fetchClinicContext()` (useClinicDonors.js) :
  // un vétérinaire qui note plusieurs missions d'affilée ne refait pas la lecture de profil.
  const clinicId = ref(null)

  /**
   * Résout le `clinicID` du Veterinarian AUTHENTIFIÉ COURANT — jamais un identifiant fourni par
   * l'appelant (voir la doc du composable).
   *
   * Ne catch PAS ses propres erreurs (convention du repo, CLAUDE.md) : renvoie `null` UNIQUEMENT
   * pour le cas légitime « ce vétérinaire n'a pas (encore) de clinique rattachée » ; une vraie
   * erreur (réseau, `@auth`) remonte au `try/catch` de `submitRating`, seul à même de distinguer
   * les deux.
   */
  const fetchRaterClinicId = async () => {
    if (clinicId.value) return clinicId.value

    const { userId } = await getCurrentUser()
    if (!userId) throw new Error('Utilisateur non connecté')

    // `selectionSet` explicite réduit au seul champ consommé : ce composable ne lit rien
    // d'autre du profil vétérinaire, et le défaut (tous les scalaires) ferait transiter des
    // champs sans usage ici (CLAUDE.md, section Backend/Infra).
    const { data, errors } = await client.models.Veterinarian.get(
      { id: userId },
      { selectionSet: ['clinicID'] },
    )
    throwIfGraphqlError(errors, 'getVeterinarian')

    if (!data?.clinicID) return null

    clinicId.value = data.clinicID
    return clinicId.value
  }

  /**
   * Enregistre une notation pour une Mission. Écriture unique et définitive : `Rating` n'accorde
   * `update`/`delete` à personne (ADR-0015 §2), et la clé composite empêche une seconde
   * soumission du même côté.
   *
   * @param {object} params
   * @param {string} params.missionId - la Mission notée.
   * @param {string} params.targetRole - `RatingParticipantRole.OWNER` (on note le propriétaire,
   *   donc on note EN TANT QUE clinique) ou `RatingParticipantRole.CLINIC` (l'inverse). Ce
   *   paramètre désigne QUI EST NOTÉ ; il ne déclare jamais qui note — voir la doc du composable.
   * @param {string} params.targetID - `Clinic.id` ou `Owner.id` de la partie notée.
   * @param {number} params.stars - entier, de `RATING_MIN_STARS` à `RATING_MAX_STARS`.
   * @param {string} [params.comment] - commentaire libre, facultatif. Non envoyé si vide.
   * @returns {Promise<object>} la `Rating` créée telle que renvoyée par le serveur.
   * @throws {Error} `INVALID_TARGET_ROLE`, `INVALID_RATING_TARGET`, `INVALID_STARS` (tous levés
   *   avant tout appel réseau), `CLINIC_NOT_FOUND`, `RATING_ALREADY_SUBMITTED` — à passer à
   *   `mapSubmitRatingError`. Toute autre erreur est propagée telle quelle.
   */
  const submitRating = async ({ missionId, targetRole, targetID, stars, comment }) => {
    const raterRole = RATER_ROLE_BY_TARGET_ROLE[targetRole]
    if (!raterRole) throw new Error('INVALID_TARGET_ROLE')
    if (!missionId || !targetID) throw new Error('INVALID_RATING_TARGET')
    if (
      !Number.isInteger(stars) ||
      stars < RATING_MIN_STARS ||
      stars > RATING_MAX_STARS
    ) {
      throw new Error('INVALID_STARS')
    }

    isSubmitting.value = true
    try {
      // Dérivation de `raterID` depuis l'identité courante — le coeur de la mitigation
      // ADR-0015 §3 (voir la doc du composable).
      let raterID
      if (raterRole === RatingParticipantRole.CLINIC) {
        raterID = await fetchRaterClinicId()
        if (!raterID) throw new Error('CLINIC_NOT_FOUND')
      } else {
        const { userId } = await getCurrentUser()
        if (!userId) throw new Error('Utilisateur non connecté')
        raterID = userId
      }

      const trimmedComment = typeof comment === 'string' ? comment.trim() : ''

      const { data, errors } = await client.models.Rating.create({
        missionID: missionId,
        raterID,
        raterRole,
        targetID,
        targetRole,
        stars,
        ...(trimmedComment ? { comment: trimmedComment } : {}),
      })
      throwIfGraphqlError(errors, 'createRating')

      return data
    } catch (e) {
      console.error('Erreur enregistrement de la notation:', e)
      if (isDuplicateRatingError(e)) {
        throw new Error('RATING_ALREADY_SUBMITTED')
      }
      throw e
    } finally {
      isSubmitting.value = false
    }
  }

  /**
   * Vérifie si une `Rating` existe déjà pour la clé composite `(missionID, raterRole)` donnée
   * -- « cette Mission a-t-elle déjà été notée DE CE CÔTÉ ? ». Pré-check "déjà noté" avant
   * d'afficher le widget de notation (voir `ensureRatingStatusChecked`, MissionsView.vue) :
   * possible UNIQUEMENT côté Owner, parce que `Rating` accorde
   * `allow.ownerDefinedIn('raterID').to(['read'])` (ADR-0015 §2) -- chaque partie peut relire
   * SA PROPRE `Rating`, jamais celle de l'autre. Asymétrie documentée aussi côté
   * RequestsView.vue, qui ne peut PAS faire ce pré-check pour une clinique (voir son
   * commentaire sur `ratedMissionIds`) -- cette fonction n'est donc appelée que par le flux
   * Owner à ce jour, mais sa signature ne présuppose rien de ce côté-là (elle prend
   * `raterRole` en paramètre plutôt que de coder `OWNER` en dur).
   *
   * `selectionSet` réduit à `missionID` : seule l'EXISTENCE de la ligne compte ici, aucun
   * autre champ n'est consommé par l'appelant.
   *
   * Ne catch PAS ses propres erreurs -- même convention que `fetchRaterClinicId` ci-dessus
   * (CLAUDE.md, "résolution de contexte qui ne catch pas ses propres erreurs") : `false` est
   * renvoyé UNIQUEMENT pour le cas légitime "pas encore de Rating à cette clé" ; une vraie
   * erreur réseau/`@auth` remonte à l'appelant, seul à même de décider du repli (lecture
   * secondaire non-exclusive côté MissionsView.vue -- repli sur 'unrated', jamais 'rated',
   * voir son propre commentaire).
   *
   * @param {string} missionId
   * @param {string} raterRole - `RatingParticipantRole.OWNER` ou `RatingParticipantRole.CLINIC`,
   *   le côté dont on vérifie s'il a déjà soumis une notation.
   * @returns {Promise<boolean>}
   */
  const checkRatingExists = async (missionId, raterRole) => {
    const { data, errors } = await client.models.Rating.get(
      { missionID: missionId, raterRole },
      { selectionSet: ['missionID'] },
    )
    throwIfGraphqlError(errors, 'getRating')
    return Boolean(data)
  }

  return {
    isSubmitting,
    submitRating,
    checkRatingExists,
  }
}
