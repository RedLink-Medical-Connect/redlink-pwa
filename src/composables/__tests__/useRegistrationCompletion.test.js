import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase 7.7 : useRegistrationCompletion() regroupe les 5 appels client.graphql() de
// complétion d'inscription (création de Clinic/Veterinarian ou Owner/Animal/
// OwnerAvailability selon le rôle) extraits de VerifyEmailView.vue.
//
// Phase 8, sous-tâche 5 (lot 1/3) : mock migré vers le client Gen2 (`aws-amplify/data`,
// `client.models.Owner.create()`/`client.models.Animal.create()`/etc.) -- un mock dédié par
// modèle plutôt qu'un unique `graphqlMock` discriminé par le nom de mutation extrait du
// texte de la query (`mutationNameOf`, qui n'a plus de sens côté appelant en Gen2 : l'input
// est passé directement, plus de document GraphQL nommé). Les assertions métier (ordre des
// appels, valeurs des champs envoyés, propagation d'erreur, `isCompleting`) restent les
// mêmes qu'avant la migration. Les assertions `authMode === 'userPool'` par appel ont été
// retirées : Gen2 ne le repasse plus par appel (`defaultAuthorizationMode` global dans
// `defineData(...)`, voir CLAUDE.md/`amplify/data/resource.ts`) -- c'était un détail
// d'implémentation Gen1, pas un comportement métier.

const ownerCreateMock = vi.fn()
const animalCreateMock = vi.fn()
const availabilityCreateMock = vi.fn()
const clinicCreateMock = vi.fn()
const vetCreateMock = vi.fn()
const consentRecordCreateMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Owner: { create: (...args) => ownerCreateMock(...args) },
      Animal: { create: (...args) => animalCreateMock(...args) },
      OwnerAvailability: { create: (...args) => availabilityCreateMock(...args) },
      Clinic: { create: (...args) => clinicCreateMock(...args) },
      Veterinarian: { create: (...args) => vetCreateMock(...args) },
      ConsentRecord: { create: (...args) => consentRecordCreateMock(...args) },
    },
  }),
}))

import { useRegistrationCompletion } from '@/composables/useRegistrationCompletion'

const resetAllMocks = () => {
  ownerCreateMock.mockReset()
  animalCreateMock.mockReset()
  availabilityCreateMock.mockReset()
  clinicCreateMock.mockReset()
  vetCreateMock.mockReset()
  consentRecordCreateMock.mockReset()
  consentRecordCreateMock.mockResolvedValue({ data: { id: 'consent-1' }, errors: undefined })
}

// cguAccepted/privacyAccepted par défaut à `true` (scaffolding légal/RGPD, 2026-08-25) :
// RegisterOwnerView.vue/RegisterClinicView.vue bloquent déjà la progression tant que les
// deux cases ne sont pas cochées -- le describe dédié plus bas ("garde-fou CONSENT_REQUIRED")
// couvre le cas `false` explicitement, pas besoin de le répéter sur chaque test existant.
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
  animal_birthDate: '2020-05-15',
  animal_weight: '25',
  blood_group: 'DEA 1.1-',
  animal_isVaccinated: true,
  animal_isSterilized: true,
  animal_donationFrequency: 'TWICE_YEAR',
  cguAccepted: true,
  privacyAccepted: true,
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
  cguAccepted: true,
  privacyAccepted: true,
  ...overrides,
})

