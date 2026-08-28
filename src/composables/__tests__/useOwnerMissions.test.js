import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Sous-tâche Phase 0.3 (ADR-0001) : acceptMission(request) -> acceptMission(requestId, animalId).
// La fonction recharge elle-même la Request (getRequest) et l'Animal (listMyAnimalsSimple)
// plutôt que de faire confiance aux objets déjà en mémoire côté client, valide l'Animal via
// les 3 gates d'Eligibility pertinents (isValidatedDonor, isBloodCompatible,
// satisfiesFrequencyRule, dans cet ordre), puis conditionne l'écriture de liaison
// Request -> Mission sur `Request.status = OPEN` au niveau DynamoDB.
//
// Phase 8, sous-tâche 5 (lot 3/3, le dernier) : mock migré vers le client Gen2
// (`aws-amplify/data`, `client.models.{Request,Animal,Mission}.*` + `client.mutations.
// linkRequestToMission`, ADR-0011), un mock dédié par méthode plutôt qu'un unique
// `graphqlMock` discriminé par le texte de la query (même convention que les lots 1/2).
// Assertions métier (codes d'erreur, ordre des gates d'Eligibility, nettoyage best-effort de
// la Mission orpheline) inchangées -- seule la forme du mock/des assertions de câblage
// réseau change. Point le plus sensible (voir le commentaire dédié plus bas) : le test de
// course concurrente (REQUEST_ALREADY_TAKEN) doit désormais simuler l'échec de condition via
// une réponse RÉSOLUE `{ data: null, errors: [...] }` sur `client.mutations.
// linkRequestToMission`, PAS une exception JS rejetée -- c'est le nouveau contrat Gen2
// (`client.models.X.*`/`client.mutations.*` ne lèvent plus pour une erreur GraphQL/@auth, ils
// résolvent avec `{ data, errors }`, voir graphql-error-service.js). Un test dédié couvre en
// plus le cas où l'appel rejette une vraie exception JS (panne réseau), pour ne pas perdre
// cette couverture au passage.

const requestGetMock = vi.fn()
const animalListMock = vi.fn()
const missionCreateMock = vi.fn()
const missionDeleteMock = vi.fn()
const missionGetMock = vi.fn()
const linkRequestToMissionMock = vi.fn()
const submitMissionValidationMock = vi.fn()
// Correctif QA (2026-08-27) : le côté Owner déclenche désormais une écriture secondaire quand
// SON vote fait passer la Mission en COMPLETED (upsert ClinicOwnerRelation, module partagé
// `mission-completion-side-effects.js`). `Animal.update`/`Clinic.*` sont mockés eux aussi, non
// pas parce que ce composable les appelle, mais précisément pour pouvoir prouver qu'il ne les
// appelle JAMAIS : un Owner n'a pas le droit `@auth` de les écrire (voir le bloc de tests
// dédié plus bas). Les omettre du mock ne prouverait rien — une tentative d'appel serait
// avalée par le traitement best-effort du module partagé.
const relationListMock = vi.fn()
const relationCreateMock = vi.fn()
const animalUpdateMock = vi.fn()
const clinicGetMock = vi.fn()
const clinicUpdateMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Request: { get: (...args) => requestGetMock(...args) },
      Animal: {
        list: (...args) => animalListMock(...args),
        update: (...args) => animalUpdateMock(...args),
      },
      Mission: {
        create: (...args) => missionCreateMock(...args),
        delete: (...args) => missionDeleteMock(...args),
        get: (...args) => missionGetMock(...args),
      },
      ClinicOwnerRelation: {
        list: (...args) => relationListMock(...args),
        create: (...args) => relationCreateMock(...args),
      },
      Clinic: {
        get: (...args) => clinicGetMock(...args),
        update: (...args) => clinicUpdateMock(...args),
      },
    },
    mutations: {
      linkRequestToMission: (...args) => linkRequestToMissionMock(...args),
      submitMissionValidation: (...args) => submitMissionValidationMock(...args),
    },
  }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ userId: 'owner-1' })),
}))

import { getCurrentUser } from 'aws-amplify/auth'
import {
  useOwnerMissions,
  mapSubmitDonationValidationError,
} from '@/composables/useOwnerMissions'
import { MissionStatus, MissionValidationOutcome } from '@/constants/enums'

// Une Request telle que renvoyée par Request.get().
const buildRequest = (overrides = {}) => ({
  id: 'request-1',
  requiredSpecies: 'DOG',
  requiredBloodGroup: 'DEA 1.1-',
  requestType: 'EMERGENCY',
  status: 'OPEN',
  clinicID: 'clinic-1',
  clinic: { id: 'clinic-1', name: 'Clinique du Centre', latitude: 48.85, longitude: 2.35 },
  ...overrides,
})

// Un Animal Validated Donor éligible par défaut (les 3 gates passent).
const buildEligibleAnimal = (overrides = {}) => ({
  id: 'animal-1',
  name: 'Rex',
  species: 'DOG',
  bloodGroup: 'DEA 1.1-',
  isValidatedDonor: true,
  validationExpiresAt: '2099-01-01T00:00:00.000Z',
  lastDonationDate: null,
  donationFrequency: 'ONCE_YEAR',
  ...overrides,
})

