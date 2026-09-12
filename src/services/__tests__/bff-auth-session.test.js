import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// `useAuthStore()` importe `@/router` (singleton) -- stubbé pour ne pas embarquer tout le
// graphe de vues, même pattern que useOwnerProfile.test.js/useMatchingRequests.test.js.
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import { useAuthStore } from '@/stores/auth'
import { getCurrentUser, deleteUser } from '@/services/bff-auth-session'

const fetchMock = vi.fn()

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

describe('getCurrentUser', () => {
  it("renvoie { userId, username } depuis le user déjà chargé par auth.init(), sans appel réseau", async () => {
    const authStore = useAuthStore()
    authStore.user = { userId: 'user-1', username: 'user-1', attributes: { email: 'a@b.com' } }

    const result = await getCurrentUser()

    expect(result).toEqual({ userId: 'user-1', username: 'user-1' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejette avec UserUnAuthenticatedException si aucune session n'est chargée", async () => {
    const authStore = useAuthStore()
    authStore.user = null

    await expect(getCurrentUser()).rejects.toMatchObject({ name: 'UserUnAuthenticatedException' })
  })
})

describe('deleteUser', () => {
  it('appelle /api/auth/delete-account en POST avec les cookies de session', async () => {
    fetchMock.mockResolvedValue({ ok: true })

    await deleteUser()

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/delete-account', {
      method: 'POST',
      credentials: 'include',
    })
  })

  it('lève une erreur si la réponse du BFF est un échec', async () => {
    fetchMock.mockResolvedValue({ ok: false })

    await expect(deleteUser()).rejects.toThrow('DELETE_ACCOUNT_FAILED')
  })
})
