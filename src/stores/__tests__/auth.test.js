import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// BFF Cognito (2026-09-06, docs/adr/0021-bff-cognito-session-cloudfront.md) : ce store ne
// parle plus à `aws-amplify/auth` du tout -- chaque fonction fait un `fetch()` vers une route
// `/api/auth/*` du BFF. Ce fichier remplace intégralement la couverture précédente (qui ne
// testait que le correctif `UsernameExistsException` de PR #59, désormais tranché côté BFF,
// voir `register()` ci-dessous) : couvre le nouveau mécanisme fetch pour chaque fonction.

vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import router from '@/router'
import i18n from '@/i18n'
import { useAuthStore } from '@/stores/auth'

const fetchMock = vi.fn()

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  vi.mocked(router.push).mockReset()
  // Locale déterministe pour les assertions de body qui incluent `locale` (register/forgotPass,
  // docs/adr/0022-branded-transactional-emails.md) : jsdom expose `navigator.language` en
  // 'en-US' par défaut, ce qui ferait retomber `src/i18n.js` sur 'en' sans ce reset explicite --
  // même idiome que `StarRating.test.js`/`useLegalDocument.test.js`.
  i18n.global.locale.value = 'fr'
})

describe('login', () => {
  it('SIGNED_IN : peuple user, redirige selon le rôle', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        status: 'SIGNED_IN',
        user: { sub: 'owner-1', email: 'a@b.com', name: 'Jean', profile: 'owner' },
      }),
    )

    const auth = useAuthStore()
    await auth.login('a@b.com', 'Password123!')

    expect(auth.isAuthenticated).toBe(true)
    expect(auth.user.username).toBe('owner-1')
    expect(auth.user.attributes).toEqual({ email: 'a@b.com', name: 'Jean', profile: 'owner' })
    expect(router.push).toHaveBeenCalledWith('/dashboard/profile')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/signin',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ email: 'a@b.com', password: 'Password123!' }),
      }),
    )
  })

  it('CONFIRM_SIGN_UP : redirige vers verify-email, ne peuple pas user', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'CONFIRM_SIGN_UP' }))

    const auth = useAuthStore()
    await auth.login('a@b.com', 'Password123!')

    expect(auth.isAuthenticated).toBe(false)
    expect(router.push).toHaveBeenCalledWith({ name: 'verify-email', query: { email: 'a@b.com' } })
  })

  it('CONFIRM_SIGN_IN_WITH_TOTP_CODE : redirige vers verify-mfa', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' }))

    const auth = useAuthStore()
    await auth.login('a@b.com', 'Password123!')

    expect(router.push).toHaveBeenCalledWith({ name: 'verify-mfa', query: { email: 'a@b.com' } })
  })

  it('identifiants invalides (401) : error posé, aucune redirection', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'SIGN_IN_FAILED' }))

    const auth = useAuthStore()
    await auth.login('a@b.com', 'wrong')

    expect(auth.error).toBe('errors.login_failed')
    expect(router.push).not.toHaveBeenCalled()
  })
})

describe('confirmMfaChallenge', () => {
  it('succès : peuple user, redirige, renvoie true', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { status: 'SIGNED_IN', user: { sub: 'vet-1', profile: 'vet' } }),
    )

    const auth = useAuthStore()
    const result = await auth.confirmMfaChallenge('123456')

    expect(result).toBe(true)
    expect(auth.currentRole).toBe('vet')
    expect(router.push).toHaveBeenCalledWith('/dashboard/requests')
  })

  it('code invalide : renvoie false, error posé', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'MFA_CHALLENGE_FAILED' }))

    const auth = useAuthStore()
    const result = await auth.confirmMfaChallenge('000000')

    expect(result).toBe(false)
    expect(auth.error).toBe('errors.mfa_challenge_failed')
  })
})

