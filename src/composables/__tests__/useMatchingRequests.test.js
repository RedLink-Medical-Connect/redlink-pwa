import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { listRequests } from '@/graphql/queries'

// Regression / integration coverage for the "matching engine silently finds
// nothing" bug fixed on this branch (commit 82c8d44). Three independent breaks
// combined to make searchMatches() never return a match even with perfectly
// compatible mock data:
//   1. useOwnerProfile() was destructured as `ownerProfile` but the composable
//      actually exports `form` -> ownerProfile.value was always undefined.
//   2. The `if (!ownerProfile.value) await fetchProfile()` guard could never
//      fire because `form` defaults to a non-null object -> profile (lat/long)
//      was never actually fetched even after fixing (1).
//   3. listRequests only selected `clinicID`, not the nested `clinic` object,
//      so the geo filter's `req.clinic.latitude`/`longitude` read was always
//      undefined -> every Request was dropped by the distance check.
//
// These tests exercise the full chain with a mocked `generateClient().graphql`
// and assert an actual Match comes out the other end, not just "doesn't throw".

const graphqlMock = vi.fn()

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ userId: 'owner-1' })),
}))

// useOwnerProfile() calls useRouter() (only exercised by deleteAccount, which
// we never call here) — stub it out so the composable can be used outside of
// an actual mounted component / router instance.
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// useOwnerProfile() also calls useAuthStore(), whose module imports the real
// `@/router` singleton (createRouter(...) + every route-level view component)
// purely for its `login`/`logout` helpers we never exercise here — stub it out
// so importing the store doesn't drag in the whole app's router/view graph.
vi.mock('@/router', () => ({
  default: { push: vi.fn() },
}))

import { useMatchingRequests } from '@/composables/useMatchingRequests'

// Paris (siège de la clinique dans nos fixtures)
const CLINIC_LAT = 48.8566
const CLINIC_LON = 2.3522
// ~2km de la clinique
const OWNER_LAT = 48.87
const OWNER_LON = 2.36

const buildOwnerProfile = (overrides = {}) => ({
  id: 'owner-1',
  firstname: 'Jean',
  lastname: 'Dupont',
  email: 'jean.dupont@example.com',
  phone: '0600000000',
  address: '1 rue de Paris',
  latitude: OWNER_LAT,
  longitude: OWNER_LON,
  maxTravelDistance: 50,
  ...overrides,
})

const buildAnimal = (overrides = {}) => ({
  id: 'animal-1',
  name: 'Rex',
  species: 'DOG',
  breed: 'Labrador',
  birthDate: '2020-01-01',
  weight: 25,
  bloodGroup: 'DEA 1.1-',
  isVaccinated: true,
  isSterilized: true,
  donationFrequency: 'TWICE_YEAR',
  ownerID: 'owner-1',
  createdAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
})

const buildRequest = (overrides = {}) => ({
  id: 'request-1',
  requiredSpecies: 'DOG',
  requiredBloodGroup: 'DEA 1.1-',
  requestType: 'EMERGENCY',
  status: 'OPEN',
  createdAt: '2024-01-01T00:00:00.000Z',
  clinicID: 'clinic-1',
  clinic: {
    id: 'clinic-1',
    name: 'Clinique du Centre',
    latitude: CLINIC_LAT,
    longitude: CLINIC_LON,
  },
  activeMissionID: null,
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
})

/**
 * Routes the mocked graphql client to the right fixture based on the
 * operation name embedded in the query string, mirroring what
 * useOwnerProfile.fetchProfile / useAnimals.fetchAnimals / useMatchingRequests
 * actually call.
 */
function mockGraphqlResponses({ profile, animals, requests }) {
  graphqlMock.mockImplementation(async ({ query }) => {
    if (query.includes('GetOwner')) {
      return { data: { getOwner: profile } }
    }
    if (query.includes('ListMyAnimalsByOwnerId')) {
      return { data: { listAnimals: { items: animals } } }
    }
    if (query.includes('ListRequests')) {
      return { data: { listRequests: { items: requests } } }
    }
    throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
  })
}

