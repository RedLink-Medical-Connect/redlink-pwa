import { describe, it, expect, vi, beforeEach } from 'vitest'

// Sous-onglet "Équipe" de SettingsView.vue (voir la conversation produit qui a mené à ce
// choix) : liste des vétérinaires de la clinique (avec leur rôle référent/vétérinaire) +
// invitation d'un nouveau vétérinaire, réservée au référent (`Clinic.owner`). Ce fichier
// couvre :
// - `isReferent` : vrai seulement quand `clinic.owner` (format `"${sub}::${username}"`)
//   commence par le `sub` du vétérinaire courant -- comparaison sur le SEUL `sub`, jamais sur
//   l'email (voir le commentaire de useClinicVeterinarians.js sur le bug initial que ça évite) ;
// - `veterinarians[].isReferent` : même comparaison, par entrée de la liste ;
// - `fetchTeam()` : peuple `veterinarians`, gère l'absence de clinicID, `loadError` sur échec ;
// - `inviteVeterinarian()` : succès (recharge l'équipe) et échec (mappe l'erreur BFF vers une
//   clé i18n, jamais un message en dur -- convention CLAUDE.md).
// - `confirmOwnAccount()` : écriture secondaire best-effort (`accountConfirmed: true`) appelée
//   par `SetNewPasswordView.vue` juste après la résolution du challenge Cognito d'un compte
//   invité -- un échec ne doit jamais lever d'exception (CLAUDE.md, "écriture secondaire
//   best-effort").

const vetGetMock = vi.fn()
const vetListMock = vi.fn()
const vetUpdateMock = vi.fn()
const clinicGetMock = vi.fn()
const bffFetchMock = vi.fn()

vi.mock('@/services/bff-graphql-client', () => ({
  generateClient: () => ({
    models: {
      Veterinarian: {
        get: (...args) => vetGetMock(...args),
        list: (...args) => vetListMock(...args),
        update: (...args) => vetUpdateMock(...args),
      },
      Clinic: {
        get: (...args) => clinicGetMock(...args),
      },
    },
  }),
}))

vi.mock('@/services/bff-auth-session', () => ({
  getCurrentUser: vi.fn(async () => ({ userId: 'vet-1' })),
}))

vi.mock('@/services/bff-fetch', () => ({
  bffFetch: (...args) => bffFetchMock(...args),
}))

import { useClinicVeterinarians, mapInviteVeterinarianError } from '@/composables/useClinicVeterinarians'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchTeam', () => {
  it('isReferent = true quand le sub de clinic.owner correspond au vétérinaire courant', async () => {
    vetGetMock.mockResolvedValueOnce({ data: { id: 'vet-1', clinicID: 'clinic-1' }, errors: null })
    clinicGetMock.mockResolvedValueOnce({ data: { owner: 'vet-1::referent@example.com' }, errors: null })
    vetListMock.mockResolvedValueOnce({ data: [], errors: null })

    const { isReferent, fetchTeam } = useClinicVeterinarians()
    await fetchTeam()

    expect(isReferent.value).toBe(true)
  })

  it("isReferent = false quand le sub de clinic.owner appartient à un autre vétérinaire", async () => {
    vetGetMock.mockResolvedValueOnce({ data: { id: 'vet-1', clinicID: 'clinic-1' }, errors: null })
    clinicGetMock.mockResolvedValueOnce({ data: { owner: 'autre-id::autre@example.com' }, errors: null })
    vetListMock.mockResolvedValueOnce({ data: [], errors: null })

    const { isReferent, fetchTeam } = useClinicVeterinarians()
    await fetchTeam()

    expect(isReferent.value).toBe(false)
  })

  it('peuple veterinarians avec la liste retournée, en marquant isReferent par entrée (jamais sur email/username)', async () => {
    vetGetMock.mockResolvedValueOnce({ data: { id: 'vet-1', clinicID: 'clinic-1' }, errors: null })
    clinicGetMock.mockResolvedValueOnce({ data: { owner: 'vet-1::referent@example.com' }, errors: null })
    vetListMock.mockResolvedValueOnce({
      data: [
        { id: 'vet-1', firstname: 'Jean', lastname: 'Dupont', email: 'referent@example.com' },
        { id: 'vet-2', firstname: 'Marie', lastname: 'Martin', email: 'marie@example.com' },
      ],
      errors: null,
    })

    const { veterinarians, fetchTeam } = useClinicVeterinarians()
    await fetchTeam()

    expect(veterinarians.value).toHaveLength(2)
    expect(veterinarians.value.find((v) => v.id === 'vet-1').isReferent).toBe(true)
    expect(veterinarians.value.find((v) => v.id === 'vet-2').isReferent).toBe(false)
    expect(vetListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: { clinicID: { eq: 'clinic-1' }, accountConfirmed: { ne: false } },
      }),
    )
  })

  it('ne fait aucun appel supplémentaire si le vétérinaire courant n\'a pas de clinicID', async () => {
    vetGetMock.mockResolvedValueOnce({ data: { id: 'vet-1', clinicID: null }, errors: null })

    const { veterinarians, fetchTeam } = useClinicVeterinarians()
    await fetchTeam()

    expect(clinicGetMock).not.toHaveBeenCalled()
    expect(vetListMock).not.toHaveBeenCalled()
    expect(veterinarians.value).toEqual([])
  })

  it('loadError = true sur échec GraphQL', async () => {
    vetGetMock.mockResolvedValueOnce({ data: null, errors: [{ message: 'boom' }] })

    const { loadError, fetchTeam } = useClinicVeterinarians()
    await fetchTeam()

    expect(loadError.value).toBe(true)
  })
})