describe('useRegistrationCompletion.completeRegistration — chemin owner', () => {
  beforeEach(resetAllMocks)

  it('appelle CreateOwner puis 2x CreateConsentRecord (CGU/confidentialité) puis CreateAnimal (animal_name renseigné) puis CreateOwnerAvailability, dans cet ordre', async () => {
    const calls = []
    ownerCreateMock.mockImplementation(async (input) => {
      calls.push({ name: 'CreateOwner', input })
      return { data: { id: 'owner-123' }, errors: undefined }
    })
    consentRecordCreateMock.mockImplementation(async (input) => {
      calls.push({ name: 'CreateConsentRecord', input })
      return { data: { id: 'consent-1' }, errors: undefined }
    })
    animalCreateMock.mockImplementation(async (input) => {
      calls.push({ name: 'CreateAnimal', input })
      return { data: { id: 'animal-1' }, errors: undefined }
    })
    availabilityCreateMock.mockImplementation(async (input) => {
      calls.push({ name: 'CreateOwnerAvailability', input })
      return { data: { id: 'avail-1' }, errors: undefined }
    })

    const { completeRegistration, isCompleting } = useRegistrationCompletion()
    expect(isCompleting.value).toBe(false)

    await completeRegistration(buildOwnerData(), 'cognito-user-1')

    expect(calls.map((c) => c.name)).toEqual([
      'CreateOwner',
      'CreateConsentRecord',
      'CreateConsentRecord',
      'CreateAnimal',
      'CreateOwnerAvailability',
    ])
    expect(isCompleting.value).toBe(false)
  })

  it('CreateConsentRecord (x2) reçoit userID = ownerID généré, userRole = OWNER, documentType CGU puis PRIVACY_POLICY, et la version en vigueur (constants/legal.js) -- jamais une version transmise par le client', async () => {
    const consentInputs = []
    ownerCreateMock.mockResolvedValue({ data: { id: 'owner-generated-id' }, errors: undefined })
    consentRecordCreateMock.mockImplementation(async (input) => {
      consentInputs.push(input)
      return { data: { id: 'consent-1' }, errors: undefined }
    })
    animalCreateMock.mockResolvedValue({ data: { id: 'animal-1' }, errors: undefined })
    availabilityCreateMock.mockResolvedValue({ data: { id: 'avail-1' }, errors: undefined })

    const { completeRegistration } = useRegistrationCompletion()
    // documentVersion falsifié côté "client" -- ne doit avoir aucun effet, la valeur écrite
    // vient toujours de LEGAL_DOCUMENT_VERSIONS.
    await completeRegistration(buildOwnerData({ documentVersion: '999.0' }), 'cognito-user-1')

    expect(consentInputs).toEqual([
      { userID: 'owner-generated-id', userRole: 'OWNER', documentType: 'CGU', documentVersion: '1.0' },
      {
        userID: 'owner-generated-id',
        userRole: 'OWNER',
        documentType: 'PRIVACY_POLICY',
        documentVersion: '1.0',
      },
    ])
  })

  it("le Owner créé utilise l'id Cognito, et l'Animal/l'OwnerAvailability référencent bien l'ownerID retourné par CreateOwner (pas cognitoUserId directement)", async () => {
    let ownerInput = null
    let animalInput = null
    let availabilityInput = null

    ownerCreateMock.mockImplementation(async (input) => {
      ownerInput = input
      return { data: { id: 'owner-generated-id' }, errors: undefined }
    })
    animalCreateMock.mockImplementation(async (input) => {
      animalInput = input
      return { data: { id: 'animal-1' }, errors: undefined }
    })
    availabilityCreateMock.mockImplementation(async (input) => {
      availabilityInput = input
      return { data: { id: 'avail-1' }, errors: undefined }
    })

    const { completeRegistration } = useRegistrationCompletion()
    await completeRegistration(buildOwnerData(), 'cognito-user-1')

    expect(ownerInput.id).toBe('cognito-user-1')
    expect(animalInput.ownerID).toBe('owner-generated-id')
    expect(availabilityInput.ownerID).toBe('owner-generated-id')
  })

  it("transmet animal_birthDate à CreateAnimal (bug réel : silencieusement absent avant ce correctif, l'âge affichait toujours '?' pour un Animal créé à l'inscription)", async () => {
    let animalInput = null
    ownerCreateMock.mockResolvedValue({ data: { id: 'owner-123' }, errors: undefined })
    animalCreateMock.mockImplementation(async (input) => {
      animalInput = input
      return { data: { id: 'animal-1' }, errors: undefined }
    })
    availabilityCreateMock.mockResolvedValue({ data: { id: 'avail-1' }, errors: undefined })

    const { completeRegistration } = useRegistrationCompletion()
    await completeRegistration(buildOwnerData({ animal_birthDate: '2020-05-15' }), 'cognito-user-1')

    expect(animalInput.birthDate).toBe('2020-05-15')
  })

  it('envoie birthDate: null quand animal_birthDate est vide (même repli que createNewAnimal, useAnimals.js)', async () => {
    let animalInput = null
    ownerCreateMock.mockResolvedValue({ data: { id: 'owner-123' }, errors: undefined })
    animalCreateMock.mockImplementation(async (input) => {
      animalInput = input
      return { data: { id: 'animal-1' }, errors: undefined }
    })
    availabilityCreateMock.mockResolvedValue({ data: { id: 'avail-1' }, errors: undefined })

    const { completeRegistration } = useRegistrationCompletion()
    await completeRegistration(buildOwnerData({ animal_birthDate: '' }), 'cognito-user-1')

    expect(animalInput.birthDate).toBeNull()
  })

  it("saute CreateAnimal quand animal_name n'est pas renseigné (inscription sans animal), mais crée quand même l'OwnerAvailability par défaut", async () => {
    const calls = []
    ownerCreateMock.mockImplementation(async () => {
      calls.push('CreateOwner')
      return { data: { id: 'owner-123' }, errors: undefined }
    })
    availabilityCreateMock.mockImplementation(async () => {
      calls.push('CreateOwnerAvailability')
      return { data: { id: 'avail-1' }, errors: undefined }
    })

    const { completeRegistration } = useRegistrationCompletion()
    await completeRegistration(buildOwnerData({ animal_name: '' }), 'cognito-user-1')

    expect(calls).toEqual(['CreateOwner', 'CreateOwnerAvailability'])
    expect(animalCreateMock).not.toHaveBeenCalled()
  })

  it("utilise Species.DOG ('DOG') comme espèce par défaut quand animal_species n'est pas renseigné, et DonationFrequency.ASAP ('ASAP') comme fréquence de don par défaut (R-14)", async () => {
    let animalInput = null
    ownerCreateMock.mockResolvedValue({ data: { id: 'owner-123' }, errors: undefined })
    animalCreateMock.mockImplementation(async (input) => {
      animalInput = input
      return { data: { id: 'animal-1' }, errors: undefined }
    })
    availabilityCreateMock.mockResolvedValue({ data: { id: 'avail-1' }, errors: undefined })

    const { completeRegistration } = useRegistrationCompletion()
    await completeRegistration(
      buildOwnerData({ animal_species: '', animal_donationFrequency: '' }),
      'cognito-user-1',
    )

    expect(animalInput.species).toBe('DOG')
    expect(animalInput.donationFrequency).toBe('ASAP')
  })

  it('transmet animal_isVaccinated/isSterilized/donationFrequency à CreateAnimal (harmonisation avec AddAnimalView.vue -- ces valeurs étaient fabriquées en silence avant ce correctif, isVaccinated forcé à true en particulier)', async () => {
    let animalInput = null
    ownerCreateMock.mockResolvedValue({ data: { id: 'owner-123' }, errors: undefined })
    animalCreateMock.mockImplementation(async (input) => {
      animalInput = input
      return { data: { id: 'animal-1' }, errors: undefined }
    })
    availabilityCreateMock.mockResolvedValue({ data: { id: 'avail-1' }, errors: undefined })

    const { completeRegistration } = useRegistrationCompletion()
    await completeRegistration(
      buildOwnerData({
        animal_isVaccinated: false,
        animal_isSterilized: true,
        animal_donationFrequency: 'ONCE_YEAR',
      }),
      'cognito-user-1',
    )

    expect(animalInput.isVaccinated).toBe(false)
    expect(animalInput.isSterilized).toBe(true)
    expect(animalInput.donationFrequency).toBe('ONCE_YEAR')
  })

  it('relance (propage) une erreur GraphQL/@auth résolue par le client Gen2 (pas de exception JS) sur CreateOwner', async () => {
    ownerCreateMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access createOwner' }],
    })

    const { completeRegistration } = useRegistrationCompletion()

    await expect(completeRegistration(buildOwnerData(), 'cognito-user-1')).rejects.toThrow()
    expect(animalCreateMock).not.toHaveBeenCalled()
    expect(availabilityCreateMock).not.toHaveBeenCalled()
  })
})

