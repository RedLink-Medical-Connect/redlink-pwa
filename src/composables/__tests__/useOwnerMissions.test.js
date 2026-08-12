import { describe, it, expect, vi, beforeEach } from 'vitest'

// Sous-tâche Phase 0.3 (ADR-0001) : acceptMission(request) -> acceptMission(requestId, animalId).
// La fonction recharge elle-même la Request (getRequest) et l'Animal (listMyAnimalsSimple)
// plutôt que de faire confiance aux objets déjà en mémoire côté client, valide l'Animal via
// les 3 gates d'Eligibility pertinents (isValidatedDonor, isBloodCompatible,
// satisfiesFrequencyRule, dans cet ordre), puis conditionne l'écriture de liaison
// Request -> Mission sur `Request.status = OPEN` au niveau DynamoDB.

const graphqlMock = vi.fn()

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ userId: 'owner-1' })),
}))

import { useOwnerMissions } from '@/composables/useOwnerMissions'

// Une Request telle que renvoyée par getRequest.
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

const mockHappyPathBeforeLink = ({ request, animal }) => {
  graphqlMock.mockImplementation(async ({ query, variables }) => {
    if (query.includes('GetRequest')) {
      expect(variables).toEqual({ id: request.id })
      return { data: { getRequest: request } }
    }
    if (query.includes('ListMyAnimals')) {
      return { data: { listAnimals: { items: [animal] } } }
    }
    throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
  })
}