const resetAllMocks = () => {
  requestGetMock.mockReset()
  animalListMock.mockReset()
  missionCreateMock.mockReset()
  missionDeleteMock.mockReset()
  missionGetMock.mockReset()
  linkRequestToMissionMock.mockReset()
  submitMissionValidationMock.mockReset()
  relationListMock.mockReset()
  relationCreateMock.mockReset()
  animalUpdateMock.mockReset()
  clinicGetMock.mockReset()
  clinicUpdateMock.mockReset()
}

/**
 * Serveur "nominal" pour les écritures secondaires déclenchées côté Owner sur COMPLETED :
 * la Mission résout bien sa clinique (`Mission.request.clinicID`) et l'Owner n'a encore aucune
 * `ClinicOwnerRelation`.
 */
const mockOwnerSideEffectsOk = (existingRelations = []) => {
  missionGetMock.mockResolvedValue({
    data: { request: { clinicID: 'clinic-1' } },
    errors: undefined,
  })
  relationListMock.mockResolvedValue({ data: existingRelations, errors: undefined })
  relationCreateMock.mockImplementation(async (input) => ({
    data: { id: 'relation-new', ...input },
    errors: undefined,
  }))
}

const mockHappyPathBeforeLink = ({ request, animal }) => {
  requestGetMock.mockResolvedValue({ data: request, errors: undefined })
  animalListMock.mockResolvedValue({ data: [animal], errors: undefined })
}

