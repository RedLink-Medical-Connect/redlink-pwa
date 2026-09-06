/**
 * Cookies de session posés par le BFF -- voir docs/adr/0021-bff-cognito-session-cloudfront.md
 * §4. Pas de couche d'abstraction (`aws-amplify/adapter-core`) : ces helpers manipulent
 * directement le tableau `cookies` du payload Lambda Function URL v2.0 (même format que
 * API Gateway HTTP API v2.0 -- `event.cookies: string[]` en lecture, `cookies: string[]` dans
 * la réponse), et les tokens Cognito bruts renvoyés par `@aws-sdk/client-cognito-identity-provider`.
 *
 * `HttpOnly` (illisible en JS -- tout l'objectif), `Secure` (jamais transmis en clair),
 * `SameSite=Strict` (jamais envoyé sur une navigation/requête cross-site) : les trois posés
 * explicitement sur CHAQUE cookie, jamais un défaut implicite. `Path=/api` : ces cookies ne
 * servent qu'aux routes de ce Lambda (derrière CloudFront, voir ADR-0021 §2) -- inutile de les
 * envoyer sur `/` (les assets statiques de la SPA).
 */

export const ID_TOKEN_COOKIE = 'rl_id_token'
export const ACCESS_TOKEN_COOKIE = 'rl_access_token'
export const REFRESH_TOKEN_COOKIE = 'rl_refresh_token'
// Cognito exige un `Session` (chaîne opaque, PAS un token) entre `InitiateAuth` et
// `RespondToAuthChallenge` pour le challenge MFA TOTP (`CONFIRM_SIGN_IN_WITH_TOTP_CODE` côté
// client Amplify, voir stores/auth.js) -- ce cookie ne porte donc jamais de credential, contexte
// d'échange le temps du round-trip MFA uniquement (`maxAgeSeconds` court, voir handler.ts).
export const MFA_SESSION_COOKIE = 'rl_mfa_session'
// Cognito exige aussi un `Session` entre `SignUp` et le challenge `CONFIRM_SIGN_UP` -- non
// utilisé ici : `ConfirmSignUpCommand` ne prend qu'un `ConfirmationCode` + `Username`, pas de
// `Session` (contrairement à `RespondToAuthChallengeCommand`). Rien à stocker pour ce flux.

interface SetCookieOptions {
  maxAgeSeconds: number
}

/**
 * `maxAgeSeconds: 0` pour supprimer un cookie (signOut/deleteUser) -- une valeur vide avec
 * `Max-Age=0` fait que le navigateur l'efface immédiatement, plus fiable que `Expires` dans le
 * passé sur certains navigateurs.
 */
export function buildSetCookie(name: string, value: string, { maxAgeSeconds }: SetCookieOptions) {
  return [
    `${name}=${value}`,
    'Path=/api',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ')
}

export function clearCookie(name: string) {
  return buildSetCookie(name, '', { maxAgeSeconds: 0 })
}

/**
 * `event.cookies` (Lambda Function URL v2.0) : un tableau de chaînes `"nom=valeur"`, une par
 * cookie envoyé par le navigateur -- jamais un header `Cookie` brut à parser à la main.
 */
export function readCookie(cookies: string[] | undefined, name: string): string | undefined {
  if (!cookies) return undefined
  const prefix = `${name}=`
  const match = cookies.find((c) => c.startsWith(prefix))
  return match?.slice(prefix.length)
}
