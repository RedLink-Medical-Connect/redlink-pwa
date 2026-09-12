<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'
import { bffFetch } from '@/services/bff-fetch'
import { useRegistrationCompletion } from '@/composables/useRegistrationCompletion'
import { TEMP_REGISTRATION_TTL_MS } from '@/constants/auth-constants'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { t, locale } = useI18n()
const { completeRegistration } = useRegistrationCompletion()

const email = ref('')
const code = ref('')
const confirmPassword = ref('')
const showPasswordInput = ref(false)
const resendLoading = ref(false)
const resendSuccess = ref(false)

let registrationData = null

onMounted(() => {
  email.value = route.query.email || ''

  if (auth.tempRegistrationData && auth.tempRegistrationData.password) {
    // Flux normal (pas de rechargement de page depuis le signUp) : le mot de passe
    // reste en mémoire Pinia (jamais persisté sur disque), pas de resaisie nécessaire.
    registrationData = auth.tempRegistrationData
  } else {
    const local = localStorage.getItem('temp_register_safe_data')
    const parsed = local ? JSON.parse(local) : null
    // TTL applicatif (Groupe 3) : purge une entrée trop ancienne plutôt que de laisser
    // des PII (adresse, téléphone, données santé animale) traîner indéfiniment en
    // localStorage après un flow abandonné.
    const isExpired = parsed && Date.now() - parsed.savedAt > TEMP_REGISTRATION_TTL_MS
    if (parsed && !isExpired) {
      // Page rechargée entre le signUp initial et la confirmation : `tempRegistrationData`
      // (Pinia, en mémoire) ne survit pas au rechargement -- repli sur la copie
      // `localStorage` (mot de passe non inclus, toujours redemandé ci-dessous).
      registrationData = parsed.data
      showPasswordInput.value = true
    } else {
      if (isExpired) localStorage.removeItem('temp_register_safe_data')
      auth.setError(t('errors.session_expired'))
      // La route s'appelle '/register' (nom 'register-selection') — '/register/selection'
      // n'existe pas dans router/index.js et menait à un cul-de-sac (page 404). Phase 6.4.
      setTimeout(() => router.push('/register'), 2000)
    }
  }
})

const handleVerify = async () => {
  if (code.value.length < 6) return
  if (showPasswordInput.value && !confirmPassword.value) {
    auth.setError(t('errors.password_required'))
    return
  }

  try {
    auth.isLoading = true
    auth.clearError()

    try {
      await auth.confirmRegistration(email.value, code.value)
    } catch (e) {
      if (!e.message?.includes('Current status is CONFIRMED')) throw e
    }

    const pwd = showPasswordInput.value ? confirmPassword.value : registrationData.password

    // BFF Cognito (2026-09-06, docs/adr/0021-bff-cognito-session-cloudfront.md) : établit la
    // session SANS naviguer -- même raison que l'ancien appel direct `signIn()`
    // (`aws-amplify/auth`) qu'il remplace : `auth.login()` (le store) navigue lui-même vers
    // /dashboard/... en cas de succès, ce qui redirigerait PRÉMATURÉMENT avant que
    // `completeRegistration()` ci-dessous n'ait eu la moindre chance de créer l'Owner/
    // Veterinarian -- donnant l'impression que rien ne persiste (le dashboard se charge sur
    // un profil qui n'existe pas encore, ou l'erreur de complétion d'inscription reste
    // invisible sur un composant déjà démonté). Plus besoin du repli "session déjà établie"
    // de l'ancienne version (`getCurrentUser()` d'abord, `signIn()` seulement si ça échoue) :
    // ce pool Cognito n'a plus aucune notion de session côté navigateur avant ce point (BFF
    // uniquement), et un `signIn` rejoué (retry après un échec de `completeRegistration()`
    // ci-dessous) est sans risque -- `InitiateAuthCommand` ne connaît pas de notion "déjà
    // signé" côté serveur, contrairement à l'ancien SDK Amplify client-side.
    const { ok, data: signInData } = await bffFetch('/api/auth/signin', {
      body: { email: email.value, password: pwd },
    })
    if (!ok || signInData.status !== 'SIGNED_IN') {
      throw new Error(signInData.error ?? 'SIGN_IN_FAILED')
    }

    const cognitoUserId = signInData.user.sub

    await completeRegistration(registrationData, cognitoUserId)

    auth.clearTempRegistrationData()
    localStorage.removeItem('temp_register_safe_data')

    // Même comportement Owner/Veterinarian (retour utilisateur -- l'écran de
    // transparence Phase 6.B intermédiaire, qui affichait les valeurs par défaut
    // avant un clic manuel vers le dashboard, est retiré : redirection directe pour
    // les deux rôles). La création des valeurs par défaut elle-même (OwnerAvailability
    // samedi 9h-12h, isVaccinated/donationFrequency sur l'Animal express) est
    // inchangée -- seul cet écran intermédiaire disparaît, voir
    // completeOwnerRegistration()/useRegistrationCompletion.js.
    await router.push('/dashboard')
  } catch (err) {
    console.error('Erreur Inscription:', err)
    // Nettoyage PII (Groupe 3, en plus du TTL posé plus haut) : même un échec de
    // vérification (code invalide, signIn en échec...) ne doit pas laisser
    // `temp_register_safe_data` traîner indéfiniment -- sans risque pour une
    // nouvelle tentative dans la même page, `registrationData` reste en mémoire
    // (variable module) tant que la page n'est pas rechargée.
    localStorage.removeItem('temp_register_safe_data')
    if (err.errors && err.errors.length > 0) {
      auth.setError(t('errors.technical_with_message', { message: err.errors[0].message }))
    } else {
      auth.setError(err.message || t('errors.unknown'))
    }
  } finally {
    auth.isLoading = false
  }
}