describe('inviteVeterinarian', () => {
  it('succès : recharge l\'équipe et renvoie true', async () => {
    bffFetchMock.mockResolvedValueOnce({ ok: true, data: { status: 'INVITED' } })
    vetGetMock.mockResolvedValueOnce({ data: { id: 'vet-1', clinicID: 'clinic-1' }, errors: null })
    clinicGetMock.mockResolvedValueOnce({ data: { owner: 'vet-1::referent@example.com' }, errors: null })
    vetListMock.mockResolvedValueOnce({ data: [], errors: null })

    const { isInviting, inviteError, inviteVeterinarian } = useClinicVeterinarians()
    const ok = await inviteVeterinarian('collegue@example.com', 'fr')

    expect(ok).toBe(true)
    expect(inviteError.value).toBeNull()
    expect(isInviting.value).toBe(false)
    expect(bffFetchMock).toHaveBeenCalledWith('/api/clinic/veterinarians', {
      body: { email: 'collegue@example.com', locale: 'fr' },
    })
    expect(vetGetMock).toHaveBeenCalled() // fetchTeam() rappelé après succès
  })

  it("échec (référent invalide) : mappe l'erreur BFF vers une clé i18n, ne recharge pas l'équipe", async () => {
    bffFetchMock.mockResolvedValueOnce({ ok: false, data: { error: 'NOT_CLINIC_REFERENT' } })

    const { inviteError, inviteVeterinarian } = useClinicVeterinarians()
    const ok = await inviteVeterinarian('collegue@example.com', 'fr')

    expect(ok).toBe(false)
    expect(inviteError.value).toBe('dashboard.settings.team.errors.not_referent')
    expect(vetGetMock).not.toHaveBeenCalled()
  })
})

describe('confirmOwnAccount', () => {
  it('succès : met accountConfirmed à true pour le vétérinaire courant', async () => {
    vetUpdateMock.mockResolvedValueOnce({ errors: null })

    const { confirmOwnAccount } = useClinicVeterinarians()
    await confirmOwnAccount()

    expect(vetUpdateMock).toHaveBeenCalledWith({ id: 'vet-1', accountConfirmed: true })
  })

  it("échec : n'expose jamais l'erreur à l'appelant (best-effort)", async () => {
    vetUpdateMock.mockResolvedValueOnce({ errors: [{ message: 'boom' }] })

    const { confirmOwnAccount } = useClinicVeterinarians()
    await expect(confirmOwnAccount()).resolves.toBeUndefined()
  })
})

describe('mapInviteVeterinarianError', () => {
  it('mappe chaque code connu vers sa clé i18n dédiée, et tout le reste vers la clé générique', () => {
    expect(mapInviteVeterinarianError('EMAIL_ALREADY_EXISTS')).toBe(
      'dashboard.settings.team.errors.email_already_exists',
    )
    expect(mapInviteVeterinarianError('NOT_CLINIC_REFERENT')).toBe(
      'dashboard.settings.team.errors.not_referent',
    )
    expect(mapInviteVeterinarianError('MISSING_EMAIL')).toBe(
      'dashboard.settings.team.errors.missing_email',
    )
    expect(mapInviteVeterinarianError('SOMETHING_UNKNOWN')).toBe(
      'dashboard.settings.team.errors.invite_failed',
    )
    expect(mapInviteVeterinarianError(undefined)).toBe('dashboard.settings.team.errors.invite_failed')
  })
})
