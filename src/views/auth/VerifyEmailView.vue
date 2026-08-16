<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'
import { resendSignUpCode, getCurrentUser } from 'aws-amplify/auth'
import { useRegistrationCompletion } from '@/composables/useRegistrationCompletion'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { t } = useI18n()
const { completeRegistration } = useRegistrationCompletion()

const email = ref('')
const code = ref('')
const confirmPassword = ref('')
const showPasswordInput = ref(false)
const resendLoading = ref(false)
const resendSuccess = ref(false)
// Transparence inscription express (Phase 6.B) : `completeRegistration()`
// (useRegistrationCompletion.js) fabrique en silence des valeurs par défaut
// (isVaccinated: true, donationFrequency: ASAP, un créneau OwnerAvailability
// samedi 9h-12h) quand un animal est créé pendant l'inscription express -- jamais
// montrées au propriétaire jusqu'ici. Plutôt que de rediriger immédiatement vers
// le dashboard, on marque cet écran comme "étape finale" affichant ces valeurs et
// où les modifier, avant que l'Owner ne continue lui-même vers son dashboard.
const showExpressDefaultsInfo = ref(false)

let registrationData = null

onMounted(() => {
  email.value = route.query.email || ''

  if (auth.tempRegistrationData && auth.tempRegistrationData.password) {
    registrationData = auth.tempRegistrationData
  } else {
    const local = localStorage.getItem('temp_register_safe_data')
    if (local) {
      registrationData = JSON.parse(local)
      showPasswordInput.value = true
    } else {
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
    let currentUser
    try {
      currentUser = await getCurrentUser()
    } catch {
      await auth.login(email.value, pwd)
      currentUser = await getCurrentUser()
    }

    const cognitoUserId = currentUser.userId

    await completeRegistration(registrationData, cognitoUserId)

    auth.clearTempRegistrationData()
    localStorage.removeItem('temp_register_safe_data')

    // N'affiche l'écran de transparence que quand l'inscription express a réellement
    // fabriqué des valeurs par défaut pour un Animal (voir useRegistrationCompletion.js,
    // completeOwnerRegistration -- seulement si data.animal_name est renseigné). Dans
    // tous les autres cas (Veterinarian, ou Owner sans animal ajouté à l'inscription),
    // comportement inchangé : redirection directe.
    if (registrationData.role === 'owner' && registrationData.animal_name) {
      showExpressDefaultsInfo.value = true
    } else {
      await router.push('/dashboard')
    }
  } catch (err) {
    console.error('Erreur Inscription:', err)
    if (err.errors && err.errors.length > 0) {
      auth.setError(t('errors.technical_with_message', { message: err.errors[0].message }))
    } else {
      auth.setError(err.message || t('errors.unknown'))
    }
  } finally {
    auth.isLoading = false
  }
}

const continueToDashboard = () => {
  router.push('/dashboard')
}

const handleResend = async () => {
  resendLoading.value = true
  resendSuccess.value = false
  auth.clearError()
  try {
    await resendSignUpCode({ username: email.value })
    resendSuccess.value = true
    setTimeout(() => resendSuccess.value = false, 5000)
  } catch {
    auth.setError(t('errors.resend_code_failed'))
  } finally {
    resendLoading.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-md mx-auto text-center animate-fade-in">
    <!-- Transparence inscription express (Phase 6.B) : remplace la redirection immédiate
         vers le dashboard par un écran informant l'Owner des valeurs par défaut appliquées
         automatiquement à l'Animal créé pendant l'inscription express (voir
         useRegistrationCompletion.js). N'apparaît que dans ce cas précis (showExpressDefaultsInfo,
         voir handleVerify) -- comportement de tous les autres flux d'inscription inchangé. -->
    <div v-if="showExpressDefaultsInfo">
      <div class="mb-8 relative inline-block">
        <div class="absolute inset-0 bg-green-500/20 blur-xl rounded-full"></div>
        <i class="pi pi-check-circle text-6xl text-green-500 relative z-10"></i>
      </div>

      <h1 class="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider mb-2">
        {{ $t('auth.verify.express_defaults_title') }}
      </h1>

      <Message severity="info" class="mb-6 text-left" icon="pi pi-info-circle">
        {{
          $t('auth.verify.express_defaults_message', {
            animal: registrationData?.animal_name,
          })
        }}
      </Message>

      <Button
        :label="$t('auth.verify.express_defaults_continue')"
        class="w-full !bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 !rounded-md shadow-lg shadow-red-500/20 transition-transform active:scale-95"
        @click="continueToDashboard"
      />
    </div>

    <template v-else>
      <div class="mb-8 relative inline-block">
        <div class="absolute inset-0 bg-[#ff3b4e]/20 blur-xl rounded-full"></div>
        <i class="pi pi-envelope text-6xl text-[#ff3b4e] relative z-10 animate-bounce"></i>
      </div>

      <h1 class="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider mb-2">
        {{ $t('auth.verify.title') }}
      </h1>
      <p class="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
        {{ $t('auth.verify.subtitle') }} <br>
        <span class="font-bold text-[#ff3b4e] text-base">{{ email }}</span>
      </p>

      <Message v-if="auth.error" severity="error" class="mb-6 text-left" icon="pi pi-exclamation-circle">
        {{ typeof auth.error === 'string' && auth.error.startsWith('errors.') ? $t(auth.error) : auth.error }}
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
                  auth.error ? '!border-red-500 !ring-red-500/30' : '!border-none'
                ]
              }
            }"
          />
        </div>

        <div v-if="showPasswordInput" class="mb-6 text-left animate-fade-in bg-yellow-50 dark:bg-yellow-900/10 p-4 rounded-lg border border-yellow-200 dark:border-yellow-800/30">
          <label class="block text-xs font-bold uppercase text-yellow-700 dark:text-yellow-500 mb-2 ml-1">
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
    </template>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.5s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