describe('useOwnerMissions.acceptMission', () => {
  beforeEach(resetAllMocks)

  it('recharge la Request et l’Animal, crée la Mission (statut PENDING_ARRIVAL pour une Request EMERGENCY) puis lie la Request à la Mission', async () => {
    const request = buildRequest()
    const animal = buildEligibleAnimal()

    requestGetMock.mockResolvedValue({ data: request, errors: undefined })
    animalListMock.mockResolvedValue({ data: [animal], errors: undefined })
    missionCreateMock.mockImplementation(async (input) => {
      expect(input).toMatchObject({
        requestID: 'request-1',
        animalID: 'animal-1',
        status: 'PENDING_ARRIVAL',
      })
      return { data: { id: 'mission-1', status: 'PENDING_ARRIVAL' }, errors: undefined }
    })
    linkRequestToMissionMock.mockImplementation(async (args) => {
      expect(args).toMatchObject({ id: 'request-1', activeMissionID: 'mission-1' })
      return {
        data: { id: 'request-1', status: 'IN_PROGRESS', activeMissionID: 'mission-1' },
        errors: undefined,
      }
    })

    const { acceptMission } = useOwnerMissions()
    const donorName = await acceptMission('request-1', 'animal-1')

    expect(donorName).toBe('Rex')
    expect(requestGetMock).toHaveBeenCalledTimes(1)
    expect(animalListMock).toHaveBeenCalledTimes(1)
    expect(missionCreateMock).toHaveBeenCalledTimes(1)
    expect(linkRequestToMissionMock).toHaveBeenCalledTimes(1)
  })

  it('retire uniquement la Request acceptée de missions.value (les autres Requests OPEN restent affichées)', async () => {
    const request = buildRequest()
    const animal = buildEligibleAnimal()
    mockHappyPathBeforeLink({ request, animal })
    missionCreateMock.mockResolvedValue({ data: { id: 'mission-1', status: 'PENDING_ARRIVAL' }, errors: undefined })
    linkRequestToMissionMock.mockResolvedValue({
      data: { id: 'request-1', status: 'IN_PROGRESS', activeMissionID: 'mission-1' },
      errors: undefined,
    })

    const { acceptMission, missions } = useOwnerMissions()
    // missions.value simule le résultat d'un fetchAvailableMissions() précédent, avec
    // plusieurs Requests OPEN affichées, dont celle qu'on va accepter.
    missions.value = [
      { id: 'request-1', status: 'OPEN' },
      { id: 'request-2', status: 'OPEN' },
      { id: 'request-3', status: 'OPEN' },
    ]

    await acceptMission('request-1', 'animal-1')

    expect(missions.value.map((m) => m.id)).toEqual(['request-2', 'request-3'])
  })

  it('utilise le statut ACCEPTED (et non PENDING_ARRIVAL) pour une Request de type APPOINTMENT', async () => {
    const request = buildRequest({ requestType: 'APPOINTMENT' })
    const animal = buildEligibleAnimal()

    requestGetMock.mockResolvedValue({ data: request, errors: undefined })
    animalListMock.mockResolvedValue({ data: [animal], errors: undefined })
    missionCreateMock.mockImplementation(async (input) => {
      expect(input.status).toBe('ACCEPTED')
      return { data: { id: 'mission-1', status: 'ACCEPTED' }, errors: undefined }
    })
    linkRequestToMissionMock.mockResolvedValue({
      data: { id: 'request-1', status: 'IN_PROGRESS', activeMissionID: 'mission-1' },
      errors: undefined,
    })

    const { acceptMission } = useOwnerMissions()
    await acceptMission('request-1', 'animal-1')
  })

  it('rejette avec REQUEST_NOT_OPEN sans aller plus loin si la Request rechargée n’est pas OPEN', async () => {
    requestGetMock.mockResolvedValue({ data: buildRequest({ status: 'IN_PROGRESS' }), errors: undefined })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow('REQUEST_NOT_OPEN')
    expect(requestGetMock).toHaveBeenCalledTimes(1)
    expect(animalListMock).not.toHaveBeenCalled()
  })

  it('rejette avec REQUEST_NOT_OPEN si la Request n’existe plus (getRequest renvoie null)', async () => {
    requestGetMock.mockResolvedValue({ data: null, errors: undefined })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow('REQUEST_NOT_OPEN')
  })

  it('rejette avec ANIMAL_NOT_FOUND si l’animalId ne correspond à aucun Animal de l’Owner (n’existe pas, ou pas le sien)', async () => {
    mockHappyPathBeforeLink({
      request: buildRequest(),
      animal: buildEligibleAnimal({ id: 'animal-other' }),
    })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow('ANIMAL_NOT_FOUND')
    expect(requestGetMock).toHaveBeenCalledTimes(1)
    expect(animalListMock).toHaveBeenCalledTimes(1)
    expect(missionCreateMock).not.toHaveBeenCalled()
  })

  it('rejette avec NOT_VALIDATED_DONOR (critère 1) avant même de vérifier la compatibilité sanguine', async () => {
    mockHappyPathBeforeLink({
      request: buildRequest(),
      // Espèce/groupe compatibles, mais pas Validated Donor : doit échouer au critère 1,
      // pas au critère 2.
      animal: buildEligibleAnimal({ isValidatedDonor: false }),
    })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow('NOT_VALIDATED_DONOR')
  })

  it('rejette avec BLOOD_INCOMPATIBLE (critère 2) pour un Animal Validated Donor mais du mauvais groupe', async () => {
    mockHappyPathBeforeLink({
      request: buildRequest({ requiredBloodGroup: 'DEA 1.1+' }),
      animal: buildEligibleAnimal({ bloodGroup: 'DEA 1.1-' }),
    })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow('BLOOD_INCOMPATIBLE')
  })

  it('rejette avec FREQUENCY_RULE_NOT_SATISFIED (critère 3) pour un Animal ayant donné trop récemment', async () => {
    mockHappyPathBeforeLink({
      request: buildRequest(),
      animal: buildEligibleAnimal({
        lastDonationDate: new Date().toISOString(),
        donationFrequency: 'ONCE_YEAR',
      }),
    })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow(
      'FREQUENCY_RULE_NOT_SATISFIED',
    )
  })

  // Les tests ci-dessus ne prouvent chacun qu'un seul gate en isolation (les 2 autres
  // passent toujours pour cet Animal) : ça ne suffit pas à prouver l'ORDRE hiérarchisé
  // documenté dans acceptMission (CONTEXT.md critères 1 à 3). Les deux tests suivants
  // construisent un Animal qui échoue simultanément à DEUX gates, et vérifient que
  // l'erreur remontée est bien celle du gate le plus prioritaire des deux — pas l'autre.
  it('rapporte NOT_VALIDATED_DONOR (et pas BLOOD_INCOMPATIBLE) pour un Animal qui échoue aux deux gates 1 et 2 à la fois', async () => {
    mockHappyPathBeforeLink({
      request: buildRequest({ requiredBloodGroup: 'DEA 1.1+' }),
      // Pas Validated Donor (gate 1) ET mauvais groupe sanguin (gate 2) : si l'ordre
      // hiérarchisé n'était pas respecté (ou testé par erreur au gate 2 en premier), ce
      // test échouerait en récupérant BLOOD_INCOMPATIBLE au lieu de NOT_VALIDATED_DONOR.
      animal: buildEligibleAnimal({ isValidatedDonor: false, bloodGroup: 'DEA 1.1-' }),
    })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow('NOT_VALIDATED_DONOR')
  })

  it('rapporte BLOOD_INCOMPATIBLE (et pas FREQUENCY_RULE_NOT_SATISFIED) pour un Animal Validated Donor qui échoue simultanément aux gates 2 et 3', async () => {
    mockHappyPathBeforeLink({
      request: buildRequest({ requiredBloodGroup: 'DEA 1.1+' }),
      // Validated Donor (gate 1 OK), mauvais groupe sanguin (gate 2) ET don trop récent
      // (gate 3) : l'erreur attendue est celle du gate 2, le plus prioritaire des deux qui
      // échouent.
      animal: buildEligibleAnimal({
        bloodGroup: 'DEA 1.1-',
        lastDonationDate: new Date().toISOString(),
        donationFrequency: 'ONCE_YEAR',
      }),
    })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow('BLOOD_INCOMPATIBLE')
  })

  // Bug #? (documenté précédemment comme [BUG CONNU], désormais corrigé sur cette
  // sous-tâche) : acceptMission() cherchait le candidat par égalité stricte
  // `a.bloodGroup === request.requiredBloodGroup`, donc `bloodGroup === 'UNKNOWN'` — un
  // Animal Validated Donor n'a jamais de groupe UNKNOWN (cf. CONTEXT.md), donc une Request
  // "peu importe le groupe" qu'un Owner avait vue comme Match valide via searchMatches()
  // (qui utilise déjà isBloodCompatible) était rejetée à tort au moment d'accepter.
  // acceptMission() utilise maintenant isBloodCompatible comme searchMatches(), donc les
  // deux convergent : ce test prouve que le bug est corrigé.
  it('accepte désormais une Request requiredBloodGroup=UNKNOWN pour un Animal de la bonne espèce (bug corrigé, convergence avec searchMatches)', async () => {
    const request = buildRequest({ requiredBloodGroup: 'UNKNOWN' })
    const animal = buildEligibleAnimal()

    requestGetMock.mockResolvedValue({ data: request, errors: undefined })
    animalListMock.mockResolvedValue({ data: [animal], errors: undefined })
    missionCreateMock.mockResolvedValue({ data: { id: 'mission-1', status: 'PENDING_ARRIVAL' }, errors: undefined })
    linkRequestToMissionMock.mockResolvedValue({
      data: { id: 'request-1', status: 'IN_PROGRESS', activeMissionID: 'mission-1' },
      errors: undefined,
    })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).resolves.toBe('Rex')
  })

  // Point le plus sensible de ce lot (voir le commentaire en tête de fichier) : sous Gen2,
  // `client.mutations.linkRequestToMission(...)` ne LÈVE PAS pour un échec de condition
  // DynamoDB -- il RÉSOUT normalement avec `{ data: null, errors: [...] }`
  // (`errors[0].errorType === 'DynamoDB:ConditionalCheckFailedException'`). C'est
  // `throwIfGraphqlError` (useOwnerMissions.js) qui synthétise l'exception que
  // `isConditionalCheckFailure` détecte ensuite dans le `catch` -- pas une exception JS
  // rejetée directement par l'appel réseau (voir le test séparé plus bas pour CE cas-là).
  it('REQUEST_ALREADY_TAKEN : si linkRequestToMission résout avec une erreur de type ConditionalCheckFailedException, nettoie la Mission orpheline (deleteMission) puis remonte REQUEST_ALREADY_TAKEN', async () => {
    const request = buildRequest()
    const animal = buildEligibleAnimal()
    let deleteMissionCalled = false

    requestGetMock.mockResolvedValue({ data: request, errors: undefined })
    animalListMock.mockResolvedValue({ data: [animal], errors: undefined })
    missionCreateMock.mockResolvedValue({ data: { id: 'mission-1', status: 'PENDING_ARRIVAL' }, errors: undefined })
    linkRequestToMissionMock.mockResolvedValue({
      data: null,
      errors: [
        {
          message: 'The conditional request failed',
          errorType: 'DynamoDB:ConditionalCheckFailedException',
        },
      ],
    })
    missionDeleteMock.mockImplementation(async (args) => {
      deleteMissionCalled = true
      expect(args).toEqual({ id: 'mission-1' })
      return { data: { id: 'mission-1' }, errors: undefined }
    })

    const { acceptMission, isAccepting } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow('REQUEST_ALREADY_TAKEN')
    expect(deleteMissionCalled).toBe(true)
    expect(isAccepting.value).toBe(false)
  })

  it('un échec du nettoyage (deleteMission) ne masque pas l’erreur REQUEST_ALREADY_TAKEN d’origine', async () => {
    const request = buildRequest()
    const animal = buildEligibleAnimal()

    requestGetMock.mockResolvedValue({ data: request, errors: undefined })
    animalListMock.mockResolvedValue({ data: [animal], errors: undefined })
    missionCreateMock.mockResolvedValue({ data: { id: 'mission-1', status: 'PENDING_ARRIVAL' }, errors: undefined })
    linkRequestToMissionMock.mockResolvedValue({
      data: null,
      errors: [{ errorType: 'DynamoDB:ConditionalCheckFailedException', message: 'The conditional request failed' }],
    })
    missionDeleteMock.mockRejectedValue(new Error('boom: cleanup also failed'))

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow('REQUEST_ALREADY_TAKEN')
  })

  // Cas distinct du test REQUEST_ALREADY_TAKEN ci-dessus : ici l'appel réseau LUI-MÊME
  // rejette une exception JS (panne réseau) plutôt que de résoudre `{ data, errors }` --
  // `isConditionalCheckFailure` doit rester `false` sur une simple `Error` JS sans `.errors`,
  // et l'erreur d'origine doit être propagée telle quelle (pas de nettoyage best-effort
  // tenté, ce n'est pas un échec de condition).
  it("propage (sans la travestir en REQUEST_ALREADY_TAKEN) une exception JS rejetée par linkRequestToMission (panne réseau, pas une réponse { errors } résolue)", async () => {
    const request = buildRequest()
    const animal = buildEligibleAnimal()
    const authError = new Error('Not Authorized to access updateRequest on type Request')

    requestGetMock.mockResolvedValue({ data: request, errors: undefined })
    animalListMock.mockResolvedValue({ data: [animal], errors: undefined })
    missionCreateMock.mockResolvedValue({ data: { id: 'mission-1', status: 'PENDING_ARRIVAL' }, errors: undefined })
    linkRequestToMissionMock.mockRejectedValue(authError)

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow(
      'Not Authorized to access updateRequest on type Request',
    )
    // Pas de deleteMission tenté : ce n'est pas un échec de condition.
    expect(missionDeleteMock).not.toHaveBeenCalled()
  })

  // Pendant du test précédent pour le nouveau contrat Gen2 : une réponse RÉSOLUE portant
  // `errors` (même forme que le succès partiel) dont le contenu ne correspond à AUCUN
  // ConditionalCheckFailedException (ici une erreur Unauthorized) ne doit pas non plus être
  // confondue avec un échec de condition. `throwIfGraphqlError` synthétise une NOUVELLE
  // exception (voir graphql-error-service.js) -- contrairement à Gen1 où l'objet rejeté par
  // `client.graphql()` était directement celui contenant `errors`, donc cette version teste
  // le contenu (`.errors`, `.message`) plutôt que l'identité de l'objet.
  it("ne confond pas une erreur Unauthorized résolue (même forme { errors: [...] } que le succès partiel) avec un échec de condition", async () => {
    const request = buildRequest()
    const animal = buildEligibleAnimal()
    const unauthorizedErrors = [{ message: 'Unauthorized', originalError: { name: 'UnauthorizedException' } }]

    requestGetMock.mockResolvedValue({ data: request, errors: undefined })
    animalListMock.mockResolvedValue({ data: [animal], errors: undefined })
    missionCreateMock.mockResolvedValue({ data: { id: 'mission-1', status: 'PENDING_ARRIVAL' }, errors: undefined })
    linkRequestToMissionMock.mockResolvedValue({ data: null, errors: unauthorizedErrors })

    const { acceptMission } = useOwnerMissions()

    const error = await acceptMission('request-1', 'animal-1').catch((e) => e)

    // Propage l'erreur (synthétisée par throwIfGraphqlError à partir des `errors` d'origine)
    // telle quelle plutôt que de la travestir en REQUEST_ALREADY_TAKEN.
    expect(error).toBeInstanceOf(Error)
    expect(error.message).not.toBe('REQUEST_ALREADY_TAKEN')
    expect(error.errors).toEqual(unauthorizedErrors)
    // Pas de deleteMission tenté : ce n'est pas un échec de condition, donc pas de Mission
    // orpheline à nettoyer selon la logique de l'implémentation.
    expect(missionDeleteMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// Double validation de Mission (2026-08-26, étape 4/5) — côté OWNER.
// Pendant de `closeMission` (useMissionClosure.js) : même mutation custom, mais l'Owner parle
// directement le vocabulaire du resolver (CONFIRMED/DENIED), sans table de traduction — le rôle
// n'est jamais envoyé, il est déduit côté serveur de `ctx.identity.groups`.
describe('useOwnerMissions.submitDonationValidation', () => {
  beforeEach(() => {
    resetAllMocks()
    mockOwnerSideEffectsOk()
  })

  const mockValidationResult = (status) => {
    submitMissionValidationMock.mockImplementation(async (input) => ({
      data: { id: input.missionId, status },
      errors: undefined,
    }))
  }

  it('CONFIRMED : appelle submitMissionValidation avec missionId + outcome, et RIEN d’autre (pas de rôle, pas de raterID — déterminés côté serveur)', async () => {
    mockValidationResult(MissionStatus.PENDING_VALIDATION)

    const { submitDonationValidation } = useOwnerMissions()
    const status = await submitDonationValidation(
      'mission-1',
      MissionValidationOutcome.CONFIRMED,
    )

    expect(submitMissionValidationMock).toHaveBeenCalledTimes(1)
    expect(submitMissionValidationMock).toHaveBeenCalledWith({
      missionId: 'mission-1',
      outcome: 'CONFIRMED',
    })
    expect(status).toBe('PENDING_VALIDATION')
  })

  it('DENIED avec disputeReason : transmet le motif (trimé) au resolver', async () => {
    mockValidationResult(MissionStatus.DISPUTED)

    const { submitDonationValidation } = useOwnerMissions()
    const status = await submitDonationValidation(
      'mission-1',
      MissionValidationOutcome.DENIED,
      '  Rendez-vous annulé par la clinique  ',
    )

    expect(submitMissionValidationMock).toHaveBeenCalledWith({
      missionId: 'mission-1',
      outcome: 'DENIED',
      disputeReason: 'Rendez-vous annulé par la clinique',
    })
    expect(status).toBe('DISPUTED')
  })

  it('DENIED sans motif (ou motif vide/espaces) : n’envoie pas la clé disputeReason du tout', async () => {
    mockValidationResult(MissionStatus.NO_SHOW)

    const { submitDonationValidation } = useOwnerMissions()
    await submitDonationValidation('mission-1', MissionValidationOutcome.DENIED)
    await submitDonationValidation('mission-2', MissionValidationOutcome.DENIED, '   ')

    expect(submitMissionValidationMock.mock.calls[0][0]).not.toHaveProperty('disputeReason')
    expect(submitMissionValidationMock.mock.calls[1][0]).not.toHaveProperty('disputeReason')
  })

  it('CONFIRMED + disputeReason fourni : le motif est IGNORÉ (décision assumée — ownerDisputeReason est write-once et contredirait un outcome confirmé)', async () => {
    mockValidationResult(MissionStatus.COMPLETED)

    const { submitDonationValidation } = useOwnerMissions()
    await submitDonationValidation(
      'mission-1',
      MissionValidationOutcome.CONFIRMED,
      'motif fourni par erreur',
    )

    expect(submitMissionValidationMock).toHaveBeenCalledWith({
      missionId: 'mission-1',
      outcome: 'CONFIRMED',
    })
  })

  it.each([
    MissionValidationOutcome.PENDING,
    MissionStatus.COMPLETED,
    MissionStatus.NO_SHOW,
    'confirmed',
    '',
    null,
    undefined,
  ])(
    'outcome invalide (%s) : throw INVALID_OUTCOME AVANT tout appel réseau — PENDING inclus (état initial, pas une soumission)',
    async (badOutcome) => {
      const { submitDonationValidation, isSubmittingValidation } = useOwnerMissions()

      await expect(submitDonationValidation('mission-1', badOutcome)).rejects.toThrow(
        'INVALID_OUTCOME',
      )
      expect(submitMissionValidationMock).not.toHaveBeenCalled()
      expect(isSubmittingValidation.value).toBe(false)
    },
  )

  it('ALREADY_VALIDATED : une réponse résolue portant errorType ALREADY_VALIDATED est normalisée en Error("ALREADY_VALIDATED")', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    submitMissionValidationMock.mockResolvedValue({
      data: null,
      errors: [
        {
          errorType: 'ALREADY_VALIDATED',
          message: 'Ce côté a déjà soumis sa validation pour cette Mission.',
        },
      ],
    })

    const { submitDonationValidation, isSubmittingValidation } = useOwnerMissions()

    await expect(
      submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED),
    ).rejects.toThrow('ALREADY_VALIDATED')
    expect(isSubmittingValidation.value).toBe(false)
    consoleErrorSpy.mockRestore()
  })

  it("ne travestit PAS une autre erreur GraphQL (Unauthorized) en ALREADY_VALIDATED : elle est propagée telle quelle", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unauthorizedErrors = [{ errorType: 'Unauthorized', message: 'Unauthorized' }]
    submitMissionValidationMock.mockResolvedValue({ data: null, errors: unauthorizedErrors })

    const { submitDonationValidation } = useOwnerMissions()
    const error = await submitDonationValidation(
      'mission-1',
      MissionValidationOutcome.CONFIRMED,
    ).catch((e) => e)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).not.toBe('ALREADY_VALIDATED')
    expect(error.errors).toEqual(unauthorizedErrors)
    consoleErrorSpy.mockRestore()
  })

  it("une panne réseau (exception JS sans .errors) est propagée telle quelle, jamais confondue avec ALREADY_VALIDATED", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    submitMissionValidationMock.mockRejectedValue(new Error('Network error'))

    const { submitDonationValidation, isSubmittingValidation } = useOwnerMissions()

    await expect(
      submitDonationValidation('mission-1', MissionValidationOutcome.DENIED),
    ).rejects.toThrow('Network error')
    expect(isSubmittingValidation.value).toBe(false)
    consoleErrorSpy.mockRestore()
  })

  it('isSubmittingValidation : true pendant l’appel, false après — et distinct de isAccepting', async () => {
    let duringCall = null
    let acceptingDuringCall = null
    const { submitDonationValidation, isSubmittingValidation, isAccepting } = useOwnerMissions()
    submitMissionValidationMock.mockImplementation(async () => {
      duringCall = isSubmittingValidation.value
      acceptingDuringCall = isAccepting.value
      return { data: { id: 'mission-1', status: MissionStatus.PENDING_VALIDATION }, errors: undefined }
    })

    await submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED)

    expect(duringCall).toBe(true)
    expect(acceptingDuringCall).toBe(false)
    expect(isSubmittingValidation.value).toBe(false)
  })

  it('met à jour le statut de la Mission concernée dans myMissions (et uniquement celle-là), pour que les computed reflètent le nouvel état sans re-fetch', async () => {
    mockValidationResult(MissionStatus.COMPLETED)

    const { submitDonationValidation, myMissions, activeMissions, historyMissions } =
      useOwnerMissions()
    myMissions.value = [
      { id: 'mission-1', status: MissionStatus.PENDING_ARRIVAL },
      { id: 'mission-2', status: MissionStatus.PENDING_ARRIVAL },
    ]

    await submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED)

    expect(myMissions.value.find((m) => m.id === 'mission-1').status).toBe('COMPLETED')
    expect(myMissions.value.find((m) => m.id === 'mission-2').status).toBe('PENDING_ARRIVAL')
    expect(activeMissions.value.map((m) => m.id)).toEqual(['mission-2'])
    expect(historyMissions.value.map((m) => m.id)).toEqual(['mission-1'])
  })

  it('réponse sans data exploitable (défensif) : retourne null et laisse myMissions inchangé', async () => {
    submitMissionValidationMock.mockResolvedValue({ data: null, errors: undefined })

    const { submitDonationValidation, myMissions } = useOwnerMissions()
    myMissions.value = [{ id: 'mission-1', status: MissionStatus.PENDING_ARRIVAL }]

    await expect(
      submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED),
    ).resolves.toBeNull()
    expect(myMissions.value[0].status).toBe('PENDING_ARRIVAL')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// Écritures secondaires côté OWNER quand SON vote fait passer la Mission en COMPLETED
// (correctif QA du 2026-08-27). Pendant du bloc "closeMission — upsert ClinicOwnerRelation"
// de useMissionClosure.test.js, côté propriétaire cette fois.
//
// Rappel du bug corrigé : dans le flux nominal (le vétérinaire clôture d'abord depuis
// RequestsView.vue), c'est l'appel de l'OWNER qui finalise la Mission — et il ne déclenchait
// AUCUNE écriture secondaire, laissant l'annuaire donneurs vide pour un don pourtant confirmé
// des deux côtés (verrouillé par mission-dual-validation.integration.test.js).
// ─────────────────────────────────────────────────────────────────────────────────────────
describe('useOwnerMissions.submitDonationValidation — écritures secondaires sur COMPLETED', () => {
  let consoleErrorSpy

  beforeEach(() => {
    resetAllMocks()
    mockOwnerSideEffectsOk()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  const mockValidationResult = (status) => {
    submitMissionValidationMock.mockImplementation(async (input) => ({
      data: { id: input.missionId, status },
      errors: undefined,
    }))
  }

  it('COMPLETED : upserte la ClinicOwnerRelation (Owner courant + clinique résolue depuis Mission.request.clinicID), isPrimaryClinic=true pour sa toute première relation', async () => {
    mockValidationResult(MissionStatus.COMPLETED)

    const { submitDonationValidation } = useOwnerMissions()
    await submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED)

    // `selectionSet` minimal : un seul champ, à travers la relation (convention CLAUDE.md).
    expect(missionGetMock).toHaveBeenCalledWith(
      { id: 'mission-1' },
      { selectionSet: ['request.clinicID'] },
    )
    expect(relationListMock).toHaveBeenCalledWith({ filter: { ownerID: { eq: 'owner-1' } } })
    expect(relationCreateMock).toHaveBeenCalledWith({
      clinicID: 'clinic-1',
      ownerID: 'owner-1',
      isPrimaryClinic: true,
    })
  })

  it('COMPLETED : n’écrit JAMAIS Animal.lastDonationDate ni les compteurs Clinic — un Owner n’en a pas le droit @auth (résidu ouvert, à fermer côté serveur)', async () => {
    // Ce n'est PAS un oubli : `Animal.lastDonationDate` est en `{allow: owner, operations:
    // [read]}` (ADR-0003) et `Clinic` en `{allow: private, operations: [read]}` pour tout ce
    // qui n'est pas Veterinarian — ces deux mutations seraient refusées côté serveur. Les
    // émettre quand même ne ferait que du bruit de log. Conséquence assumée et signalée : la
    // Frequency Rule n'est pas réarmée quand l'Owner vote en second ; seul un chemin serveur
    // peut la porter (cf. la Lambda mission-validation-auto-finalizer, ADR-0016 §4).
    mockValidationResult(MissionStatus.COMPLETED)

    const { submitDonationValidation } = useOwnerMissions()
    await submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED)

    expect(animalUpdateMock).not.toHaveBeenCalled()
    expect(clinicGetMock).not.toHaveBeenCalled()
    expect(clinicUpdateMock).not.toHaveBeenCalled()
  })

  it.each([
    MissionStatus.PENDING_VALIDATION,
    MissionStatus.DISPUTED,
    MissionStatus.NO_SHOW,
    MissionStatus.COMPLETED_AUTO,
  ])(
    'statut retourné %s : AUCUNE écriture secondaire, ni même la résolution de contexte (même garde-fou STRICT que closeMission)',
    async (status) => {
      mockValidationResult(status)

      const { submitDonationValidation } = useOwnerMissions()
      await submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED)

      expect(missionGetMock).not.toHaveBeenCalled()
      expect(relationListMock).not.toHaveBeenCalled()
      expect(relationCreateMock).not.toHaveBeenCalled()
    },
  )

  it('COMPLETED avec une relation déjà existante pour cette clinique : aucune création (pas de doublon d’annuaire)', async () => {
    mockValidationResult(MissionStatus.COMPLETED)
    relationListMock.mockResolvedValue({
      data: [{ clinicID: 'clinic-1', isPrimaryClinic: true }],
      errors: undefined,
    })

    const { submitDonationValidation } = useOwnerMissions()
    await submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED)

    expect(relationListMock).toHaveBeenCalledTimes(1)
    expect(relationCreateMock).not.toHaveBeenCalled()
  })

  it('best-effort : un échec de résolution du clinicID n’empêche pas la soumission de réussir (le vote est déjà enregistré, write-once)', async () => {
    mockValidationResult(MissionStatus.COMPLETED)
    missionGetMock.mockRejectedValue(new Error('Network error'))

    const { submitDonationValidation } = useOwnerMissions()

    await expect(
      submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED),
    ).resolves.toBe('COMPLETED')
    expect(relationCreateMock).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('best-effort : un échec @auth/réseau de la création de ClinicOwnerRelation est logué et avalé, jamais remonté à l’utilisateur', async () => {
    mockValidationResult(MissionStatus.COMPLETED)
    relationCreateMock.mockResolvedValue({
      data: null,
      errors: [{ errorType: 'Unauthorized', message: 'Not Authorized to access createClinicOwnerRelation' }],
    })

    const { submitDonationValidation } = useOwnerMissions()

    await expect(
      submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED),
    ).resolves.toBe('COMPLETED')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ClinicOwnerRelation'),
      expect.any(Error),
    )
  })

  it('best-effort : une session Cognito indisponible (getCurrentUser rejette) n’empêche pas la soumission de réussir', async () => {
    mockValidationResult(MissionStatus.COMPLETED)
    vi.mocked(getCurrentUser).mockRejectedValueOnce(new Error('No current user'))

    const { submitDonationValidation } = useOwnerMissions()

    await expect(
      submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED),
    ).resolves.toBe('COMPLETED')
    expect(relationListMock).not.toHaveBeenCalled()
    expect(relationCreateMock).not.toHaveBeenCalled()
  })
})

