import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Phase 7.8 (R-11, + audit Phase 6.B) : `useClinicSettings.js` n'avait aucun test malgré
// un flux irréversible (`deleteAccount`, suppression Veterinarian + Clinic suivie de
// `deleteUser()` Cognito) et un risque réel identifié en audit : `deleteAccount` supprimait
// la Clinic entière sans vérifier si un AUTRE Veterinarian y était encore rattaché
// (Clinic.veterinarians: [Veterinarian] @hasMany, schema.graphql -- plusieurs Veterinarian
// par Clinic est un cas prévu, pas un cas limite ; contexte école = plusieurs utilisateurs
// par service). Ce fichier couvre :
// - `deleteAccount()` : succès complet (dernier vétérinaire -> Clinic supprimée), échec du
//   nettoyage best-effort (n'empêche PAS la suppression Cognito), échec de `deleteUser()`
//   (DOIT remonter à l'appelant) ;
// - le garde-fou multi-vétérinaire : au moins un autre Veterinarian rattaché à la même
//   Clinic -> seul le Veterinarian courant est supprimé, la Clinic survit.

const graphqlMock = vi.fn()
const deleteUserMock = vi.fn()
const signOutMock = vi.fn()

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ userId: 'vet-1' })),
  // Références indirectes (pas `deleteUser: deleteUserMock`) : le factory de `vi.mock` est
  // hoisté au-dessus des `const deleteUserMock = vi.fn()` ci-dessus -- un accès direct lève
  // "Cannot access before initialization". Une closure appelée plus tard (au premier
  // `deleteUser()` réel dans le composable) contourne le TDZ.
  deleteUser: (...args) => deleteUserMock(...args),
  signOut: (...args) => signOutMock(...args),
  fetchUserAttributes: vi.fn(async () => ({})),
}))

// useClinicSettings() calls useRouter() directly (deleteAccount's redirect) — stub it out
// so the composable can be used outside of a mounted component / real router instance (same
// pattern as useMatchingRequests.test.js / useOwnerProfile.test.js).
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// useClinicSettings() also calls useAuthStore(), whose module imports the real `@/router`
// singleton purely for its `logout()` helper's redirect — stub it out so importing the
// store doesn't drag in the whole app's router/view graph.
vi.mock('@/router', () => ({
  default: { push: vi.fn() },
}))

import { useClinicSettings } from '@/composables/useClinicSettings'

/**
 * Charge un Vet+Clinic (nécessaire pour que `vetId.value`/`clinicId.value` soient définis)
 * avant de reconfigurer `graphqlMock` pour le scénario testé.
 */
const primeVetAndClinic = async () => {
  graphqlMock.mockImplementationOnce(async ({ query }) => {
    expect(query).toContain('GetVetWithClinic')
    return {
      data: {
        getVeterinarian: {
          id: 'vet-1',
          firstname: 'Alex',
          lastname: 'Martin',
          email: 'alex.martin@clinique.fr',
          clinic: {
            id: 'clinic-1',
            name: 'Clinique du Centre',
            rpps: '12345',
            email: 'contact@clinique.fr',
            phone: '0100000000',
            address: '1 rue de la Clinique',
            latitude: 48.8566,
            longitude: 2.3522,
            hasEmergencyService: true,
          },
        },
      },
    }
  })
  const composable = useClinicSettings()
  await composable.fetchSettings()
  return composable
}

