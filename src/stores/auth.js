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
  // --- ÉTAT (STATE) ---
  const user = ref(null)
  const isLoading = ref(false)
  const error = ref(null)

  // Variable locale pour le test (Sélecteur du Header)
  // Elle est écrasée par le vrai rôle AWS une fois connecté
  const role = ref('owner')

  // --- GETTERS ---
  const isAuthenticated = computed(() => !!user.value)

  // Le Cerveau : Détermine le rôle actif (AWS prioritaire, sinon Test)
  const currentRole = computed(() => {
    // 1. Si connecté, on lit le champ 'profile' d'AWS
    if (user.value?.attributes?.profile) {
      return user.value.attributes.profile
    }
    // 2. Sinon, on utilise la valeur du sélecteur de test
    return role.value
  })

  // --- ACTIONS ---

  // 1. Initialisation (Au chargement de l'app ou F5)
  async function init() {
    try {
      const currentUser = await getCurrentUser()
      // On doit faire un 2ème appel pour avoir les attributs (email, profile, etc.)
      const attributes = await fetchUserAttributes()

      // On stocke tout dans l'objet user
      user.value = { ...currentUser, attributes }
    } catch {
      // Pas d'erreur ici, c'est juste que l'utilisateur n'est pas connecté
      user.value = null
    }
  }

  // 2. Connexion
  async function login(email, password) {
    isLoading.value = true
    error.value = null
    try {
      const { isSignedIn } = await signIn({ username: email, password })
      if (isSignedIn) {
        // On charge le profil pour savoir qui c'est (Véto ou Proprio)
        await init()

        // AIGUILLAGE AUTOMATIQUE
        if (currentRole.value === 'vet') {
          await router.push('/dashboard/requests')
        } else if (currentRole.value === 'owner') {
          await router.push('/profile')
        } else {
          await router.push('/') // Fallback
        }
      }
    } catch (err) {
      console.error(err)
      error.value = `errors.login_failed`
    } finally {
      isLoading.value = false
    }
  }

  // 3. Inscription
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
            // ICI : On utilise 'profile' au lieu de 'custom:role'
            // car c'est un champ standard autorisé par votre config AWS
            profile: roleType
          }
        }
      })
      // Redirection vers vérification
      await router.push(`/verify-email?email=${encodeURIComponent(email)}`)
    } catch (err) {
      console.error(err)
      if (err.name === 'UsernameExistsException') {
        error.value = `errors.email_exists`
      } else {
        error.value = `errors.registration_failed`
      }
    } finally {
      isLoading.value = false
    }
  }

  // 4. Confirmation Email
  async function confirmRegistration(email, code) {
    isLoading.value = true
    error.value = null
    try {
      const { isSignUpComplete } = await confirmSignUp({
        username: email,
        confirmationCode: code
      });
      if (isSignUpComplete) {
        await router.push('/login');
      }
    } catch (err) {
      console.error(err)
      error.value = `errors.invalid_code`
    } finally {
      isLoading.value = false
    }
  }

  // 5. Mot de passe oublié (Demande)
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

  // 6. Mot de passe oublié (Validation)
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

  // 7. Déconnexion
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
      router.push('/login')
      return true
    } catch (err) {
      console.error(err)
      error.value = `errors.delete_account_failed`
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Actions pour gérer les erreurs depuis l'extérieur du store
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
    setError
  }
})