describe('mapSubmitDonationValidationError', () => {
  it('traduit ALREADY_VALIDATED et INVALID_OUTCOME en messages utilisateur dédiés', () => {
    expect(mapSubmitDonationValidationError('ALREADY_VALIDATED')).toContain('déjà répondu')
    expect(mapSubmitDonationValidationError('INVALID_OUTCOME')).toContain('invalide')
  })

  it('retombe sur le fallback pour un code inconnu (erreur réseau, @auth...)', () => {
    expect(mapSubmitDonationValidationError('BOOM')).toBe(
      'Impossible d’enregistrer votre réponse pour cette mission.',
    )
    expect(mapSubmitDonationValidationError(undefined, 'repli custom')).toBe('repli custom')
  })
})

describe('useOwnerMissions — computed de statuts (double validation)', () => {
  beforeEach(resetAllMocks)

  const allStatuses = [
    { id: 'accepted', status: MissionStatus.ACCEPTED },
    { id: 'pending-arrival', status: MissionStatus.PENDING_ARRIVAL },
    { id: 'pending-validation', status: MissionStatus.PENDING_VALIDATION },
    { id: 'completed', status: MissionStatus.COMPLETED },
    { id: 'completed-auto', status: MissionStatus.COMPLETED_AUTO },
    { id: 'no-show', status: MissionStatus.NO_SHOW },
    { id: 'disputed', status: MissionStatus.DISPUTED },
    { id: 'cancelled', status: MissionStatus.CANCELLED },
  ]

  it('historyMissions inclut COMPLETED_AUTO et DISPUTED en plus de COMPLETED/NO_SHOW/CANCELLED (sans elles, une Mission finalisée par la Lambda ou en litige disparaîtrait de l’écran du propriétaire)', () => {
    const { myMissions, historyMissions } = useOwnerMissions()
    myMissions.value = allStatuses

    expect(historyMissions.value.map((m) => m.id).sort()).toEqual(
      ['cancelled', 'completed', 'completed-auto', 'disputed', 'no-show'].sort(),
    )
  })

  it('awaitingValidationMissions ne contient QUE PENDING_VALIDATION', () => {
    const { myMissions, awaitingValidationMissions } = useOwnerMissions()
    myMissions.value = allStatuses

    expect(awaitingValidationMissions.value.map((m) => m.id)).toEqual(['pending-validation'])
  })

  it('activeMissions reste limité à ACCEPTED/PENDING_ARRIVAL : PENDING_VALIDATION n’y est PAS (décision documentée — plus d’action de terrain, donc pas dans le compteur de missions actives)', () => {
    const { myMissions, activeMissions } = useOwnerMissions()
    myMissions.value = allStatuses

    expect(activeMissions.value.map((m) => m.id)).toEqual(['accepted', 'pending-arrival'])
  })

  it('les trois computed sont mutuellement exclusifs et couvrent tous les statuts connus (aucune Mission invisible, aucune comptée deux fois)', () => {
    const { myMissions, activeMissions, awaitingValidationMissions, historyMissions } =
      useOwnerMissions()
    myMissions.value = allStatuses

    const covered = [
      ...activeMissions.value,
      ...awaitingValidationMissions.value,
      ...historyMissions.value,
    ].map((m) => m.id)

    expect(covered.sort()).toEqual(allStatuses.map((m) => m.id).sort())
    expect(new Set(covered).size).toBe(covered.length)
  })
})
