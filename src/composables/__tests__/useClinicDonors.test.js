import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Phase 3.2 : useClinicDonors() expose l'annuaire des donneurs de la clinique courante
// (DonorsView.vue) — lecture de ClinicOwnerRelation (peuplée depuis Phase 3.1) aplatie en
// une ligne par (Animal, Owner), filtrée aux seuls Validated Donor courants
// (isValidatedDonor(), eligibility-service.js), avec distanceKM calculée entre la clinique
// et l'Owner.

const graphqlMock = vi.fn()
const getCurrentUserMock = vi.fn()

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}))

import { useClinicDonors } from '@/composables/useClinicDonors'
import { getVetWithClinic, listClinicDonorsByClinicID } from '@/graphql/custom-queries'
import { calculateDistance } from '@/services/eligibility-service'

const buildAnimal = (overrides = {}) => ({
  id: 'animal-1',
  name: 'Rex',
  species: 'DOG',
  breed: 'Labrador',
  bloodGroup: 'DEA 1.1-',
  isValidatedDonor: true,
  validationExpiresAt: '2099-01-01T00:00:00.000Z',
  lastDonationDate: null,
  ...overrides,
})

const buildOwner = (overrides = {}) => ({
  id: 'owner-1',
  firstname: 'Jean',
  lastname: 'Dupont',
  phone: '0600000000',
  address: '1 rue de la Paix',
  latitude: 45.75,
  longitude: 4.85,
  animals: { items: [] },
  ...overrides,
})

/**
 * Mock GraphQL réutilisé par les tests de ce fichier : gère GetVetWithClinic (résolution
 * du contexte clinique) puis ListClinicDonorsByClinicID (l'annuaire lui-même).
 */
function mockGraphql({ vetClinic = { latitude: 45.75, longitude: 4.8 }, relations = [] } = {}) {
  getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
  graphqlMock.mockImplementation(async ({ query, variables }) => {
    if (query.includes('GetVetWithClinic')) {
      if (!vetClinic) {
        return { data: { getVeterinarian: { id: 'vet-1', clinicID: null, clinic: null } } }
      }
      return {
        data: {
          getVeterinarian: {
            id: 'vet-1',
            clinicID: 'clinic-1',
            clinic: { id: 'clinic-1', ...vetClinic },
          },
        },
      }
    }
    if (query.includes('ListClinicDonorsByClinicID')) {
      expect(variables).toEqual({ clinicID: 'clinic-1' })
      return { data: { clinicOwnerRelationsByClinicID: { items: relations } } }
    }
    throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
  })
}

