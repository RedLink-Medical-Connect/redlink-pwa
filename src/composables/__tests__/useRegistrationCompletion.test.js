import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase 7.7 : useRegistrationCompletion() regroupe les 5 appels client.graphql() de
// complétion d'inscription (création de Clinic/Veterinarian ou Owner/Animal/
// OwnerAvailability selon le rôle) extraits de VerifyEmailView.vue.

const graphqlMock = vi.fn()

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}))

import {
  useRegistrationCompletion,
  shouldShowExpressDefaultsInfo,
} from '@/composables/useRegistrationCompletion'

const buildOwnerData = (overrides = {}) => ({
  role: 'owner',
  firstname: 'Jean',
  lastname: 'Dupont',
  email: 'jean.dupont@example.com',
  phone: '0601020304',
  address: '1 rue de Paris',
  latitude: '48.85',
  longitude: '2.35',
  animal_name: 'Rex',
  animal_species: 'dog',
  animal_breed: 'Labrador',
  animal_sex: 'MALE',
  animal_weight: '25',
  blood_group: 'DEA 1.1-',
  ...overrides,
})

const buildVetData = (overrides = {}) => ({
  role: 'vet',
  firstname: 'Cyril',
  lastname: 'Robert',
  email: 'cyril.robert@vet-alfort.fr',
  phone: '0601020304',
  address: '7 avenue du Général de Gaulle',
  latitude: '48.8',
  longitude: '2.4',
  clinic_name: 'Clinique Vétérinaire Alfort',
  rpps: '12345678901',
  ...overrides,
})

const mutationNameOf = (query) => {
  const match = query.match(/mutation (\w+)\(/)
  return match ? match[1] : null
}

describe('useRegistrationCompletion.completeRegistration — chemin owner', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it('appelle CreateOwner puis CreateAnimal (animal_name renseigné) puis CreateOwnerAvailability, dans cet ordre, avec authMode userPool', async () => {
    const calls = []
    graphqlMock.mockImplementation(async ({ query, variables, authMode }) => {
      const name = mutationNameOf(query)
      calls.push({ name, variables, authMode })
      if (name === 'CreateOwner') return { data: { createOwner: { id: 'owner-123' } } }
      if (name === 'CreateAnimal') return { data: { createAnimal: { id: 'animal-1' } } }
      if (name === 'CreateOwnerAvailability') {
        return { data: { createOwnerAvailability: { id: 'avail-1' } } }
      }
      throw new Error(`Unexpected mutation in test: ${name}`)
    })

    const { completeRegistration, isCompleting } = useRegistrationCompletion()
    expect(isCompleting.value).toBe(false)

    await completeRegistration(buildOwnerData(), 'cognito-user-1')

    expect(calls.map((c) => c.name)).toEqual(['CreateOwner', 'CreateAnimal', 'CreateOwnerAvailability'])
    expect(calls.every((c) => c.authMode === 'userPool')).toBe(true)
    expect(isCompleting.value).toBe(false)
  })

  it("le Owner créé utilise l'id Cognito, et l'Animal/l'OwnerAvailability référencent bien l'ownerID retourné par CreateOwner (pas cognitoUserId directement)", async () => {
    let ownerInput = null
    let animalInput = null
    let availabilityInput = null

    graphqlMock.mockImplementation(async ({ query, variables }) => {
      const name = mutationNameOf(query)
      if (name === 'CreateOwner') {
        ownerInput = variables.input
        return { data: { createOwner: { id: 'owner-generated-id' } } }
      }
      if (name === 'CreateAnimal') {
        animalInput = variables.input
        return { data: { createAnimal: { id: 'animal-1' } } }
      }
      if (name === 'CreateOwnerAvailability') {
        availabilityInput = variables.input
        return { data: { createOwnerAvailability: { id: 'avail-1' } } }
      }
      throw new Error(`Unexpected mutation in test: ${name}`)
    })

    const { completeRegistration } = useRegistrationCompletion()
    await completeRegistration(buildOwnerData(), 'cognito-user-1')

    expect(ownerInput.id).toBe('cognito-user-1')
    expect(animalInput.ownerID).toBe('owner-generated-id')
    expect(availabilityInput.ownerID).toBe('owner-generated-id')
  })

  it("saute CreateAnimal quand animal_name n'est pas renseigné (inscription sans animal), mais crée quand même l'OwnerAvailability par défaut", async () => {
    const calls = []
    graphqlMock.mockImplementation(async ({ query }) => {
      const name = mutationNameOf(query)
      calls.push(name)
      if (name === 'CreateOwner') return { data: { createOwner: { id: 'owner-123' } } }
      if (name === 'CreateOwnerAvailability') {
        return { data: { createOwnerAvailability: { id: 'avail-1' } } }
      }
      throw new Error(`Unexpected mutation in test: ${name}`)
    })

    const { completeRegistration } = useRegistrationCompletion()
    await completeRegistration(buildOwnerData({ animal_name: '' }), 'cognito-user-1')

    expect(calls).toEqual(['CreateOwner', 'CreateOwnerAvailability'])
  })

  it("utilise Species.DOG ('DOG') comme espèce par défaut quand animal_species n'est pas renseigné, et DonationFrequency.ASAP ('ASAP') comme fréquence de don par défaut (R-14)", async () => {
    let animalInput = null
    graphqlMock.mockImplementation(async ({ query, variables }) => {
      const name = mutationNameOf(query)
      if (name === 'CreateOwner') return { data: { createOwner: { id: 'owner-123' } } }
      if (name === 'CreateAnimal') {
        animalInput = variables.input
        return { data: { createAnimal: { id: 'animal-1' } } }
      }
      if (name === 'CreateOwnerAvailability') {
        return { data: { createOwnerAvailability: { id: 'avail-1' } } }
      }
      throw new Error(`Unexpected mutation in test: ${name}`)
    })

    const { completeRegistration } = useRegistrationCompletion()
    await completeRegistration(buildOwnerData({ animal_species: '' }), 'cognito-user-1')

    expect(animalInput.species).toBe('DOG')
    expect(animalInput.donationFrequency).toBe('ASAP')
  })
})