describe('useOwnerMissions.acceptMission', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it('recharge la Request et l’Animal, crée la Mission (statut PENDING_ARRIVAL pour une Request EMERGENCY) puis lie la Request à la Mission', async () => {
    const request = buildRequest()
    const animal = buildEligibleAnimal()

    graphqlMock.mockImplementation(async ({ query, variables }) => {
      if (query.includes('GetRequest')) {
        return { data: { getRequest: request } }
      }
      if (query.includes('ListMyAnimals')) {
        return { data: { listAnimals: { items: [animal] } } }
      }
      if (query.includes('CreateMission')) {
        expect(variables.input).toMatchObject({
          requestID: 'request-1',
          animalID: 'animal-1',
          status: 'PENDING_ARRIVAL',
        })
        return { data: { createMission: { id: 'mission-1', status: 'PENDING_ARRIVAL' } } }
      }
      if (query.includes('LinkRequestToMission')) {
        expect(variables).toMatchObject({ id: 'request-1', activeMissionID: 'mission-1' })
        return { data: { updateRequest: { id: 'request-1', status: 'IN_PROGRESS', activeMissionID: 'mission-1' } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { acceptMission } = useOwnerMissions()
    const donorName = await acceptMission('request-1', 'animal-1')

    expect(donorName).toBe('Rex')
    // getRequest, listMyAnimalsSimple, createMissionSimple, linkRequestToMission.
    expect(graphqlMock).toHaveBeenCalledTimes(4)
  })

  it('utilise le statut ACCEPTED (et non PENDING_ARRIVAL) pour une Request de type APPOINTMENT', async () => {
    const request = buildRequest({ requestType: 'APPOINTMENT' })
    const animal = buildEligibleAnimal()

    graphqlMock.mockImplementation(async ({ query, variables }) => {
      if (query.includes('GetRequest')) return { data: { getRequest: request } }
      if (query.includes('ListMyAnimals')) return { data: { listAnimals: { items: [animal] } } }
      if (query.includes('CreateMission')) {
        expect(variables.input.status).toBe('ACCEPTED')
        return { data: { createMission: { id: 'mission-1', status: 'ACCEPTED' } } }
      }
      if (query.includes('LinkRequestToMission')) {
        return { data: { updateRequest: { id: 'request-1', status: 'IN_PROGRESS', activeMissionID: 'mission-1' } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { acceptMission } = useOwnerMissions()
    await acceptMission('request-1', 'animal-1')
  })

  it('rejette avec REQUEST_NOT_OPEN sans aller plus loin si la Request rechargée n’est pas OPEN', async () => {
    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('GetRequest')) {
        return { data: { getRequest: buildRequest({ status: 'IN_PROGRESS' }) } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow('REQUEST_NOT_OPEN')
    expect(graphqlMock).toHaveBeenCalledTimes(1)
  })

  it('rejette avec REQUEST_NOT_OPEN si la Request n’existe plus (getRequest renvoie null)', async () => {
    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('GetRequest')) return { data: { getRequest: null } }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

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
    expect(graphqlMock).toHaveBeenCalledTimes(2)
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

    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('GetRequest')) return { data: { getRequest: request } }
      if (query.includes('ListMyAnimals')) return { data: { listAnimals: { items: [animal] } } }
      if (query.includes('CreateMission')) {
        return { data: { createMission: { id: 'mission-1', status: 'PENDING_ARRIVAL' } } }
      }
      if (query.includes('LinkRequestToMission')) {
        return { data: { updateRequest: { id: 'request-1', status: 'IN_PROGRESS', activeMissionID: 'mission-1' } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).resolves.toBe('Rex')
  })

  it('REQUEST_ALREADY_TAKEN : si linkRequestToMission échoue avec une erreur de type ConditionalCheckFailedException, nettoie la Mission orpheline (deleteMission) puis remonte REQUEST_ALREADY_TAKEN', async () => {
    const request = buildRequest()
    const animal = buildEligibleAnimal()
    let deleteMissionCalled = false

    const conditionalCheckError = {
      data: { updateRequest: null },
      errors: [
        {
          message: 'The conditional request failed',
          errorType: 'DynamoDB:ConditionalCheckFailedException',
        },
      ],
    }

    graphqlMock.mockImplementation(async ({ query, variables }) => {
      if (query.includes('GetRequest')) return { data: { getRequest: request } }
      if (query.includes('ListMyAnimals')) return { data: { listAnimals: { items: [animal] } } }
      if (query.includes('CreateMission')) {
        return { data: { createMission: { id: 'mission-1', status: 'PENDING_ARRIVAL' } } }
      }
      if (query.includes('LinkRequestToMission')) {
        throw conditionalCheckError
      }
      if (query.includes('DeleteMission')) {
        deleteMissionCalled = true
        expect(variables).toEqual({ input: { id: 'mission-1' } })
        return { data: { deleteMission: { id: 'mission-1' } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { acceptMission, isAccepting } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow('REQUEST_ALREADY_TAKEN')
    expect(deleteMissionCalled).toBe(true)
    expect(isAccepting.value).toBe(false)
  })

  it('un échec du nettoyage (deleteMission) ne masque pas l’erreur REQUEST_ALREADY_TAKEN d’origine', async () => {
    const request = buildRequest()
    const animal = buildEligibleAnimal()

    const conditionalCheckError = {
      errors: [{ errorType: 'DynamoDB:ConditionalCheckFailedException', message: 'The conditional request failed' }],
    }

    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('GetRequest')) return { data: { getRequest: request } }
      if (query.includes('ListMyAnimals')) return { data: { listAnimals: { items: [animal] } } }
      if (query.includes('CreateMission')) {
        return { data: { createMission: { id: 'mission-1', status: 'PENDING_ARRIVAL' } } }
      }
      if (query.includes('LinkRequestToMission')) throw conditionalCheckError
      if (query.includes('DeleteMission')) throw new Error('boom: cleanup also failed')
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow('REQUEST_ALREADY_TAKEN')
  })

  it('propage (sans la travestir en REQUEST_ALREADY_TAKEN) une erreur linkRequestToMission qui n’est pas un échec de condition', async () => {
    const request = buildRequest()
    const animal = buildEligibleAnimal()
    const authError = new Error('Not Authorized to access updateRequest on type Request')

    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('GetRequest')) return { data: { getRequest: request } }
      if (query.includes('ListMyAnimals')) return { data: { listAnimals: { items: [animal] } } }
      if (query.includes('CreateMission')) {
        return { data: { createMission: { id: 'mission-1', status: 'PENDING_ARRIVAL' } } }
      }
      if (query.includes('LinkRequestToMission')) throw authError
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission('request-1', 'animal-1')).rejects.toThrow(
      'Not Authorized to access updateRequest on type Request',
    )
    // Pas de deleteMission tenté : ce n'est pas un échec de condition.
    expect(graphqlMock).toHaveBeenCalledTimes(4)
  })
})
