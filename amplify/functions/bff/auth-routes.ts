import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  GlobalSignOutCommand,
  DeleteUserCommand,
  GetUserCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
  type AuthenticationResultType,
} from '@aws-sdk/client-cognito-identity-provider'
import {
  ID_TOKEN_COOKIE,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  MFA_SESSION_COOKIE,
  buildSetCookie,
  clearCookie,
  readCookie,
} from './cookies'

/**
 * Routes `/api/auth/*` du BFF -- voir docs/adr/0021-bff-cognito-session-cloudfront.md §4/§5.
 * SDK Cognito Identity Provider direct, `USER_PASSWORD_AUTH` (voir ADR-0021 §4 pour le
 * raisonnement -- pas de réimplémentation SRP côté serveur). Chaque fonction reçoit le body
 * JSON déjà parsé + les cookies bruts de la requête, et renvoie un statut HTTP + un corps JSON
 * + les `Set-Cookie` à poser -- le routage HTTP proprement dit vit dans `handler.ts`.
 *
 * Contrat commun : jamais un JWT dans le corps de la réponse JSON, uniquement dans les cookies
 * (`HttpOnly`) posés par le Lambda lui-même -- c'est tout l'objectif de ce chantier.
 */

export interface RouteResult {
  statusCode: number
  body: Record<string, unknown>
  setCookies?: string[]
}

const REFRESH_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60 // 7 jours, aligné sur cfnUserPoolClient.refreshTokenValidity
const SESSION_TOKEN_MAX_AGE_SECONDS = 15 * 60 // 15 min, aligné sur accessTokenValidity/idTokenValidity
const MFA_SESSION_MAX_AGE_SECONDS = 5 * 60 // le temps de saisir un code TOTP, pas plus

function getClient() {
  return new CognitoIdentityProviderClient({ region: process.env.AWS_REGION })
}

function getClientId() {
  const clientId = process.env.COGNITO_USER_POOL_CLIENT_ID
  if (!clientId) throw new Error('COGNITO_USER_POOL_CLIENT_ID manquant')
  return clientId
}

/**
 * `ClientMetadata` transite jusqu'au trigger `CustomMessage`
 * (`amplify/functions/custom-message/handler.ts`, docs/adr/0022-branded-transactional-emails.md)
 * en tant que `event.request.clientMetadata.locale` -- ce BFF ne valide ni ne résout cette
 * valeur (une locale absente ou invalide y retombe sur `fr` par défaut, seule source de
 * vérité pour ce repli). `undefined` plutôt qu'un objet à clé vide quand `locale` n'est pas
 * une string : `ClientMetadata` du SDK Cognito est `Record<string, string>`, une valeur
 * `undefined` n'y est pas assignable.
 */
function localeMetadata(locale: unknown): Record<string, string> | undefined {
  return typeof locale === 'string' ? { locale } : undefined
}

/**
 * Lecture de claims sur un JWT qu'on vient de RECEVOIR DIRECTEMENT de Cognito dans cette même
 * requête (jamais un cookie relu plus tard -- voir `readUserFromAccessToken` ci-dessous pour ce
 * cas) : pas de vérification de signature nécessaire, la confiance vient du canal (réponse
 * Cognito sur TLS), pas du contenu du token lui-même.
 */
function decodeIdTokenClaims(idToken: string): Record<string, unknown> {
  const payload = idToken.split('.')[1]
  const json = Buffer.from(payload, 'base64url').toString('utf-8')
  return JSON.parse(json)
}

function sessionCookiesFor(result: AuthenticationResultType): string[] {
  const cookies = [
    buildSetCookie(ID_TOKEN_COOKIE, result.IdToken!, { maxAgeSeconds: SESSION_TOKEN_MAX_AGE_SECONDS }),
    buildSetCookie(ACCESS_TOKEN_COOKIE, result.AccessToken!, {
      maxAgeSeconds: SESSION_TOKEN_MAX_AGE_SECONDS,
    }),
  ]
  // `RespondToAuthChallenge` (refresh token flow) ne renvoie PAS de nouveau RefreshToken
  // (rotation non activée) -- ne réécrire ce cookie que quand Cognito en fournit un.
  if (result.RefreshToken) {
    cookies.push(
      buildSetCookie(REFRESH_TOKEN_COOKIE, result.RefreshToken, {
        maxAgeSeconds: REFRESH_TOKEN_MAX_AGE_SECONDS,
      }),
    )
  }
  return cookies
}

