import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Phase 3.2 : useClinicDonors() expose l'annuaire des donneurs de la clinique courante
// (DonorsView.vue) — lecture de ClinicOwnerRelation (peuplée depuis Phase 3.1) aplatie en
// une ligne par (Animal, Owner), filtrée aux seuls Validated Donor courants
// (isValidatedDonor(), eligibility-service.js), avec distanceKM calculée entre la clinique
// et l'Owner.
//
// Phase 8, sous-tâche 5 (lot 2/3) : useClinicDonors.js migré sur le client Gen2
// (`aws-amplify/data`, `client.models.Veterinarian.get()` avec `selectionSet` +
// `client.models.ClinicOwnerRelation.list()` avec `selectionSet`) -- mock reconstruit sur
// `{ data, errors }` par méthode de modèle. `ownerProfile.animals` est désormais un
// tableau direct (`RestoreArrays`, cf. commentaire dans useClinicDonors.js), plus
// enveloppé dans `{ items: [...] }` comme le faisait la query Gen1
// (`listClinicDonorsByClinicID`) -- `buildOwner()` ci-dessous reflète ce nouveau shape.
// Assertions métier (flattening, Validated Donor, distanceKM, loadError) inchangées.

const vetGetMock = vi.fn()
const relationListMock = vi.fn()
const getCurrentUserMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Veterinarian: { get: (...args) => vetGetMock(...args) },
      ClinicOwnerRelation: { list: (...args) => relationListMock(...args) },
    },
  }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}))

import { useClinicDonors } from '@/composables/useClinicDonors'
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
  animals: [],
  ...overrides,
})

/**
 * Mock du client Gen2 réutilisé par les tests de ce fichier : gère
 * `Veterinarian.get()` (résolution du contexte clinique, avec `selectionSet`) puis
 * `ClinicOwnerRelation.list()` (l'annuaire lui-même, avec `selectionSet`).
 */
function mockClient({ vetClinic = { latitude: 45.75, longitude: 4.8 }, relations = [] } = {}) {
  getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })

  vetGetMock.mockImplementation(async ({ id }, options) => {
    expect(id).toBe('vet-1')
    expect(options?.selectionSet).toEqual(
      expect.arrayContaining(['clinicID', 'clinic.latitude', 'clinic.longitude']),
    )
    if (!vetClinic) {
      return { data: { id: 'vet-1', clinicID: null, clinic: null }, errors: undefined }
    }
    return {
      data: { id: 'vet-1', clinicID: 'clinic-1', clinic: { id: 'clinic-1', ...vetClinic } },
      errors: undefined,
    }
  })

  relationListMock.mockImplementation(async ({ filter, selectionSet }) => {
    expect(filter).toEqual({ clinicID: { eq: 'clinic-1' } })
    expect(selectionSet).toEqual(
      expect.arrayContaining(['ownerID', 'ownerProfile.animals.bloodGroup']),
    )
    return { data: relations, errors: undefined }
  })
}

