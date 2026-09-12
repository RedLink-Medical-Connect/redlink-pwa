import { describe, it, expect, vi, beforeEach } from 'vitest'
import { proxyGraphql } from './graphql-proxy'
import { tryRefresh } from './auth-routes'
import { ID_TOKEN_COOKIE } from './cookies'

// `graphql-proxy.ts` importe `tryRefresh` depuis `auth-routes.ts` (réutilisation, voir son
// commentaire de tête) -- mocké ici pour isoler ces tests du SDK Cognito, qui a déjà sa propre
// couverture dans `auth-routes.test.ts`.
vi.mock('./auth-routes', () => ({ tryRefresh: vi.fn() }))

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  vi.mocked(tryRefresh).mockReset()
  process.env.APPSYNC_GRAPHQL_URL = 'https://appsync.example.com/graphql'
})

describe('proxyGraphql', () => {
  it('relaie le body brut à AppSync avec le vrai ID token en Authorization, renvoie la réponse telle quelle', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ data: { listAnimals: [] } }),
    })

    const rawBody = JSON.stringify({ query: 'query { listAnimals { items { id } } }' })
    const result = await proxyGraphql(rawBody, [`${ID_TOKEN_COOKIE}=real-id-token`])

    expect(result.statusCode).toBe(200)
    expect(result.rawBody).toBe(JSON.stringify({ data: { listAnimals: [] } }))
    expect(fetchMock).toHaveBeenCalledWith('https://appsync.example.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'real-id-token' },
      body: rawBody,
    })
    expect(tryRefresh).not.toHaveBeenCalled()
  })

  it('sans cookie de session mais un refresh token valide : rafraîchit puis relaie normalement', async () => {
    vi.mocked(tryRefresh).mockResolvedValue({ IdToken: 'fresh-id', AccessToken: 'fresh-access' } as never)
    fetchMock.mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{"data":{}}',
    })

    const result = await proxyGraphql('{"query":"..."}', undefined)

    expect(result.statusCode).toBe(200)
    expect(result.setCookies).toBeDefined()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'fresh-id' }) }),
    )
  })

  it('sans cookie de session et refresh impossible : erreur GraphQL-shaped, AppSync jamais appelé', async () => {
    vi.mocked(tryRefresh).mockResolvedValue(null)

    const result = await proxyGraphql('{"query":"..."}', undefined)

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.rawBody)).toEqual({ data: null, errors: [{ message: 'NOT_AUTHENTICATED' }] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('AppSync renvoie 401 (token expiré pendant la requête) : rafraîchit une seule fois puis rejoue', async () => {
    vi.mocked(tryRefresh).mockResolvedValue({ IdToken: 'fresh-id', AccessToken: 'fresh-access' } as never)
    fetchMock
      .mockResolvedValueOnce({ status: 401, headers: new Headers(), text: async () => '' })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => '{"data":{}}',
      })

    const result = await proxyGraphql('{"query":"..."}', [`${ID_TOKEN_COOKIE}=stale-id-token`])

    expect(result.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'fresh-id' }) }),
    )
  })

  it('AppSync renvoie 401 et le refresh échoue aussi : ne boucle pas, renvoie le 401 initial', async () => {
    vi.mocked(tryRefresh).mockResolvedValue(null)
    fetchMock.mockResolvedValue({ status: 401, headers: new Headers(), text: async () => 'unauthorized' })

    const result = await proxyGraphql('{"query":"..."}', [`${ID_TOKEN_COOKIE}=stale-id-token`])

    expect(result.statusCode).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('renvoie 400 sans appeler AppSync ni tryRefresh si le body est absent', async () => {
    const result = await proxyGraphql(undefined, [`${ID_TOKEN_COOKIE}=real-id-token`])

    expect(result.statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tryRefresh).not.toHaveBeenCalled()
  })
})
