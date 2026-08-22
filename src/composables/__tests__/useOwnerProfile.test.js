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
//
// Phase 8, sous-tâche 5 (lot 1/3) : mock migré vers le client Gen2 (`aws-amplify/data`,
// `client.models.Owner.*`/`client.models.Animal.*`) -- un mock dédié par méthode plutôt
// qu'un unique `graphqlMock` discriminé par le texte de la query (`query.includes('...')`,
// qui n'existe plus côté appelant en Gen2). Les assertions métier restent les mêmes
// qu'avant la migration. Un cas supplémentaire est couvert (`fetchProfile` rejette sur une
// erreur GraphQL/@auth *résolue*, pas seulement une exception JS -- absent du test Gen1 où
// seule une exception JS pouvait modéliser un échec GraphQL) : voir useOwnerProfile.js pour
// le raisonnement complet.

const ownerGetMock = vi.fn()
const ownerUpdateMock = vi.fn()
const ownerDeleteMock = vi.fn()
const animalListMock = vi.fn()
const animalDeleteMock = vi.fn()
const deleteUserMock = vi.fn()
const signOutMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Owner: {
        get: (...args) => ownerGetMock(...args),
        update: (...args) => ownerUpdateMock(...args),
        delete: (...args) => ownerDeleteMock(...args),
      },
      Animal: {
        list: (...args) => animalListMock(...args),
        delete: (...args) => animalDeleteMock(...args),
      },
    },
  }),
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

const resetAllMocks = () => {
  ownerGetMock.mockReset()
  ownerUpdateMock.mockReset()
  ownerDeleteMock.mockReset()
  animalListMock.mockReset()
  animalDeleteMock.mockReset()
  deleteUserMock.mockReset()
  signOutMock.mockReset()
}

describe('useOwnerProfile.fetchProfile (R-19 : cache par session)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetAllMocks()
  })

  it('charge le profil au premier appel et remplit `form`', async () => {
    ownerGetMock.mockImplementation(async ({ id }) => {
      expect(id).toBe('owner-1')
      return { data: buildProfile(), errors: undefined }
    })

    const { form, fetchProfile } = useOwnerProfile()
    await fetchProfile()

    expect(form.value.firstname).toBe('Jean')
    expect(ownerGetMock).toHaveBeenCalledTimes(1)
  })

  it("ne refait PAS l'aller-retour réseau GetOwner sur un second appel de la même session (R-19)", async () => {
    ownerGetMock.mockImplementation(async () => ({ data: buildProfile(), errors: undefined }))

    const { fetchProfile } = useOwnerProfile()
    await fetchProfile()
    await fetchProfile()
    await fetchProfile()

    // Un seul appel réseau malgré 3 invocations de fetchProfile() -- exactement le
    // scénario "chaque tick de polling refait un GetOwner" relevé par R-19.
    expect(ownerGetMock).toHaveBeenCalledTimes(1)
  })

  it('recharge malgré le cache quand `force: true` est explicitement passé', async () => {
    ownerGetMock.mockImplementation(async () => ({ data: buildProfile(), errors: undefined }))

    const { fetchProfile } = useOwnerProfile()
    await fetchProfile()
    await fetchProfile({ force: true })

    expect(ownerGetMock).toHaveBeenCalledTimes(2)
  })

  it('relance (propage) une erreur GraphQL/@auth résolue par le client Gen2 (pas de exception JS)', async () => {
    ownerGetMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access getOwner' }],
    })

    const { fetchProfile, isLoading } = useOwnerProfile()

    await expect(fetchProfile()).rejects.toThrow()
    expect(isLoading.value).toBe(false)
  })
})

describe('useOwnerProfile.deleteAccount', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetAllMocks()
    deleteUserMock.mockResolvedValue(undefined)
    signOutMock.mockResolvedValue(undefined)
  })

  /**
   * Charge un profil (nécessaire pour que `ownerId.value` soit défini, seul cas où
   * `deleteAccount()` tente le nettoyage DB) avant de reconfigurer les mocks pour le
   * scénario testé.
   */
  const primeOwnerId = async () => {
    ownerGetMock.mockResolvedValueOnce({ data: buildProfile(), errors: undefined })
    const composable = useOwnerProfile()
    await composable.fetchProfile()
    return composable
  }

  it('supprime les Animals puis le Owner, puis le compte Cognito (succès complet)', async () => {
    const { deleteAccount } = await primeOwnerId()

    animalListMock.mockResolvedValue({
      data: [{ id: 'animal-1' }, { id: 'animal-2' }],
      errors: undefined,
    })
    animalDeleteMock.mockResolvedValue({ data: { id: 'animal-x' }, errors: undefined })
    ownerDeleteMock.mockResolvedValue({ data: { id: 'owner-1' }, errors: undefined })

    await expect(deleteAccount()).resolves.toBeUndefined()

    expect(animalListMock).toHaveBeenCalledTimes(1)
    expect(animalDeleteMock).toHaveBeenCalledTimes(2)
    expect(ownerDeleteMock).toHaveBeenCalledTimes(1)
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it("n'échoue PAS si le nettoyage DB best-effort échoue -- deleteUser() Cognito est quand même appelé", async () => {
    const { deleteAccount, isSaving } = await primeOwnerId()

    animalListMock.mockRejectedValue(new Error('Not Authorized to access listAnimals'))

    await expect(deleteAccount()).resolves.toBeUndefined()

    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).toHaveBeenCalledTimes(1)
    // `isSaving` doit être redescendu même sur ce chemin (le `finally` s'exécute toujours).
    expect(isSaving.value).toBe(false)
  })

  it("n'échoue PAS non plus quand le nettoyage DB échoue via une erreur GraphQL/@auth résolue (pas une exception JS)", async () => {
    const { deleteAccount } = await primeOwnerId()

    animalListMock.mockResolvedValue({ data: [], errors: undefined })
    ownerDeleteMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access deleteOwner' }],
    })

    await expect(deleteAccount()).resolves.toBeUndefined()

    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it('relance (propage) une erreur de deleteUser() (Cognito) -- contrairement au nettoyage DB', async () => {
    const { deleteAccount, isSaving } = await primeOwnerId()

    animalListMock.mockResolvedValue({ data: [], errors: undefined })
    ownerDeleteMock.mockResolvedValue({ data: { id: 'owner-1' }, errors: undefined })

    const cognitoError = new Error('Cognito: unable to delete user')
    deleteUserMock.mockRejectedValue(cognitoError)

    await expect(deleteAccount()).rejects.toBe(cognitoError)

    // deleteUser() a bien été tenté (DB cleanup réussi juste avant), mais son échec doit
    // remonter -- contrairement à un échec de nettoyage DB (voir le test précédent).
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(isSaving.value).toBe(false)
  })
})