function userFromIdToken(idToken: string) {
  const claims = decodeIdTokenClaims(idToken)
  return {
    sub: claims.sub as string,
    email: claims.email as string,
    name: (claims.name as string) ?? null,
    profile: (claims.profile as string) ?? null,
  }
}

export async function signIn(body: { email?: string; password?: string }): Promise<RouteResult> {
  if (!body.email || !body.password) {
    return { statusCode: 400, body: { error: 'MISSING_CREDENTIALS' } }
  }

  try {
    const result = await getClient().send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: getClientId(),
        AuthParameters: { USERNAME: body.email, PASSWORD: body.password },
      }),
    )

    if (result.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
      // Le `Session` Cognito ici n'est PAS un credential -- juste un jeton d'échange à
      // rapporter tel quel au prochain appel (`confirmSignIn`), voir cookies.ts.
      return {
        statusCode: 200,
        body: { status: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' },
        setCookies: [
          buildSetCookie(MFA_SESSION_COOKIE, result.Session!, {
            maxAgeSeconds: MFA_SESSION_MAX_AGE_SECONDS,
          }),
        ],
      }
    }

    if (!result.AuthenticationResult) {
      return { statusCode: 500, body: { error: 'UNEXPECTED_CHALLENGE', challenge: result.ChallengeName } }
    }

    return {
      statusCode: 200,
      body: { status: 'SIGNED_IN', user: userFromIdToken(result.AuthenticationResult.IdToken!) },
      setCookies: sessionCookiesFor(result.AuthenticationResult),
    }
  } catch (err) {
    const error = err as { name?: string }
    if (error.name === 'UserNotConfirmedException') {
      return { statusCode: 200, body: { status: 'CONFIRM_SIGN_UP' } }
    }
    console.error('signIn error:', err)
    return { statusCode: 401, body: { error: 'SIGN_IN_FAILED' } }
  }
}

export async function confirmSignIn(
  body: { code?: string },
  cookies: string[] | undefined,
): Promise<RouteResult> {
  const session = readCookie(cookies, MFA_SESSION_COOKIE)
  if (!body.code || !session) {
    return { statusCode: 400, body: { error: 'MISSING_MFA_CHALLENGE' } }
  }

  try {
    const result = await getClient().send(
      new RespondToAuthChallengeCommand({
        ClientId: getClientId(),
        ChallengeName: 'SOFTWARE_TOKEN_MFA',
        Session: session,
        ChallengeResponses: { USERNAME: readUsernameFromMfaSession(session), SOFTWARE_TOKEN_MFA_CODE: body.code },
      }),
    )

    if (!result.AuthenticationResult) {
      return { statusCode: 401, body: { error: 'MFA_CHALLENGE_FAILED' } }
    }

    return {
      statusCode: 200,
      body: { status: 'SIGNED_IN', user: userFromIdToken(result.AuthenticationResult.IdToken!) },
      setCookies: [...sessionCookiesFor(result.AuthenticationResult), clearCookie(MFA_SESSION_COOKIE)],
    }
  } catch (err) {
    console.error('confirmSignIn error:', err)
    return { statusCode: 401, body: { error: 'MFA_CHALLENGE_FAILED' } }
  }
}

/**
 * `RespondToAuthChallengeCommand` exige `USERNAME` dans `ChallengeResponses` -- Cognito ne le
 * redérive pas depuis le `Session` opaque. On ne le stocke PAS séparément (un cookie de plus à
 * gérer) : le `Session` lui-même est un JWT signé par Cognito dont le payload porte déjà le
 * username, lisible sans vérification pour la même raison que `decodeIdTokenClaims` (Cognito
 * vérifie sa propre signature au prochain appel `RespondToAuthChallenge` -- une valeur falsifiée
 * ferait simplement échouer ce prochain appel, jamais une usurpation réussie).
 */
function readUsernameFromMfaSession(session: string): string {
  const claims = decodeIdTokenClaims(session)
  return (claims.username as string) ?? (claims['cognito:username'] as string)
}

