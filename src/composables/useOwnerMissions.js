import { computed, ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { getCurrentUser } from 'aws-amplify/auth'
import {
  isValidatedDonor,
  isBloodCompatible,
  satisfiesFrequencyRule,
} from '@/services/eligibility-service'
import { throwIfGraphqlError } from '@/services/graphql-error-service'
import { applyOwnerCompletionSideEffects } from '@/composables/mission-completion-side-effects'
import {
  RequestStatus,
  RequestType,
  MissionStatus,
  MissionValidationOutcome,
} from '@/constants/enums'

// Correctif QA (2026-08-27) : `submitDonationValidation` déclenche désormais les écritures
// secondaires de fin de Mission quand c'est SON vote qui fait passer la Mission en COMPLETED
// (module partagé `mission-completion-side-effects.js`, importé aussi par
// `useMissionClosure.js` — aucun des deux composables n'importe l'autre). Avant ce correctif,
// aucune ne partait sur ce chemin, alors que le flux nominal (le vétérinaire clôture d'abord
// depuis RequestsView.vue) fait précisément de l'Owner le SECOND votant : l'annuaire donneurs
// restait vide et la Frequency Rule non réarmée pour un don pourtant confirmé des deux côtés.
// ⚠️ Ce correctif front est PARTIEL par construction et c'est documenté, pas oublié : `@auth`
// interdit à un Owner d'écrire `Animal.lastDonationDate` et les compteurs `Clinic`. La moitié
// qui comptait vraiment a été fermée CÔTÉ SERVEUR depuis (commit `8c14e7d`, ADR-0019) : la 8e
// fonction du pipeline `submitMissionValidation` écrit `Animal.lastDonationDate` dès que la
// Mission atteint `COMPLETED`, quel que soit le côté qui vote en second — la Frequency Rule est
// donc réarmée sur tous les chemins. Seuls les compteurs `Clinic` restent non incrémentés quand
// l'Owner vote en second (résidu assumé, indicateurs de tableau de bord — voir l'en-tête du
// module partagé et le JSDoc de `submitDonationValidation`).
//
// Double validation de Mission (2026-08-26, étape 4/5) : ce composable gagne
// `submitDonationValidation` (`client.mutations.submitMissionValidation`, seconde mutation
// custom de ce schéma après `linkRequestToMission`) — le pendant Owner de `closeMission`
// (useMissionClosure.js). Voir sa doc pour le contrat, et `historyMissions`/
// `awaitingValidationMissions` pour les statuts que la double validation ajoute.
//
// Phase 8, sous-tâche 5 (lot 3/3, le dernier) : migré sur le client Gen2 (`aws-amplify/data`,
// `client.models.Request.*`/`client.models.Animal.*`/`client.models.Mission.*`/
// `client.mutations.linkRequestToMission`). Les documents Gen1 (`listRequests`/`getRequest`
// -- `@/graphql/queries` --, `listMyAnimalsMissions`/`listMyAnimalsSimple`/
// `createMissionSimple`/`linkRequestToMission`/`deleteMissionSimple` -- custom-queries.js/
// custom-mutations.js) n'ont plus lieu d'être ici -- voir CLAUDE.md / roadmap Phase 8 pour la
// méthodologie de migration.
//
// Sur le changement de comportement d'erreur Gen1 -> Gen2 et `throwIfGraphqlError` : voir le
// JSDoc de `src/services/graphql-error-service.js`. Tous les appels de `fetchAvailableMissions`/
// `fetchMyMissions`/`acceptMission` reprennent `throwIfGraphqlError` (jamais
// `resolveOrThrowOnFailure`) : le Gen1 d'origine faisait toujours un simple `await
// client.graphql(...)` sans destructurer/inspecter la réponse (aucune notion de succès
// partiel), y compris pour `linkRequestToMission` -- voir le commentaire dédié sur l'étape 5
// d'`acceptMission` ci-dessous pour le détail spécifique à l'écriture atomique conditionnelle
// (ADR-0001/ADR-0011).
//
// `listMyAnimalsMissions`/`listMyAnimalsSimple` (Gen2 : `client.models.Animal.list()` avec
// `selectionSet`) : selectionSet construits en reprenant EXACTEMENT les champs sélectionnés
// par leurs équivalents Gen1 (custom-queries.js), vérifiés un par un contre ce que ce
// composable ET ses vues consommatrices (MissionsView.vue, DashboardView.vue) lisent
// réellement -- voir les commentaires posés directement sur chaque appel ci-dessous.

// Messages spécifiques par code d'erreur levé par `acceptMission` (voir sa doc
// ci-dessous pour le détail de chaque étape qui peut lever ces erreurs). Fonction
// pure, exportée séparément de tout composant Vue pour rester testable sans monter
// de composant (ce repo n'a aucun test de composant `.vue` à ce jour — voir la
// Lead Dev review de feat/wire-eligibility-engine).
const ACCEPT_MISSION_ERROR_MESSAGES = {
  REQUEST_NOT_OPEN: "Cette demande n'est plus ouverte.",
  ANIMAL_NOT_FOUND: 'Cet animal est introuvable parmi vos animaux.',
  NOT_VALIDATED_DONOR: "Cet animal n'est plus un donneur validé.",
  BLOOD_INCOMPATIBLE: "Le groupe sanguin de cet animal n'est plus compatible avec cette demande.",
  FREQUENCY_RULE_NOT_SATISFIED: 'Cet animal a donné trop récemment pour donner à nouveau.',
  REQUEST_ALREADY_TAKEN: "Cette demande vient d'être prise en charge par un autre propriétaire.",
}

/**
 * Traduit une erreur levée par `acceptMission` (son `.message`, l'un des codes
 * ci-dessus) en message utilisateur clair. Retourne `fallback` pour tout code non
 * reconnu (erreur réseau, etc.).
 *
 * @param {string} errorMessage
 * @param {string} [fallback]
 * @returns {string}
 */
export function mapAcceptMissionError(
  errorMessage,
  fallback = "Impossible d'accepter la mission.",
) {
  return ACCEPT_MISSION_ERROR_MESSAGES[errorMessage] || fallback
}

// Double validation de Mission (2026-08-26, étape 4/5) — pendant de
// `ACCEPT_MISSION_ERROR_MESSAGES` ci-dessus pour `submitDonationValidation`. Les deux codes
// couverts sont les seuls que la fonction NORMALISE elle-même (voir sa doc) : tout le reste
// (réseau, `@auth`, `Unauthorized` du resolver pour un appelant hors groupe) retombe sur le
// message générique.
const SUBMIT_DONATION_VALIDATION_ERROR_MESSAGES = {
  ALREADY_VALIDATED:
    'Vous avez déjà répondu pour cette mission — votre réponse ne peut plus être modifiée.',
  INVALID_OUTCOME: 'Réponse invalide : indiquez si le don a eu lieu ou non.',
  // 2026-08-28 (docs/adr/0020) : message VOLONTAIREMENT distinct d'`ALREADY_VALIDATED`, c'est
  // toute la raison d'être du code d'erreur serveur séparé. Les deux cas sont irrécupérables de
  // la même façon (aucun retry possible) mais n'ont pas la même cause côté utilisateur : ici
  // l'Owner n'a rien fait de mal — c'est le délai de réponse qui a expiré et la finalisation
  // automatique (`COMPLETED_AUTO`/`DISPUTED`, Lambda planifiée, ADR-0016) qui a tranché à sa
  // place. Lui répondre "vous avez déjà répondu" serait faux et incompréhensible.
  MISSION_ALREADY_FINALIZED:
    'Cette mission a déjà été clôturée (délai de réponse dépassé) — votre réponse ne peut plus être enregistrée.',
}

/**
 * Traduit une erreur levée par `submitDonationValidation` (son `.message`, l'un des codes
 * ci-dessus) en message utilisateur clair. Même forme, mêmes raisons et même testabilité que
 * `mapAcceptMissionError` ci-dessus (fonction pure exportée à côté du composable, hors de
 * tout composant `.vue`). Retourne `fallback` pour tout code non reconnu.
 *
 * @param {string} errorMessage
 * @param {string} [fallback]
 * @returns {string}
 */
export function mapSubmitDonationValidationError(
  errorMessage,
  fallback = 'Impossible d’enregistrer votre réponse pour cette mission.',
) {
  return SUBMIT_DONATION_VALIDATION_ERROR_MESSAGES[errorMessage] || fallback
}

/**
 * Détecte si une erreur renvoyée par `client.graphql()` correspond à l'échec de la
 * condition atomique posée sur `linkRequestToMission` (ADR-0001 : `Request.status = OPEN`),
 * par opposition à une erreur d'un autre type (réseau, @auth, validation...).
 *
 * ⚠️ Hypothèse non vérifiable dans cette session (pas de backend AppSync live) — à confirmer
 * une fois déployé, cf. rapport de la sous-tâche. Ce qu'on sait avec certitude en lisant
 * node_modules/@aws-amplify/api-graphql/dist/cjs/internals/InternalGraphQLAPI.js : quand la
 * réponse GraphQL contient un tableau `errors` non vide, `client.graphql()` ne throw PAS une
 * simple `Error` JS mais l'objet réponse lui-même (`{ data, errors }`,
 * `throw repackageUnauthorizedError(response)` quand `isGraphQLResponseWithErrors(response)`
 * est vrai) — donc l'erreur catchée ici a la forme `{ data, errors: [...] }`, pas
 * `error.message` directement. Ce qui reste une hypothèse documentaire (AWS AppSync +
 * DynamoDB, Transformer v1) plutôt que vérifié dans ce repo : un ConditionExpression DynamoDB
 * qui échoue derrière un resolver AppSync généré remonte typiquement dans
 * `errors[0].errorType === 'DynamoDB:ConditionalCheckFailedException'` avec un message du
 * type "The conditional request failed". On vérifie errorType en priorité, message en repli,
 * pour rester robuste si l'un des deux champs varie selon la version d'AppSync/Transformer.
 */
const isConditionalCheckFailure = (error) => {
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
 * Détecte l'erreur `ALREADY_VALIDATED` levée par le resolver `submitMissionValidation`
 * (fonction 1/3, `submit-mission-validation-write-side.js`) quand CE côté a déjà soumis sa
 * validation pour cette Mission — write-once par côté, condition DynamoDB
 * `attributeExists: false` sur le champ d'outcome de l'appelant.
 *
 * Contrairement à `isConditionalCheckFailure` ci-dessus (qui doit deviner la forme d'une
 * erreur DynamoDB remontée par un resolver GÉNÉRÉ), le code lu ici est celui que NOTRE
 * resolver pose explicitement : `util.error(message, 'ALREADY_VALIDATED', ...)` place cette
 * chaîne dans `errorType` de l'entrée `errors` correspondante — pas une supposition sur le
 * comportement d'AppSync, mais le contrat de `util.error(message, errorType, data)`. On lit
 * quand même le `message` en repli, par symétrie avec `isConditionalCheckFailure` et pour
 * rester robuste si une future version d'AppSync remaniait la sérialisation.
 *
 * L'erreur inspectée ici est celle synthétisée par `throwIfGraphqlError` (elle porte
 * `.errors`, le tableau `GraphQLFormattedError` d'origine), pas la réponse `{ data, errors }`
 * elle-même — voir graphql-error-service.js.
 */
const isAlreadyValidatedError = (error) => {
  const graphQLErrors = error?.errors
  if (!Array.isArray(graphQLErrors)) return false

  return graphQLErrors.some((e) => {
    const errorType = e?.errorType || ''
    const message = (e?.message || '').toLowerCase()
    return errorType === 'ALREADY_VALIDATED' || message.includes('déjà soumis sa validation')
  })
}

/**
 * Détecte l'erreur `MISSION_ALREADY_FINALIZED` levée par le resolver (fonction 5/8,
 * `submit-mission-validation-write-side.js`, correctif du 2026-08-28 — docs/adr/0020) quand la
 * Mission porte DÉJÀ un statut terminal au moment du vote : typiquement une finalisation
 * automatique (`COMPLETED_AUTO`/`DISPUTED`) prononcée par la Lambda planifiée après expiration du
 * délai de réponse. Ce cas est MUTUELLEMENT EXCLUSIF d'`ALREADY_VALIDATED` côté serveur (la garde
 * de statut précède la condition write-once, et le resolver n'émet qu'une seule erreur), mais les
 * deux sont testés séparément ici : les confondre redonnerait à l'Owner le message "vous avez déjà
 * répondu" alors qu'il n'a précisément jamais pu répondre.
 *
 * Même forme et mêmes garanties que `isAlreadyValidatedError` ci-dessus : le code lu est celui que
 * NOTRE resolver pose explicitement (`util.error(message, 'MISSION_ALREADY_FINALIZED')` -> champ
 * `errorType`), avec le `message` en repli par symétrie.
 */
const isMissionAlreadyFinalizedError = (error) => {
  const graphQLErrors = error?.errors
  if (!Array.isArray(graphQLErrors)) return false

  return graphQLErrors.some((e) => {
    const errorType = e?.errorType || ''
    const message = (e?.message || '').toLowerCase()
    return errorType === 'MISSION_ALREADY_FINALIZED' || message.includes('déjà clôturée')
  })
}

export function useOwnerMissions() {
  const client = generateClient()

  const missions = ref([])
  const myMissions = ref([])
  const isLoading = ref(false)
  const isAccepting = ref(false)
  // Ref de chargement dédiée à `submitDonationValidation` (même convention que `isAccepting`
  // ci-dessus) — surtout PAS partagée avec `isAccepting` : accepter une Request et valider un
  // don sont deux actions distinctes, potentiellement affichées sur le même écran, et un
  // spinner partagé bloquerait visuellement la mauvaise.
  const isSubmittingValidation = ref(false)
  // Phase 7.6 (R-09) : distingue "chargement en erreur" d'une liste réellement vide pour les
  // deux flux principaux de lecture ci-dessous (fetchAvailableMissions/fetchMyMissions),
  // même convention `loadError` que le reste du repo (CLAUDE.md). Partagé entre les deux
  // fetchers comme `isLoading` l'est déjà. Ne couvre QUE ces flux principaux : le nettoyage
  // best-effort de la Mission orpheline dans `acceptMission()` (voir son catch dédié
  // plus bas) continue d'avaler son erreur sans jamais toucher `loadError` — une écriture
  // secondaire best-effort ne doit pas se travestir en échec de lecture de la liste.
  const loadError = ref(false)

  const fetchAvailableMissions = async () => {
    isLoading.value = true
    loadError.value = false
    try {
      // Pas de `selectionSet` dédié : lecture PLATE (aucune relation imbriquée), tous les
      // champs consommés ci-dessous (requestType, createdAt) sont des scalaires de Request
      // déjà couverts par le selectionSet par défaut du client Gen2 -- même raisonnement que
      // useMissionClosure.js (Clinic.get()/ClinicOwnerRelation.list()).
      const { data, errors } = await client.models.Request.list({
        filter: { status: { eq: RequestStatus.OPEN } },
      })

      throwIfGraphqlError(errors, 'listRequests')

      const requests = data || []
      missions.value = requests.sort((a, b) => {
        if (a.requestType === RequestType.EMERGENCY && b.requestType !== RequestType.EMERGENCY) return -1
        if (a.requestType !== RequestType.EMERGENCY && b.requestType === RequestType.EMERGENCY) return 1
        return new Date(b.createdAt) - new Date(a.createdAt)
      })
    } catch (e) {
      console.error('Erreur chargement missions:', e)
      loadError.value = true
    } finally {
      isLoading.value = false
    }
  }

  const fetchMyMissions = async () => {
    isLoading.value = true
    loadError.value = false
    try {
      const { userId } = await getCurrentUser()

      // selectionSet reprenant EXACTEMENT les champs sélectionnés par `listMyAnimalsMissions`
      // (Gen1, custom-queries.js) -- vérifiés un par un contre ce que ce composable ET
      // MissionsView.vue consomment réellement (animalName/animalSpecies flattenés
      // ci-dessous ; mission.status/appointmentDatetime ; mission.request.clinic.name/
      // address/phone/latitude/longitude, affichés/ouverts dans Maps par MissionsView.vue --
      // `mission.request.id`/`requestType` eux-mêmes ne sont consommés par aucune vue, mais
      // reproduits tels quels : traduction mécanique de la query Gen1, pas une occasion de
      // resserrer davantage ici). `animal.missions`/`mission.request` sont des tableaux/objets
      // directs (relation `selectionSet` Gen2), jamais enveloppés dans `{ items: [...] }`
      // comme le faisait Gen1 -- voir useClinicDonors.js pour ce même comportement déjà
      // rencontré en lot 2.
      const { data, errors } = await client.models.Animal.list({
        filter: { ownerID: { eq: userId } },
        selectionSet: [
          'id',
          'name',
          'species',
          'missions.id',
          'missions.status',
          'missions.appointmentDatetime',
          'missions.request.id',
          'missions.request.requestType',
          'missions.request.clinic.name',
          'missions.request.clinic.address',
          'missions.request.clinic.phone',
          'missions.request.clinic.latitude',
          'missions.request.clinic.longitude',
        ],
      })

      throwIfGraphqlError(errors, 'listAnimals')

      const flatList = []

      const animals = data || []
      animals.forEach((animal) => {
        const animalMissions = animal.missions || []
        animalMissions.forEach((mission) => {
          flatList.push({
            ...mission,
            animalName: animal.name,
            animalSpecies: animal.species,
          })
        })
      })

      myMissions.value = flatList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    } catch (e) {
      console.error('Erreur chargement mes missions:', e)
      loadError.value = true
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Accepte une Request au nom de l'Owner courant, pour l'Animal `animalId` choisi.
   *
   * 1. Recharge la Request fraîche (`getRequest`) — vérif rapide côté client, PAS la garde
   *    faisant autorité contre la course concurrente (voir étape 5 / ADR-0001) : juste un
   *    fail-fast pour le cas courant "déjà fermée" avant de faire tout le reste du travail.
   * 2. Recharge les Animals de l'Owner (`listMyAnimalsSimple`, scoping owner via @auth) et
   *    retrouve celui désigné par `animalId`.
   * 3. Valide l'Animal contre la Request via les 3 gates d'Eligibility pertinents à ce
   *    stade (CONTEXT.md critères 1 à 3), dans cet ordre précis — on réutilise les fonctions
   *    pures d'eligibility-service.js plutôt que le composite `checkEligibility()`, dont les
   *    critères 4/5 (distance, Clinic Priority) n'ont pas de sens ici : l'Owner vient de
   *    choisir d'accepter, revalider sa propre préférence de distance de trajet contre
   *    lui-même n'a pas de sens.
   * 4. Crée la Mission.
   * 5. Lie la Request à la Mission via une écriture atomique conditionnelle sur
   *    `Request.status = OPEN` (ADR-0001) — c'est la garde qui fait réellement autorité. Si
   *    la condition échoue (Request déjà prise par un autre Owner entre-temps), on nettoie
   *    la Mission orpheline créée à l'étape 4 en best-effort puis on remonte une erreur dédiée.
   * 6. Met à jour l'état local et renvoie le nom de l'Animal (même contrat qu'avant, utilisé
   *    par DashboardView.vue pour son message de succès).
   *
   * @param {string} requestId
   * @param {string} animalId
   * @returns {Promise<string>} le nom de l'Animal donneur
   */
  const acceptMission = async (requestId, animalId) => {
    isAccepting.value = true
    try {
      // 1. Fast client-side check (pas la garde faisant autorité, voir étape 5). Pas de
      // `selectionSet` : lecture PLATE, tous les champs consommés plus bas (status, id,
      // requiredSpecies, requiredBloodGroup, requestType) sont des scalaires de Request
      // couverts par le selectionSet par défaut.
      const { data: request, errors: requestErrors } = await client.models.Request.get({
        id: requestId,
      })
      throwIfGraphqlError(requestErrors, 'getRequest')
      if (!request || request.status !== RequestStatus.OPEN) {
        throw new Error('REQUEST_NOT_OPEN')
      }

      // 2. Retrouve l'Animal désigné parmi ceux de l'Owner courant (scoping owner via
      // `allow.owner()`, schema.graphql/resource.ts : absent de la liste couvre aussi bien
      // "n'existe pas" que "pas le vôtre"). Pas de `filter: { ownerID: { eq } }` ici --
      // traduction mécanique de `listMyAnimalsSimple` (Gen1, custom-queries.js), qui
      // n'envoyait déjà aucun filtre/variable et s'appuyait uniquement sur le scoping @auth
      // owner pour restreindre `listAnimals` aux animaux de l'Owner courant (contrairement à
      // `listMyAnimalsByOwnerId`/`useAnimals.fetchAnimals()`, qui filtre explicitement par
      // `ownerID` -- deux queries Gen1 distinctes, reproduites telles quelles).
      // selectionSet reprenant EXACTEMENT les champs de `listMyAnimalsSimple` (Gen1) --
      // tous consommés par les 3 gates d'Eligibility et le retour de la fonction ci-dessous
      // (species/bloodGroup, isValidatedDonor/validationExpiresAt, lastDonationDate/
      // donationFrequency, name).
      const { data: myAnimals, errors: animalsErrors } = await client.models.Animal.list({
        selectionSet: [
          'id',
          'name',
          'species',
          'bloodGroup',
          'isValidatedDonor',
          'validationExpiresAt',
          'lastDonationDate',
          'donationFrequency',
        ],
      })
      throwIfGraphqlError(animalsErrors, 'listAnimals')
      const animal = (myAnimals || []).find((a) => a.id === animalId)
      if (!animal) throw new Error('ANIMAL_NOT_FOUND')

      // 3. Eligibility (CONTEXT.md), critères 1 à 3, dans l'ordre hiérarchisé imposé.
      if (!isValidatedDonor(animal)) throw new Error('NOT_VALIDATED_DONOR')
      if (
        !isBloodCompatible(
          request.requiredSpecies,
          request.requiredBloodGroup,
          animal.species,
          animal.bloodGroup,
        )
      ) {
        throw new Error('BLOOD_INCOMPATIBLE')
      }
      if (!satisfiesFrequencyRule(animal)) throw new Error('FREQUENCY_RULE_NOT_SATISFIED')

      // 4. Crée la Mission.
      const missionInput = {
        requestID: request.id,
        animalID: animal.id,
        status:
          request.requestType === RequestType.EMERGENCY
            ? MissionStatus.PENDING_ARRIVAL
            : MissionStatus.ACCEPTED,
        appointmentDatetime: new Date().toISOString(),
      }

      const { data: createdMission, errors: createMissionErrors } =
        await client.models.Mission.create(missionInput)
      throwIfGraphqlError(createMissionErrors, 'createMission')

      const newMissionId = createdMission.id

      // 5. Écriture atomique conditionnelle (ADR-0001/ADR-0011) : garde faisant autorité
      // contre la course concurrente entre Owners. `client.mutations.linkRequestToMission(...)`
      // (mutation custom Gen2, resolver JS `amplify/data/resolvers/link-request-to-mission.js`,
      // voir ADR-0011) a EXACTEMENT le même contrat `Promise<{ data, errors }>` que
      // `client.models.X.*` -- confirmé (Lead Dev, lecture directe des types installés
      // `@aws-amplify/data-schema-types`) -- donc aucun traitement spécial requis pour cette
      // raison. Routé via `throwIfGraphqlError` (PAS `resolveOrThrowOnFailure`) : un échec de
      // condition ne renvoie jamais de `data` exploitable, et `throwIfGraphqlError` correspond
      // au comportement Gen1 d'origine -- toujours lever, jamais de succès partiel. L'exception
      // synthétisée porte `.errors` (même tableau `GraphQLFormattedError[]` que la réponse
      // d'origine), donc `isConditionalCheckFailure(linkError)` ci-dessous continue de
      // s'appliquer SANS AUCUNE modification -- seul CE point d'appel change (un
      // `client.graphql()` qui n'existe plus), pas la fonction `isConditionalCheckFailure`
      // elle-même (voir son JSDoc, inchangé).
      try {
        const { errors: linkErrors } = await client.mutations.linkRequestToMission({
          id: request.id,
          activeMissionID: newMissionId,
        })
        throwIfGraphqlError(linkErrors, 'linkRequestToMission')
      } catch (linkError) {
        if (isConditionalCheckFailure(linkError)) {
          // Best-effort : évite de laisser une Mission orpheline (sans Request liée) si la
          // condition a échoué. Un échec de ce nettoyage ne doit pas masquer l'erreur d'origine.
          try {
            const { errors: deleteErrors } = await client.models.Mission.delete({
              id: newMissionId,
            })
            throwIfGraphqlError(deleteErrors, 'deleteMission')
          } catch (cleanupError) {
            console.error(
              'Erreur nettoyage Mission orpheline après échec acceptation concurrente:',
              cleanupError,
            )
          }
          throw new Error('REQUEST_ALREADY_TAKEN')
        }
        throw linkError
      }

      // 6. Succès.
      missions.value = missions.value.filter((m) => m.id !== requestId)
      return animal.name
    } catch (e) {
      console.error('Erreur acceptation:', e)
      throw e
    } finally {
      isAccepting.value = false
    }
  }
  /**
   * Résout le `clinicID` de la clinique concernée par une Mission (`Mission.request.clinicID`),
   * nécessaire à l'upsert `ClinicOwnerRelation` déclenché quand le vote de l'Owner fait passer
   * la Mission en `COMPLETED`.
   *
   * CHOIX (à scruter en revue) : résolu ICI par une lecture dédiée, plutôt que reçu en
   * paramètre comme `closeMission(..., clinicID, ownerID)` le fait côté vétérinaire. Les deux
   * côtés ne sont pas dans la même situation : `RequestsView.vue` a déjà la Request complète en
   * main (`listRequestsByClinic`) et passer son `clinicID` ne lui coûte rien, alors que côté
   * Owner la seule source possible serait la liste que CE composable a lui-même produite —
   * la faire transiter par la vue pour la lui repasser ensuite serait un détour, et rendrait
   * `submitDonationValidation` silencieusement inopérante pour tout appelant qui n'aurait pas
   * appelé `fetchMyMissions()` au préalable (état local vide). C'est aussi la situation exacte
   * de la Lambda `mission-validation-auto-finalizer`, qui résout de la même façon
   * `Request.clinicID` faute de `clinicID` sur `Mission` (ADR-0016 §5).
   *
   * `selectionSet` réduit au strict nécessaire (un seul champ, à travers une relation) — la
   * convention CLAUDE.md vise précisément ce cas.
   *
   * Best-effort, contrairement aux helpers de résolution de contexte du reste du repo
   * (`fetchClinicId()`/`fetchClinicContext()`, qui laissent délibérément remonter leurs
   * erreurs) : ceux-là conditionnent un flux de LECTURE dont l'échec doit devenir visible via
   * `loadError`. Ici, le vote de l'Owner est déjà enregistré côté serveur et irréversible
   * (write-once) au moment de l'appel — laisser remonter une erreur de cette lecture
   * transformerait une soumission RÉUSSIE en échec affiché, sans aucun retry possible.
   *
   * @param {string} missionId
   * @returns {Promise<string|null>} le `clinicID`, ou `null` (introuvable ou erreur)
   */
  const resolveMissionClinicId = async (missionId) => {
    try {
      const { data, errors } = await client.models.Mission.get(
        { id: missionId },
        { selectionSet: ['request.clinicID'] },
      )
      throwIfGraphqlError(errors, 'getMission')
      return data?.request?.clinicID ?? null
    } catch (e) {
      console.error(
        'Erreur résolution de la clinique de la mission (écritures secondaires de fin de Mission) :',
        e,
      )
      return null
    }
  }

  /**
   * Identité de l'Owner authentifié courant, pour l'upsert `ClinicOwnerRelation`
   * (`ClinicOwnerRelation.ownerID`). Même source que `fetchMyMissions` (`getCurrentUser()`),
   * jamais un paramètre : c'est l'identité de l'appelant lui-même, la faire fournir par la vue
   * n'apporterait qu'un risque de divergence. Best-effort pour la même raison que
   * `resolveMissionClinicId` ci-dessus.
   *
   * @returns {Promise<string|null>}
   */
  const resolveCurrentOwnerId = async () => {
    try {
      const { userId } = await getCurrentUser()
      return userId ?? null
    } catch (e) {
      console.error(
        "Erreur résolution de l'identité du propriétaire (écritures secondaires de fin de Mission) :",
        e,
      )
      return null
    }
  }

  /**
   * Soumet la validation CÔTÉ OWNER pour une Mission — pendant exact de `closeMission`
   * (useMissionClosure.js) côté vétérinaire. Le rôle de l'appelant n'est JAMAIS envoyé : il
   * est déterminé côté serveur via `ctx.identity.groups` (resolver
   * `submit-mission-validation-write-side.js`), donc rien à passer ici pour l'indiquer.
   *
   * Vocabulaire : contrairement à `closeMission` (qui traduit un `MissionStatus` en
   * `MissionValidationOutcome` pour préserver un contrat public antérieur), cette fonction
   * est NEUVE — elle parle donc directement le vocabulaire du resolver
   * (`MissionValidationOutcome.CONFIRMED`/`DENIED`), sans table de traduction à maintenir ni
   * risque d'inversion.
   *
   * ÉCRITURES SECONDAIRES quand c'est CE vote qui fait passer la Mission en `COMPLETED`
   * (correctif QA du 2026-08-27 — remplace un commentaire précédent qui affirmait à tort
   * qu'AUCUNE écriture n'était nécessaire ici, et que « la Lambda planifiée ou la prochaine
   * action côté clinique » s'en chargerait : les deux affirmations étaient fausses. La Lambda
   * `mission-validation-auto-finalizer` ne traite QUE les Missions restées en
   * `PENDING_VALIDATION` — celle-ci est déjà `COMPLETED` ; et le côté clinique a déjà voté,
   * write-once, il ne peut plus rien déclencher. Le flux nominal — le vétérinaire clôture
   * d'abord depuis RequestsView.vue — fait précisément de l'Owner le SECOND votant, donc ce
   * chemin est le cas COURANT, pas un cas limite).
   *
   * Ce qui est fait ici, et ce qui ne peut PAS l'être (asymétrie `@auth`, vérifiée sur le SDL
   * compilé — détail dans l'en-tête de `mission-completion-side-effects.js`) :
   * - ✅ upsert `ClinicOwnerRelation` : la ligne appartient à l'Owner
   *   (`{allow: owner, ownerField: "ownerID"}`, ADR-0009), il peut la créer. C'est ce qui
   *   peuple l'annuaire donneurs de la clinique (`DonorsView.vue`).
   * - ❌ `Animal.lastDonationDate` (Owner en `[read]` seul, ADR-0003) et compteurs `Clinic`
   *   (Owner en `[read]` seul) : structurellement impossibles depuis un client Owner. Ils ne
   *   sont donc PAS tentés (une mutation qu'on sait refusée ne ferait que du bruit de log).
   *   `Animal.lastDonationDate` n'est PLUS un résidu : il est écrit CÔTÉ SERVEUR depuis le
   *   commit `8c14e7d` (ADR-0019, 8e fonction du pipeline `submitMissionValidation`), sur tous
   *   les chemins et dans un fuseau explicite — la Frequency Rule est donc bien réarmée quand
   *   l'Owner vote en second. Reste ouvert, et assumé : les compteurs `Clinic` sur ce chemin
   *   (indicateurs de tableau de bord, coût de fermeture disproportionné — ADR-0019 §4).
   *
   * Ces écritures ne peuvent jamais faire échouer la soumission (best-effort strict) : le vote
   * est déjà enregistré côté serveur et non rejouable quand elles partent.
   *
   * Met à jour l'entrée correspondante de `myMissions` avec le statut retourné, pour que les
   * computed (`activeMissions`/`awaitingValidationMissions`/`historyMissions`) reflètent
   * immédiatement le nouvel état sans imposer un `fetchMyMissions()` complet à l'appelant —
   * même esprit que `acceptMission`, qui retire la Request acceptée de `missions`.
   *
   * @param {string} missionId
   * @param {string} outcome - `MissionValidationOutcome.CONFIRMED` (le don a bien eu lieu) ou
   *   `MissionValidationOutcome.DENIED` (il n'a pas eu lieu). `PENDING` est refusé : c'est
   *   l'état initial implicite, pas une soumission (le resolver le rejetterait de toute façon
   *   avec `InvalidOutcome`, on fail-fast avant l'appel réseau).
   * @param {string} [disputeReason] - motif de litige en texte libre, transmis UNIQUEMENT
   *   avec `DENIED`. Décision assumée (à scruter en revue) : un `disputeReason` fourni avec
   *   `CONFIRMED` est IGNORÉ plutôt que transmis. `Mission.ownerDisputeReason` est write-once
   *   et sert de trace probante d'un désaccord ; l'écrire sur une Mission que l'Owner vient
   *   de confirmer produirait une donnée qui contredit durablement son propre outcome. Le
   *   schéma ne peut pas l'interdire (aucune contrainte conditionnelle entre deux champs,
   *   limite `@auth` connue depuis ADR-0002) — c'est donc ici la seule garde possible.
   * @returns {Promise<string|null>} le statut RÉEL de la Mission après cette soumission
   *   (`PENDING_VALIDATION` tant que la clinique n'a pas répondu, ou `COMPLETED`/`NO_SHOW`/
   *   `DISPUTED`), `null` si le serveur n'a renvoyé aucune donnée exploitable sans erreur.
   *   Même contrat de retour que `closeMission` — permet à une future vue d'afficher « en
   *   attente de la confirmation de la clinique » sans re-changer cette signature.
   * @throws {Error} `INVALID_OUTCOME` (avant tout appel réseau), `ALREADY_VALIDATED` (ce
   *   côté a déjà voté, write-once serveur) ou `MISSION_ALREADY_FINALIZED` (la Mission portait
   *   déjà un statut terminal — typiquement finalisée automatiquement par la Lambda planifiée
   *   faute de réponse dans le délai, docs/adr/0020) — trois codes à passer à
   *   `mapSubmitDonationValidationError`. Toute autre erreur est propagée telle quelle.
   */
  const submitDonationValidation = async (missionId, outcome, disputeReason) => {
    if (
      outcome !== MissionValidationOutcome.CONFIRMED &&
      outcome !== MissionValidationOutcome.DENIED
    ) {
      throw new Error('INVALID_OUTCOME')
    }

    isSubmittingValidation.value = true
    try {
      const input = { missionId, outcome }
      // Voir le JSDoc (@param disputeReason) : jamais transmis avec CONFIRMED.
      const trimmedReason = typeof disputeReason === 'string' ? disputeReason.trim() : ''
      if (outcome === MissionValidationOutcome.DENIED && trimmedReason) {
        input.disputeReason = trimmedReason
      }

      const { data, errors } = await client.mutations.submitMissionValidation(input)
      throwIfGraphqlError(errors, 'submitMissionValidation')

      const finalStatus = data?.status ?? null

      if (finalStatus) {
        myMissions.value = myMissions.value.map((m) =>
          m.id === missionId ? { ...m, status: finalStatus } : m,
        )
      }

      // STRICTEMENT `COMPLETED`, exactement le même garde-fou que côté vétérinaire
      // (`useMissionClosure.closeMission`) : jamais sur `PENDING_VALIDATION` (la clinique n'a
      // pas encore répondu), jamais sur `DISPUTED`/`NO_SHOW` (pas de don réalisé), jamais sur
      // `COMPLETED_AUTO` (produit par la seule Lambda planifiée, qui fait déjà ces écritures
      // de son côté — ADR-0016 §4 ; les refaire ici compterait le don deux fois).
      if (finalStatus === MissionStatus.COMPLETED) {
        const [clinicID, ownerID] = await Promise.all([
          resolveMissionClinicId(missionId),
          resolveCurrentOwnerId(),
        ])
        await applyOwnerCompletionSideEffects(client, { clinicID, ownerID })
      }

      return finalStatus
    } catch (e) {
      console.error('Erreur validation du don (côté propriétaire):', e)
      if (isAlreadyValidatedError(e)) {
        throw new Error('ALREADY_VALIDATED')
      }
      // docs/adr/0020 — normalisé comme `ALREADY_VALIDATED` juste au-dessus, et pour la même
      // raison : sans ça, `mapSubmitDonationValidationError` (qui lit le `.message`) recevrait le
      // message serveur brut et retomberait sur son libellé générique, rendant le code d'erreur
      // dédié inutile côté UI.
      if (isMissionAlreadyFinalizedError(e)) {
        throw new Error('MISSION_ALREADY_FINALIZED')
      }
      throw e
    } finally {
      isSubmittingValidation.value = false
    }
  }

  // `PENDING_VALIDATION` n'est délibérément PAS ajouté ici (décision de cette sous-tâche, à
  // scruter en revue) : `activeMissions` porte la sémantique « il reste quelque chose à faire
  // sur le terrain » (se rendre à la clinique, honorer le rendez-vous) et alimente le compteur
  // de missions actives de MissionsView.vue. Une Mission en attente de validation n'a plus
  // d'action de terrain, seulement une réponse à donner — la mélanger ici gonflerait ce
  // compteur avec des missions déjà vécues. Elle a donc son propre computed
  // (`awaitingValidationMissions`), et n'est PAS non plus dans `historyMissions` : son issue
  // n'est pas encore décidée.
  const activeMissions = computed(() => {
    return myMissions.value.filter((m) =>
      [MissionStatus.ACCEPTED, MissionStatus.PENDING_ARRIVAL].includes(m.status),
    )
  })

  /**
   * Missions dont le don a eu lieu (ou pas) mais dont l'issue attend encore une réponse d'un
   * des deux côtés — c'est ici que vit l'action « le don a-t-il eu lieu ? »
   * (`submitDonationValidation`) côté Owner. Câblage UI hors périmètre de cette sous-tâche
   * (aucune vue ne consomme encore ce computed) : exposé maintenant pour que la PR de suivi
   * n'ait ni à modifier ce composable ni à trancher à nouveau où loger ce statut.
   */
  const awaitingValidationMissions = computed(() => {
    return myMissions.value.filter((m) => m.status === MissionStatus.PENDING_VALIDATION)
  })

  const historyMissions = computed(() => {
    // Étendu à COMPLETED_AUTO/DISPUTED (double validation, 2026-08-26) : ce sont deux issues
    // TERMINALES au même titre que COMPLETED/NO_SHOW — `COMPLETED_AUTO` (finalisation
    // automatique faute de réponse du second côté, Lambda planifiée ADR-0016) et `DISPUTED`
    // (les deux côtés ont répondu, en désaccord — aucune interface de résolution admin n'est
    // construite, ADR-0016 §6). Sans elles, une Mission finalisée par l'un de ces deux chemins
    // disparaîtrait purement et simplement de l'écran du propriétaire.
    // `MissionStatus.CANCELLED` remplace ici le littéral `'CANCELLED'` et son commentaire
    // devenu faux (l'enum a gagné cette valeur depuis, R-13/Phase 7) — même expression déjà
    // réécrite par cette sous-tâche, pas un passage de correction séparé.
    return myMissions.value.filter((m) =>
      [
        MissionStatus.COMPLETED,
        MissionStatus.COMPLETED_AUTO,
        MissionStatus.NO_SHOW,
        MissionStatus.DISPUTED,
        MissionStatus.CANCELLED,
      ].includes(m.status),
    )
  })

  return {
    missions,
    myMissions,
    activeMissions,
    awaitingValidationMissions,
    historyMissions,
    isLoading,
    isAccepting,
    isSubmittingValidation,
    loadError,
    fetchAvailableMissions,
    acceptMission,
    submitDonationValidation,
    fetchMyMissions,
  }
}