describe('useRegistrationCompletion.completeRegistration — chemin vet', () => {
  beforeEach(resetAllMocks)

  it('appelle CreateClinic puis CreateVeterinarian puis 2x CreateConsentRecord, dans cet ordre, et Veterinarian.id = cognitoUserId (jamais Clinic.id)', async () => {
    const calls = []
    let vetInput = null
    let clinicInput = null
    const consentInputs = []

    clinicCreateMock.mockImplementation(async (input) => {
      calls.push('CreateClinic')
      clinicInput = input
      return { data: { id: 'clinic-generated-id' }, errors: undefined }
    })
    vetCreateMock.mockImplementation(async (input) => {
      calls.push('CreateVeterinarian')
      vetInput = input
      return { data: { id: 'cognito-vet-1' }, errors: undefined }
    })
    consentRecordCreateMock.mockImplementation(async (input) => {
      calls.push('CreateConsentRecord')
      consentInputs.push(input)
      return { data: { id: 'consent-1' }, errors: undefined }
    })

    const { completeRegistration } = useRegistrationCompletion()
    await completeRegistration(buildVetData(), 'cognito-vet-1')

    expect(calls).toEqual(['CreateClinic', 'CreateVeterinarian', 'CreateConsentRecord', 'CreateConsentRecord'])
    expect(clinicInput.id).toBeUndefined()
    expect(vetInput.id).toBe('cognito-vet-1')
    expect(vetInput.clinicID).toBe('clinic-generated-id')
    // userID = cognitoUserId directement (pas Clinic.id) -- Veterinarian.id EST le
    // cognitoUserId sur ce schéma, contrairement à Clinic qui a son propre id généré.
    expect(consentInputs).toEqual([
      { userID: 'cognito-vet-1', userRole: 'VETERINARIAN', documentType: 'CGU', documentVersion: '1.0' },
      {
        userID: 'cognito-vet-1',
        userRole: 'VETERINARIAN',
        documentType: 'PRIVACY_POLICY',
        documentVersion: '1.0',
      },
    ])
  })

  it('relance (propage) une erreur GraphQL/@auth résolue par le client Gen2 sur CreateVeterinarian', async () => {
    clinicCreateMock.mockResolvedValue({ data: { id: 'clinic-1' }, errors: undefined })
    vetCreateMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access createVeterinarian' }],
    })

    const { completeRegistration } = useRegistrationCompletion()

    await expect(completeRegistration(buildVetData(), 'cognito-vet-1')).rejects.toThrow()
  })
})

