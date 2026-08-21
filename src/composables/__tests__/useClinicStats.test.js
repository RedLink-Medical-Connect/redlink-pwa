import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase 6.7 (CdC §2.4) : useClinicStats() expose transfusionsDone/donorOwnersCount pour
// RequestsView.vue -- lecture seule (l'écriture/incrément a lieu à la clôture COMPLETED
// d'une Mission, voir useMissionClosure.test.js). Composable jamais couvert par un test
// jusqu'ici (gap identifié en revue QA de la Phase 6.5/6.6/6.7/6.8, aucun test dédié écrit
// par le Senior Dev sur ce fichier précis malgré sa création dans ce même lot).
//
// Phase 8, sous-tâche 5 (lot 2/3) : useClinicStats.js migré sur le client Gen2
// (`aws-amplify/data`, `client.models.Veterinarian.get()`/`client.models.Clinic.get()`) --
// mock reconstruit sur `{ data, errors }` par méthode de modèle plutôt que sur
// `client.graphql({ query, variables })`. Les assertions métier (compteurs, loadError,
// isLoading) sont inchangées, seule la plomberie de mock change.

const vetGetMock = vi.fn()
const clinicGetMock = vi.fn()
const getCurrentUserMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Veterinarian: { get: (...args) => vetGetMock(...args) },
      Clinic: { get: (...args) => clinicGetMock(...args) },
    },
  }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}))

import { useClinicStats } from '@/composables/useClinicStats'

/**
 * Configure `vetGetMock`/`clinicGetMock` pour le scénario "heureux" réutilisé par la
 * plupart des tests de ce fichier : résolution du clinicID puis lecture des compteurs.
 *
 * Vérifie au passage le `selectionSet` explicite ajouté en revue Lead Dev (lot 2) : ce
 * composable ne lit jamais que `clinicID` (Veterinarian) et
 * `transfusionsDone`/`donorOwnersCount` (Clinic) -- voir le commentaire de tête de
 * useClinicStats.js.
 */
function mockClient({ clinicID = 'clinic-1', clinic = { transfusionsDone: 4, donorOwnersCount: 2 } } = {}) {
  getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
  vetGetMock.mockImplementation(async ({ id }, options) => {
    expect(id).toBe('vet-1')
    expect(options?.selectionSet).toEqual(['clinicID'])
    return { data: { id: 'vet-1', clinicID }, errors: undefined }
  })
  clinicGetMock.mockImplementation(async ({ id }, options) => {
    expect(id).toBe(clinicID)
    expect(options?.selectionSet).toEqual(['transfusionsDone', 'donorOwnersCount'])
    return { data: clinic ? { id: clinicID, ...clinic } : null, errors: undefined }
  })
}

