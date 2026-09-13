import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import * as authRoutes from './auth-routes'
import type { RouteResult } from './auth-routes'
import * as clinicRoutes from './clinic-routes'
import { proxyGraphql } from './graphql-proxy'
import { ORIGIN_VERIFY_HEADER } from './origin-verify'

/**
 * Point d'entrée du BFF -- voir docs/adr/0021-bff-cognito-session-cloudfront.md. Format d'event
 * Lambda Function URL v2.0 (identique à API Gateway HTTP API v2.0 -- `event.cookies: string[]`,
 * `event.rawPath`, `event.requestContext.http.method`), CloudFront devant (ADR-0021 §2) : pas de
 * CORS à gérer, la SPA et ce Lambda sont same-origin sous le domaine de la distribution.
 *
 * Function URL en `authType: NONE` (`amplify/backend.ts`) -- ce Lambda est donc, au sens IAM,
 * appelable par n'importe qui qui devine son URL `*.lambda-url.<region>.on.aws`. La protection
 * réelle est le header `ORIGIN_VERIFY_HEADER` : CloudFront l'attache (valeur secrète,
 * *origin custom header*) à CHAQUE requête qu'il transmet à cette origine, quelle que soit la
 * méthode HTTP ou la présence d'un corps -- un appelant qui contacterait le Function URL
 * directement ne peut pas le fournir. `ORIGIN_VERIFY_SECRET` absent (local `ampx sandbox`/
 * `npm run dev` : pas de distribution CloudFront devant, voir `amplify/backend.ts`) désactive
 * ce contrôle plutôt que de rejeter systématiquement -- la même distinction que le reste de ce
 * fichier fait déjà pour l'absence de CloudFront en local.
 *
 * `/api/graphql` (relais brut, `graphql-proxy.ts`) vs `/api/auth/*` (SDK Cognito direct,
 * `auth-routes.ts`) : deux familles de contrat de réponse différentes (la première renvoie le
 * corps AppSync TEL QUEL, la seconde du JSON structuré) -- routées séparément plutôt que
 * forcées dans un même formatage de réponse.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const originVerifySecret = process.env.ORIGIN_VERIFY_SECRET
  if (originVerifySecret && event.headers?.[ORIGIN_VERIFY_HEADER] !== originVerifySecret) {
    return { statusCode: 403, body: JSON.stringify({ error: 'FORBIDDEN' }) }
  }

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
    'POST /api/auth/confirm-new-password': () => authRoutes.confirmNewPassword(body, cookies),
    'POST /api/auth/signup': () => authRoutes.signUp(body),
    'POST /api/auth/confirm-signup': () => authRoutes.confirmSignUp(body),
    'POST /api/auth/resend-code': () => authRoutes.resendCode(body),
    'POST /api/auth/forgot-password': () => authRoutes.forgotPassword(body),
    'POST /api/auth/confirm-forgot-password': () => authRoutes.confirmForgotPassword(body),
    'GET /api/auth/session': () => authRoutes.getSession(cookies),
    'POST /api/auth/signout': () => authRoutes.signOut(cookies),
    'POST /api/auth/delete-account': () => authRoutes.deleteAccount(cookies),
    'POST /api/auth/update-profile': () => authRoutes.updateProfile(body, cookies),
    'GET /api/auth/mfa/status': () => authRoutes.getMfaStatus(cookies),
    'POST /api/auth/mfa/setup': () => authRoutes.startMfaSetup(cookies),
    'POST /api/auth/mfa/verify': () => authRoutes.confirmMfaSetup(body, cookies),
    'POST /api/auth/mfa/disable': () => authRoutes.disableMfa(cookies),
    'POST /api/clinic/veterinarians': () => clinicRoutes.inviteVeterinarian(body, cookies),
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
