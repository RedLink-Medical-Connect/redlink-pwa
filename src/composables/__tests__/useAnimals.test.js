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

const graphqlMock = vi.fn()

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ userId: 'owner-1' })),
}))

import { useAnimals } from '@/composables/useAnimals'

describe('useAnimals.createNewAnimal', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it('transmet le sexe choisi tel quel dans la mutation createAnimalSimple', async () => {
    graphqlMock.mockImplementation(async ({ variables }) => ({
      data: { createAnimal: { id: 'animal-1', ...variables.input } },
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

    expect(graphqlMock).toHaveBeenCalledTimes(1)
    const { variables } = graphqlMock.mock.calls[0][0]
    expect(variables.input.sex).toBe('MALE')
  })

  it("n'impose aucune valeur par défaut quand le sexe n'est pas renseigné (champ informatif optionnel)", async () => {
    graphqlMock.mockImplementation(async ({ variables }) => ({
      data: { createAnimal: { id: 'animal-2', ...variables.input } },
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

    const { variables } = graphqlMock.mock.calls[0][0]
    expect(variables.input.sex).toBeNull()
  })

  it("retombe sur bloodGroup: 'UNKNOWN' quand le formulaire n'en fournit pas", async () => {
    graphqlMock.mockImplementation(async ({ variables }) => ({
      data: { createAnimal: { id: 'animal-3', ...variables.input } },
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

    const { variables } = graphqlMock.mock.calls[0][0]
    expect(variables.input.bloodGroup).toBe('UNKNOWN')
  })
})

describe('useAnimals.fetchAnimals', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it('charge les animaux et laisse loadError à false en cas de succès', async () => {
    graphqlMock.mockResolvedValue({
      data: { listAnimals: { items: [{ id: 'animal-1', name: 'Rex', birthDate: null }] } },
    })

    const { animals, loadError, fetchAnimals } = useAnimals()
    const ownerId = await fetchAnimals()

    expect(ownerId).toBe('owner-1')
    expect(animals.value).toHaveLength(1)
    expect(loadError.value).toBe(false)
  })

  it('bascule loadError à true et vide animals sans relancer, sur échec réseau/@auth', async () => {
    graphqlMock.mockRejectedValue(new Error('Network error'))

    const { animals, loadError, fetchAnimals } = useAnimals()

    // Ne doit PAS rejeter : l'échec se lit sur `loadError`, pas sur un throw (convention
    // CLAUDE.md -- voir la doc de fetchAnimals()).
    await expect(fetchAnimals()).resolves.toBeUndefined()

    expect(loadError.value).toBe(true)
    expect(animals.value).toEqual([])
  })

  it('réinitialise loadError à false au début du prochain appel réussi', async () => {
    graphqlMock.mockRejectedValueOnce(new Error('Network error'))
    graphqlMock.mockResolvedValueOnce({
      data: { listAnimals: { items: [] } },
    })

    const { loadError, fetchAnimals } = useAnimals()

    await fetchAnimals()
    expect(loadError.value).toBe(true)

    await fetchAnimals()
    expect(loadError.value).toBe(false)
  })
})

describe('useAnimals.updateAnimalDetails', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it('met à jour animals localement sur succès plein', async () => {
    graphqlMock.mockResolvedValue({
      data: { updateAnimal: { id: 'animal-1', name: 'Rex modifié', birthDate: null } },
    })

    const { animals, updateAnimalDetails } = useAnimals()
    animals.value = [{ id: 'animal-1', name: 'Rex' }]

    await updateAnimalDetails({ id: 'animal-1', name: 'Rex modifié' })

    expect(animals.value[0].name).toBe('Rex modifié')
  })

  it("traite un succès partiel GraphQL (data ET errors) comme un succès, sans relancer", async () => {
    // Amplify (aws-amplify/api) remonte ce cas comme une exception JS porteuse à la fois
    // de `.data` et `.errors` (pas une simple réponse `{ data, errors }` retournée sans
    // throw) -- même modélisation que `deleteAnimalById` ci-dessous.
    const partialError = Object.assign(new Error('GraphQL error'), {
      data: { updateAnimal: { id: 'animal-1', name: 'Rex modifié', birthDate: null } },
      errors: [{ message: "Impossible de résoudre une relation annexe" }],
    })
    graphqlMock.mockRejectedValue(partialError)

    const { animals, updateAnimalDetails } = useAnimals()
    animals.value = [{ id: 'animal-1', name: 'Rex' }]

    await expect(
      updateAnimalDetails({ id: 'animal-1', name: 'Rex modifié' }),
    ).resolves.toBeUndefined()

    expect(animals.value[0].name).toBe('Rex modifié')
  })

  it("relance une vraie erreur (pas de data.updateAnimal exploitable) sans modifier animals", async () => {
    const realError = new Error('Network error')
    graphqlMock.mockRejectedValue(realError)

    const { animals, updateAnimalDetails } = useAnimals()
    animals.value = [{ id: 'animal-1', name: 'Rex' }]

    await expect(updateAnimalDetails({ id: 'animal-1', name: 'Rex modifié' })).rejects.toThrow(
      'Network error',
    )

    expect(animals.value[0].name).toBe('Rex')
  })
})

describe('useAnimals.deleteAnimalById', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it('retire animals de manière optimiste puis confirme sur succès', async () => {
    graphqlMock.mockResolvedValue({ data: { deleteAnimal: { id: 'animal-1' } } })

    const { animals, deleteAnimalById } = useAnimals()
    animals.value = [{ id: 'animal-1', name: 'Rex' }]

    await deleteAnimalById('animal-1')

    expect(animals.value).toEqual([])
  })

  it('annule (rollback) le retrait optimiste et relance sur vraie erreur serveur', async () => {
    const realError = new Error('Network error')
    graphqlMock.mockRejectedValue(realError)

    const { animals, deleteAnimalById } = useAnimals()
    animals.value = [{ id: 'animal-1', name: 'Rex' }]

    await expect(deleteAnimalById('animal-1')).rejects.toThrow('Network error')

    // Le rollback restaure exactement la liste précédente.
    expect(animals.value).toEqual([{ id: 'animal-1', name: 'Rex' }])
  })

  it("ne fait pas de rollback sur succès partiel GraphQL (data.deleteAnimal présent malgré errors)", async () => {
    const partialError = Object.assign(new Error('GraphQL error'), {
      data: { deleteAnimal: { id: 'animal-1' } },
      errors: [{ message: "Impossible de résoudre une relation annexe" }],
    })
    graphqlMock.mockRejectedValue(partialError)

    const { animals, deleteAnimalById } = useAnimals()
    animals.value = [{ id: 'animal-1', name: 'Rex' }]

    await expect(deleteAnimalById('animal-1')).resolves.toBeUndefined()

    expect(animals.value).toEqual([])
  })
})
