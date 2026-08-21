import { describe, it, expect, vi, beforeEach } from 'vitest'

// Sous-tâche 6.8 : couverture ciblée sur `createNewAnimal` — le seul point de
// `useAnimals.js` touché par cette sous-tâche (câblage du champ informatif
// `Animal.sex`, PAS un critère d'éligibilité). `fetchAnimals`/`updateAnimalDetails`/
// `deleteAnimalById` restent hors périmètre, aucun test préexistant pour ce
// composable avant cette sous-tâche.
//
// Sous-tâche 7.5 (R-08) : étend la couverture à `fetchAnimals` (bug `loadError`, voir
// useAnimals.js), au succès partiel GraphQL de `updateAnimalDetails`, au rollback
// optimiste de `deleteAnimalById`, et verrouille explicitement le défaut
// `bloodGroup: 'UNKNOWN'` de `createNewAnimal` déjà en place avant cette sous-tâche.
//
// Phase 8, sous-tâche 5 (lot 1/3) : mock migré vers le client Gen2 (`aws-amplify/data`,
// `client.models.Animal.*`), un mock dédié par méthode plutôt qu'un unique `graphqlMock`
// discriminé par le texte de la query. Les assertions métier (valeurs de `animals.value`/
// `loadError.value`, propagation ou non d'une erreur) restent EXACTEMENT les mêmes qu'avant
// la migration -- seule la forme du mock change (voir CLAUDE.md / roadmap Phase 8). Deux cas
// supplémentaires couverts ici, absents du test Gen1 : `errors` SANS `data` exploitable sur
// `updateAnimalDetails`/`deleteAnimalById` -- un cas qui n'existait pas en Gen1 (où
// `client.graphql()` levait directement une exception pour toute erreur GraphQL/@auth, jamais
// un `{ data: null, errors }` résolu) mais que `client.models.Animal.*` peut désormais
// renvoyer -- `useAnimals.js` doit continuer à le traiter comme un échec (rollback + relance),
// pas comme un succès silencieux.

const animalListMock = vi.fn()
const animalCreateMock = vi.fn()
const animalUpdateMock = vi.fn()
const animalDeleteMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Animal: {
        list: (...args) => animalListMock(...args),
        create: (...args) => animalCreateMock(...args),
        update: (...args) => animalUpdateMock(...args),
        delete: (...args) => animalDeleteMock(...args),
      },
    },
  }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ userId: 'owner-1' })),
}))

import { useAnimals } from '@/composables/useAnimals'

const resetAllMocks = () => {
  animalListMock.mockReset()
  animalCreateMock.mockReset()
  animalUpdateMock.mockReset()
  animalDeleteMock.mockReset()
}

