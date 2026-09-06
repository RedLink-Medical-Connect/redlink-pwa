import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  signIn,
  signUp,
  signOut,
  confirmSignUp,
  confirmSignIn,
  getCurrentUser,
  fetchUserAttributes,
  resetPassword,
  confirmResetPassword,
  deleteUser,
  resendSignUpCode
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

  async function redirectAfterLogin() {
    if (currentRole.value === 'vet') {
      await router.push('/dashboard/requests')
    } else if (currentRole.value === 'owner') {
      await router.push('/dashboard/profile')
    } else {
      await router.push('/')
    }
  }

  // Bug réel trouvé en test de bout en bout (migration Gen1->Gen2, Phase 8) :
  // un navigateur ayant déjà une session Amplify locale pour un Cognito User
  // Pool remplacé depuis (ex. `ampx sandbox` relancé, nouveau pool) se
  // retrouve dans un état incohérent -- `getCurrentUser()` échoue contre le
  // pool actuel (l'utilisateur local n'y existe plus, cf. init() ci-dessus)
  // donc l'app affiche "non connecté", MAIS Amplify garde en local un flag
  // "déjà connecté" qui fait échouer tout nouveau `signIn()` avec
  // `UserAlreadyAuthenticatedException` -- l'utilisateur reste bloqué sans
  // pouvoir ni continuer sur l'ancienne session (invalide) ni s'authentifier
  // à nouveau. `signOut()` purge cet état local orphelin puis on retente le
  // `signIn()` une seule fois avec les identifiants fournis, plutôt que de
  // laisser un message d'erreur sans issue (l'utilisateur ne peut pas "vider
  // le localStorage" lui-même en usage normal).
  // Bug réel trouvé en test manuel (2026-09-02, indépendant de la Phase 8 et du
  // Groupe 1 sécurité -- ce fichier n'avait jamais géré ce cas) : `signIn()` ne lève
  // PAS d'exception pour un compte existant mais jamais confirmé -- il résout
  // normalement `{ isSignedIn: false, nextStep: { signInStep: 'CONFIRM_SIGN_UP' } }`
  // (vérifié dans `node_modules/aws-amplify/.../auth/src/providers/cognito/utils/
  // signInHelpers.ts`, `getSignInResultFromError`). Avant ce correctif, `login()`
  // ignorait silencieusement ce cas (`if (isSignedIn)` seul, rien dans le `else`) --
  // l'utilisateur voyait juste le bouton arrêter de charger, sans message d'erreur ET
  // sans aucun moyen de revenir saisir son code de confirmation déjà reçu par email.
  // Redirige vers `/verify-email` (déjà équipée d'un bouton "renvoyer le code" et d'un
  // repli de saisie du mot de passe si `temp_register_safe_data` est encore en
  // `localStorage`) plutôt que de laisser echouer un `signIn()` sans issue.
  async function redirectIfUnconfirmed(nextStep, email) {
    if (nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
      await router.push({ name: 'verify-email', query: { email } })
      return true
    }
    return false
  }

  // Durcissement sécurité (audit Cognito/API, 2026-09-02, Groupe 4) : un compte ayant
  // activé le TOTP (enrôlement depuis MfaSettings.vue/useMfa.js, `mode: 'OPTIONAL'` côté
  // `defineAuth` -- jamais imposé) reçoit ce nextStep après `signIn()` au lieu de
  // `isSignedIn: true` -- redirige vers l'écran de saisie du code plutôt que de laisser
  // `signIn()` sans issue, même principe que `redirectIfUnconfirmed()` ci-dessus.
  async function redirectIfMfaRequired(nextStep, email) {
    if (nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
      await router.push({ name: 'verify-mfa', query: { email } })
      return true
    }
    return false
  }

  async function login(email, password) {
    isLoading.value = true
    error.value = null
    try {
      const { isSignedIn, nextStep } = await signIn({ username: email, password })
      if (isSignedIn) {
        await init()
        await redirectAfterLogin()
      } else if (await redirectIfUnconfirmed(nextStep, email)) {
        return
      } else if (await redirectIfMfaRequired(nextStep, email)) {
        return
      }
    } catch (err) {
      console.error(err)
      if (err.name === 'UserAlreadyAuthenticatedException') {
        try {
          await signOut({ global: true })
          const { isSignedIn, nextStep } = await signIn({ username: email, password })
          if (isSignedIn) {
            await init()
            await redirectAfterLogin()
            return
          } else if (await redirectIfUnconfirmed(nextStep, email)) {
            return
          } else if (await redirectIfMfaRequired(nextStep, email)) {
            return
          }
        } catch (retryErr) {
          console.error(retryErr)
        }
      }
      error.value = `errors.login_failed`
    } finally {
      isLoading.value = false
    }
  }

  // Écran de challenge MFA (VerifyMfaView.vue) : contrat booléen (même famille que
  // `forgotPass`/`deleteAccount` ci-dessous), pas un `throw` -- la vue n'a besoin que de
  // savoir si la connexion a abouti, `auth.error` porte déjà le message d'échec.
  async function confirmMfaChallenge(code) {
    isLoading.value = true
    error.value = null
    try {
      const { isSignedIn } = await confirmSignIn({ challengeResponse: code })
      if (isSignedIn) {
        await init()
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

  // Bug réel trouvé en test de bout en bout (ni ce fichier ni RegisterOwnerView.vue/
  // RegisterClinicView.vue n'ont été touchés par la Phase 8) : cette fonction
  // n'a jamais communiqué son échec à l'appelant (pas de `throw`, pas de valeur
  // de retour) -- les deux vues appelantes continuaient donc TOUJOURS leur propre
  // suite (construction du payload, `router.push('/verify-email...')`) juste après
  // `await auth.register(...)`, même sur un `UsernameExistsException`. Le
  // `router.push('/login?email=...')` ci-dessous s'exécutait bien en premier, mais
  // était aussitôt écrasé par la navigation vers `/verify-email` de l'appelant --
  // donnant l'impression que la redirection ne fonctionnait pas du tout. Retourne
  // désormais `true`/`false` (même contrat que `forgotPass`/`deleteAccount`
  // ci-dessous) pour que l'appelant sache s'il doit continuer. Retiré aussi : la
  // navigation de succès vers `/verify-email` faite ici en double de celle déjà
  // faite par les deux vues appelantes (même principe que le store qui ne doit
  // pas naviguer lui-même, voir confirmRegistration()).
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
      return true
    } catch (err) {
      console.error(err)
      if (err.name === 'UsernameExistsException') {
        // Correctif (2026-09-06) : ce pool Cognito utilise l'email directement comme
        // username (`usernameAttributes: ['email']`, amplify/auth/resource.ts) --
        // `signUp()` renvoie `UsernameExistsException` pour un username déjà pris,
        // CONFIRMÉ OU NON. Avant ce correctif, ce cas redirigeait toujours vers
        // /login -- correct pour un compte déjà confirmé, mais un piège pour une
        // inscription abandonnée (utilisateur qui ferme VerifyEmailView.vue avant
        // d'entrer son code) : /login exige alors un mot de passe que l'utilisateur
        // n'a tapé qu'une seule fois et n'a jamais utilisé, et `forgotPassword()` ne
        // sauve pas la mise -- Cognito refuse un reset tant que l'email n'est pas
        // vérifié (`InvalidParameterException`), un vrai catch-22 documenté. Un compte
        // non confirmé peut se voir renvoyer un code SANS mot de passe
        // (`resendSignUpCode`, déjà utilisé sans auth dans VerifyEmailView.vue) --
        // s'il réussit, l'inscription était bien non confirmée : on reprend le flux de
        // vérification directement plutôt que d'exiger une connexion impossible. S'il
        // échoue (compte déjà confirmé -- Cognito renvoie une erreur, ex.
        // `InvalidParameterException`, plutôt que de renvoyer un nouveau code), on
        // retombe sur le comportement d'origine : /login est alors le bon endroit.
        try {
          await resendSignUpCode({ username: email })
          error.value = `errors.registration_resumed`
          await router.push({ name: 'verify-email', query: { email } })
        } catch (resendErr) {
          console.error(resendErr)
          error.value = `errors.email_exists`
          // Comportement d'origine (retour utilisateur, hors migration Phase 8 -- ce
          // fichier n'a jamais été touché par elle) : un email déjà utilisé et déjà
          // confirmé redirige vers /login (email pré-rempli) plutôt que de laisser
          // l'Owner/Vet bloqué sur le formulaire d'inscription avec un message
          // d'erreur seul. `error` reste posé dans le store (pas réinitialisé par la
          // navigation elle-même) : LoginView.vue l'affiche déjà via son propre
          // `<Message v-if="auth.error">`.
          await router.push(`/login?email=${encodeURIComponent(email)}`)
        }
      } else {
        error.value = `errors.registration_failed`
      }
      return false
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
      await signOut({ global: true })
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
    confirmMfaChallenge,
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
