import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Correctif (2026-09-06) : `register()` redirigeait TOUJOURS vers /login sur
// `UsernameExistsException`, y compris pour une inscription abandonnée jamais confirmée
// (l'utilisateur ferme VerifyEmailView.vue avant d'entrer son code). Ce pool Cognito
// utilisant l'email comme username, ce cas est indiscernable d'un email déjà confirmé
// sans un appel supplémentaire -- `resendSignUpCode` (sans mot de passe) permet de
// distinguer les deux : succès = inscription non confirmée à reprendre, échec = compte
// déjà confirmé, /login reste le bon endroit. Ce fichier couvre les 3 branches de
// `register()` sur cette erreur (voir stores/auth.js pour le raisonnement complet).

const signUpMock = vi.fn()
const resendSignUpCodeMock = vi.fn()
const routerPushMock = vi.fn()

vi.mock('aws-amplify/auth', () => ({
  signIn: vi.fn(),
  signUp: (...args) => signUpMock(...args),
  signOut: vi.fn(),
  confirmSignUp: vi.fn(),
  confirmSignIn: vi.fn(),
  getCurrentUser: vi.fn(),
  fetchUserAttributes: vi.fn(),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
  deleteUser: vi.fn(),
  resendSignUpCode: (...args) => resendSignUpCodeMock(...args),
}))

vi.mock('@/router', () => ({
  default: { push: (...args) => routerPushMock(...args) },
}))

import { useAuthStore } from '@/stores/auth'

beforeEach(() => {
  setActivePinia(createPinia())
  signUpMock.mockReset()
  resendSignUpCodeMock.mockReset()
  routerPushMock.mockReset()
})

describe('useAuthStore().register() — UsernameExistsException', () => {
  it('reprend le flux de vérification si le compte existant est non confirmé (resend réussit)', async () => {
    const usernameExistsError = Object.assign(new Error('already exists'), {
      name: 'UsernameExistsException',
    })
    signUpMock.mockRejectedValue(usernameExistsError)
    resendSignUpCodeMock.mockResolvedValue({})

    const auth = useAuthStore()
    const result = await auth.register('jean@example.com', 'Password123!', 'Jean', 'owner')

    expect(result).toBe(false)
    expect(resendSignUpCodeMock).toHaveBeenCalledWith({ username: 'jean@example.com' })
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'verify-email',
      query: { email: 'jean@example.com' },
    })
    expect(auth.error).toBe('errors.registration_resumed')
  })

  it('redirige vers /login si le compte existant est déjà confirmé (resend échoue)', async () => {
    const usernameExistsError = Object.assign(new Error('already exists'), {
      name: 'UsernameExistsException',
    })
    signUpMock.mockRejectedValue(usernameExistsError)
    resendSignUpCodeMock.mockRejectedValue(
      Object.assign(new Error('already confirmed'), { name: 'InvalidParameterException' }),
    )

    const auth = useAuthStore()
    const result = await auth.register('jean@example.com', 'Password123!', 'Jean', 'owner')

    expect(result).toBe(false)
    expect(routerPushMock).toHaveBeenCalledWith('/login?email=jean%40example.com')
    expect(auth.error).toBe('errors.email_exists')
  })

  it('ne tente pas resendSignUpCode sur une autre erreur signUp', async () => {
    signUpMock.mockRejectedValue(new Error('network down'))

    const auth = useAuthStore()
    const result = await auth.register('jean@example.com', 'Password123!', 'Jean', 'owner')

    expect(result).toBe(false)
    expect(resendSignUpCodeMock).not.toHaveBeenCalled()
    expect(routerPushMock).not.toHaveBeenCalled()
    expect(auth.error).toBe('errors.registration_failed')
  })
})
