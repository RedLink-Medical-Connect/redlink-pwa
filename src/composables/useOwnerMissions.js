import { computed, ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { getCurrentUser } from 'aws-amplify/auth'
import {
  isValidatedDonor,
  isBloodCompatible,
  satisfiesFrequencyRule,
} from '@/services/eligibility-service'
import { throwIfGraphqlError } from '@/services/graphql-error-service'
import { RequestStatus, RequestType, MissionStatus } from '@/constants/enums'

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

export function useOwnerMissions() {
  const client = generateClient()

  const missions = ref([])
  const myMissions = ref([])
  const isLoading = ref(false)
  const isAccepting = ref(false)
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
  const activeMissions = computed(() => {
    return myMissions.value.filter((m) =>
      [MissionStatus.ACCEPTED, MissionStatus.PENDING_ARRIVAL].includes(m.status),
    )
  })

  const historyMissions = computed(() => {
    // 'CANCELLED' n'a pas d'équivalent dans MissionStatus (constants/enums.js) — laissé en
    // littéral, pas touché par cette substitution mécanique (hors périmètre de ce sous-tâche).
    return myMissions.value.filter((m) =>
      [MissionStatus.COMPLETED, MissionStatus.NO_SHOW, 'CANCELLED'].includes(m.status),
    )
  })

  return {
    missions,
    myMissions,
    activeMissions,
    historyMissions,
    isLoading,
    isAccepting,
    loadError,
    fetchAvailableMissions,
    acceptMission,
    fetchMyMissions,
  }
}