describe('useClinicDonors.fetchDonors', () => {
  beforeEach(() => {
    vetGetMock.mockReset()
    relationListMock.mockReset()
    getCurrentUserMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exclut un Animal non Validated Donor (isValidatedDonor: false)', async () => {
    mockClient({
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            animals: [buildAnimal({ isValidatedDonor: false })],
          }),
        },
      ],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await fetchDonors()

    expect(donors.value).toEqual([])
  })

  it('exclut un Animal dont la validation a expiré (isValidatedDonor: true mais validationExpiresAt dans le passé)', async () => {
    mockClient({
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            animals: [
              buildAnimal({ isValidatedDonor: true, validationExpiresAt: '2020-01-01T00:00:00.000Z' }),
            ],
          }),
        },
      ],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await fetchDonors()

    expect(donors.value).toEqual([])
  })

  it('un Owner avec 2 Animals Validated Donor produit 2 lignes (table animal-centrique)', async () => {
    mockClient({
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            animals: [
              buildAnimal({ id: 'animal-1', name: 'Rex' }),
              buildAnimal({ id: 'animal-2', name: 'Milo' }),
            ],
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
    }
    // Et chaque ligne garde bien SES propres infos Animal (pas celles de l'autre ligne).
    const rex = donors.value.find((d) => d.animalId === 'animal-1')
    const milo = donors.value.find((d) => d.animalId === 'animal-2')
    expect(rex.animalName).toBe('Rex')
    expect(milo.animalName).toBe('Milo')
  })

  it('flattening sur un batch réaliste : 2 relations, un Owner avec 3 Animals (2 Validated Donor, 1 non), un Owner sans aucun Animal — exactement 2 lignes, du bon Owner, avec les bons Animals (vérification indépendante de la logique d’aplatissement, pas juste un cas trivial à 1 item)', async () => {
    mockClient({
      relations: [
        {
          ownerID: 'owner-A',
          ownerProfile: buildOwner({
            id: 'owner-A',
            firstname: 'Owner',
            lastname: 'A',
            animals: [
              buildAnimal({ id: 'a1', name: 'Un', isValidatedDonor: true }),
              buildAnimal({ id: 'a2', name: 'Deux', isValidatedDonor: true }),
              buildAnimal({ id: 'a3', name: 'Trois', isValidatedDonor: false, validationExpiresAt: null }),
            ],
          }),
        },
        {
          ownerID: 'owner-B',
          ownerProfile: buildOwner({
            id: 'owner-B',
            firstname: 'Owner',
            lastname: 'B',
            animals: [],
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
    mockClient({
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            id: 'owner-1',
            animals: [
              buildAnimal({ id: 'animal-valid', isValidatedDonor: true }),
              buildAnimal({ id: 'animal-never', isValidatedDonor: false }),
            ],
          }),
        },
        {
          ownerID: 'owner-2',
          ownerProfile: buildOwner({
            id: 'owner-2',
            firstname: 'Alice',
            animals: [buildAnimal({ id: 'animal-expired', validationExpiresAt: '2020-01-01T00:00:00.000Z' })],
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

    mockClient({
      vetClinic: clinicCoords,
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            ...ownerCoords,
            animals: [buildAnimal()],
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

    mockClient({
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            animals: [
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

    mockClient({
      vetClinic: sharedCoords,
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            ...sharedCoords,
            animals: [buildAnimal()],
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
    mockClient({
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            latitude: null,
            longitude: null,
            animals: [buildAnimal()],
          }),
        },
      ],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await fetchDonors()

    expect(donors.value[0].distanceKM).toBeNull()
  })

  it('relation sans ownerProfile (Owner introuvable/supprimé) : ignorée sans planter', async () => {
    mockClient({
      relations: [{ ownerID: 'owner-orphan', ownerProfile: null }],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await expect(fetchDonors()).resolves.toBeUndefined()
    expect(donors.value).toEqual([])
  })

  it('batch mélangé réaliste : une relation avec ownerProfile null au milieu de relations valides — les lignes des Owners valides sortent quand même, seule la relation orpheline est sautée (pas un cas trivial où TOUT est orphelin)', async () => {
    mockClient({
      relations: [
        {
          ownerID: 'owner-1',
          ownerProfile: buildOwner({
            id: 'owner-1',
            animals: [buildAnimal({ id: 'animal-1' })],
          }),
        },
        { ownerID: 'owner-orphan', ownerProfile: null },
        {
          ownerID: 'owner-2',
          ownerProfile: buildOwner({
            id: 'owner-2',
            firstname: 'Alice',
            animals: [buildAnimal({ id: 'animal-2' })],
          }),
        },
      ],
    })

    const { fetchDonors, donors } = useClinicDonors()
    await expect(fetchDonors()).resolves.toBeUndefined()

    expect(donors.value.map((d) => d.animalId).sort()).toEqual(['animal-1', 'animal-2'])
    expect(donors.value.map((d) => d.ownerId).sort()).toEqual(['owner-1', 'owner-2'])
  })

  it('Veterinarian sans clinicID/clinic résolue : donors vide, pas d’appel à ClinicOwnerRelation.list(), pas d’erreur', async () => {
    mockClient({ vetClinic: null })

    const { fetchDonors, donors, loadError } = useClinicDonors()
    await fetchDonors()

    expect(donors.value).toEqual([])
    expect(loadError.value).toBe(false)
    expect(vetGetMock).toHaveBeenCalledTimes(1)
    expect(relationListMock).not.toHaveBeenCalled()
  })

  it('mémoïse le contexte clinique : un second fetchDonors() ne rappelle pas Veterinarian.get()', async () => {
    mockClient({ relations: [] })

    const { fetchDonors } = useClinicDonors()
    await fetchDonors()
    await fetchDonors()

    expect(vetGetMock).toHaveBeenCalledTimes(1)
    expect(relationListMock).toHaveBeenCalledTimes(2)
  })

  it('isLoading passe à true pendant le chargement puis retombe à false', async () => {
    mockClient({ relations: [] })

    const { fetchDonors, isLoading } = useClinicDonors()
    expect(isLoading.value).toBe(false)

    const promise = fetchDonors()
    expect(isLoading.value).toBe(true)
    await promise

    expect(isLoading.value).toBe(false)
    expect(vetGetMock).toHaveBeenCalledTimes(1)
    expect(relationListMock).toHaveBeenCalledTimes(1)
  })

  it("loadError distingue un échec de chargement d'un annuaire réellement vide", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
    vetGetMock.mockRejectedValue(new Error('network down'))

    const { fetchDonors, loadError, donors } = useClinicDonors()
    expect(loadError.value).toBe(false)

    await fetchDonors()

    expect(loadError.value).toBe(true)
    expect(donors.value).toEqual([])
    expect(consoleErrorSpy).toHaveBeenCalled()

    // Un rechargement réussi (ex. clic "Réessayer") efface l'état d'erreur.
    mockClient({ relations: [] })
    await fetchDonors()

    expect(loadError.value).toBe(false)

    consoleErrorSpy.mockRestore()
  })

  it("échec de la query ClinicOwnerRelation.list() (après résolution réussie du contexte clinique) : loadError à true, donors vidé", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
    vetGetMock.mockResolvedValue({
      data: { id: 'vet-1', clinicID: 'clinic-1', clinic: { id: 'clinic-1', latitude: 45.75, longitude: 4.8 } },
      errors: undefined,
    })
    relationListMock.mockRejectedValue(new Error('DynamoDB throttled'))

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

  it("échec GraphQL/@auth sur ClinicOwnerRelation.list() (`errors` présent sans exception JS) : loadError à true", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
    vetGetMock.mockResolvedValue({
      data: { id: 'vet-1', clinicID: 'clinic-1', clinic: { id: 'clinic-1', latitude: 45.75, longitude: 4.8 } },
      errors: undefined,
    })
    relationListMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access clinicOwnerRelationsByClinicID' }],
    })

    const { fetchDonors, loadError, donors } = useClinicDonors()
    await fetchDonors()

    expect(loadError.value).toBe(true)
    expect(donors.value).toEqual([])
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('les deux appels référencent bien un `selectionSet` couvrant tous les champs consommés par fetchDonors()', async () => {
    mockClient({ relations: [] })

    const { fetchDonors } = useClinicDonors()
    await fetchDonors()

    const [, vetOptions] = vetGetMock.mock.calls[0]
    expect(vetOptions.selectionSet).toEqual(
      expect.arrayContaining(['id', 'clinicID', 'clinic.id', 'clinic.latitude', 'clinic.longitude']),
    )

    const [relationArgs] = relationListMock.mock.calls[0]
    expect(relationArgs.selectionSet).toEqual(
      expect.arrayContaining([
        'ownerID',
        'ownerProfile.id',
        'ownerProfile.firstname',
        'ownerProfile.lastname',
        'ownerProfile.phone',
        'ownerProfile.latitude',
        'ownerProfile.longitude',
        'ownerProfile.animals.id',
        'ownerProfile.animals.name',
        'ownerProfile.animals.species',
        'ownerProfile.animals.breed',
        'ownerProfile.animals.bloodGroup',
        'ownerProfile.animals.isValidatedDonor',
        'ownerProfile.animals.validationExpiresAt',
        'ownerProfile.animals.lastDonationDate',
      ]),
    )
  })
})

// Phase 6.6 : barre de recherche de DonorsView.vue câblée sur un filtre côté client
// (searchQuery + computed filteredDonors), sans aller-retour GraphQL supplémentaire —
// donors.value est peuplé directement ici (pas besoin de repasser par fetchDonors()/le
// mock du client Gen2, la logique de filtre est indépendante du chargement).
describe('useClinicDonors.filteredDonors', () => {
  const seedDonors = (donors) => {
    const composable = useClinicDonors()
    composable.donors.value = donors
    return composable
  }

  it('sans recherche (searchQuery vide ou non renseignée), filteredDonors === donors au complet', () => {
    const { donors, filteredDonors } = seedDonors([
      { animalName: 'Rex', ownerFirstname: 'Jean', ownerLastname: 'Dupont', bloodGroup: 'DEA 1.1-' },
      { animalName: 'Milo', ownerFirstname: 'Alice', ownerLastname: 'Martin', bloodGroup: 'DEA 1.1+' },
    ])

    expect(filteredDonors.value).toEqual(donors.value)
  })

  it("filtre sur le nom de l'animal, insensible à la casse", () => {
    const { searchQuery, filteredDonors } = seedDonors([
      { animalName: 'Rex', ownerFirstname: 'Jean', ownerLastname: 'Dupont', bloodGroup: 'DEA 1.1-' },
      { animalName: 'Milo', ownerFirstname: 'Alice', ownerLastname: 'Martin', bloodGroup: 'DEA 1.1+' },
    ])

    searchQuery.value = 'rEx'

    expect(filteredDonors.value).toHaveLength(1)
    expect(filteredDonors.value[0].animalName).toBe('Rex')
  })

  it('filtre sur le prénom OU le nom du propriétaire', () => {
    const { searchQuery, filteredDonors } = seedDonors([
      { animalName: 'Rex', ownerFirstname: 'Jean', ownerLastname: 'Dupont', bloodGroup: 'DEA 1.1-' },
      { animalName: 'Milo', ownerFirstname: 'Alice', ownerLastname: 'Martin', bloodGroup: 'DEA 1.1+' },
    ])

    searchQuery.value = 'dupont'
    expect(filteredDonors.value.map((d) => d.animalName)).toEqual(['Rex'])

    searchQuery.value = 'alice'
    expect(filteredDonors.value.map((d) => d.animalName)).toEqual(['Milo'])
  })

  it('filtre sur le groupe sanguin', () => {
    const { searchQuery, filteredDonors } = seedDonors([
      { animalName: 'Rex', ownerFirstname: 'Jean', ownerLastname: 'Dupont', bloodGroup: 'DEA 1.1-' },
      { animalName: 'Milo', ownerFirstname: 'Alice', ownerLastname: 'Martin', bloodGroup: 'DEA 1.1+' },
    ])

    searchQuery.value = 'DEA 1.1+'

    expect(filteredDonors.value.map((d) => d.animalName)).toEqual(['Milo'])
  })

  it('la casse et les espaces superflus de la recherche sont ignorés (trim)', () => {
    const { searchQuery, filteredDonors } = seedDonors([
      { animalName: 'Rex', ownerFirstname: 'Jean', ownerLastname: 'Dupont', bloodGroup: 'DEA 1.1-' },
    ])

    searchQuery.value = '   REX   '

    expect(filteredDonors.value).toHaveLength(1)
  })

  it('aucune correspondance : filteredDonors est vide sans planter (donors.value reste intact)', () => {
    const { searchQuery, filteredDonors, donors } = seedDonors([
      { animalName: 'Rex', ownerFirstname: 'Jean', ownerLastname: 'Dupont', bloodGroup: 'DEA 1.1-' },
    ])

    searchQuery.value = 'inexistant'

    expect(filteredDonors.value).toEqual([])
    expect(donors.value).toHaveLength(1)
  })

  it("ignore la race (breed) : présente dans les données mais pas affichée comme colonne dans DonorsView.vue, donc volontairement exclue des critères de recherche", () => {
    const { searchQuery, filteredDonors } = seedDonors([
      {
        animalName: 'Rex',
        ownerFirstname: 'Jean',
        ownerLastname: 'Dupont',
        bloodGroup: 'DEA 1.1-',
        breed: 'Labrador',
      },
    ])

    searchQuery.value = 'labrador'

    expect(filteredDonors.value).toEqual([])
  })

  it('reste réactif : filteredDonors se recalcule quand donors.value change après une recherche déjà saisie', () => {
    const { searchQuery, filteredDonors, donors } = seedDonors([
      { animalName: 'Rex', ownerFirstname: 'Jean', ownerLastname: 'Dupont', bloodGroup: 'DEA 1.1-' },
    ])

    searchQuery.value = 'milo'
    expect(filteredDonors.value).toEqual([])

    donors.value = [
      ...donors.value,
      { animalName: 'Milo', ownerFirstname: 'Alice', ownerLastname: 'Martin', bloodGroup: 'DEA 1.1+' },
    ]

    expect(filteredDonors.value.map((d) => d.animalName)).toEqual(['Milo'])
  })
})
