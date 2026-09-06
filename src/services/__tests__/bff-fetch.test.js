import { describe, it, expect, vi, beforeEach } from 'vitest'
import { bffFetch } from '@/services/bff-fetch'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

describe('bffFetch', () => {
  it('POST par défaut, credentials include, sérialise le body en JSON', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'OK' }) })

    const result = await bffFetch('/api/auth/signin', { body: { email: 'a@b.com' } })

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/signin', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com' }),
    })
    expect(result).toEqual({ ok: true, status: 200, data: { status: 'OK' } })
  })

  it('méthode explicite (GET), sans body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ authenticated: false }) })

    await bffFetch('/api/auth/session', { method: 'GET' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({ method: 'GET', body: undefined }),
    )
  })

  it('un body JSON invalide dans la réponse ne fait pas planter -- data devient {}', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input')
      },
    })

    const result = await bffFetch('/api/auth/signin')

    expect(result).toEqual({ ok: false, status: 500, data: {} })
  })
})
