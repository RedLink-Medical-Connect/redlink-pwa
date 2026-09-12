import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import router from '@/router'
import i18n from '@/i18n'
import { bffFetch } from '@/services/bff-fetch'

/**
 * BFF Cognito (2026-09-06, docs/adr/0021-bff-cognito-session-cloudfront.md) : ce store ne
 * parle PLUS DU TOUT à `aws-amplify/auth` -- toute la session Cognito (ID/Access/Refresh
 * token) vit exclusivement côté Lambda BFF (`amplify/functions/bff/`), dans des cookies
 * `HttpOnly`/`Secure`/`SameSite=Strict` que ce code ne lit ni n'écrit jamais directement
 * (le navigateur les gère seul, invisibles en JS -- c'est tout l'objectif). Chaque fonction
 * ci-dessous appelle une route `/api/auth/*` du BFF via `bffFetch()`
 * (`src/services/bff-fetch.js`, `credentials: 'include'` pour que le navigateur attache/
 * reçoive ces cookies -- même same-origin, CloudFront devant SPA et BFF, ADR-0021 §2).
 */

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const isLoading = ref(false)
  const error = ref(null)
  const role = ref('owner')

  const isAuthenticated = computed(() => !!user.value)

  const currentRole = computed(() => {
    if (user.value?.attributes?.profile) {
      return user.value.attributes.profile
    }
    return role.value
  })
  const tempRegistrationData = ref(null)

  function setTempRegistrationData(data) {
    tempRegistrationData.value = data
  }

  function clearTempRegistrationData() {
    tempRegistrationData.value = null
  }

  /**
   * Même forme que l'ancien `user.value = { ...currentUser, attributes }` (via
   * `getCurrentUser()`/`fetchUserAttributes()` d'`aws-amplify/auth`) : `AppHeader.vue`
   * (`auth.user?.attributes?.name`/`auth.user?.username`) et `currentRole` ci-dessus
   * (`auth.user?.attributes?.profile`) restent inchangés, seule la source de la donnée change.
   */
  function setUserFromSession(sessionUser) {
    user.value = {
      username: sessionUser.sub,
      userId: sessionUser.sub,
      attributes: {
        email: sessionUser.email,
        name: sessionUser.name,
        profile: sessionUser.profile,
      },
    }
  }

  async function init() {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'include' })
      const data = await response.json()
      if (data.authenticated) {
        setUserFromSession(data.user)
      } else {
        user.value = null
      }
    } catch {
      user.value = null
    }
  }

  async function redirectAfterLogin() {
    if (currentRole.value === 'vet') {
      await router.push('/dashboard/requests')
    } else if (currentRole.value === 'owner') {
      await router.push('/dashboard/profile')
    } else {
      await router.push('/')
    }
  }

  async function redirectIfUnconfirmed(status, email) {
    if (status === 'CONFIRM_SIGN_UP') {
      await router.push({ name: 'verify-email', query: { email } })
      return true
    }
    return false
  }

  async function redirectIfMfaRequired(status, email) {
    if (status === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
      await router.push({ name: 'verify-mfa', query: { email } })
      return true
    }
    return false
  }

  async function login(email, password) {
    isLoading.value = true
    error.value = null
    try {
      const { ok, data } = await bffFetch('/api/auth/signin', { body: { email, password } })
      if (!ok) {
        error.value = `errors.login_failed`
        return
      }
      if (data.status === 'SIGNED_IN') {
        setUserFromSession(data.user)
        await redirectAfterLogin()
      } else if (await redirectIfUnconfirmed(data.status, email)) {
        return
      } else if (await redirectIfMfaRequired(data.status, email)) {
        return
      }
    } catch (err) {
      console.error(err)
      error.value = `errors.login_failed`
    } finally {
      isLoading.value = false
    }
  }

  async function confirmMfaChallenge(code) {
    isLoading.value = true
    error.value = null
    try {
      const { ok, data } = await bffFetch('/api/auth/confirm-signin', { body: { code } })
      if (ok && data.status === 'SIGNED_IN') {
        setUserFromSession(data.user)
        await redirectAfterLogin()
        return true
      }
      error.value = `errors.mfa_challenge_failed`
      return false
    } catch (err) {
      console.error(err)
      error.value = `errors.mfa_challenge_failed`
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * `CONFIRM_SIGN_UP_RESUMED` (2026-09-06, remplace le correctif posé directement dans ce
   * fichier le même jour, PR #59) : la distinction "compte non confirmé (reprise directe)"
   * vs "compte déjà confirmé (redirection /login)" est désormais tranchée côté BFF
   * (`amplify/functions/bff/auth-routes.ts`, `signUp()` -- `resendConfirmationCode` y est
   * tenté avant de répondre) puisque c'est lui qui a accès au SDK Cognito. Ce store se
   * contente d'interpréter le statut renvoyé, sans dupliquer cette logique.
   */
  async function register(email, password, name, roleType) {
    isLoading.value = true
    error.value = null
    try {
      const { status, data } = await bffFetch('/api/auth/signup', {
        body: { email, password, name, role: roleType, locale: i18n.global.locale.value },
      })

      if (data.status === 'CONFIRM_SIGN_UP' || data.status === 'CONFIRM_SIGN_UP_RESUMED') {
        return true
      }

      if (status === 409 && data.error === 'USERNAME_EXISTS') {
        error.value = `errors.email_exists`
        await router.push(`/login?email=${encodeURIComponent(email)}`)
        return false
      }

      error.value = `errors.registration_failed`
      return false
    } catch (err) {
      console.error(err)
      error.value = `errors.registration_failed`
      return false
    } finally {
      isLoading.value = false
    }
  }

  async function confirmRegistration(email, code) {
    isLoading.value = true
    error.value = null
    try {
      const { ok, data } = await bffFetch('/api/auth/confirm-signup', { body: { email, code } })
      if (!ok) {
        error.value = `errors.invalid_code`
        throw new Error(data.error ?? 'INVALID_CODE')
      }
    } finally {
      isLoading.value = false
    }
  }

  async function forgotPass(email) {
    isLoading.value = true
    error.value = null
    try {
      const { ok } = await bffFetch('/api/auth/forgot-password', {
        body: { email, locale: i18n.global.locale.value },
      })
      if (!ok) {
        error.value = `errors.send_code_failed`
        return false
      }
      return true
    } catch (err) {
      console.error(err)
      error.value = `errors.send_code_failed`
      return false
    } finally {
      isLoading.value = false
    }
  }

  async function resetPassSubmit(email, code, newPassword) {
    isLoading.value = true
    error.value = null
    try {
      const { ok } = await bffFetch('/api/auth/confirm-forgot-password', {
        body: { email, code, newPassword },
      })
      if (ok) {
        router.push('/login')
      } else {
        error.value = `errors.reset_password_failed`
      }
    } catch (err) {
      console.error(err)
      error.value = `errors.reset_password_failed`
    } finally {
      isLoading.value = false
    }
  }

  async function logout() {
    try {
      await bffFetch('/api/auth/signout')
    } catch (err) {
      console.error(err)
    }
    user.value = null
    role.value = 'guest'
    await router.push('/login')
  }

  async function deleteAccount() {
    isLoading.value = true
    try {
      const { ok } = await bffFetch('/api/auth/delete-account')
      if (!ok) {
        error.value = `errors.delete_account_failed`
        return false
      }
      user.value = null
      await router.push('/login')
      return true
    } catch (err) {
      console.error(err)
      error.value = `errors.delete_account_failed`
      return false
    } finally {
      isLoading.value = false
    }
  }

  function clearError() {
    error.value = null
  }

  function setError(errorMessage) {
    error.value = errorMessage
  }

  return {
    user,
    role,
    currentRole,
    isLoading,
    error,
    isAuthenticated,
    init,
    login,
    register,
    confirmRegistration,
    confirmMfaChallenge,
    logout,
    forgotPass,
    resetPassSubmit,
    deleteAccount,
    clearError,
    setError,
    clearTempRegistrationData,
    setTempRegistrationData,
  }
})