describe('register', () => {
  it('CONFIRM_SIGN_UP : renvoie true', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'CONFIRM_SIGN_UP' }))

    const auth = useAuthStore()
    await expect(auth.register('a@b.com', 'Password123!', 'Jean', 'owner')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/signup',
      expect.objectContaining({
        body: JSON.stringify({
          email: 'a@b.com',
          password: 'Password123!',
          name: 'Jean',
          role: 'owner',
          locale: 'fr',
        }),
      }),
    )
  })

  it('CONFIRM_SIGN_UP_RESUMED (inscription abandonnée reprise côté BFF) : renvoie true aussi', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'CONFIRM_SIGN_UP_RESUMED' }))

    const auth = useAuthStore()
    await expect(auth.register('a@b.com', 'Password123!', 'Jean', 'owner')).resolves.toBe(true)
  })

  it('USERNAME_EXISTS (409, compte déjà confirmé) : redirige vers /login, renvoie false', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'USERNAME_EXISTS' }))

    const auth = useAuthStore()
    const result = await auth.register('a@b.com', 'Password123!', 'Jean', 'owner')

    expect(result).toBe(false)
    expect(auth.error).toBe('errors.email_exists')
    expect(router.push).toHaveBeenCalledWith('/login?email=a%40b.com')
  })
})

describe('forgotPass', () => {
  it('transmet la locale courante au BFF (docs/adr/0022-branded-transactional-emails.md)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'CODE_SENT' }))

    const auth = useAuthStore()
    await expect(auth.forgotPass('a@b.com')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/forgot-password',
      expect.objectContaining({
        body: JSON.stringify({ email: 'a@b.com', locale: 'fr' }),
      }),
    )
  })

  it('échec : error posé, renvoie false', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'SEND_CODE_FAILED' }))

    const auth = useAuthStore()
    await expect(auth.forgotPass('a@b.com')).resolves.toBe(false)
    expect(auth.error).toBe('errors.send_code_failed')
  })
})

describe('confirmRegistration', () => {
  it('succès : ne lève pas', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'CONFIRMED' }))

    const auth = useAuthStore()
    await expect(auth.confirmRegistration('a@b.com', '123456')).resolves.toBeUndefined()
  })

  it('code invalide : relance (propage) une erreur, contrat attendu par VerifyEmailView.vue', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'INVALID_CODE' }))

    const auth = useAuthStore()
    await expect(auth.confirmRegistration('a@b.com', '000000')).rejects.toThrow()
    expect(auth.error).toBe('errors.invalid_code')
  })
})

describe('logout', () => {
  it('efface user, redirige vers /login, même si le fetch échoue (best-effort)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    const auth = useAuthStore()
    auth.user = { username: 'owner-1', attributes: {} }
    await auth.logout()

    expect(auth.user).toBeNull()
    expect(router.push).toHaveBeenCalledWith('/login')
  })
})

describe('deleteAccount', () => {
  it('succès : efface user, redirige, renvoie true', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'DELETED' }))

    const auth = useAuthStore()
    auth.user = { username: 'owner-1', attributes: {} }
    const result = await auth.deleteAccount()

    expect(result).toBe(true)
    expect(auth.user).toBeNull()
    expect(router.push).toHaveBeenCalledWith('/login')
  })

  it('échec : renvoie false, error posé, ne redirige pas', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'DELETE_ACCOUNT_FAILED' }))

    const auth = useAuthStore()
    const result = await auth.deleteAccount()

    expect(result).toBe(false)
    expect(auth.error).toBe('errors.delete_account_failed')
    expect(router.push).not.toHaveBeenCalled()
  })
})

describe('init', () => {
  it('session active : peuple user depuis GET /api/auth/session', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { authenticated: true, user: { sub: 'owner-1', profile: 'owner' } }),
    )

    const auth = useAuthStore()
    await auth.init()

    expect(auth.isAuthenticated).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', { credentials: 'include' })
  })

  it('pas de session : user reste null', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { authenticated: false }))

    const auth = useAuthStore()
    await auth.init()

    expect(auth.isAuthenticated).toBe(false)
  })
})
