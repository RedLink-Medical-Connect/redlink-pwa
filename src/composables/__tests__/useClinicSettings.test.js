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
//
// Phase 8, sous-tâche 5 (lot 2/3) : useClinicSettings.js migré sur le client Gen2
// (`aws-amplify/data`, `client.models.Veterinarian.*`/`client.models.Clinic.*`) -- mock
// reconstruit sur `{ data, errors }` par méthode de modèle. Assertions métier inchangées.

const vetGetMock = vi.fn()
const vetListMock = vi.fn()
const vetDeleteMock = vi.fn()
const clinicDeleteMock = vi.fn()
const deleteUserMock = vi.fn()
const signOutMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Veterinarian: {
        get: (...args) => vetGetMock(...args),
        list: (...args) => vetListMock(...args),
        delete: (...args) => vetDeleteMock(...args),
        update: vi.fn(),
      },
      Clinic: {
        delete: (...args) => clinicDeleteMock(...args),
        update: vi.fn(),
      },
    },
  }),
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
 * avant de reconfigurer les mocks pour le scénario testé.
 */
const primeVetAndClinic = async () => {
  vetGetMock.mockResolvedValueOnce({
    data: {
      id: 'vet-1',
      firstname: 'Alex',
      lastname: 'Martin',
      email: 'alex.martin@clinique.fr',
      clinicID: 'clinic-1',
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
    errors: undefined,
  })
  const composable = useClinicSettings()
  await composable.fetchSettings()
  return composable
}

describe('useClinicSettings.deleteAccount', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vetGetMock.mockReset()
    vetListMock.mockReset()
    vetDeleteMock.mockReset()
    clinicDeleteMock.mockReset()
    deleteUserMock.mockReset()
    signOutMock.mockReset()
    deleteUserMock.mockResolvedValue(undefined)
    signOutMock.mockResolvedValue(undefined)
  })

  it('supprime le Veterinarian ET la Clinic, puis le compte Cognito (dernier vétérinaire de la Clinic)', async () => {
    const { deleteAccount } = await primeVetAndClinic()

    // Seul le vétérinaire courant est rattaché à la Clinic.
    vetListMock.mockResolvedValue({ data: [{ id: 'vet-1' }], errors: undefined })
    vetDeleteMock.mockResolvedValue({ data: { id: 'vet-1' }, errors: undefined })
    clinicDeleteMock.mockResolvedValue({ data: { id: 'clinic-1' }, errors: undefined })

    await expect(deleteAccount()).resolves.toBeUndefined()

    // `selectionSet: ['id']` (revue Lead Dev, lot 2) : seul `v.id` est lu par le garde-fou,
    // le reste du profil des collègues rattachés à la Clinic n'a pas à être sur-fetché.
    expect(vetListMock).toHaveBeenCalledWith({
      filter: { clinicID: { eq: 'clinic-1' } },
      selectionSet: ['id'],
    })
    expect(vetDeleteMock).toHaveBeenCalledWith({ id: 'vet-1' })
    expect(clinicDeleteMock).toHaveBeenCalledWith({ id: 'clinic-1' })
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it("garde-fou multi-vétérinaire : un autre Veterinarian reste rattaché -> seul le compte courant est supprimé, la Clinic survit", async () => {
    const { deleteAccount } = await primeVetAndClinic()

    // Deux vétérinaires rattachés à la même Clinic : le courant (vet-1) et un autre.
    vetListMock.mockResolvedValue({
      data: [{ id: 'vet-1' }, { id: 'vet-2' }],
      errors: undefined,
    })
    vetDeleteMock.mockResolvedValue({ data: { id: 'vet-1' }, errors: undefined })

    await expect(deleteAccount()).resolves.toBeUndefined()

    expect(vetDeleteMock).toHaveBeenCalledWith({ id: 'vet-1' })
    expect(clinicDeleteMock).not.toHaveBeenCalled()
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
  })

  it("n'échoue PAS si le nettoyage DB best-effort échoue -- deleteUser() Cognito est quand même appelé", async () => {
    const { deleteAccount, isSaving } = await primeVetAndClinic()

    const dbError = new Error('Not Authorized to access deleteVeterinarian on type Veterinarian')
    vetListMock.mockResolvedValue({ data: [{ id: 'vet-1' }], errors: undefined })
    vetDeleteMock.mockRejectedValue(dbError)

    await expect(deleteAccount()).resolves.toBeUndefined()

    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(isSaving.value).toBe(false)
  })

  it('relance (propage) une erreur de deleteUser() (Cognito) -- contrairement au nettoyage DB', async () => {
    const { deleteAccount, isSaving } = await primeVetAndClinic()

    vetListMock.mockResolvedValue({ data: [{ id: 'vet-1' }], errors: undefined })
    vetDeleteMock.mockResolvedValue({ data: { id: 'vet-1' }, errors: undefined })
    clinicDeleteMock.mockResolvedValue({ data: { id: 'clinic-1' }, errors: undefined })

    const cognitoError = new Error('Cognito: unable to delete user')
    deleteUserMock.mockRejectedValue(cognitoError)

    await expect(deleteAccount()).rejects.toBe(cognitoError)

    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(isSaving.value).toBe(false)
  })

  it("garde-fou en échec (lecture Veterinarian.list en erreur) -- ne supprime PAS la Clinic par prudence (fail-safe)", async () => {
    const { deleteAccount, isSaving } = await primeVetAndClinic()

    vetListMock.mockRejectedValue(new Error('Timeout réseau'))
    vetDeleteMock.mockResolvedValue({ data: { id: 'vet-1' }, errors: undefined })

    await expect(deleteAccount()).resolves.toBeUndefined()

    expect(vetDeleteMock).toHaveBeenCalledWith({ id: 'vet-1' })
    expect(clinicDeleteMock).not.toHaveBeenCalled()
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(isSaving.value).toBe(false)
  })

  it("garde-fou en échec GraphQL/@auth (Veterinarian.list résout `{ data: null, errors }`, pas d'exception JS) -- ne supprime PAS la Clinic non plus", async () => {
    const { deleteAccount } = await primeVetAndClinic()

    vetListMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access veterinariansByClinicID' }],
    })
    vetDeleteMock.mockResolvedValue({ data: { id: 'vet-1' }, errors: undefined })

    await expect(deleteAccount()).resolves.toBeUndefined()

    expect(vetDeleteMock).toHaveBeenCalledWith({ id: 'vet-1' })
    expect(clinicDeleteMock).not.toHaveBeenCalled()
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
  })
})