describe('useAnimals.createNewAnimal', () => {
  beforeEach(resetAllMocks)

  it('transmet le sexe choisi tel quel dans la mutation create', async () => {
    animalCreateMock.mockImplementation(async (input) => ({
      data: { id: 'animal-1', ...input },
      errors: undefined,
    }))

    const { createNewAnimal } = useAnimals()

    await createNewAnimal(
      {
        name: 'Rex',
        species: 'DOG',
        breed: 'Labrador',
        sex: 'MALE',
        weight: 25,
        bloodGroup: 'DEA 1.1-',
        isVaccinated: true,
        isSterilized: false,
        donationFrequency: 'ASAP',
      },
      'owner-1',
    )

    expect(animalCreateMock).toHaveBeenCalledTimes(1)
    const input = animalCreateMock.mock.calls[0][0]
    expect(input.sex).toBe('MALE')
  })

  it("n'impose aucune valeur par défaut quand le sexe n'est pas renseigné (champ informatif optionnel)", async () => {
    animalCreateMock.mockImplementation(async (input) => ({
      data: { id: 'animal-2', ...input },
      errors: undefined,
    }))

    const { createNewAnimal } = useAnimals()

    await createNewAnimal(
      {
        name: 'Mia',
        species: 'CAT',
        breed: '',
        weight: 4,
        bloodGroup: 'A',
        isVaccinated: true,
        isSterilized: false,
        donationFrequency: 'ASAP',
      },
      'owner-1',
    )

    const input = animalCreateMock.mock.calls[0][0]
    expect(input.sex).toBeNull()
  })

  it("retombe sur bloodGroup: 'UNKNOWN' quand le formulaire n'en fournit pas", async () => {
    animalCreateMock.mockImplementation(async (input) => ({
      data: { id: 'animal-3', ...input },
      errors: undefined,
    }))

    const { createNewAnimal } = useAnimals()

    await createNewAnimal(
      {
        name: 'Filou',
        species: 'DOG',
        breed: '',
        weight: 12,
        // bloodGroup volontairement absent du formulaire
        isVaccinated: false,
        isSterilized: false,
        donationFrequency: 'ASAP',
      },
      'owner-1',
    )

    const input = animalCreateMock.mock.calls[0][0]
    expect(input.bloodGroup).toBe('UNKNOWN')
  })

  it("relance (propage) une erreur GraphQL sans data exploitable, sans ajouter l'animal localement", async () => {
    animalCreateMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access createAnimal' }],
    })

    const { animals, createNewAnimal } = useAnimals()

    await expect(
      createNewAnimal(
        { name: 'Rex', species: 'DOG', weight: 25, bloodGroup: 'A', donationFrequency: 'ASAP' },
        'owner-1',
      ),
    ).rejects.toThrow()

    expect(animals.value).toEqual([])
  })
})

describe('useAnimals.fetchAnimals', () => {
  beforeEach(resetAllMocks)

  it('charge les animaux et laisse loadError à false en cas de succès', async () => {
    animalListMock.mockResolvedValue({
      data: [{ id: 'animal-1', name: 'Rex', birthDate: null }],
      errors: undefined,
    })

    const { animals, loadError, fetchAnimals } = useAnimals()
    const ownerId = await fetchAnimals()

    expect(ownerId).toBe('owner-1')
    expect(animals.value).toHaveLength(1)
    expect(loadError.value).toBe(false)
  })

  it('bascule loadError à true et vide animals sans relancer, sur échec réseau/@auth', async () => {
    animalListMock.mockRejectedValue(new Error('Network error'))

    const { animals, loadError, fetchAnimals } = useAnimals()

    // Ne doit PAS rejeter : l'échec se lit sur `loadError`, pas sur un throw (convention
    // CLAUDE.md -- voir la doc de fetchAnimals()).
    await expect(fetchAnimals()).resolves.toBeUndefined()

    expect(loadError.value).toBe(true)
    expect(animals.value).toEqual([])
  })

  it('bascule loadError à true sur une erreur GraphQL/@auth résolue (pas rejetée) par le client Gen2', async () => {
    animalListMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access listAnimals' }],
    })

    const { loadError, fetchAnimals } = useAnimals()

    await expect(fetchAnimals()).resolves.toBeUndefined()
    expect(loadError.value).toBe(true)
  })

  it('réinitialise loadError à false au début du prochain appel réussi', async () => {
    animalListMock.mockRejectedValueOnce(new Error('Network error'))
    animalListMock.mockResolvedValueOnce({ data: [], errors: undefined })

    const { loadError, fetchAnimals } = useAnimals()

    await fetchAnimals()
    expect(loadError.value).toBe(true)

    await fetchAnimals()
    expect(loadError.value).toBe(false)
  })
})

