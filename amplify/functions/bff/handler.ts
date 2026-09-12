import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import * as authRoutes from './auth-routes'
import type { RouteResult } from './auth-routes'
import { proxyGraphql } from './graphql-proxy'

/**
 * Point d'entrée du BFF -- voir docs/adr/0021-bff-cognito-session-cloudfront.md. Format d'event
 * Lambda Function URL v2.0 (identique à API Gateway HTTP API v2.0 -- `event.cookies: string[]`,
 * `event.rawPath`, `event.requestContext.http.method`), CloudFront devant (ADR-0021 §2) : pas de
 * CORS à gérer, la SPA et ce Lambda sont same-origin sous le domaine de la distribution.
 *
 * `/api/graphql` (relais brut, `graphql-proxy.ts`) vs `/api/auth/*` (SDK Cognito direct,
 * `auth-routes.ts`) : deux familles de contrat de réponse différentes (la première renvoie le
 * corps AppSync TEL QUEL, la seconde du JSON structuré) -- routées séparément plutôt que
 * forcées dans un même formatage de réponse.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const method = event.requestContext.http.method
  const path = event.rawPath
  const cookies = event.cookies

  if (path === '/api/graphql' && method === 'POST') {
    const result = await proxyGraphql(decodeBody(event), cookies)
    return {
      statusCode: result.statusCode,
      headers: { 'Content-Type': result.contentType },
      body: result.rawBody,
      cookies: result.setCookies,
    }
  }

  const body = parseJsonBody(decodeBody(event))

  const routes: Record<string, () => Promise<RouteResult>> = {
    'POST /api/auth/signin': () => authRoutes.signIn(body),
    'POST /api/auth/confirm-signin': () => authRoutes.confirmSignIn(body, cookies),
    'POST /api/auth/signup': () => authRoutes.signUp(body),
    'POST /api/auth/confirm-signup': () => authRoutes.confirmSignUp(body),
    'POST /api/auth/resend-code': () => authRoutes.resendCode(body),
    'POST /api/auth/forgot-password': () => authRoutes.forgotPassword(body),
    'POST /api/auth/confirm-forgot-password': () => authRoutes.confirmForgotPassword(body),
    'GET /api/auth/session': () => authRoutes.getSession(cookies),
    'POST /api/auth/signout': () => authRoutes.signOut(cookies),
    'POST /api/auth/delete-account': () => authRoutes.deleteAccount(cookies),
    'GET /api/auth/mfa/status': () => authRoutes.getMfaStatus(cookies),
    'POST /api/auth/mfa/setup': () => authRoutes.startMfaSetup(cookies),
    'POST /api/auth/mfa/verify': () => authRoutes.confirmMfaSetup(body, cookies),
    'POST /api/auth/mfa/disable': () => authRoutes.disableMfa(cookies),
  }

  const route = routes[`${method} ${path}`]
  if (!route) {
    return { statusCode: 404, body: JSON.stringify({ error: 'NOT_FOUND' }) }
  }

  const result = await route()
  return {
    statusCode: result.statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.body),
    cookies: result.setCookies,
  }
}

function decodeBody(event: APIGatewayProxyEventV2): string | undefined {
  if (!event.body) return undefined
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body
}

function parseJsonBody(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}