describe('useClinicDonors.fetchDonors', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
    getCurrentUserMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exclut un Animal non Validated Donor (isValidatedDonor: false)', async () => {
    mockGraphql({
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            animals: { items: [buildAnimal({ isValidatedDonor: false })] },
          }),
        },
      ],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await fetchDonors()

    expect(donors.value).toEqual([])
  })

  it('exclut un Animal dont la validation a expiré (isValidatedDonor: true mais validationExpiresAt dans le passé)', async () => {
    mockGraphql({
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            animals: {
              items: [
                buildAnimal({ isValidatedDonor: true, validationExpiresAt: '2020-01-01T00:00:00.000Z' }),
              ],
            },
          }),
        },
      ],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await fetchDonors()

    expect(donors.value).toEqual([])
  })

  it('un Owner avec 2 Animals Validated Donor produit 2 lignes (table animal-centrique)', async () => {
    mockGraphql({
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            animals: {
              items: [
                buildAnimal({ id: 'animal-1', name: 'Rex' }),
                buildAnimal({ id: 'animal-2', name: 'Milo' }),
              ],
            },
          }),
        },
      ],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await fetchDonors()

    expect(donors.value).toHaveLength(2)
    expect(donors.value.map((d) => d.animalId).sort()).toEqual(['animal-1', 'animal-2'])
    // Chaque ligne porte bien TOUTES les infos de l'Owner partagé — pas seulement
    // ownerFirstname (un bug de mapping qui laisserait passer un seul champ correctement
    // rempli mais les autres undefined resterait invisible avec une seule assertion).
    for (const row of donors.value) {
      expect(row.ownerId).toBe('owner-1')
      expect(row.ownerFirstname).toBe('Jean')
      expect(row.ownerLastname).toBe('Dupont')
      expect(row.ownerPhone).toBe('0600000000')
      expect(row.ownerAddress).toBe('1 rue de la Paix')
    }
    // Et chaque ligne garde bien SES propres infos Animal (pas celles de l'autre ligne).
    const rex = donors.value.find((d) => d.animalId === 'animal-1')
    const milo = donors.value.find((d) => d.animalId === 'animal-2')
    expect(rex.animalName).toBe('Rex')
    expect(milo.animalName).toBe('Milo')
  })

  it('flattening sur un batch réaliste : 2 relations, un Owner avec 3 Animals (2 Validated Donor, 1 non), un Owner sans aucun Animal — exactement 2 lignes, du bon Owner, avec les bons Animals (vérification indépendante de la logique d’aplatissement, pas juste un cas trivial à 1 item)', async () => {
    mockGraphql({
      relations: [
        {
          ownerID: 'owner-A',
          ownerProfile: buildOwner({
            id: 'owner-A',
            firstname: 'Owner',
            lastname: 'A',
            animals: {
              items: [
                buildAnimal({ id: 'a1', name: 'Un', isValidatedDonor: true }),
                buildAnimal({ id: 'a2', name: 'Deux', isValidatedDonor: true }),
                buildAnimal({ id: 'a3', name: 'Trois', isValidatedDonor: false, validationExpiresAt: null }),
              ],
            },
          }),
        },
        {
          ownerID: 'owner-B',
          ownerProfile: buildOwner({
            id: 'owner-B',
            firstname: 'Owner',
            lastname: 'B',
            animals: { items: [] },
          }),
        },
      ],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await fetchDonors()

    expect(donors.value).toHaveLength(2)
    expect(donors.value.every((d) => d.ownerId === 'owner-A')).toBe(true)
    expect(donors.value.map((d) => d.animalId).sort()).toEqual(['a1', 'a2'])
  })

  it('mélange plusieurs Owners/Animals : ne garde que les lignes réellement Validated Donor', async () => {
    mockGraphql({
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            id: 'owner-1',
            animals: {
              items: [
                buildAnimal({ id: 'animal-valid', isValidatedDonor: true }),
                buildAnimal({ id: 'animal-never', isValidatedDonor: false }),
              ],
            },
          }),
        },
        {
          ownerID: 'owner-2',
          ownerProfile: buildOwner({
            id: 'owner-2',
            firstname: 'Alice',
            animals: {
              items: [buildAnimal({ id: 'animal-expired', validationExpiresAt: '2020-01-01T00:00:00.000Z' })],
            },
          }),
        },
      ],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await fetchDonors()

    expect(donors.value.map((d) => d.animalId)).toEqual(['animal-valid'])
  })

  it('calcule distanceKM avec la MÊME formule (calculateDistance, eligibility-service.js) que le reste du repo, arrondie au dixième (même arrondi que useMatchingRequests.searchMatches — Math.round(x * 10) / 10), entre la clinique et l’Owner (pas l’Animal, qui n’a pas de coordonnées propres)', async () => {
    // Paris (clinique) -> Lyon (Owner) : coordonnées réelles, ~392km à vol d'oiseau.
    const clinicCoords = { latitude: 48.8566, longitude: 2.3522 }
    const ownerCoords = { latitude: 45.764, longitude: 4.8357 }
    const expectedDistanceKM =
      Math.round(
        calculateDistance(
          clinicCoords.latitude,
          clinicCoords.longitude,
          ownerCoords.latitude,
          ownerCoords.longitude,
        ) * 10,
      ) / 10

    mockGraphql({
      vetClinic: clinicCoords,
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            ...ownerCoords,
            animals: { items: [buildAnimal()] },
          }),
        },
      ],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await fetchDonors()

    expect(donors.value).toHaveLength(1)
    expect(donors.value[0].distanceKM).toBe(expectedDistanceKM)
    // Sanity check : bien dans l'ordre de grandeur Paris-Lyon, pas juste égal par construction
    // à une formule qui serait elle-même buggée (ex. si calculateDistance retournait 0).
    expect(donors.value[0].distanceKM).toBeGreaterThan(300)
    expect(donors.value[0].distanceKM).toBeLessThan(450)
  })

  it("frontière stricte de la comparaison temporelle (même rigor que useAnimalValidation.js/useMissionClosure.js) : un Animal qui expire dans 1s reste Validated Donor, un Animal expiré depuis 1s ou exactement 'maintenant' est exclu — pas seulement testé avec des dates lointaines (2099/2020) qui masqueraient un off-by-one", async () => {
    vi.useFakeTimers()
    const now = new Date('2026-08-13T12:00:00.000Z')
    vi.setSystemTime(now)

    mockGraphql({
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            animals: {
              items: [
                buildAnimal({
                  id: 'animal-boundary-still-valid',
                  isValidatedDonor: true,
                  validationExpiresAt: new Date(now.getTime() + 1000).toISOString(),
                }),
                buildAnimal({
                  id: 'animal-boundary-just-expired',
                  isValidatedDonor: true,
                  validationExpiresAt: new Date(now.getTime() - 1000).toISOString(),
                }),
                // Expire exactement à l'instant présent : isValidatedDonor() compare avec `>`
                // strict (eligibility-service.js), donc "expire maintenant" doit être traité
                // comme expiré, pas comme encore valide.
                buildAnimal({
                  id: 'animal-boundary-exact-now',
                  isValidatedDonor: true,
                  validationExpiresAt: now.toISOString(),
                }),
              ],
            },
          }),
        },
      ],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await fetchDonors()

    expect(donors.value.map((d) => d.animalId)).toEqual(['animal-boundary-still-valid'])
  })

  it("distanceKM est 0 (pas null) quand la clinique et l'Owner sont exactement aux mêmes coordonnées — distingue 'distance vraiment nulle' de 'distance non calculable' (coordonnées manquantes, testé séparément ci-dessous) : les deux ne doivent PAS être confondus dans le rendu (distance_unknown vs '0 km')", async () => {
    const sharedCoords = { latitude: 45.75, longitude: 4.85 }

    mockGraphql({
      vetClinic: sharedCoords,
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            ...sharedCoords,
            animals: { items: [buildAnimal()] },
          }),
        },
      ],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await fetchDonors()

    expect(donors.value).toHaveLength(1)
    expect(donors.value[0].distanceKM).toBe(0)
    expect(donors.value[0].distanceKM).not.toBeNull()
  })

  it("distanceKM est null (pas 'Infinity') quand les coordonnées de l'Owner sont manquantes", async () => {
    mockGraphql({
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            latitude: null,
            longitude: null,
            animals: { items: [buildAnimal()] },
          }),
        },
      ],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await fetchDonors()

    expect(donors.value[0].distanceKM).toBeNull()
  })

  it('relation sans ownerProfile (Owner introuvable/supprimé) : ignorée sans planter', async () => {
    mockGraphql({
      relations: [{ ownerID: 'owner-orphan', ownerProfile: null }],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await expect(fetchDonors()).resolves.toBeUndefined()
    expect(donors.value).toEqual([])
  })

  it('batch mélangé réaliste : une relation avec ownerProfile null au milieu de relations valides — les lignes des Owners valides sortent quand même, seule la relation orpheline est sautée (pas un cas trivial où TOUT est orphelin)', async () => {
    mockGraphql({
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            id: 'owner-1',
            animals: { items: [buildAnimal({ id: 'animal-1' })] },
          }),
        },
        { ownerID: 'owner-orphan', ownerProfile: null },
        {
          ownerID: 'owner-2',
          ownerProfile: buildOwner({
            id: 'owner-2',
            firstname: 'Alice',
            animals: { items: [buildAnimal({ id: 'animal-2' })] },
          }),
        },
      ],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await expect(fetchDonors()).resolves.toBeUndefined()

    expect(donors.value.map((d) => d.animalId).sort()).toEqual(['animal-1', 'animal-2'])
    expect(donors.value.map((d) => d.ownerId).sort()).toEqual(['owner-1', 'owner-2'])
  })

  it('Veterinarian sans clinicID/clinic résolue : donors vide, pas d’appel à ListClinicDonorsByClinicID, pas d’erreur', async () => {
    mockGraphql({ vetClinic: null })

    const { fetchDonors, donors, loadError } = useClinicDonors()
    await fetchDonors()

    expect(donors.value).toEqual([])
    expect(loadError.value).toBe(false)
    expect(graphqlMock).toHaveBeenCalledTimes(1)
  })

  it('mémoïse le contexte clinique : un second fetchDonors() ne rappelle pas GetVetWithClinic', async () => {
    mockGraphql({ relations: [] })

    const { fetchDonors } = useClinicDonors()
    await fetchDonors()
    await fetchDonors()

    const vetCalls = graphqlMock.mock.calls.filter(([{ query }]) => query.includes('GetVetWithClinic'))
    expect(vetCalls).toHaveLength(1)
  })

  it('authMode userPool sur les deux appels, isLoading true pendant le chargement puis false', async () => {
    mockGraphql({ relations: [] })
    let sawUserPoolCalls = 0
    graphqlMock.mockImplementation(async ({ query, variables, authMode }) => {
      expect(authMode).toBe('userPool')
      sawUserPoolCalls += 1
      if (query.includes('GetVetWithClinic')) {
        return {
          data: {
            getVeterinarian: {
              id: 'vet-1',
              clinicID: 'clinic-1',
              clinic: { id: 'clinic-1', latitude: 45.75, longitude: 4.8 },
            },
          },
        }
      }
      if (query.includes('ListClinicDonorsByClinicID')) {
        expect(variables).toEqual({ clinicID: 'clinic-1' })
        return { data: { clinicOwnerRelationsByClinicID: { items: [] } } }
      }
      throw new Error('unexpected')
    })

    const { fetchDonors, isLoading } = useClinicDonors()
    expect(isLoading.value).toBe(false)

    const promise = fetchDonors()
    expect(isLoading.value).toBe(true)
    await promise

    expect(isLoading.value).toBe(false)
    expect(sawUserPoolCalls).toBe(2)
  })

  it("loadError distingue un échec de chargement d'un annuaire réellement vide", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
    graphqlMock.mockImplementation(async () => {
      throw new Error('network down')
    })

    const { fetchDonors, loadError, donors } = useClinicDonors()
    expect(loadError.value).toBe(false)

    await fetchDonors()

    expect(loadError.value).toBe(true)
    expect(donors.value).toEqual([])
    expect(consoleErrorSpy).toHaveBeenCalled()

    // Un rechargement réussi (ex. clic "Réessayer") efface l'état d'erreur.
    mockGraphql({ relations: [] })
    await fetchDonors()

    expect(loadError.value).toBe(false)

    consoleErrorSpy.mockRestore()
  })

  it("échec de la query ListClinicDonorsByClinicID (après résolution réussie du contexte clinique) : loadError à true, donors vidé", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('GetVetWithClinic')) {
        return {
          data: {
            getVeterinarian: {
              id: 'vet-1',
              clinicID: 'clinic-1',
              clinic: { id: 'clinic-1', latitude: 45.75, longitude: 4.8 },
            },
          },
        }
      }
      throw new Error('DynamoDB throttled')
    })

    const { fetchDonors, loadError, donors } = useClinicDonors()
    await fetchDonors()

    expect(loadError.value).toBe(true)
    expect(donors.value).toEqual([])
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('donneurs'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it('les deux queries référencées sont bien celles importées de custom-queries.js', async () => {
    mockGraphql({ relations: [] })
    const capturedQueries = []
    graphqlMock.mockImplementation(async ({ query, variables }) => {
      capturedQueries.push(query)
      if (query.includes('GetVetWithClinic')) {
        return {
          data: {
            getVeterinarian: {
              id: 'vet-1',
              clinicID: 'clinic-1',
              clinic: { id: 'clinic-1', latitude: 45.75, longitude: 4.8 },
            },
          },
        }
      }
      expect(variables).toEqual({ clinicID: 'clinic-1' })
      return { data: { clinicOwnerRelationsByClinicID: { items: [] } } }
    })

    const { fetchDonors } = useClinicDonors()
    await fetchDonors()

    expect(capturedQueries).toContain(getVetWithClinic)
    expect(capturedQueries).toContain(listClinicDonorsByClinicID)
  })
})