const handleResend = async () => {
  resendLoading.value = true
  resendSuccess.value = false
  auth.clearError()
  try {
    const { ok } = await bffFetch('/api/auth/resend-code', {
      body: { email: email.value, locale: locale.value },
    })
    if (!ok) throw new Error('RESEND_FAILED')
    resendSuccess.value = true
    setTimeout(() => (resendSuccess.value = false), 5000)
  } catch {
    auth.setError(t('errors.resend_code_failed'))
  } finally {
    resendLoading.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-md mx-auto text-center animate-fade-in">
    <div class="mb-8 relative inline-block">
      <div class="absolute inset-0 bg-[#ff3b4e]/20 blur-xl rounded-full"></div>
      <i class="pi pi-envelope text-6xl text-[#ff3b4e] relative z-10 animate-bounce"></i>
    </div>

    <h1 class="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider mb-2">
      {{ $t('auth.verify.title') }}
    </h1>
    <p class="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
      {{ $t('auth.verify.subtitle') }} <br />
      <span class="font-bold text-[#ff3b4e] text-base">{{ email }}</span>
    </p>

    <Message
      v-if="auth.error"
      severity="error"
      class="mb-6 text-left"
      icon="pi pi-exclamation-circle"
    >
      {{
        typeof auth.error === 'string' && auth.error.startsWith('errors.')
          ? $t(auth.error)
          : auth.error
      }}
    </Message>

    <Message v-if="resendSuccess" severity="success" class="mb-6 text-left" icon="pi pi-check">
      {{ $t('auth.verify.resend_success') }}
    </Message>

    <form @submit.prevent="handleVerify">
      <div class="flex justify-center mb-8">
        <InputOtp
          v-model="code"
          :length="6"
          integer-only
          :pt="{
            root: { class: 'gap-2 sm:gap-3' },
            input: {
              class: [
                '!bg-zinc-100 dark:!bg-zinc-800',
                '!text-zinc-900 dark:!text-white',
                '!w-10 !h-12 sm:!w-12 sm:!h-14',
                '!text-xl font-bold',
                'focus:!ring-2 focus:!ring-[#ff3b4e] focus:!border-[#ff3b4e]',
                auth.error ? '!border-red-500 !ring-red-500/30' : '!border-none',
              ],
            },
          }"
        />
      </div>

      <div
        v-if="showPasswordInput"
        class="mb-6 text-left animate-fade-in bg-yellow-50 dark:bg-yellow-900/10 p-4 rounded-lg border border-yellow-200 dark:border-yellow-800/30"
      >
        <label
          class="block text-xs font-bold uppercase text-yellow-700 dark:text-yellow-500 mb-2 ml-1"
        >
          {{ $t('auth.verify.password_label') }}
        </label>
        <Password
          v-model="confirmPassword"
          :feedback="false"
          toggle-mask
          :placeholder="$t('auth.verify.password_placeholder')"
          class="w-full"
          input-class="w-full !bg-white dark:!bg-zinc-900 !border-none !text-zinc-900 dark:!text-white !p-3 rounded-md shadow-sm"
        />
      </div>

      <Button
        :label="$t('auth.verify.btn')"
        type="submit"
        class="w-full !bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 !rounded-md shadow-lg shadow-red-500/20 transition-transform active:scale-95"
        :loading="auth.isLoading"
        :disabled="code.length < 6"
      />
    </form>

    <Button
      :label="resendLoading ? $t('auth.verify.resend_loading') : $t('auth.verify.resend')"
      :icon="resendLoading ? 'pi pi-spin pi-spinner' : ''"
      variant="text"
      class="mt-6 !text-zinc-500 hover:!text-zinc-900 dark:hover:!text-white !uppercase !text-xs !font-bold tracking-widest"
      :disabled="resendLoading"
      @click="handleResend"
    />
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.5s ease-out;
}
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
