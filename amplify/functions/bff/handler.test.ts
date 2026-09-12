import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { handler } from './handler'
import * as authRoutes from './auth-routes'
import { proxyGraphql } from './graphql-proxy'

// Routage pur : chaque route déléguée est mockée, sa propre logique a sa propre couverture
// (`auth-routes.test.ts`, `graphql-proxy.test.ts`). Ce fichier vérifie seulement que
// method+path arrive à la bonne fonction, avec le bon body/cookies, et que le contrat de
// réponse HTTP (statusCode/body/cookies) est bien reconstruit.
vi.mock('./auth-routes')
vi.mock('./graphql-proxy')

function buildEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    rawPath: '/api/auth/signin',
    requestContext: { http: { method: 'POST' } },
    cookies: undefined,
    body: undefined,
    isBase64Encoded: false,
    ...overrides,
  } as APIGatewayProxyEventV2
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handler routing', () => {
  it('route /api/graphql (POST) vers proxyGraphql, avec le body décodé et les cookies', async () => {
    vi.mocked(proxyGraphql).mockResolvedValue({
      statusCode: 200,
      contentType: 'application/json',
      rawBody: '{"data":{}}',
    })

    const event = buildEvent({
      rawPath: '/api/graphql',
      body: JSON.stringify({ query: '...' }),
      cookies: ['rl_id_token=abc'],
    })

    const result = await handler(event)

    expect(proxyGraphql).toHaveBeenCalledWith(JSON.stringify({ query: '...' }), ['rl_id_token=abc'])
    expect(result).toEqual({
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: '{"data":{}}',
      cookies: undefined,
    })
  })

  it('décode un body base64 avant de le transmettre (POST /api/auth/signin)', async () => {
    vi.mocked(authRoutes.signIn).mockResolvedValue({ statusCode: 200, body: { status: 'SIGNED_IN' } })

    const rawJson = JSON.stringify({ email: 'a@b.com', password: 'p' })
    const event = buildEvent({ body: Buffer.from(rawJson).toString('base64'), isBase64Encoded: true })

    await handler(event)

    expect(authRoutes.signIn).toHaveBeenCalledWith({ email: 'a@b.com', password: 'p' })
  })

  it('POST /api/auth/confirm-signin transmet le body ET les cookies (challenge MFA)', async () => {
    vi.mocked(authRoutes.confirmSignIn).mockResolvedValue({ statusCode: 200, body: { status: 'SIGNED_IN' } })

    const event = buildEvent({
      rawPath: '/api/auth/confirm-signin',
      body: JSON.stringify({ code: '123456' }),
      cookies: ['rl_mfa_session=xyz'],
    })

    await handler(event)

    expect(authRoutes.confirmSignIn).toHaveBeenCalledWith({ code: '123456' }, ['rl_mfa_session=xyz'])
  })

  it('GET /api/auth/session route vers getSession avec les cookies, sans body', async () => {
    vi.mocked(authRoutes.getSession).mockResolvedValue({ statusCode: 200, body: { authenticated: false } })

    const event = buildEvent({
      rawPath: '/api/auth/session',
      requestContext: { http: { method: 'GET' } } as never,
      cookies: ['rl_access_token=abc'],
    })

    const result = await handler(event)

    expect(authRoutes.getSession).toHaveBeenCalledWith(['rl_access_token=abc'])
    expect(result.body).toBe(JSON.stringify({ authenticated: false }))
  })

  it('renvoie 404 pour une route inconnue, sans appeler aucune fonction de route', async () => {
    const event = buildEvent({ rawPath: '/api/does-not-exist' })

    const result = await handler(event)

    expect(result.statusCode).toBe(404)
    expect(authRoutes.signIn).not.toHaveBeenCalled()
    expect(proxyGraphql).not.toHaveBeenCalled()
  })

  it('un body JSON invalide sur une route /api/auth/* est traité comme un body vide, pas une exception', async () => {
    vi.mocked(authRoutes.signIn).mockResolvedValue({ statusCode: 400, body: { error: 'MISSING_CREDENTIALS' } })

    const event = buildEvent({ body: '{not valid json' })

    await expect(handler(event)).resolves.toMatchObject({ statusCode: 400 })
    expect(authRoutes.signIn).toHaveBeenCalledWith({})
  })

  it('POST /api/auth/mfa/verify transmet le body ET les cookies (access token requis)', async () => {
    vi.mocked(authRoutes.confirmMfaSetup).mockResolvedValue({ statusCode: 200, body: { status: 'ENABLED' } })

    const event = buildEvent({
      rawPath: '/api/auth/mfa/verify',
      body: JSON.stringify({ code: '123456' }),
      cookies: ['rl_access_token=abc'],
    })

    await handler(event)

    expect(authRoutes.confirmMfaSetup).toHaveBeenCalledWith({ code: '123456' }, ['rl_access_token=abc'])
  })

  it('GET /api/auth/mfa/status route vers getMfaStatus avec les cookies, sans body', async () => {
    vi.mocked(authRoutes.getMfaStatus).mockResolvedValue({ statusCode: 200, body: { enabled: false } })

    const event = buildEvent({
      rawPath: '/api/auth/mfa/status',
      requestContext: { http: { method: 'GET' } } as never,
      cookies: ['rl_access_token=abc'],
    })

    await handler(event)

    expect(authRoutes.getMfaStatus).toHaveBeenCalledWith(['rl_access_token=abc'])
  })

  it('propage les Set-Cookie renvoyés par la route dans la réponse HTTP', async () => {
    vi.mocked(authRoutes.signOut).mockResolvedValue({
      statusCode: 200,
      body: { status: 'SIGNED_OUT' },
      setCookies: ['rl_id_token=; Max-Age=0'],
    })

    const event = buildEvent({ rawPath: '/api/auth/signout' })

    const result = await handler(event)

    expect(result.cookies).toEqual(['rl_id_token=; Max-Age=0'])
  })
})
