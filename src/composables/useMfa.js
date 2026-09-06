import { ref } from 'vue'
import { bffFetch } from '@/services/bff-fetch'

/**
 * BFF Cognito (2026-09-06, docs/adr/0021-bff-cognito-session-cloudfront.md §6bis) :
 * `setUpTOTP`/`verifyTOTPSetup`/`updateMFAPreference`/`fetchMFAPreference` (`aws-amplify/auth`)
 * sont des opérations Cognito authentifiées -- besoin de l'access token, qui ne vit plus que
 * dans le cookie `HttpOnly` du BFF (`amplify/functions/bff/auth-routes.ts`,
 * `getMfaStatus`/`startMfaSetup`/`confirmMfaSetup`/`disableMfa`). Ce composable appelle ces 4
 * routes via `bffFetch()` (`src/services/bff-fetch.js`), jamais le SDK Cognito directement.
 */

/**
 * Même format que l'ancien `details.getSetupUri(appName, accountName)` d'Amplify (repris à
 * l'identique -- `node_modules/aws-amplify/.../providers/cognito/utils/signInHelpers.mjs`,
 * `getTOTPSetupDetails`, AUCUN encodage d'URL appliqué côté Amplify non plus) : le contenu du
 * QR code affiché à l'utilisateur reste rigoureusement inchangé par ce chantier.
 */
function buildTotpUri(secretCode, appName, accountName) {
  return `otpauth://totp/${appName}:${accountName}?secret=${secretCode}&issuer=${appName}`
}

// Durcissement sécurité (audit Cognito/API, 2026-09-02, Groupe 4) : enrôlement/désactivation
// TOTP, disponible aux deux rôles (Owner/Vet) -- consommé par un composant partagé
// (MfaSettings.vue) plutôt que dupliqué dans SettingsView.vue (clinic) et ProfileView.vue
// (owner), aucune des deux logiques n'étant spécifique à un rôle.
export function useMfa() {
  const isLoading = ref(false)
  const error = ref(null)
  const isEnabled = ref(false)
  const setupDetails = ref(null)

  async function fetchStatus() {
    isLoading.value = true
    error.value = null
    try {
      const { ok, data } = await bffFetch('/api/auth/mfa/status', { method: 'GET' })
      if (!ok) throw new Error(data.error ?? 'MFA_STATUS_FAILED')
      isEnabled.value = !!data.enabled
    } catch (err) {
      console.error(err)
      error.value = 'errors.mfa_status_failed'
    } finally {
      isLoading.value = false
    }
  }

  async function startEnrollment(accountName) {
    isLoading.value = true
    error.value = null
    try {
      const { ok, data } = await bffFetch('/api/auth/mfa/setup')
      if (!ok) throw new Error(data.error ?? 'MFA_SETUP_FAILED')
      setupDetails.value = {
        sharedSecret: data.secretCode,
        uri: buildTotpUri(data.secretCode, 'Redlink', accountName),
      }
      return true
    } catch (err) {
      console.error(err)
      error.value = 'errors.mfa_setup_failed'
      return false
    } finally {
      isLoading.value = false
    }
  }

  function cancelEnrollment() {
    setupDetails.value = null
  }

  async function confirmEnrollment(code) {
    isLoading.value = true
    error.value = null
    try {
      const { ok, data } = await bffFetch('/api/auth/mfa/verify', { body: { code } })
      if (!ok) throw new Error(data.error ?? 'MFA_VERIFICATION_FAILED')
      isEnabled.value = true
      setupDetails.value = null
      return true
    } catch (err) {
      console.error(err)
      error.value = 'errors.mfa_verification_failed'
      return false
    } finally {
      isLoading.value = false
    }
  }

  async function disable() {
    isLoading.value = true
    error.value = null
    try {
      const { ok, data } = await bffFetch('/api/auth/mfa/disable')
      if (!ok) throw new Error(data.error ?? 'MFA_DISABLE_FAILED')
      isEnabled.value = false
      return true
    } catch (err) {
      console.error(err)
      error.value = 'errors.mfa_disable_failed'
      return false
    } finally {
      isLoading.value = false
    }
  }

  return {
    isLoading,
    error,
    isEnabled,
    setupDetails,
    fetchStatus,
    startEnrollment,
    cancelEnrollment,
    confirmEnrollment,
    disable,
  }
}