describe('useClinicSettings.deleteAccount', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    graphqlMock.mockReset()
    deleteUserMock.mockReset()
    signOutMock.mockReset()
    deleteUserMock.mockResolvedValue(undefined)
    signOutMock.mockResolvedValue(undefined)
  })

  it('supprime le Veterinarian ET la Clinic, puis le compte Cognito (dernier vétérinaire de la Clinic)', async () => {
    const { deleteAccount } = await primeVetAndClinic()

    const calledQueries = []
    graphqlMock.mockImplementation(async ({ query, variables }) => {
      calledQueries.push(query)
      if (query.includes('VeterinariansByClinicIDSimple')) {
        expect(variables).toEqual({ clinicID: 'clinic-1' })
        // Seul le vétérinaire courant est rattaché à la Clinic.
        return { data: { veterinariansByClinicID: { items: [{ id: 'vet-1' }] } } }
      }
      if (query.includes('DeleteVeterinarian')) {
        return { data: { deleteVeterinarian: { id: 'vet-1' } } }
      }
      if (query.includes('DeleteClinic')) {
        return { data: { deleteClinic: { id: 'clinic-1' } } }
      }
      throw new Error(`Requête GraphQL inattendue dans ce test : ${query}`)
    })

    await expect(deleteAccount()).resolves.toBeUndefined()

    expect(calledQueries.some((q) => q.includes('DeleteVeterinarian'))).toBe(true)
    expect(calledQueries.some((q) => q.includes('DeleteClinic'))).toBe(true)
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it("garde-fou multi-vétérinaire : un autre Veterinarian reste rattaché -> seul le compte courant est supprimé, la Clinic survit", async () => {
    const { deleteAccount } = await primeVetAndClinic()

    const calledQueries = []
    graphqlMock.mockImplementation(async ({ query }) => {
      calledQueries.push(query)
      if (query.includes('VeterinariansByClinicIDSimple')) {
        // Deux vétérinaires rattachés à la même Clinic : le courant (vet-1) et un autre.
        return {
          data: {
            veterinariansByClinicID: { items: [{ id: 'vet-1' }, { id: 'vet-2' }] },
          },
        }
      }
      if (query.includes('DeleteVeterinarian')) {
        return { data: { deleteVeterinarian: { id: 'vet-1' } } }
      }
      throw new Error(`Requête GraphQL inattendue dans ce test (la Clinic ne doit PAS être supprimée) : ${query}`)
    })

    await expect(deleteAccount()).resolves.toBeUndefined()

    expect(calledQueries.some((q) => q.includes('DeleteVeterinarian'))).toBe(true)
    expect(calledQueries.some((q) => q.includes('DeleteClinic'))).toBe(false)
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
  })

  it("n'échoue PAS si le nettoyage DB best-effort échoue -- deleteUser() Cognito est quand même appelé", async () => {
    const { deleteAccount, isSaving } = await primeVetAndClinic()

    const dbError = new Error('Not Authorized to access deleteVeterinarian on type Veterinarian')
    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('VeterinariansByClinicIDSimple')) {
        return { data: { veterinariansByClinicID: { items: [{ id: 'vet-1' }] } } }
      }
      throw dbError
    })

    await expect(deleteAccount()).resolves.toBeUndefined()

    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(isSaving.value).toBe(false)
  })

  it('relance (propage) une erreur de deleteUser() (Cognito) -- contrairement au nettoyage DB', async () => {
    const { deleteAccount, isSaving } = await primeVetAndClinic()

    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('VeterinariansByClinicIDSimple')) {
        return { data: { veterinariansByClinicID: { items: [{ id: 'vet-1' }] } } }
      }
      if (query.includes('DeleteVeterinarian')) {
        return { data: { deleteVeterinarian: { id: 'vet-1' } } }
      }
      if (query.includes('DeleteClinic')) {
        return { data: { deleteClinic: { id: 'clinic-1' } } }
      }
      throw new Error(`Requête GraphQL inattendue dans ce test : ${query}`)
    })

    const cognitoError = new Error('Cognito: unable to delete user')
    deleteUserMock.mockRejectedValue(cognitoError)

    await expect(deleteAccount()).rejects.toBe(cognitoError)

    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(isSaving.value).toBe(false)
  })

  it("garde-fou en échec (lecture VeterinariansByClinicID en erreur) -- ne supprime PAS la Clinic par prudence (fail-safe)", async () => {
    const { deleteAccount, isSaving } = await primeVetAndClinic()

    const calledQueries = []
    graphqlMock.mockImplementation(async ({ query }) => {
      calledQueries.push(query)
      if (query.includes('VeterinariansByClinicIDSimple')) {
        throw new Error('Timeout réseau')
      }
      if (query.includes('DeleteVeterinarian')) {
        return { data: { deleteVeterinarian: { id: 'vet-1' } } }
      }
      throw new Error(`Requête GraphQL inattendue dans ce test (la Clinic ne doit PAS être supprimée) : ${query}`)
    })

    await expect(deleteAccount()).resolves.toBeUndefined()

    expect(calledQueries.some((q) => q.includes('DeleteVeterinarian'))).toBe(true)
    expect(calledQueries.some((q) => q.includes('DeleteClinic'))).toBe(false)
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(isSaving.value).toBe(false)
  })
})
