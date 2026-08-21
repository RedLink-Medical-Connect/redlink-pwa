import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useOwnerMissions, mapAcceptMissionError } from '@/composables/useOwnerMissions'

// Regression coverage for fix #2 on branch fix/data-model-risks: schema.graphql's Request
// @auth rule was missing "update" on the private (Owner) rule, so linkRequestToMission (called
// from acceptMission as the last step of accepting a Mission) would 403 for an Owner. The @auth
// rule itself isn't exercisable from Vitest against a mock client — that's covered by the
// schema diff review — but this test proves the composable's call path: it issues the
// linkRequestToMission call as the Owner's own authenticated session (no client-side gate/role-
// check that would itself block an Owner from reaching it).
//
// Updated for Phase 0.3 (ADR-0001): acceptMission(request) -> acceptMission(requestId,
// animalId). It reloads the Request (getRequest) and the Animal (listMyAnimalsSimple)
// itself instead of trusting objects already in memory client-side, hence the extra
// getRequest call in the mock sequence below.
//
// Phase 8, sous-tâche 5 (lot 3/3, le dernier) : mocks migrés vers le client Gen2
// (`aws-amplify/data`, `client.models.{Request,Animal,Mission}.*` + `client.mutations.
// linkRequestToMission`, ADR-0011) -- un mock dédié par méthode plutôt qu'un unique
// `mockGraphql` discriminé par le texte de la query, même convention que
// `__tests__/useOwnerMissions.test.js` (déjà migré dans ce même lot). Le test qui vérifiait
// littéralement le texte de la query GraphQL (`linkCall.query.toContain('condition')`, etc.)
// est retiré : ADR-0011 documente déjà, côté schéma (`amplify/data/resource.ts` +
// `amplify/data/resolvers/link-request-to-mission.js`), que la condition `status = OPEN` est
// reproduite par le resolver JS custom -- ce n'est plus un texte de document GraphQL que ce
// composable construit lui-même, donc plus rien à pinner à ce niveau ici. Ce que ce fichier
// peut encore prouver utilement -- et prouve toujours ci-dessous -- : `acceptMission` appelle
// bien `client.mutations.linkRequestToMission(...)` avec les bons arguments, sans garde
// côté client qui bloquerait un Owner d'y arriver.

const requestGetMock = vi.fn()
const animalListMock = vi.fn()
const missionCreateMock = vi.fn()
const missionDeleteMock = vi.fn()
const linkRequestToMissionMock = vi.fn()
const requestListMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Request: {
        get: (...args) => requestGetMock(...args),
        list: (...args) => requestListMock(...args),
      },
      Animal: { list: (...args) => animalListMock(...args) },
      Mission: {
        create: (...args) => missionCreateMock(...args),
        delete: (...args) => missionDeleteMock(...args),
      },
    },
    mutations: {
      linkRequestToMission: (...args) => linkRequestToMissionMock(...args),
    },
  }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: 'owner-cognito-id' }),
}))

const resetAllMocks = () => {
  requestGetMock.mockReset()
  animalListMock.mockReset()
  missionCreateMock.mockReset()
  missionDeleteMock.mockReset()
  linkRequestToMissionMock.mockReset()
  requestListMock.mockReset()
}