export async function signUp(body: {
  email?: string
  password?: string
  name?: string
  role?: string
  locale?: string
}): Promise<RouteResult> {
  if (!body.email || !body.password) {
    return { statusCode: 400, body: { error: 'MISSING_CREDENTIALS' } }
  }

  try {
    await getClient().send(
      new SignUpCommand({
        ClientId: getClientId(),
        Username: body.email,
        Password: body.password,
        UserAttributes: [
          { Name: 'email', Value: body.email },
          { Name: 'name', Value: body.name ?? '' },
          { Name: 'profile', Value: body.role ?? '' },
        ],
        ClientMetadata: localeMetadata(body.locale),
      }),
    )
    return { statusCode: 200, body: { status: 'CONFIRM_SIGN_UP' } }
  } catch (err) {
    const error = err as { name?: string }
    if (error.name === 'UsernameExistsException') {
      // Même raisonnement que le correctif `stores/auth.js` (2026-09-06, PR #59) : distinguer
      // un compte déjà confirmé (redirection /login côté frontend) d'une inscription abandonnée
      // (reprise directe -- resendConfirmationCode ne demande aucun mot de passe).
      try {
        await getClient().send(
          new ResendConfirmationCodeCommand({
            ClientId: getClientId(),
            Username: body.email,
            ClientMetadata: localeMetadata(body.locale),
          }),
        )
        return { statusCode: 200, body: { status: 'CONFIRM_SIGN_UP_RESUMED' } }
      } catch (resendErr) {
        console.error('signUp resend on existing user failed:', resendErr)
        return { statusCode: 409, body: { error: 'USERNAME_EXISTS' } }
      }
    }
    console.error('signUp error:', err)
    return { statusCode: 400, body: { error: 'SIGN_UP_FAILED' } }
  }
}

export async function confirmSignUp(body: { email?: string; code?: string }): Promise<RouteResult> {
  if (!body.email || !body.code) {
    return { statusCode: 400, body: { error: 'MISSING_CODE' } }
  }
  try {
    await getClient().send(
      new ConfirmSignUpCommand({ ClientId: getClientId(), Username: body.email, ConfirmationCode: body.code }),
    )
    return { statusCode: 200, body: { status: 'CONFIRMED' } }
  } catch (err) {
    const error = err as { message?: string }
    // Comportement d'origine conservé (stores/auth.js, avant migration BFF) : un code déjà
    // consommé (nouvel essai après succès, ex. double-clic) n'est pas traité comme un échec.
    if (error.message?.includes('Current status is CONFIRMED')) {
      return { statusCode: 200, body: { status: 'CONFIRMED' } }
    }
    console.error('confirmSignUp error:', err)
    return { statusCode: 400, body: { error: 'INVALID_CODE' } }
  }
}

export async function resendCode(body: { email?: string; locale?: string }): Promise<RouteResult> {
  if (!body.email) return { statusCode: 400, body: { error: 'MISSING_EMAIL' } }
  try {
    await getClient().send(
      new ResendConfirmationCodeCommand({
        ClientId: getClientId(),
        Username: body.email,
        ClientMetadata: localeMetadata(body.locale),
      }),
    )
    return { statusCode: 200, body: { status: 'CODE_SENT' } }
  } catch (err) {
    console.error('resendCode error:', err)
    return { statusCode: 400, body: { error: 'RESEND_FAILED' } }
  }
}

export async function forgotPassword(body: { email?: string; locale?: string }): Promise<RouteResult> {
  if (!body.email) return { statusCode: 400, body: { error: 'MISSING_EMAIL' } }
  try {
    await getClient().send(
      new ForgotPasswordCommand({
        ClientId: getClientId(),
        Username: body.email,
        ClientMetadata: localeMetadata(body.locale),
      }),
    )
    return { statusCode: 200, body: { status: 'CODE_SENT' } }
  } catch (err) {
    console.error('forgotPassword error:', err)
    return { statusCode: 400, body: { error: 'SEND_CODE_FAILED' } }
  }
}

export async function confirmForgotPassword(body: {
  email?: string
  code?: string
  newPassword?: string
}): Promise<RouteResult> {
  if (!body.email || !body.code || !body.newPassword) {
    return { statusCode: 400, body: { error: 'MISSING_FIELDS' } }
  }
  try {
    await getClient().send(
      new ConfirmForgotPasswordCommand({
        ClientId: getClientId(),
        Username: body.email,
        ConfirmationCode: body.code,
        Password: body.newPassword,
      }),
    )
    return { statusCode: 200, body: { status: 'RESET' } }
  } catch (err) {
    console.error('confirmForgotPassword error:', err)
    return { statusCode: 400, body: { error: 'RESET_PASSWORD_FAILED' } }
  }
}