describe('useRegistrationCompletion.completeRegistration — chemin vet', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it('appelle CreateClinic puis CreateVeterinarian, dans cet ordre, avec authMode userPool, et Veterinarian.id = cognitoUserId (jamais Clinic.id)', async () => {
    const calls = []
    let vetInput = null
    let clinicInput = null

    graphqlMock.mockImplementation(async ({ query, variables, authMode }) => {
      const name = mutationNameOf(query)
      calls.push({ name, authMode })
      if (name === 'CreateClinic') {
        clinicInput = variables.input
        return { data: { createClinic: { id: 'clinic-generated-id' } } }
      }
      if (name === 'CreateVeterinarian') {
        vetInput = variables.input
        return { data: { createVeterinarian: { id: 'cognito-vet-1' } } }
      }
      throw new Error(`Unexpected mutation in test: ${name}`)
    })

    const { completeRegistration } = useRegistrationCompletion()
    await completeRegistration(buildVetData(), 'cognito-vet-1')

    expect(calls.map((c) => c.name)).toEqual(['CreateClinic', 'CreateVeterinarian'])
    expect(calls.every((c) => c.authMode === 'userPool')).toBe(true)
    expect(clinicInput.id).toBeUndefined()
    expect(vetInput.id).toBe('cognito-vet-1')
    expect(vetInput.clinicID).toBe('clinic-generated-id')
  })
})

describe('useRegistrationCompletion.completeRegistration — rôle inconnu', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it("n'appelle aucune mutation pour un rôle différent de 'owner'/'vet' (comportement identique à l'original : le if/else if ne couvrait déjà que ces deux cas)", async () => {
    const { completeRegistration } = useRegistrationCompletion()
    await expect(completeRegistration({ role: 'admin' }, 'cognito-user-1')).resolves.toBeUndefined()
    expect(graphqlMock).not.toHaveBeenCalled()
  })
})

describe('useRegistrationCompletion.completeRegistration — échec au milieu de la séquence', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it('CreateOwner réussit puis CreateAnimal échoue : propage l’erreur, isCompleting repasse à false, et CreateOwnerAvailability n’est JAMAIS appelée — pas de rollback du Owner déjà créé (bug préexistant documenté, pas corrigé par cette extraction)', async () => {
    const calls = []
    graphqlMock.mockImplementation(async ({ query }) => {
      const name = mutationNameOf(query)
      calls.push(name)
      if (name === 'CreateOwner') return { data: { createOwner: { id: 'owner-orphaned' } } }
      if (name === 'CreateAnimal') throw new Error('DynamoDB:ConditionalCheckFailedException')
      throw new Error(`Unexpected mutation in test: ${name}`)
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { completeRegistration, isCompleting } = useRegistrationCompletion()

    const promise = completeRegistration(buildOwnerData(), 'cognito-user-1')
    expect(isCompleting.value).toBe(true)

    await expect(promise).rejects.toThrow('DynamoDB:ConditionalCheckFailedException')

    expect(isCompleting.value).toBe(false)
    // Documente le comportement actuel : la séquence s'arrête net au premier échec, sans
    // compensation. L'Owner créé au premier appel reste orphelin côté backend (hors de
    // portée d'un test unitaire composable-seul, mais la conséquence directe est ici :
    // aucune tentative de nettoyage ni de retry n'est faite par le composable lui-même).
    expect(calls).toEqual(['CreateOwner', 'CreateAnimal'])
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('CreateClinic réussit puis CreateVeterinarian échoue : propage l’erreur sans modifier isCompleting durablement', async () => {
    graphqlMock.mockImplementation(async ({ query }) => {
      const name = mutationNameOf(query)
      if (name === 'CreateClinic') return { data: { createClinic: { id: 'clinic-orphaned' } } }
      if (name === 'CreateVeterinarian') throw new Error('boom')
      throw new Error(`Unexpected mutation in test: ${name}`)
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { completeRegistration, isCompleting } = useRegistrationCompletion()
    await expect(completeRegistration(buildVetData(), 'cognito-vet-1')).rejects.toThrow('boom')

    expect(isCompleting.value).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})

// Revue Lead Dev Phase 7 : la condition initiale de VerifyEmailView.vue
// (role === 'owner' && animal_name) laissait un Owner sans animal recevoir le
// créneau OwnerAvailability par défaut sans jamais voir l'écran de transparence
// -- completeOwnerRegistration crée toujours ce créneau, avec ou sans animal.
describe('shouldShowExpressDefaultsInfo', () => {
  it('true pour un Owner avec animal (inscription express complète)', () => {
    expect(shouldShowExpressDefaultsInfo(buildOwnerData())).toBe(true)
  })

  it('true pour un Owner SANS animal (le créneau de disponibilité est créé quand même)', () => {
    expect(shouldShowExpressDefaultsInfo(buildOwnerData({ animal_name: '' }))).toBe(true)
  })

  it('false pour un Veterinarian', () => {
    expect(shouldShowExpressDefaultsInfo(buildVetData())).toBe(false)
  })

  it('false si data est absent/null (garde défensive)', () => {
    expect(shouldShowExpressDefaultsInfo(null)).toBe(false)
    expect(shouldShowExpressDefaultsInfo(undefined)).toBe(false)
  })
})
