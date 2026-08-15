import { describe, it, expect, vi, beforeEach } from 'vitest'

// Sous-tâche 6.8 : couverture ciblée sur `createNewAnimal` — le seul point de
// `useAnimals.js` touché par cette sous-tâche (câblage du champ informatif
// `Animal.sex`, PAS un critère d'éligibilité). `fetchAnimals`/`updateAnimalDetails`/
// `deleteAnimalById` restent hors périmètre, aucun test préexistant pour ce
// composable avant cette sous-tâche.

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
})