/**
 * `/api/auth/session` : appelé au chargement de l'app (équivalent de l'ancien
 * `auth.init()`/`getCurrentUser()` local). `GetUserCommand` valide l'access token AUPRÈS DE
 * COGNITO à chaque appel (pas un JWT décodé localement, voir ADR-0021 §4) -- un
 * `GlobalSignOut()` antérieur fait donc échouer cet appel immédiatement, sans attendre
 * l'expiration naturelle du token. Rafraîchit une seule fois via le refresh token si l'access
 * token est expiré, avant de conclure à une session invalide.
 */
export async function getSession(cookies: string[] | undefined): Promise<RouteResult> {
  const accessToken = readCookie(cookies, ACCESS_TOKEN_COOKIE)
  if (accessToken) {
    const viaAccessToken = await tryGetUser(accessToken)
    if (viaAccessToken) return { statusCode: 200, body: { authenticated: true, user: viaAccessToken } }
  }

  const refreshed = await tryRefresh(cookies)
  if (!refreshed) {
    return {
      statusCode: 200,
      body: { authenticated: false },
      setCookies: [clearCookie(ID_TOKEN_COOKIE), clearCookie(ACCESS_TOKEN_COOKIE), clearCookie(REFRESH_TOKEN_COOKIE)],
    }
  }

  return {
    statusCode: 200,
    body: { authenticated: true, user: userFromIdToken(refreshed.IdToken!) },
    setCookies: sessionCookiesFor(refreshed),
  }
}

async function tryGetUser(accessToken: string) {
  try {
    const result = await getClient().send(new GetUserCommand({ AccessToken: accessToken }))
    const attrs = Object.fromEntries((result.UserAttributes ?? []).map((a) => [a.Name, a.Value]))
    return {
      sub: attrs.sub ?? null,
      email: attrs.email ?? null,
      name: attrs.name ?? null,
      profile: attrs.profile ?? null,
    }
  } catch {
    return null
  }
}

/**
 * Exportée : réutilisée par `graphql-proxy.ts` pour rafraîchir l'ID token quand AppSync
 * renvoie une erreur d'expiration -- même mécanique, pas de duplication.
 */
export async function tryRefresh(cookies: string[] | undefined): Promise<AuthenticationResultType | null> {
  const refreshToken = readCookie(cookies, REFRESH_TOKEN_COOKIE)
  if (!refreshToken) return null
  try {
    const result = await getClient().send(
      new InitiateAuthCommand({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: getClientId(),
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      }),
    )
    return result.AuthenticationResult ?? null
  } catch (err) {
    console.error('refresh error:', err)
    return null
  }
}

export async function signOut(cookies: string[] | undefined): Promise<RouteResult> {
  const accessToken = readCookie(cookies, ACCESS_TOKEN_COOKIE)
  if (accessToken) {
    try {
      await getClient().send(new GlobalSignOutCommand({ AccessToken: accessToken }))
    } catch (err) {
      // Best-effort (même idiome que useOwnerMissions.js/useMissionClosure.js, CLAUDE.md) :
      // un access token déjà expiré fait échouer GlobalSignOut, mais les cookies sont effacés
      // ci-dessous dans tous les cas -- la session cliente est de toute façon terminée.
      console.error('signOut GlobalSignOut error (ignoré, cookies effacés quand même):', err)
    }
  }
  return {
    statusCode: 200,
    body: { status: 'SIGNED_OUT' },
    setCookies: [clearCookie(ID_TOKEN_COOKIE), clearCookie(ACCESS_TOKEN_COOKIE), clearCookie(REFRESH_TOKEN_COOKIE)],
  }
}

export async function deleteAccount(cookies: string[] | undefined): Promise<RouteResult> {
  const accessToken = readCookie(cookies, ACCESS_TOKEN_COOKIE)
  if (!accessToken) return { statusCode: 401, body: { error: 'NOT_AUTHENTICATED' } }
  try {
    await getClient().send(new DeleteUserCommand({ AccessToken: accessToken }))
    return {
      statusCode: 200,
      body: { status: 'DELETED' },
      setCookies: [clearCookie(ID_TOKEN_COOKIE), clearCookie(ACCESS_TOKEN_COOKIE), clearCookie(REFRESH_TOKEN_COOKIE)],
    }
  } catch (err) {
    console.error('deleteAccount error:', err)
    return { statusCode: 400, body: { error: 'DELETE_ACCOUNT_FAILED' } }
  }
}