describe('useAnimals.updateAnimalDetails', () => {
  beforeEach(resetAllMocks)

  it('met à jour animals localement sur succès plein', async () => {
    animalUpdateMock.mockResolvedValue({
      data: { id: 'animal-1', name: 'Rex modifié', birthDate: null },
      errors: undefined,
    })

    const { animals, updateAnimalDetails } = useAnimals()
    animals.value = [{ id: 'animal-1', name: 'Rex' }]

    await updateAnimalDetails({ id: 'animal-1', name: 'Rex modifié' })

    expect(animals.value[0].name).toBe('Rex modifié')
  })

  it("traite un succès partiel GraphQL (data ET errors) comme un succès, sans relancer", async () => {
    // Gen2 (aws-amplify/data) résout normalement avec `{ data, errors }`, y compris pour un
    // succès partiel (relation annexe non résolue) -- plus d'exception JS porteuse d'un
    // `.data` (pattern Gen1).
    animalUpdateMock.mockResolvedValue({
      data: { id: 'animal-1', name: 'Rex modifié', birthDate: null },
      errors: [{ message: 'Impossible de résoudre une relation annexe' }],
    })

    const { animals, updateAnimalDetails } = useAnimals()
    animals.value = [{ id: 'animal-1', name: 'Rex' }]

    await expect(
      updateAnimalDetails({ id: 'animal-1', name: 'Rex modifié' }),
    ).resolves.toBeUndefined()

    expect(animals.value[0].name).toBe('Rex modifié')
  })

  it("relance une vraie erreur réseau/exception JS sans modifier animals", async () => {
    animalUpdateMock.mockRejectedValue(new Error('Network error'))

    const { animals, updateAnimalDetails } = useAnimals()
    animals.value = [{ id: 'animal-1', name: 'Rex' }]

    await expect(updateAnimalDetails({ id: 'animal-1', name: 'Rex modifié' })).rejects.toThrow(
      'Network error',
    )

    expect(animals.value[0].name).toBe('Rex')
  })

  it("relance une erreur GraphQL/@auth résolue sans data exploitable, sans modifier animals", async () => {
    animalUpdateMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access updateAnimal' }],
    })

    const { animals, updateAnimalDetails } = useAnimals()
    animals.value = [{ id: 'animal-1', name: 'Rex' }]

    await expect(updateAnimalDetails({ id: 'animal-1', name: 'Rex modifié' })).rejects.toThrow()

    expect(animals.value[0].name).toBe('Rex')
  })
})

describe('useAnimals.deleteAnimalById', () => {
  beforeEach(resetAllMocks)

  it('retire animals de manière optimiste puis confirme sur succès', async () => {
    animalDeleteMock.mockResolvedValue({ data: { id: 'animal-1' }, errors: undefined })

    const { animals, deleteAnimalById } = useAnimals()
    animals.value = [{ id: 'animal-1', name: 'Rex' }]

    await deleteAnimalById('animal-1')

    expect(animals.value).toEqual([])
  })

  it('annule (rollback) le retrait optimiste et relance sur vraie erreur serveur', async () => {
    animalDeleteMock.mockRejectedValue(new Error('Network error'))

    const { animals, deleteAnimalById } = useAnimals()
    animals.value = [{ id: 'animal-1', name: 'Rex' }]

    await expect(deleteAnimalById('animal-1')).rejects.toThrow('Network error')

    // Le rollback restaure exactement la liste précédente.
    expect(animals.value).toEqual([{ id: 'animal-1', name: 'Rex' }])
  })

  it("ne fait pas de rollback sur succès partiel GraphQL (data présent malgré errors)", async () => {
    animalDeleteMock.mockResolvedValue({
      data: { id: 'animal-1' },
      errors: [{ message: 'Impossible de résoudre une relation annexe' }],
    })

    const { animals, deleteAnimalById } = useAnimals()
    animals.value = [{ id: 'animal-1', name: 'Rex' }]

    await expect(deleteAnimalById('animal-1')).resolves.toBeUndefined()

    expect(animals.value).toEqual([])
  })

  it("fait un rollback sur une erreur GraphQL/@auth résolue sans data exploitable", async () => {
    animalDeleteMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access deleteAnimal' }],
    })

    const { animals, deleteAnimalById } = useAnimals()
    animals.value = [{ id: 'animal-1', name: 'Rex' }]

    await expect(deleteAnimalById('animal-1')).rejects.toThrow()

    expect(animals.value).toEqual([{ id: 'animal-1', name: 'Rex' }])
  })
})
