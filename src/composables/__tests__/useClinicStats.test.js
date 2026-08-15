import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase 6.7 (CdC §2.4) : useClinicStats() expose transfusionsDone/donorOwnersCount pour
// RequestsView.vue -- lecture seule (l'écriture/incrément a lieu à la clôture COMPLETED
// d'une Mission, voir useMissionClosure.test.js). Composable jamais couvert par un test
// jusqu'ici (gap identifié en revue QA de la Phase 6.5/6.6/6.7/6.8, aucun test dédié écrit
// par le Senior Dev sur ce fichier précis malgré sa création dans ce même lot).

const graphqlMock = vi.fn()
const getCurrentUserMock = vi.fn()

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}))

import { useClinicStats } from '@/composables/useClinicStats'

/**
 * Mock GraphQL réutilisé par les tests de ce fichier : gère GetVeterinarian (résolution du
 * clinicID) puis GetClinic (les indicateurs eux-mêmes), même pattern que
 * useClinicDonors.test.js / useClinicRequest.test.js pour fetchClinicId.
 */
function mockGraphql({ clinicID = 'clinic-1', clinic = { transfusionsDone: 4, donorOwnersCount: 2 } } = {}) {
  getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
  graphqlMock.mockImplementation(async ({ query, variables }) => {
    if (query.includes('GetVeterinarian')) {
      return { data: { getVeterinarian: { id: 'vet-1', clinicID } } }
    }
    if (query.includes('GetClinic')) {
      expect(variables).toEqual({ id: clinicID })
      return { data: { getClinic: clinic ? { id: clinicID, ...clinic } : null } }
    }
    throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
  })
}

describe('useClinicStats.fetchStats', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
    getCurrentUserMock.mockReset()
  })

  it('expose transfusionsDone et donorOwnersCount tels que renvoyés par GetClinic', async () => {
    mockGraphql({ clinic: { transfusionsDone: 12, donorOwnersCount: 5 } })

    const { fetchStats, transfusionsDone, donorOwnersCount, loadError } = useClinicStats()
    await fetchStats()

    expect(transfusionsDone.value).toBe(12)
    expect(donorOwnersCount.value).toBe(5)
    expect(loadError.value).toBe(false)
  })

  it('retombe sur 0/0 (pas undefined/NaN) quand transfusionsDone/donorOwnersCount sont null en base (Clinic jamais encore clôturée)', async () => {
    mockGraphql({ clinic: { transfusionsDone: null, donorOwnersCount: null } })

    const { fetchStats, transfusionsDone, donorOwnersCount } = useClinicStats()
    await fetchStats()

    expect(transfusionsDone.value).toBe(0)
    expect(donorOwnersCount.value).toBe(0)
  })

  it("isLoading passe à true pendant le chargement puis retombe à false, avec authMode 'userPool' sur les deux appels", async () => {
    mockGraphql()
    let sawUserPoolCalls = 0
    graphqlMock.mockImplementation(async ({ query, authMode }) => {
      expect(authMode).toBe('userPool')
      sawUserPoolCalls += 1
      if (query.includes('GetVeterinarian')) {
        return { data: { getVeterinarian: { id: 'vet-1', clinicID: 'clinic-1' } } }
      }
      return { data: { getClinic: { id: 'clinic-1', transfusionsDone: 1, donorOwnersCount: 1 } } }
    })

    const { fetchStats, isLoading } = useClinicStats()
    expect(isLoading.value).toBe(false)

    const promise = fetchStats()
    expect(isLoading.value).toBe(true)
    await promise

    expect(isLoading.value).toBe(false)
    expect(sawUserPoolCalls).toBe(2)
  })

  it("loadError passe à true et les compteurs restent à leur valeur par défaut (0) si le Veterinarian n'a pas de clinicID", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('GetVeterinarian')) {
        return { data: { getVeterinarian: { id: 'vet-1', clinicID: null } } }
      }
      throw new Error('GetClinic ne devrait jamais être appelée sans clinicID résolu')
    })

    const { fetchStats, transfusionsDone, donorOwnersCount, loadError } = useClinicStats()
    await fetchStats()

    expect(loadError.value).toBe(true)
    expect(transfusionsDone.value).toBe(0)
    expect(donorOwnersCount.value).toBe(0)
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('loadError distingue un échec réseau sur GetClinic (après résolution réussie du clinicID) d\'un tableau de bord réellement à 0/0', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCurrentUserMock.mockResolvedValue({ userId: 'vet-1' })
    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('GetVeterinarian')) {
        return { data: { getVeterinarian: { id: 'vet-1', clinicID: 'clinic-1' } } }
      }
      throw new Error('DynamoDB throttled')
    })

    const { fetchStats, loadError } = useClinicStats()
    await fetchStats()

    expect(loadError.value).toBe(true)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('indicateurs'),
      expect.any(Error),
    )

    // Un rechargement réussi (ex. clic "Réessayer") efface l'état d'erreur.
    mockGraphql({ clinic: { transfusionsDone: 3, donorOwnersCount: 1 } })
    await fetchStats()

    expect(loadError.value).toBe(false)

    consoleErrorSpy.mockRestore()
  })

  it('un GetClinic qui renvoie null (Clinic introuvable/supprimée) retombe silencieusement sur 0/0, sans lever loadError', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGraphql({ clinic: null })

    const { fetchStats, loadError, transfusionsDone, donorOwnersCount } = useClinicStats()
    await fetchStats()

    // useClinicStats.js ne distingue pas "GetClinic a répondu avec getClinic: null" de
    // "getClinic a répondu avec des compteurs à 0" -- les deux lectures optionnelles
    // (`data.getClinic?.transfusionsDone ?? 0`) retombent sur 0 sans qu'aucune exception ne
    // soit levée, donc sans jamais passer loadError à true. Ce test documente ce comportement
    // réel (pas un cas d'erreur réseau/permission, testé séparément ci-dessus) plutôt que d'en
    // présumer un, pour qu'un futur changement volontaire (ex. faire échouer loadError aussi
    // dans ce cas) casse ce test au lieu de dériver silencieusement.
    expect(transfusionsDone.value).toBe(0)
    expect(donorOwnersCount.value).toBe(0)
    expect(loadError.value).toBe(false)

    consoleErrorSpy.mockRestore()
  })
})
