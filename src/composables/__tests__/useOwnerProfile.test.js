import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Phase 7.8 (R-11) + R-19 : `useOwnerProfile.js` n'avait aucun test malgré un flux
// irréversible (`deleteAccount`, suppression cascade Owner+Animals suivie de
// `deleteUser()` Cognito) et un bug de performance confirmé (R-19 : `fetchProfile()`
// refaisait un aller-retour réseau `GetOwner` à chaque appel, y compris chaque tick du
// polling de useMatchingRequests.searchMatches()). Ce fichier couvre :
// - `fetchProfile()` : ne recharge qu'une fois par session (`isLoaded`), sauf `force: true` ;
// - `deleteAccount()` : succès complet, échec du nettoyage best-effort (n'empêche PAS la
//   suppression Cognito), échec de `deleteUser()` (DOIT remonter à l'appelant).

const graphqlMock = vi.fn()
const deleteUserMock = vi.fn()
const signOutMock = vi.fn()

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ userId: 'owner-1' })),
  // Références indirectes (pas `deleteUser: deleteUserMock`) : le factory de `vi.mock` est
  // hoisté au-dessus des `const deleteUserMock = vi.fn()` ci-dessus -- un accès direct lève
  // "Cannot access before initialization". Une closure appelée plus tard (au premier
  // `deleteUser()` réel dans le composable) contourne le TDZ.
  deleteUser: (...args) => deleteUserMock(...args),
  signOut: (...args) => signOutMock(...args),
  fetchUserAttributes: vi.fn(async () => ({})),
}))

// useOwnerProfile() calls useRouter() directly (deleteAccount's redirect) — stub it out so
// the composable can be used outside of a mounted component / real router instance (same
// pattern as useMatchingRequests.test.js).
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// useOwnerProfile() also calls useAuthStore(), whose module imports the real `@/router`
// singleton (createRouter(...) + every route-level view component) purely for its
// `logout()` helper's redirect — stub it out so importing the store doesn't drag in the
// whole app's router/view graph (same pattern as useMatchingRequests.test.js).
vi.mock('@/router', () => ({
  default: { push: vi.fn() },
}))

import { useOwnerProfile } from '@/composables/useOwnerProfile'

const buildProfile = (overrides = {}) => ({
  id: 'owner-1',
  firstname: 'Jean',
  lastname: 'Dupont',
  email: 'jean.dupont@example.com',
  phone: '0600000000',
  address: '1 rue de Paris',
  latitude: 48.8566,
  longitude: 2.3522,
  maxTravelDistance: 50,
  ...overrides,
})

describe('useOwnerProfile.fetchProfile (R-19 : cache par session)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    graphqlMock.mockReset()
    deleteUserMock.mockReset()
    signOutMock.mockReset()
  })

  it("charge le profil au premier appel et remplit `form`", async () => {
    graphqlMock.mockImplementation(async ({ query }) => {
      expect(query).toContain('GetOwner')
      return { data: { getOwner: buildProfile() } }
    })

    const { form, fetchProfile } = useOwnerProfile()
    await fetchProfile()

    expect(form.value.firstname).toBe('Jean')
    expect(graphqlMock).toHaveBeenCalledTimes(1)
  })

  it("ne refait PAS l'aller-retour réseau GetOwner sur un second appel de la même session (R-19)", async () => {
    graphqlMock.mockImplementation(async () => ({ data: { getOwner: buildProfile() } }))

    const { fetchProfile } = useOwnerProfile()
    await fetchProfile()
    await fetchProfile()
    await fetchProfile()

    // Un seul appel réseau malgré 3 invocations de fetchProfile() -- exactement le
    // scénario "chaque tick de polling refait un GetOwner" relevé par R-19.
    expect(graphqlMock).toHaveBeenCalledTimes(1)
  })

  it('recharge malgré le cache quand `force: true` est explicitement passé', async () => {
    graphqlMock.mockImplementation(async () => ({ data: { getOwner: buildProfile() } }))

    const { fetchProfile } = useOwnerProfile()
    await fetchProfile()
    await fetchProfile({ force: true })

    expect(graphqlMock).toHaveBeenCalledTimes(2)
  })
})

describe('useOwnerProfile.deleteAccount', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    graphqlMock.mockReset()
    deleteUserMock.mockReset()
    signOutMock.mockReset()
    deleteUserMock.mockResolvedValue(undefined)
    signOutMock.mockResolvedValue(undefined)
  })

  /**
   * Charge un profil (nécessaire pour que `ownerId.value` soit défini, seul cas où
   * `deleteAccount()` tente le nettoyage DB) avant de reconfigurer `graphqlMock` pour le
   * scénario testé.
   */
  const primeOwnerId = async () => {
    graphqlMock.mockImplementationOnce(async () => ({ data: { getOwner: buildProfile() } }))
    const composable = useOwnerProfile()
    await composable.fetchProfile()
    return composable
  }

  it('supprime les Animals puis le Owner, puis le compte Cognito (succès complet)', async () => {
    const { deleteAccount } = await primeOwnerId()

    const calledQueries = []
    graphqlMock.mockImplementation(async ({ query }) => {
      calledQueries.push(query)
      if (query.includes('ListAnimals')) {
        return { data: { listAnimals: { items: [{ id: 'animal-1' }, { id: 'animal-2' }] } } }
      }
      if (query.includes('DeleteAnimal')) {
        return { data: { deleteAnimal: { id: 'animal-x' } } }
      }
      if (query.includes('DeleteOwner')) {
        return { data: { deleteOwner: { id: 'owner-1' } } }
      }
      throw new Error(`Requête GraphQL inattendue dans ce test : ${query}`)
    })

    await expect(deleteAccount()).resolves.toBeUndefined()

    expect(calledQueries.some((q) => q.includes('ListAnimals'))).toBe(true)
    expect(calledQueries.filter((q) => q.includes('DeleteAnimal'))).toHaveLength(2)
    expect(calledQueries.some((q) => q.includes('DeleteOwner'))).toBe(true)
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it("n'échoue PAS si le nettoyage DB best-effort échoue -- deleteUser() Cognito est quand même appelé", async () => {
    const { deleteAccount, isSaving } = await primeOwnerId()

    const dbError = new Error('Not Authorized to access deleteOwner on type Owner')
    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('ListAnimals')) {
        return { data: { listAnimals: { items: [] } } }
      }
      throw dbError
    })

    await expect(deleteAccount()).resolves.toBeUndefined()

    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).toHaveBeenCalledTimes(1)
    // `isSaving` doit être redescendu même sur ce chemin (le `finally` s'exécute toujours).
    expect(isSaving.value).toBe(false)
  })

  it('relance (propage) une erreur de deleteUser() (Cognito) -- contrairement au nettoyage DB', async () => {
    const { deleteAccount, isSaving } = await primeOwnerId()

    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('ListAnimals')) {
        return { data: { listAnimals: { items: [] } } }
      }
      if (query.includes('DeleteOwner')) {
        return { data: { deleteOwner: { id: 'owner-1' } } }
      }
      throw new Error(`Requête GraphQL inattendue dans ce test : ${query}`)
    })

    const cognitoError = new Error('Cognito: unable to delete user')
    deleteUserMock.mockRejectedValue(cognitoError)

    await expect(deleteAccount()).rejects.toBe(cognitoError)

    // deleteUser() a bien été tenté (DB cleanup réussi juste avant), mais son échec doit
    // remonter -- contrairement à un échec de nettoyage DB (voir le test précédent).
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(isSaving.value).toBe(false)
  })
})