describe('useMatchingRequests', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    graphqlMock.mockReset()
  })

  // Pin la définition réelle de la query (pas le mock) : si `clinic { ... }`
  // est un jour retiré de listRequests (régression du bug #3), ce test échoue
  // même si les fixtures mockées ci-dessous continuent, elles, d'injecter
  // `clinic` à la main.
  it('la query listRequests sélectionne bien l\'objet clinic imbriqué', () => {
    expect(listRequests).toContain('clinic {')
    expect(listRequests).toContain('latitude')
    expect(listRequests).toContain('longitude')
  })

  it('trouve un Match réel de bout en bout (profil + animal compatible + clinique proche)', async () => {
    mockGraphqlResponses({
      profile: buildOwnerProfile(),
      animals: [buildAnimal()],
      requests: [buildRequest()],
    })

    const { matches, searchMatches } = useMatchingRequests()

    await searchMatches()

    // La preuve que fetchProfile() a bien été appelé (bug #1 et #2) : getOwner
    // a été requêté.
    expect(graphqlMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.stringContaining('GetOwner') }),
    )

    expect(matches.value).toHaveLength(1)
    expect(matches.value[0].id).toBe('request-1')
    // La preuve que la clinique imbriquée a bien été sélectionnée (bug #3) :
    // le filtre géographique a pu attacher une distance calculée.
    expect(matches.value[0].distanceKM).toBeTypeOf('number')
    expect(matches.value[0].distanceKM).toBeLessThan(50)
    expect(matches.value[0].matchingAnimal.id).toBe('animal-1')
  })

  it('exclut une Request hors du rayon maxTravelDistance', async () => {
    mockGraphqlResponses({
      profile: buildOwnerProfile({ maxTravelDistance: 50 }),
      animals: [buildAnimal()],
      requests: [
        buildRequest({
          id: 'request-far',
          clinic: { id: 'clinic-far', name: 'Clinique lointaine', latitude: 45.764, longitude: 4.8357 }, // Lyon, ~390km de Paris
        }),
      ],
    })

    const { matches, searchMatches } = useMatchingRequests()

    await searchMatches()

    expect(matches.value).toHaveLength(0)
  })

  it("exclut une Request dont l'espèce ou le groupe sanguin ne correspond à aucun animal du propriétaire", async () => {
    mockGraphqlResponses({
      profile: buildOwnerProfile(),
      animals: [buildAnimal({ species: 'CAT', bloodGroup: 'A' })],
      requests: [buildRequest({ requiredSpecies: 'DOG', requiredBloodGroup: 'DEA 1.1-' })],
    })

    const { matches, searchMatches } = useMatchingRequests()

    await searchMatches()

    expect(matches.value).toHaveLength(0)
  })

  it("s'arrête sans appeler listRequests si le propriétaire n'a aucun animal", async () => {
    mockGraphqlResponses({
      profile: buildOwnerProfile(),
      animals: [],
      requests: [buildRequest()],
    })

    const { matches, searchMatches } = useMatchingRequests()

    await searchMatches()

    expect(matches.value).toHaveLength(0)
    expect(graphqlMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.stringContaining('ListRequests') }),
    )
  })

  it('trie les Matches par distance croissante', async () => {
    mockGraphqlResponses({
      profile: buildOwnerProfile({ maxTravelDistance: 500 }),
      animals: [buildAnimal()],
      requests: [
        buildRequest({
          id: 'request-far',
          clinic: { id: 'clinic-b', name: 'B', latitude: 45.764, longitude: 4.8357 }, // Lyon
        }),
        buildRequest({
          id: 'request-near',
          clinic: { id: 'clinic-a', name: 'A', latitude: CLINIC_LAT, longitude: CLINIC_LON }, // Paris, proche
        }),
      ],
    })

    const { matches, searchMatches } = useMatchingRequests()

    await searchMatches()

    expect(matches.value.map((m) => m.id)).toEqual(['request-near', 'request-far'])
  })
})
