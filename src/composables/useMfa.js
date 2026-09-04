import { ref } from 'vue'
import {
  setUpTOTP,
  verifyTOTPSetup,
  updateMFAPreference,
  fetchMFAPreference,
} from 'aws-amplify/auth'

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
      const { enabled } = await fetchMFAPreference()
      isEnabled.value = !!enabled?.includes('TOTP')
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
      const details = await setUpTOTP()
      setupDetails.value = {
        sharedSecret: details.sharedSecret,
        uri: details.getSetupUri('Redlink', accountName).toString(),
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
      await verifyTOTPSetup({ code })
      // `verifyTOTPSetup` associe seulement le token logiciel côté Cognito -- sans ce
      // second appel, TOTP resterait associé mais jamais réellement actif comme facteur
      // de connexion (confirmé via `getMFASettings()`, aws-amplify/auth : 'PREFERRED' pose
      // `Enabled: true, PreferredMfa: true`).
      await updateMFAPreference({ totp: 'PREFERRED' })
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
      await updateMFAPreference({ totp: 'DISABLED' })
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