describe('useRegistrationCompletion.completeRegistration — rôle inconnu', () => {
  beforeEach(resetAllMocks)

  it("n'appelle aucune mutation pour un rôle différent de 'owner'/'vet' (comportement identique à l'original : le if/else if ne couvrait déjà que ces deux cas)", async () => {
    const { completeRegistration } = useRegistrationCompletion()
    await expect(completeRegistration({ role: 'admin' }, 'cognito-user-1')).resolves.toBeUndefined()

    expect(ownerCreateMock).not.toHaveBeenCalled()
    expect(animalCreateMock).not.toHaveBeenCalled()
    expect(availabilityCreateMock).not.toHaveBeenCalled()
    expect(clinicCreateMock).not.toHaveBeenCalled()
    expect(vetCreateMock).not.toHaveBeenCalled()
  })
})

describe('useRegistrationCompletion.completeRegistration — échec au milieu de la séquence', () => {
  beforeEach(resetAllMocks)

  it('CreateOwner réussit puis CreateAnimal échoue (exception JS réseau) : propage l’erreur, isCompleting repasse à false, et CreateOwnerAvailability n’est JAMAIS appelée — pas de rollback du Owner déjà créé (bug préexistant documenté, pas corrigé par cette extraction)', async () => {
    ownerCreateMock.mockResolvedValue({ data: { id: 'owner-orphaned' }, errors: undefined })
    animalCreateMock.mockRejectedValue(new Error('DynamoDB:ConditionalCheckFailedException'))

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
    expect(availabilityCreateMock).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('CreateClinic réussit puis CreateVeterinarian échoue : propage l’erreur sans modifier isCompleting durablement', async () => {
    clinicCreateMock.mockResolvedValue({ data: { id: 'clinic-orphaned' }, errors: undefined })
    vetCreateMock.mockRejectedValue(new Error('boom'))

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { completeRegistration, isCompleting } = useRegistrationCompletion()
    await expect(completeRegistration(buildVetData(), 'cognito-vet-1')).rejects.toThrow('boom')

    expect(isCompleting.value).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})

// Scaffolding légal/RGPD (2026-08-25, docs/adr/0014) : défense en profondeur, voir le
// commentaire de `completeOwnerRegistration`/`completeVetRegistration` dans
// useRegistrationCompletion.js. Les deux vues d'inscription bloquent déjà la progression
// tant que les cases ne sont pas cochées -- ce garde-fou couvre le cas où cette fonction
// serait appelée par un autre chemin (test, futur appelant) sans passer par ces vues.
describe('useRegistrationCompletion.completeRegistration — garde-fou CONSENT_REQUIRED', () => {
  beforeEach(resetAllMocks)

  it.each([
    ['owner', buildOwnerData, { cguAccepted: false, privacyAccepted: true }],
    ['owner', buildOwnerData, { cguAccepted: true, privacyAccepted: false }],
    ['owner', buildOwnerData, { cguAccepted: false, privacyAccepted: false }],
    ['vet', buildVetData, { cguAccepted: false, privacyAccepted: true }],
    ['vet', buildVetData, { cguAccepted: true, privacyAccepted: false }],
  ])(
    "rejette avant toute création (%s) si l'une des deux cases n'est pas cochée (%j)",
    async (_role, buildData, overrides) => {
      const { completeRegistration } = useRegistrationCompletion()

      await expect(
        completeRegistration(buildData(overrides), 'cognito-user-1'),
      ).rejects.toThrow('CONSENT_REQUIRED')

      expect(ownerCreateMock).not.toHaveBeenCalled()
      expect(clinicCreateMock).not.toHaveBeenCalled()
      expect(vetCreateMock).not.toHaveBeenCalled()
      expect(consentRecordCreateMock).not.toHaveBeenCalled()
    },
  )

  it('CreateConsentRecord échoue (erreur GraphQL/@auth) : propage, CreateAnimal/CreateOwnerAvailability ne sont jamais appelés', async () => {
    ownerCreateMock.mockResolvedValue({ data: { id: 'owner-123' }, errors: undefined })
    consentRecordCreateMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access createConsentRecord' }],
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { completeRegistration } = useRegistrationCompletion()

    await expect(completeRegistration(buildOwnerData(), 'cognito-user-1')).rejects.toThrow()

    expect(animalCreateMock).not.toHaveBeenCalled()
    expect(availabilityCreateMock).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})