describe('useOwnerMissions > acceptMission', () => {
  beforeEach(resetAllMocks)

  const request = {
    id: 'request-1',
    requiredSpecies: 'DOG',
    requiredBloodGroup: 'DEA 1.1-',
    requestType: 'APPOINTMENT',
    status: 'OPEN',
  }

  const matchingAnimal = {
    id: 'animal-1',
    name: 'Rex',
    species: 'DOG',
    bloodGroup: 'DEA 1.1-',
    isValidatedDonor: true,
    validationExpiresAt: '2099-01-01T00:00:00.000Z',
    lastDonationDate: null,
    donationFrequency: 'ONCE_YEAR',
  }

  it('calls client.mutations.linkRequestToMission as the Owner, with no client-side gate blocking it', async () => {
    requestGetMock.mockResolvedValue({ data: request, errors: undefined })
    animalListMock.mockResolvedValue({ data: [matchingAnimal], errors: undefined })
    missionCreateMock.mockResolvedValue({ data: { id: 'mission-1', status: 'ACCEPTED' }, errors: undefined })
    linkRequestToMissionMock.mockResolvedValue({
      data: { id: 'request-1', status: 'IN_PROGRESS', activeMissionID: 'mission-1' },
      errors: undefined,
    })

    const { acceptMission } = useOwnerMissions()
    const donorName = await acceptMission('request-1', 'animal-1')

    expect(donorName).toBe('Rex')
    expect(requestGetMock).toHaveBeenCalledTimes(1)
    expect(animalListMock).toHaveBeenCalledTimes(1)
    expect(missionCreateMock).toHaveBeenCalledTimes(1)
    expect(linkRequestToMissionMock).toHaveBeenCalledTimes(1)
    expect(linkRequestToMissionMock).toHaveBeenCalledWith({ id: 'request-1', activeMissionID: 'mission-1' })
  })

  it('propagates (does not swallow) an auth failure resolved as `{ errors }` from linkRequestToMission, so a missing @auth rule would surface as a thrown error, not a silently-lost accept', async () => {
    requestGetMock.mockResolvedValue({ data: request, errors: undefined })
    animalListMock.mockResolvedValue({ data: [matchingAnimal], errors: undefined })
    missionCreateMock.mockResolvedValue({ data: { id: 'mission-1', status: 'ACCEPTED' }, errors: undefined })
    linkRequestToMissionMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access linkRequestToMission' }],
    })

    const { acceptMission, isAccepting } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow(
      'Erreur GraphQL linkRequestToMission',
    )
    expect(isAccepting.value).toBe(false)
  })

  it('throws ANIMAL_NOT_FOUND before attempting any mutation when the Owner has no matching animal', async () => {
    requestGetMock.mockResolvedValue({ data: request, errors: undefined })
    animalListMock.mockResolvedValue({ data: [], errors: undefined })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow('ANIMAL_NOT_FOUND')
    expect(requestGetMock).toHaveBeenCalledTimes(1)
    expect(animalListMock).toHaveBeenCalledTimes(1)
    expect(missionCreateMock).not.toHaveBeenCalled()
  })
})

// Extracted from DashboardView.vue's handleAccept during the Lead Dev review of
// feat/wire-eligibility-engine: this codebase has no precedent for mounting/testing
// .vue components, so the error-code-to-message mapping lives here as a plain
// function instead, testable without that infrastructure.
describe('mapAcceptMissionError', () => {
  it.each([
    ['REQUEST_NOT_OPEN', "Cette demande n'est plus ouverte."],
    ['ANIMAL_NOT_FOUND', 'Cet animal est introuvable parmi vos animaux.'],
    ['NOT_VALIDATED_DONOR', "Cet animal n'est plus un donneur validé."],
    [
      'BLOOD_INCOMPATIBLE',
      "Le groupe sanguin de cet animal n'est plus compatible avec cette demande.",
    ],
    ['FREQUENCY_RULE_NOT_SATISFIED', 'Cet animal a donné trop récemment pour donner à nouveau.'],
    [
      'REQUEST_ALREADY_TAKEN',
      "Cette demande vient d'être prise en charge par un autre propriétaire.",
    ],
  ])('maps %s to its specific French message', (code, expected) => {
    expect(mapAcceptMissionError(code)).toBe(expected)
  })

  it('falls back to the generic message for an unrecognized code (e.g. a raw network error)', () => {
    expect(mapAcceptMissionError('Network request failed')).toBe(
      "Impossible d'accepter la mission.",
    )
    expect(mapAcceptMissionError(undefined)).toBe("Impossible d'accepter la mission.")
  })

  it('accepts a custom fallback message', () => {
    expect(mapAcceptMissionError('UNKNOWN_CODE', 'Erreur personnalisée.')).toBe(
      'Erreur personnalisée.',
    )
  })
})

