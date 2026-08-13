import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase 1.1 (ADR-0002) : useAnimalValidation() expose la liste (globale, voir doc du
// composable) des Animals en attente de validation vétérinaire, et l'action de
// validation elle-même — écriture scopée à isValidatedDonor + validationExpiresAt
// uniquement (validateAnimalDonorSimple).

const graphqlMock = vi.fn()

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}))

import { useAnimalValidation } from '@/composables/useAnimalValidation'

const buildAnimal = (overrides = {}) => ({
  id: 'animal-1',
  name: 'Rex',
  species: 'DOG',
  breed: 'Labrador',
  bloodGroup: 'DEA 1.1-',
  isValidatedDonor: false,
  validationExpiresAt: null,
  ownerID: 'owner-1',
  ownerProfile: { firstname: 'Jean', lastname: 'Dupont' },
  ...overrides,
})

describe('useAnimalValidation.fetchPendingValidations', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it('inclut un Animal jamais validé (isValidatedDonor: false)', async () => {
    const neverValidated = buildAnimal({ id: 'animal-never', isValidatedDonor: false, validationExpiresAt: null })

    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('ListAnimalsForValidation')) {
        return { data: { listAnimals: { items: [neverValidated] } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { fetchPendingValidations, pendingAnimals } = useAnimalValidation()
    await fetchPendingValidations()

    expect(pendingAnimals.value.map((a) => a.id)).toEqual(['animal-never'])
  })

  it('inclut un Animal dont la validation a expiré (isValidatedDonor: true mais validationExpiresAt dans le passé)', async () => {
    const expired = buildAnimal({
      id: 'animal-expired',
      isValidatedDonor: true,
      validationExpiresAt: '2020-01-01T00:00:00.000Z',
    })

    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('ListAnimalsForValidation')) {
        return { data: { listAnimals: { items: [expired] } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { fetchPendingValidations, pendingAnimals } = useAnimalValidation()
    await fetchPendingValidations()

    expect(pendingAnimals.value.map((a) => a.id)).toEqual(['animal-expired'])
  })

  it("n'inclut PAS un Animal Validated Donor à jour (isValidatedDonor: true, validationExpiresAt dans le futur)", async () => {
    const valid = buildAnimal({
      id: 'animal-valid',
      isValidatedDonor: true,
      validationExpiresAt: '2099-01-01T00:00:00.000Z',
    })

    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('ListAnimalsForValidation')) {
        return { data: { listAnimals: { items: [valid] } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { fetchPendingValidations, pendingAnimals } = useAnimalValidation()
    await fetchPendingValidations()

    expect(pendingAnimals.value).toEqual([])
  })

  it('mélange les trois cas : ne garde que les deux animaux en attente (jamais validé + expiré), pas le valide', async () => {
    const neverValidated = buildAnimal({ id: 'animal-never', isValidatedDonor: false, validationExpiresAt: null })
    const expired = buildAnimal({
      id: 'animal-expired',
      isValidatedDonor: true,
      validationExpiresAt: '2020-01-01T00:00:00.000Z',
    })
    const valid = buildAnimal({
      id: 'animal-valid',
      isValidatedDonor: true,
      validationExpiresAt: '2099-01-01T00:00:00.000Z',
    })

    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('ListAnimalsForValidation')) {
        return { data: { listAnimals: { items: [neverValidated, expired, valid] } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { fetchPendingValidations, pendingAnimals } = useAnimalValidation()
    await fetchPendingValidations()

    expect(pendingAnimals.value.map((a) => a.id).sort()).toEqual(['animal-expired', 'animal-never'])
  })

  it('authMode userPool, isLoading true pendant le chargement puis false, et gère une erreur réseau sans throw', async () => {
    let sawLoadingDuringCall = false
    graphqlMock.mockImplementation(async ({ authMode }) => {
      expect(authMode).toBe('userPool')
      sawLoadingDuringCall = true
      throw new Error('network down')
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { fetchPendingValidations, isLoading } = useAnimalValidation()
    expect(isLoading.value).toBe(false)

    const promise = fetchPendingValidations()
    expect(isLoading.value).toBe(true)
    await promise

    expect(sawLoadingDuringCall).toBe(true)
    expect(isLoading.value).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})

describe('useAnimalValidation.validateAnimal', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it("appelle la mutation avec un input contenant EXACTEMENT id/isValidatedDonor/validationExpiresAt (rien d'autre, surtout pas bloodGroup)", async () => {
    let capturedInput = null

    graphqlMock.mockImplementation(async ({ query, variables }) => {
      if (query.includes('UpdateAnimal')) {
        capturedInput = variables.input
        return {
          data: {
            updateAnimal: {
              id: variables.input.id,
              isValidatedDonor: variables.input.isValidatedDonor,
              validationExpiresAt: variables.input.validationExpiresAt,
            },
          },
        }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { validateAnimal } = useAnimalValidation()
    await validateAnimal('animal-1')

    expect(capturedInput).not.toBeNull()
    expect(Object.keys(capturedInput).sort()).toEqual(
      ['id', 'isValidatedDonor', 'validationExpiresAt'].sort(),
    )
    expect(capturedInput.id).toBe('animal-1')
    expect(capturedInput.isValidatedDonor).toBe(true)
  })

  it('calcule validationExpiresAt à ~1 an dans le futur (ISO 8601 / AWSDateTime)', async () => {
    const before = Date.now()
    let capturedInput = null

    graphqlMock.mockImplementation(async ({ variables }) => {
      capturedInput = variables.input
      return { data: { updateAnimal: { ...variables.input } } }
    })

    const { validateAnimal } = useAnimalValidation()
    await validateAnimal('animal-1')
    const after = Date.now()

    const expiresAtMs = new Date(capturedInput.validationExpiresAt).getTime()
    const oneYearMs = 365 * 24 * 60 * 60 * 1000

    expect(expiresAtMs).toBeGreaterThanOrEqual(before + oneYearMs - 5000)
    expect(expiresAtMs).toBeLessThanOrEqual(after + oneYearMs + 5000)
    // Format ISO 8601, cohérent avec le reste du repo (ex. appointmentDatetime dans
    // useOwnerMissions.js).
    expect(capturedInput.validationExpiresAt).toBe(new Date(expiresAtMs).toISOString())
  })

  it('retire l’Animal validé de pendingAnimals.value au succès (les autres restent affichés)', async () => {
    graphqlMock.mockImplementation(async ({ variables }) => ({
      data: { updateAnimal: { ...variables.input } },
    }))

    const { validateAnimal, pendingAnimals } = useAnimalValidation()
    pendingAnimals.value = [
      buildAnimal({ id: 'animal-1' }),
      buildAnimal({ id: 'animal-2' }),
      buildAnimal({ id: 'animal-3' }),
    ]

    await validateAnimal('animal-1')

    expect(pendingAnimals.value.map((a) => a.id)).toEqual(['animal-2', 'animal-3'])
  })

  it('authMode userPool, isValidating true pendant l’appel puis false, propage l’erreur sans modifier pendingAnimals au échec', async () => {
    graphqlMock.mockImplementation(async ({ authMode }) => {
      expect(authMode).toBe('userPool')
      throw new Error('boom')
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { validateAnimal, isValidating, pendingAnimals } = useAnimalValidation()
    pendingAnimals.value = [buildAnimal({ id: 'animal-1' })]

    expect(isValidating.value).toBe(false)
    const promise = validateAnimal('animal-1')
    expect(isValidating.value).toBe(true)

    await expect(promise).rejects.toThrow('boom')

    expect(isValidating.value).toBe(false)
    expect(pendingAnimals.value.map((a) => a.id)).toEqual(['animal-1'])
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('isValidating est un ref distinct de isLoading', () => {
    const { isValidating, isLoading } = useAnimalValidation()
    expect(isValidating).not.toBe(isLoading)
  })
})