/**
 * Enrôlement/désactivation MFA TOTP (`useMfa.js`, découvert en cours de chantier -- pas dans
 * la portée initiale de docs/adr/0021-bff-cognito-session-cloudfront.md, voir son §6bis pour
 * le contexte) : `AssociateSoftwareToken`/`VerifySoftwareToken`/`SetUserMFAPreference` sont
 * des opérations Cognito authentifiées, elles ont besoin de l'ACCESS TOKEN -- structurellement
 * impossible côté navigateur maintenant qu'il ne vit plus que dans le cookie `HttpOnly` du BFF.
 * Toutes les 4 routes ci-dessous exigent donc l'access token, jamais l'ID token (qui ne sert
 * qu'au relais GraphQL, `graphql-proxy.ts`).
 */
function requireAccessToken(cookies: string[] | undefined): string | null {
  return readCookie(cookies, ACCESS_TOKEN_COOKIE) ?? null
}

export async function getMfaStatus(cookies: string[] | undefined): Promise<RouteResult> {
  const accessToken = requireAccessToken(cookies)
  if (!accessToken) return { statusCode: 401, body: { error: 'NOT_AUTHENTICATED' } }
  try {
    const result = await getClient().send(new GetUserCommand({ AccessToken: accessToken }))
    return { statusCode: 200, body: { enabled: (result.UserMFASettingList ?? []).includes('SOFTWARE_TOKEN_MFA') } }
  } catch (err) {
    console.error('getMfaStatus error:', err)
    return { statusCode: 400, body: { error: 'MFA_STATUS_FAILED' } }
  }
}

export async function startMfaSetup(cookies: string[] | undefined): Promise<RouteResult> {
  const accessToken = requireAccessToken(cookies)
  if (!accessToken) return { statusCode: 401, body: { error: 'NOT_AUTHENTICATED' } }
  try {
    const result = await getClient().send(new AssociateSoftwareTokenCommand({ AccessToken: accessToken }))
    if (!result.SecretCode) return { statusCode: 500, body: { error: 'MFA_SETUP_FAILED' } }
    return { statusCode: 200, body: { secretCode: result.SecretCode } }
  } catch (err) {
    console.error('startMfaSetup error:', err)
    return { statusCode: 400, body: { error: 'MFA_SETUP_FAILED' } }
  }
}

export async function confirmMfaSetup(
  body: { code?: string },
  cookies: string[] | undefined,
): Promise<RouteResult> {
  const accessToken = requireAccessToken(cookies)
  if (!accessToken) return { statusCode: 401, body: { error: 'NOT_AUTHENTICATED' } }
  if (!body.code) return { statusCode: 400, body: { error: 'MISSING_CODE' } }
  try {
    const verifyResult = await getClient().send(
      new VerifySoftwareTokenCommand({ AccessToken: accessToken, UserCode: body.code }),
    )
    if (verifyResult.Status !== 'SUCCESS') {
      return { statusCode: 400, body: { error: 'MFA_VERIFICATION_FAILED' } }
    }
    // `VerifySoftwareTokenCommand` associe seulement le token logiciel côté Cognito -- sans ce
    // second appel, TOTP resterait associé mais jamais réellement actif comme facteur de
    // connexion (même raisonnement que l'ancien `updateMFAPreference({ totp: 'PREFERRED' })`
    // côté client, avant ce chantier).
    await getClient().send(
      new SetUserMFAPreferenceCommand({
        AccessToken: accessToken,
        SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
      }),
    )
    return { statusCode: 200, body: { status: 'ENABLED' } }
  } catch (err) {
    console.error('confirmMfaSetup error:', err)
    return { statusCode: 400, body: { error: 'MFA_VERIFICATION_FAILED' } }
  }
}

export async function disableMfa(cookies: string[] | undefined): Promise<RouteResult> {
  const accessToken = requireAccessToken(cookies)
  if (!accessToken) return { statusCode: 401, body: { error: 'NOT_AUTHENTICATED' } }
  try {
    await getClient().send(
      new SetUserMFAPreferenceCommand({
        AccessToken: accessToken,
        SoftwareTokenMfaSettings: { Enabled: false },
      }),
    )
    return { statusCode: 200, body: { status: 'DISABLED' } }
  } catch (err) {
    console.error('disableMfa error:', err)
    return { statusCode: 400, body: { error: 'MFA_DISABLE_FAILED' } }
  }
}
