import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
  ResendConfirmationCodeCommand,
  GetUserCommand,
  GlobalSignOutCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import * as authRoutes from './auth-routes'
import { ID_TOKEN_COOKIE, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, MFA_SESSION_COOKIE } from './cookies'

// Même pattern que post-confirmation/handler.test.ts et rating-aggregation/handler.test.ts :
// on stubbe `CognitoIdentityProviderClient.prototype.send` directement plutôt que `vi.mock` du
// module SDK entier.
const sendSpy = vi.spyOn(CognitoIdentityProviderClient.prototype, 'send')

afterAll(() => {
  sendSpy.mockRestore()
})

beforeEach(() => {
  sendSpy.mockReset()
  process.env.COGNITO_USER_POOL_CLIENT_ID = 'client-123'
})

// JWT minimal (header.payload.signature, signature jamais vérifiée par ce code -- voir le
// commentaire de `decodeIdTokenClaims` dans auth-routes.ts) : seul le payload compte pour ces
// tests.
function fakeJwt(payload: Record<string, unknown>) {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.signature`
}

describe('signIn', () => {
  it('renvoie 400 si email/mot de passe manque', async () => {
    const result = await authRoutes.signIn({ email: 'a@b.com' })
    expect(result.statusCode).toBe(400)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('connexion réussie sans challenge : pose les 3 cookies de session, renvoie le user décodé', async () => {
    const idToken = fakeJwt({ sub: 'user-1', email: 'a@b.com', name: 'Jean', profile: 'owner' })
    sendSpy.mockResolvedValue({
      AuthenticationResult: { IdToken: idToken, AccessToken: 'access-1', RefreshToken: 'refresh-1' },
    } as never)

    const result = await authRoutes.signIn({ email: 'a@b.com', password: 'Password123!' })

    expect(result.statusCode).toBe(200)
    expect(result.body).toEqual({
      status: 'SIGNED_IN',
      user: { sub: 'user-1', email: 'a@b.com', name: 'Jean', profile: 'owner' },
    })
    expect(result.setCookies).toHaveLength(3)
    expect(result.setCookies!.some((c) => c.startsWith(`${ID_TOKEN_COOKIE}=${idToken}`))).toBe(true)
    expect(result.setCookies!.some((c) => c.startsWith(`${ACCESS_TOKEN_COOKIE}=access-1`))).toBe(true)
    expect(result.setCookies!.some((c) => c.startsWith(`${REFRESH_TOKEN_COOKIE}=refresh-1`))).toBe(true)

    const [command] = sendSpy.mock.calls[0]
    expect(command).toBeInstanceOf(InitiateAuthCommand)
    expect(command.input).toMatchObject({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: 'client-123' })
  })

  it('challenge MFA TOTP : ne pose que le cookie de session MFA (jamais de tokens)', async () => {
    sendSpy.mockResolvedValue({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'mfa-session-abc' } as never)

    const result = await authRoutes.signIn({ email: 'a@b.com', password: 'Password123!' })

    expect(result.statusCode).toBe(200)
    expect(result.body).toEqual({ status: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' })
    expect(result.setCookies).toEqual([expect.stringContaining(`${MFA_SESSION_COOKIE}=mfa-session-abc`)])
  })

  it('compte non confirmé : renvoie CONFIRM_SIGN_UP plutôt qu\'un 401 brut', async () => {
    sendSpy.mockRejectedValue(Object.assign(new Error('not confirmed'), { name: 'UserNotConfirmedException' }))

    const result = await authRoutes.signIn({ email: 'a@b.com', password: 'Password123!' })

    expect(result).toEqual({ statusCode: 200, body: { status: 'CONFIRM_SIGN_UP' } })
  })

  it('identifiants invalides : 401, jamais de cookie posé', async () => {
    sendSpy.mockRejectedValue(new Error('bad credentials'))

    const result = await authRoutes.signIn({ email: 'a@b.com', password: 'wrong' })

    expect(result.statusCode).toBe(401)
    expect(result.setCookies).toBeUndefined()
  })
})

describe('confirmSignIn (challenge MFA)', () => {
  it('renvoie 400 si le code ou le cookie de session MFA manque', async () => {
    const result = await authRoutes.confirmSignIn({}, undefined)
    expect(result.statusCode).toBe(400)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('succès : pose les cookies de session ET efface le cookie de session MFA', async () => {
    const mfaSession = fakeJwt({ username: 'user-1' })
    const idToken = fakeJwt({ sub: 'user-1', email: 'a@b.com' })
    sendSpy.mockResolvedValue({
      AuthenticationResult: { IdToken: idToken, AccessToken: 'access-1', RefreshToken: 'refresh-1' },
    } as never)

    const result = await authRoutes.confirmSignIn({ code: '123456' }, [`${MFA_SESSION_COOKIE}=${mfaSession}`])

    expect(result.statusCode).toBe(200)
    expect(result.setCookies).toContainEqual(expect.stringMatching(new RegExp(`^${MFA_SESSION_COOKIE}=; .*Max-Age=0`)))

    const [command] = sendSpy.mock.calls[0]
    expect(command).toBeInstanceOf(RespondToAuthChallengeCommand)
    expect(command.input).toMatchObject({
      ChallengeName: 'SOFTWARE_TOKEN_MFA',
      Session: mfaSession,
      ChallengeResponses: { USERNAME: 'user-1', SOFTWARE_TOKEN_MFA_CODE: '123456' },
    })
  })
})

describe('signUp', () => {
  it('email déjà utilisé mais non confirmé : renvoie CONFIRM_SIGN_UP_RESUMED après un resend réussi', async () => {
    sendSpy.mockImplementation(async (command) => {
      if (command instanceof SignUpCommand) {
        throw Object.assign(new Error('exists'), { name: 'UsernameExistsException' })
      }
      if (command instanceof ResendConfirmationCodeCommand) {
        return {} as never
      }
      throw new Error('unexpected command in test')
    })

    const result = await authRoutes.signUp({ email: 'a@b.com', password: 'Password123!' })

    expect(result).toEqual({ statusCode: 200, body: { status: 'CONFIRM_SIGN_UP_RESUMED' } })
  })

  it('email déjà utilisé et déjà confirmé (resend échoue) : 409 USERNAME_EXISTS', async () => {
    sendSpy.mockImplementation(async (command) => {
      if (command instanceof SignUpCommand) {
        throw Object.assign(new Error('exists'), { name: 'UsernameExistsException' })
      }
      throw Object.assign(new Error('already confirmed'), { name: 'InvalidParameterException' })
    })

    const result = await authRoutes.signUp({ email: 'a@b.com', password: 'Password123!' })

    expect(result).toEqual({ statusCode: 409, body: { error: 'USERNAME_EXISTS' } })
  })
})

describe('getSession', () => {
  it("access token valide : authenticated true, ne tente jamais de rafraîchir", async () => {
    sendSpy.mockResolvedValue({
      UserAttributes: [
        { Name: 'sub', Value: 'user-1' },
        { Name: 'email', Value: 'a@b.com' },
      ],
    } as never)

    const result = await authRoutes.getSession([`${ACCESS_TOKEN_COOKIE}=access-1`])

    expect(result.body).toEqual({ authenticated: true, user: { sub: 'user-1', email: 'a@b.com', name: null, profile: null } })
    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy.mock.calls[0][0]).toBeInstanceOf(GetUserCommand)
  })

  it('access token absent/expiré, refresh token valide : rafraîchit et repose les cookies', async () => {
    const idToken = fakeJwt({ sub: 'user-1', email: 'a@b.com' })
    sendSpy.mockImplementation(async (command) => {
      if (command instanceof InitiateAuthCommand) {
        return { AuthenticationResult: { IdToken: idToken, AccessToken: 'access-2' } } as never
      }
      throw new Error('unexpected command')
    })

    const result = await authRoutes.getSession([`${REFRESH_TOKEN_COOKIE}=refresh-1`])

    expect(result.body).toEqual({ authenticated: true, user: { sub: 'user-1', email: 'a@b.com', name: null, profile: null } })
    expect(result.setCookies).toBeDefined()
  })

  it('ni access token ni refresh token valide : authenticated false, efface tous les cookies', async () => {
    sendSpy.mockRejectedValue(new Error('invalid'))

    const result = await authRoutes.getSession(undefined)

    expect(result.body).toEqual({ authenticated: false })
    expect(result.setCookies).toHaveLength(3)
  })
})

describe('signOut', () => {
  it("efface les 3 cookies même si GlobalSignOut échoue (best-effort, comme useOwnerMissions.js)", async () => {
    sendSpy.mockRejectedValue(new Error('access token already expired'))

    const result = await authRoutes.signOut([`${ACCESS_TOKEN_COOKIE}=access-1`])

    expect(result.statusCode).toBe(200)
    expect(result.setCookies).toHaveLength(3)
    expect(sendSpy.mock.calls[0][0]).toBeInstanceOf(GlobalSignOutCommand)
  })

  it("n'appelle pas GlobalSignOut sans access token, efface quand même les cookies", async () => {
    const result = await authRoutes.signOut(undefined)

    expect(sendSpy).not.toHaveBeenCalled()
    expect(result.setCookies).toHaveLength(3)
  })
})

describe('MFA TOTP (enrôlement/désactivation)', () => {
  it('getMfaStatus : 401 sans access token, jamais d\'appel SDK', async () => {
    const result = await authRoutes.getMfaStatus(undefined)
    expect(result.statusCode).toBe(401)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('getMfaStatus : enabled true seulement si SOFTWARE_TOKEN_MFA est dans UserMFASettingList', async () => {
    sendSpy.mockResolvedValue({ UserMFASettingList: ['SOFTWARE_TOKEN_MFA'] } as never)
    const result = await authRoutes.getMfaStatus([`${ACCESS_TOKEN_COOKIE}=access-1`])
    expect(result.body).toEqual({ enabled: true })
  })

  it('getMfaStatus : enabled false si la liste est vide ou absente', async () => {
    sendSpy.mockResolvedValue({} as never)
    const result = await authRoutes.getMfaStatus([`${ACCESS_TOKEN_COOKIE}=access-1`])
    expect(result.body).toEqual({ enabled: false })
  })

  it('startMfaSetup : renvoie le secretCode, requiert un access token', async () => {
    sendSpy.mockResolvedValue({ SecretCode: 'JBSWY3DPEHPK3PXP' } as never)
    const result = await authRoutes.startMfaSetup([`${ACCESS_TOKEN_COOKIE}=access-1`])
    expect(result).toEqual({ statusCode: 200, body: { secretCode: 'JBSWY3DPEHPK3PXP' } })
    expect(sendSpy.mock.calls[0][0]).toBeInstanceOf(AssociateSoftwareTokenCommand)
  })

  it('confirmMfaSetup : succès pose la préférence MFA à PREFERRED après vérification', async () => {
    sendSpy.mockImplementation(async (command) => {
      if (command instanceof VerifySoftwareTokenCommand) return { Status: 'SUCCESS' } as never
      if (command instanceof SetUserMFAPreferenceCommand) return {} as never
      throw new Error('unexpected command')
    })

    const result = await authRoutes.confirmMfaSetup({ code: '123456' }, [`${ACCESS_TOKEN_COOKIE}=access-1`])

    expect(result).toEqual({ statusCode: 200, body: { status: 'ENABLED' } })
    expect(sendSpy).toHaveBeenCalledTimes(2)
    const [, setPrefCommand] = sendSpy.mock.calls
    expect(setPrefCommand[0].input).toMatchObject({
      SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
    })
  })

  it('confirmMfaSetup : code invalide (Status != SUCCESS) ne pose jamais la préférence MFA', async () => {
    sendSpy.mockResolvedValue({ Status: 'ERROR' } as never)
    const result = await authRoutes.confirmMfaSetup({ code: '000000' }, [`${ACCESS_TOKEN_COOKIE}=access-1`])
    expect(result).toEqual({ statusCode: 400, body: { error: 'MFA_VERIFICATION_FAILED' } })
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })

  it('disableMfa : pose la préférence MFA à Enabled: false', async () => {
    sendSpy.mockResolvedValue({} as never)
    const result = await authRoutes.disableMfa([`${ACCESS_TOKEN_COOKIE}=access-1`])
    expect(result).toEqual({ statusCode: 200, body: { status: 'DISABLED' } })
    expect(sendSpy.mock.calls[0][0]).toBeInstanceOf(SetUserMFAPreferenceCommand)
    expect(sendSpy.mock.calls[0][0].input).toMatchObject({ SoftwareTokenMfaSettings: { Enabled: false } })
  })
})