describe('useClinicStats.fetchStats', () => {
  beforeEach(() => {
    vetGetMock.mockReset()
    clinicGetMock.mockReset()
    getCurrentUserMock.mockReset()
  })

  it('expose transfusionsDone et donorOwnersCount tels que renvoyés par Clinic.get()', async () => {
    mockClient({ clinic: { transfusionsDone: 12, donorOwnersCount: 5 } })

    const { fetchStats, transfusionsDone, donorOwnersCount, loadError } = useClinicStats()
    await fetchStats()

    expect(transfusionsDone.value).toBe(12)
    expect(donorOwnersCount.value).toBe(5)
    expect(loadError.value).toBe(false)
  })

  it('retombe sur 0/0 (pas undefined/NaN) quand transfusionsDone/donorOwnersCount sont null en base (Clinic jamais encore clôturée)', async () => {
    mockClient({ clinic: { transfusionsDone: null, donorOwnersCount: null } })

    const { fetchStats, transfusionsDone, donorOwnersCount } = useClinicStats()
    await fetchStats()

    expect(transfusionsDone.value).toBe(0)
    expect(donorOwnersCount.value).toBe(0)
  })

  it('isLoading passe à true pendant le chargement puis retombe à false', async () => {
    mockClient()

    const { fetchStats, isLoading } = useClinicStats()
    expect(isLoading.value).toBe(false)

    const promise = fetchStats()
    expect(isLoading.value).toBe(true)
    await promise

    expect(isLoading.value).toBe(false)
    expect(vetGetMock).toHaveBeenCalledTimes(1)
    expect(clinicGetMock).toHaveBeenCalledTimes(1)
  })

  it("loadError passe à true et les compteurs restent à leur valeur par défaut (0) si le Veterinarian n'a pas de clinicID", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
    vetGetMock.mockResolvedValue({ data: { id: 'vet-1', clinicID: null }, errors: undefined })
    clinicGetMock.mockRejectedValue(
      new Error('Clinic.get() ne devrait jamais être appelée sans clinicID résolu'),
    )

    const { fetchStats, transfusionsDone, donorOwnersCount, loadError } = useClinicStats()
    await fetchStats()

    expect(loadError.value).toBe(true)
    expect(transfusionsDone.value).toBe(0)
    expect(donorOwnersCount.value).toBe(0)
    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(clinicGetMock).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('loadError distingue un échec réseau sur Clinic.get() (après résolution réussie du clinicID) d\'un tableau de bord réellement à 0/0', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
    vetGetMock.mockResolvedValue({ data: { id: 'vet-1', clinicID: 'clinic-1' }, errors: undefined })
    clinicGetMock.mockRejectedValue(new Error('DynamoDB throttled'))

    const { fetchStats, loadError } = useClinicStats()
    await fetchStats()

    expect(loadError.value).toBe(true)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('indicateurs'),
      expect.any(Error),
    )

    // Un rechargement réussi (ex. clic "Réessayer") efface l'état d'erreur.
    mockClient({ clinic: { transfusionsDone: 3, donorOwnersCount: 1 } })
    await fetchStats()

    expect(loadError.value).toBe(false)

    consoleErrorSpy.mockRestore()
  })

  it('un Clinic.get() qui renvoie null (Clinic introuvable/supprimée) retombe silencieusement sur 0/0, sans lever loadError', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockClient({ clinic: null })

    const { fetchStats, loadError, transfusionsDone, donorOwnersCount } = useClinicStats()
    await fetchStats()

    // useClinicStats.js ne distingue pas "Clinic.get() a résolu data: null" de "Clinic.get()
    // a résolu des compteurs à 0" -- les deux lectures optionnelles
    // (`data?.transfusionsDone ?? 0`) retombent sur 0 sans qu'aucune exception ne soit
    // levée, donc sans jamais passer loadError à true. Ce test documente ce comportement
    // réel (pas un cas d'erreur réseau/permission, testé séparément ci-dessus) plutôt que
    // d'en présumer un, pour qu'un futur changement volontaire (ex. faire échouer loadError
    // aussi dans ce cas) casse ce test au lieu de dériver silencieusement.
    expect(transfusionsDone.value).toBe(0)
    expect(donorOwnersCount.value).toBe(0)
    expect(loadError.value).toBe(false)

    consoleErrorSpy.mockRestore()
  })

  it('propage une erreur GraphQL/@auth sur Veterinarian.get() (errors présent) via loadError', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
    vetGetMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access getVeterinarian' }],
    })

    const { fetchStats, loadError } = useClinicStats()
    await fetchStats()

    expect(loadError.value).toBe(true)
    expect(clinicGetMock).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('indicateurs'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  // Revue Lead Dev (lot 2) : le test précédent couvrait déjà le contrat Gen2 résolu
  // (`{ data: null, errors }`, PAS un rejet JS) côté Veterinarian.get() -- ce test couvre le
  // même contrat côté Clinic.get(), jusqu'ici seulement exercé via `mockRejectedValue`
  // (échec réseau/exception JS, un cas différent) dans les deux tests au-dessus.
  it('propage une erreur GraphQL/@auth sur Clinic.get() (errors présent, pas un rejet JS) via loadError', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
    vetGetMock.mockResolvedValue({ data: { id: 'vet-1', clinicID: 'clinic-1' }, errors: undefined })
    clinicGetMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access getClinic' }],
    })

    const { fetchStats, loadError, transfusionsDone, donorOwnersCount } = useClinicStats()
    await fetchStats()

    expect(loadError.value).toBe(true)
    expect(transfusionsDone.value).toBe(0)
    expect(donorOwnersCount.value).toBe(0)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('indicateurs'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })
})
