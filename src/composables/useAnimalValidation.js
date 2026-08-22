import { ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { isValidatedDonor } from '@/services/eligibility-service'
import { throwIfGraphqlError } from '@/services/graphql-error-service'

// Phase 8, sous-tâche 5 (lot 3/3) : migré sur le client Gen2 (`aws-amplify/data`,
// `client.models.Animal.*`). `listAnimalsForValidation`/`validateAnimalDonorSimple`/
// `updateAnimalBloodGroupSimple` (custom-queries.js/custom-mutations.js, Gen1) n'ont plus
// lieu d'être ici -- voir CLAUDE.md / roadmap Phase 8 pour la méthodologie de migration.
//
// Sur le changement de comportement d'erreur Gen1 -> Gen2 et `throwIfGraphqlError` : voir le
// JSDoc de `src/services/graphql-error-service.js`. Les trois appels de ce composable
// (`Animal.list`/`Animal.update` x2) reprennent tous `throwIfGraphqlError` : le Gen1 d'origine
// levait TOUJOURS sur une erreur GraphQL (simple `await client.graphql(...)`, jamais de
// destructuration ni de notion de succès partiel côté appelant), donc aucun des trois n'a de
// raison de traiter un succès partiel différemment.
//
// selectionSet de `fetchPendingValidations()` : reprend EXACTEMENT les champs sélectionnés par
// `listAnimalsForValidation` (Gen1) -- id/name/species/breed/bloodGroup/isValidatedDonor/
// validationExpiresAt/ownerID/ownerProfile.firstname/ownerProfile.lastname -- vérifiés un par un
// contre ce que `ValidationsView.vue` consomme réellement (colonnes name/species/breed/
// bloodGroup, badge owner firstname/lastname, `isValidatedDonor`/`validationExpiresAt` pour le
// filtre côté client ci-dessous) : aucun champ Gen1 n'était déjà du sur-fetch pour cette vue,
// donc rien à retirer par rapport à la sélection Gen1 d'origine (même discipline que
// useClinicDonors.js, lot 2 -- ici elle ne change simplement rien à la liste de champs).

// Durée d'une validation vétérinaire (CONTEXT.md, "Validated Donor") : 1 an, renouvelable
// en consultation.
const VALIDATION_DURATION_MS = 365 * 24 * 60 * 60 * 1000

// Clé i18n spécifique par code d'erreur levé par `validateAnimal` (voir sa doc
// ci-dessous). `BLOOD_GROUP_UNKNOWN` est le seul code connu à ce jour ; tout le reste
// (erreur réseau, @auth...) retombe sur la clé générique.
const VALIDATION_ERROR_KEYS = {
  BLOOD_GROUP_UNKNOWN: 'dashboard.validations.toasts.blood_group_unknown',
}

/**
 * Traduit le `.message` d'une erreur levée par `validateAnimal` en clé i18n à afficher à
 * l'utilisateur (`dashboard.validations.toasts.*`, cf. src/locales/*.json) — pas en texte
 * traduit directement : `useI18n()`/`t()` ne sont utilisables que dans un contexte de
 * composant, donc cette fonction pure reste en dehors de ça et laisse l'appelant (la vue)
 * faire `t(mapValidationErrorKey(e.message))`. Exportée séparément de tout composant Vue
 * pour rester testable sans monter de composant (ce repo n'a aucun test de composant `.vue`
 * à ce jour — même raisonnement que `mapAcceptMissionError` dans useOwnerMissions.js, extrait
 * pendant la Lead Dev review de feat/wire-eligibility-engine).
 *
 * @param {string} errorMessage
 * @returns {string} une clé i18n, à passer à `t()`
 */
export function mapValidationErrorKey(errorMessage) {
  return VALIDATION_ERROR_KEYS[errorMessage] || 'dashboard.validations.toasts.generic_error'
}

// Clé i18n spécifique par code d'erreur levé par `correctBloodGroup` (voir sa doc
// plus bas). Réutilise la même clé `blood_group_unknown` que `VALIDATION_ERROR_KEYS`
// pour le code `BLOOD_GROUP_UNKNOWN` (même garde-fou, même message) — mais un
// message d'erreur générique distinct pour tout le reste (réseau, @auth...) : celui de
// `mapValidationErrorKey` ("Impossible de valider cet animal") parlerait de validation,
// pas de correction de groupe sanguin, ce qui induirait le vétérinaire en erreur sur
// l'action qui a réellement échoué.
const BLOOD_GROUP_CORRECTION_ERROR_KEYS = {
  BLOOD_GROUP_UNKNOWN: 'dashboard.validations.toasts.blood_group_unknown',
}

/**
 * Traduit le `.message` d'une erreur levée par `correctBloodGroup` en clé i18n à afficher
 * à l'utilisateur — même raisonnement que `mapValidationErrorKey` ci-dessus (fonction pure,
 * hors contexte de composant, testable sans monter de composant Vue).
 *
 * @param {string} errorMessage
 * @returns {string} une clé i18n, à passer à `t()`
 */
export function mapBloodGroupCorrectionErrorKey(errorMessage) {
  return (
    BLOOD_GROUP_CORRECTION_ERROR_KEYS[errorMessage] ||
    'dashboard.validations.toasts.blood_group_correction_error'
  )
}

/**
 * Phase 1.1 : composable Veterinarian-facing pour la liste des Animals en attente de
 * validation, et l'action de validation elle-même (ADR-0002).
 *
 * ⚠️ Portée volontairement GLOBALE, pas "ma clinique" : `Animal` n'accorde aux
 * Veterinarians qu'un accès `read` global dans le schéma actuel (aucun scoping par
 * clinique — voir schema.graphql, type Animal). Un filtrage réel par clinique existerait en
 * combinant `getVeterinarian` (résout le `clinicID` du vétérinaire courant, cf.
 * `fetchClinicId()` dans `useClinicRequest.js`) avec la query générée
 * `clinicOwnerRelationsByClinicID` (existe déjà dans queries.js, mais jamais composée avec
 * une liste d'Animals nulle part dans ce repo) — pas construit ici, déferré à une phase
 * ultérieure avec le même trou pour "Clinic Priority". Pour ce pilote (une seule école
 * vétérinaire partenaire), une liste globale est une simplification honnête : elle
 * correspond exactement à ce que le modèle @auth permet déjà, plutôt que de simuler côté
 * client une frontière de sécurité par clinique qui n'existe pas réellement.
 *
 * Un Animal est "en attente" si `!isValidatedDonor(animal)` (eligibility-service.js) :
 * ça couvre aussi bien un Animal jamais validé qu'un Animal dont `isValidatedDonor` vaut
 * encore `true` en base mais dont `validationExpiresAt` est déjà dépassée — ce repo n'a
 * pas de job planifié qui repasse `isValidatedDonor` à `false` à l'expiration (
 * simplification pilote assumée), donc le statut réel se calcule toujours à la lecture
 * via cette fonction, jamais en faisant confiance au flag brut de la DB.
 *
 * `bloodGroup` n'est JAMAIS écrit par `validateAnimal` : cette action reste scopée à
 * `isValidatedDonor`/`validationExpiresAt` uniquement (`validateAnimalDonorSimple`,
 * ADR-0002). En revanche, la règle "un groupe sanguin connu est un prérequis à
 * la validation" (CONTEXT.md, "un Animal Validated Donor à groupe sanguin inconnu ne peut
 * pas exister") EST appliquée ici, comme l'assigne explicitement l'amendement de l'ADR-0002
 * à ce fichier précis — `validateAnimal` refuse la validation si le `bloodGroup` connu
 * localement (issu de `pendingAnimals`) est absent/`''`/`'UNKNOWN'`, même prédicat que celui
 * déjà utilisé par `isBloodCompatible` (eligibility-service.js) pour rester cohérent.
 *
 * Phase 6 (section B) : `correctBloodGroup` ci-dessous couvre le cas où ce `bloodGroup`
 * connu localement EST `'UNKNOWN'`/vide (saisie erronée de l'Owner) — jusque-là un
 * vétérinaire pouvait constater le problème (message `BLOOD_GROUP_UNKNOWN` ci-dessus) mais
 * n'avait aucun moyen de le corriger : `Animal.bloodGroup` n'avait pas de règle `@auth` au
 * niveau champ ouvrant l'écriture aux Veterinarians. Nouvelle règle de champ ajoutée
 * (schema.graphql) : contrairement à `isValidatedDonor`/`validationExpiresAt`,
 * `bloodGroup` reste aussi écrit par l'Owner (création/édition) — voir le commentaire dans
 * schema.graphql pour le détail de cette règle @auth, volontairement différente du pattern
 * ADR-0002/0003 (Owner `[read]` seul) pour ce champ précis.
 */
export function useAnimalValidation() {
  const client = generateClient()

  const pendingAnimals = ref([])
  const isLoading = ref(false)
  const isValidating = ref(false)
  // Ref de chargement dédiée à `correctBloodGroup`, distincte de `isValidating` (même
  // raisonnement que isLoading/isValidating déjà séparés : une correction de bloodGroup et
  // une validation sont deux actions indépendantes, potentiellement déclenchées sur deux
  // lignes différentes du tableau au même instant côté ValidationsView.vue).
  const isCorrectingBloodGroup = ref(false)
  // Distingue "chargement en erreur" de "file d'attente réellement vide" — sans ce ref,
  // un échec réseau/@auth silencieux (attrapé ci-dessous, jamais rethrow, voir le test
  // dédié plus bas) rendait exactement le même état que 0 animal en attente : un
  // vétérinaire pouvait repartir en pensant qu'il n'y a rien à valider (relevé en Lead
  // Dev review de feat/animal-validation-ui, premier écran où ce swallow devenait
  // visible côté humain).
  const loadError = ref(false)

  /**
   * Charge tous les Animals (liste globale, voir doc du composable) puis filtre côté
   * client ceux en attente de validation (`!isValidatedDonor(animal)`).
   */
  const fetchPendingValidations = async () => {
    isLoading.value = true
    loadError.value = false
    try {
      const { data, errors } = await client.models.Animal.list({
        selectionSet: [
          'id',
          'name',
          'species',
          'breed',
          'bloodGroup',
          'isValidatedDonor',
          'validationExpiresAt',
          'ownerID',
          'ownerProfile.firstname',
          'ownerProfile.lastname',
        ],
      })

      throwIfGraphqlError(errors, 'listAnimals')

      const animals = data || []
      pendingAnimals.value = animals.filter((animal) => !isValidatedDonor(animal))
    } catch (e) {
      console.error('Erreur chargement des animaux en attente de validation:', e)
      loadError.value = true
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Valide un Animal comme donneur pour 1 an à partir de maintenant. N'écrit QUE
   * `isValidatedDonor` et `validationExpiresAt` (validateAnimalDonorSimple, ADR-0002) —
   * jamais `bloodGroup` ni aucun autre champ.
   *
   * Refuse (throw `BLOOD_GROUP_UNKNOWN`) si l'Animal est trouvé dans `pendingAnimals` et que
   * son `bloodGroup` est absent/`'UNKNOWN'` — CONTEXT.md interdit un Validated Donor à groupe
   * sanguin inconnu. Si l'Animal n'est PAS (plus) dans `pendingAnimals` (ex. déjà validé par
   * un autre vétérinaire entre-temps), on ne peut pas vérifier son `bloodGroup` sans un fetch
   * supplémentaire — on laisse alors la mutation partir telle quelle, comme avant : ce cas
   * limite reste couvert par la revue humaine de la Mission plutôt que bloqué ici.
   *
   * @param {string} animalId
   */
  const validateAnimal = async (animalId) => {
    isValidating.value = true
    try {
      const knownAnimal = pendingAnimals.value.find((a) => a.id === animalId)
      if (knownAnimal && (!knownAnimal.bloodGroup || knownAnimal.bloodGroup === 'UNKNOWN')) {
        throw new Error('BLOOD_GROUP_UNKNOWN')
      }

      const validationExpiresAt = new Date(Date.now() + VALIDATION_DURATION_MS).toISOString()

      const { errors } = await client.models.Animal.update({
        id: animalId,
        isValidatedDonor: true,
        validationExpiresAt,
      })

      throwIfGraphqlError(errors, 'updateAnimal')

      pendingAnimals.value = pendingAnimals.value.filter((animal) => animal.id !== animalId)
    } catch (e) {
      console.error("Erreur validation vétérinaire de l'animal:", e)
      throw e
    } finally {
      isValidating.value = false
    }
  }

  /**
   * Corrige le `bloodGroup` d'un Animal en attente de validation, saisi par erreur par
   * l'Owner (Phase 6, section B — nouvelle règle `@auth` au niveau champ sur `bloodGroup`,
   * voir schema.graphql). N'écrit QUE `bloodGroup` (`updateAnimalBloodGroupSimple`) —
   * jamais `isValidatedDonor`/`validationExpiresAt`, qui restent le rôle exclusif de
   * `validateAnimal` ci-dessus.
   *
   * Refuse (throw `BLOOD_GROUP_UNKNOWN`, même code que `validateAnimal`) si `bloodGroup`
   * est absent/`''`/`'UNKNOWN'` — défense en profondeur : `ValidationsView.vue` alimente
   * déjà son `Select` avec `BloodGroupsBySpecies` (constants/enums.js), qui ne liste jamais
   * `'UNKNOWN'` comme option choisissable, mais cette fonction reste appelable
   * indépendamment de ce composant.
   *
   * Met à jour `pendingAnimals.value` localement avec la nouvelle valeur au succès — pas de
   * re-fetch complet : `validateAnimal` lit `bloodGroup` depuis cette même liste locale
   * (voir plus haut), donc un vétérinaire qui corrige puis valide dans la foulée doit voir
   * la correction reflétée immédiatement.
   *
   * @param {string} animalId
   * @param {string} bloodGroup Nouvelle valeur, non vide et différente de 'UNKNOWN'.
   */
  const correctBloodGroup = async (animalId, bloodGroup) => {
    isCorrectingBloodGroup.value = true
    try {
      if (!bloodGroup || bloodGroup === 'UNKNOWN') {
        throw new Error('BLOOD_GROUP_UNKNOWN')
      }

      const { errors } = await client.models.Animal.update({
        id: animalId,
        bloodGroup,
      })

      throwIfGraphqlError(errors, 'updateAnimal')

      const target = pendingAnimals.value.find((animal) => animal.id === animalId)
      if (target) {
        target.bloodGroup = bloodGroup
      }
    } catch (e) {
      console.error("Erreur correction du groupe sanguin de l'animal:", e)
      throw e
    } finally {
      isCorrectingBloodGroup.value = false
    }
  }

  return {
    pendingAnimals,
    isLoading,
    isValidating,
    isCorrectingBloodGroup,
    loadError,
    fetchPendingValidations,
    validateAnimal,
    correctBloodGroup,
  }
}