// Phase 7.6 (R-09): fetchAvailableMissions()/fetchMyMissions() used to only console.error on
// failure, with no way for MissionsView.vue (fetchMyMissions) to distinguish a real fetch
// failure from a genuinely empty mission list. loadError is shared between the two fetchers
// (like isLoading already is), reset at the start of each call and set on failure.
describe('useOwnerMissions > loadError (fetchAvailableMissions / fetchMyMissions)', () => {
  let consoleErrorSpy

  beforeEach(() => {
    resetAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('fetchAvailableMissions: sets loadError to true on failure, keeps missions.value untouched', async () => {
    requestListMock.mockRejectedValueOnce(new Error('réseau : timeout'))

    const { fetchAvailableMissions, missions, loadError } = useOwnerMissions()
    expect(loadError.value).toBe(false)

    await fetchAvailableMissions()

    expect(loadError.value).toBe(true)
    expect(missions.value).toEqual([])
  })

  it('fetchAvailableMissions: resets loadError to false on the next successful fetch', async () => {
    requestListMock.mockRejectedValueOnce(new Error('réseau : timeout'))

    const { fetchAvailableMissions, loadError } = useOwnerMissions()
    await fetchAvailableMissions()
    expect(loadError.value).toBe(true)

    requestListMock.mockResolvedValueOnce({ data: [], errors: undefined })
    await fetchAvailableMissions()

    expect(loadError.value).toBe(false)
  })

  it('fetchMyMissions: sets loadError to true on failure (real error, MissionsView.vue must not show the empty state)', async () => {
    animalListMock.mockRejectedValueOnce(new Error('réseau : timeout'))

    const { fetchMyMissions, myMissions, loadError } = useOwnerMissions()
    expect(loadError.value).toBe(false)

    await fetchMyMissions()

    expect(loadError.value).toBe(true)
    expect(myMissions.value).toEqual([])
    expect(consoleErrorSpy).toHaveBeenCalledWith('Erreur chargement mes missions:', expect.any(Error))
  })

  it('fetchMyMissions: keeps loadError false on a successful fetch, even with an empty mission list', async () => {
    animalListMock.mockResolvedValueOnce({ data: [], errors: undefined })

    const { fetchMyMissions, myMissions, loadError } = useOwnerMissions()
    await fetchMyMissions()

    expect(loadError.value).toBe(false)
    expect(myMissions.value).toEqual([])
  })

  // Phase 7 section C / Phase 6.B: fetchMyMissions() now also flattens Animal.species onto
  // each Mission as animalSpecies (alongside the pre-existing animalName), consumed by
  // MissionsView.vue's getAnimalEmoji() to pick 🐶 vs 🐱 instead of a hardcoded 🐶 for every
  // Mission regardless of the donor Animal's actual species.
  it('fetchMyMissions: flattens Animal.species onto each Mission as animalSpecies', async () => {
    animalListMock.mockResolvedValueOnce({
      data: [
        {
          id: 'animal-1',
          name: 'Minou',
          species: 'CAT',
          missions: [{ id: 'mission-1', status: 'ACCEPTED', createdAt: '2025-01-01T00:00:00.000Z' }],
        },
      ],
      errors: undefined,
    })

    const { fetchMyMissions, myMissions } = useOwnerMissions()
    await fetchMyMissions()

    expect(myMissions.value).toHaveLength(1)
    expect(myMissions.value[0]).toMatchObject({
      id: 'mission-1',
      animalName: 'Minou',
      animalSpecies: 'CAT',
    })
  })

  // Regression guard for the best-effort / secondary-write distinction documented in
  // CLAUDE.md: a failed orphan-Mission cleanup inside acceptMission() must keep swallowing
  // its own error (console.error only) and must NEVER flip the shared loadError — that ref
  // is reserved for the two list-fetching flows above, not for acceptMission()'s own
  // best-effort cleanup.
  it('acceptMission: a failed best-effort orphan-Mission cleanup does not touch loadError', async () => {
    const request = {
      id: 'request-1',
      requiredSpecies: 'DOG',
      requiredBloodGroup: 'DEA 1.1-',
      requestType: 'EMERGENCY',
      status: 'OPEN',
    }
    const animal = {
      id: 'animal-1',
      name: 'Rex',
      species: 'DOG',
      bloodGroup: 'DEA 1.1-',
      isValidatedDonor: true,
      validationExpiresAt: '2099-01-01T00:00:00.000Z',
      lastDonationDate: null,
      donationFrequency: 'ONCE_YEAR',
    }

    requestGetMock.mockResolvedValue({ data: request, errors: undefined })
    animalListMock.mockResolvedValue({ data: [animal], errors: undefined })
    missionCreateMock.mockResolvedValue({ data: { id: 'mission-1', status: 'PENDING_ARRIVAL' }, errors: undefined })
    linkRequestToMissionMock.mockResolvedValue({
      data: null,
      errors: [
        { errorType: 'DynamoDB:ConditionalCheckFailedException', message: 'The conditional request failed' },
      ],
    })
    missionDeleteMock.mockRejectedValue(new Error('boom: cleanup also failed'))

    const { acceptMission, loadError } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow('REQUEST_ALREADY_TAKEN')

    expect(loadError.value).toBe(false)
  })
})
