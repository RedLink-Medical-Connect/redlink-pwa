import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  signIn,
  signUp,
  signOut,
  confirmSignUp,
  getCurrentUser,
  fetchUserAttributes,
  resetPassword,
  confirmResetPassword,
  deleteUser
} from 'aws-amplify/auth'
import router from '@/router'

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

  async function init() {
    try {
      const currentUser = await getCurrentUser()
      const attributes = await fetchUserAttributes()

      user.value = { ...currentUser, attributes }
    } catch {
      user.value = null
    }
  }

  async function login(email, password) {
    isLoading.value = true
    error.value = null
    try {
      const { isSignedIn } = await signIn({ username: email, password })
      if (isSignedIn) {
        await init()

        if (currentRole.value === 'vet') {
          await router.push('/dashboard/requests')
        } else if (currentRole.value === 'owner') {
          await router.push('/dashboard/profile')
        } else {
          await router.push('/')
        }
      }
    } catch (err) {
      console.error(err)
      error.value = `errors.login_failed`
    } finally {
      isLoading.value = false
    }
  }

  async function register(email, password, name, roleType) {
    isLoading.value = true
    error.value = null
    try {
      await signUp({
        username: email,
        password,
        options: {
          userAttributes: {
            email,
            name,
            profile: roleType
          }
        }
      })
      await router.push(`/verify-email?email=${encodeURIComponent(email)}`)
    } catch (err) {
      console.error(err)
      if (err.name === 'UsernameExistsException') {
        error.value = `errors.email_exists`
        // Comportement demandé (retour utilisateur, hors migration Phase 8 -- ce
        // fichier n'a jamais été touché par elle) : un email déjà utilisé redirige
        // vers /login (email pré-rempli) plutôt que de laisser l'Owner/Vet bloqué
        // sur le formulaire d'inscription avec un message d'erreur seul. `error`
        // reste posé dans le store (pas réinitialisé par la navigation elle-même) :
        // LoginView.vue l'affiche déjà via son propre `<Message v-if="auth.error">`.
        await router.push(`/login?email=${encodeURIComponent(email)}`)
      } else {
        error.value = `errors.registration_failed`
      }
    } finally {
      isLoading.value = false
    }
  }

  // Bug réel trouvé en test de bout en bout (ni ce fichier ni VerifyEmailView.vue
  // n'ont été touchés par la Phase 8) : un code de vérification erroné/expiré était
  // avalé ici (`error.value` posé, jamais relancé) -- l'appelant (VerifyEmailView.vue,
  // `try { await auth.confirmRegistration(...) } catch (e) { if (!e.message?.includes(
  // 'Current status is CONFIRMED')) throw e }`) ne recevait donc JAMAIS d'exception à
  // examiner, quel que soit le code entré, et continuait la suite du flux
  // (signIn/completeRegistration) comme si la confirmation avait réussi -- créant les
  // entités DynamoDB même sur un code invalide. `throw err` ci-dessous restaure le
  // contrat attendu par cet appelant.
  //
  // Retiré aussi : le `router.push('/login')` sur succès. VerifyEmailView.vue pilote
  // déjà toute la navigation post-confirmation (connexion, complétion du profil, puis
  // dashboard) -- ce store ne doit pas naviguer lui-même (même principe que le bug
  // corrigé sur `login()`/VerifyEmailView.vue précédemment).
  async function confirmRegistration(email, code) {
    isLoading.value = true
    error.value = null
    try {
      await confirmSignUp({
        username: email,
        confirmationCode: code
      });
    } catch (err) {
      console.error(err)
      error.value = `errors.invalid_code`
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function forgotPass(email) {
    isLoading.value = true
    error.value = null
    try {
      await resetPassword({ username: email })
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
      await confirmResetPassword({
        username: email,
        confirmationCode: code,
        newPassword
      })
      router.push('/login')
    } catch (err) {
      console.error(err)
      error.value = `errors.reset_password_failed`
    } finally {
      isLoading.value = false
    }
  }

  async function logout() {
    try {
      await signOut()
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
      await deleteUser()
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
    logout,
    forgotPass,
    resetPassSubmit,
    deleteAccount,
    clearError,
    setError,
    clearTempRegistrationData,
    setTempRegistrationData
  }
})
