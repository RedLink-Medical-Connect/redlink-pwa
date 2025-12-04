<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'
import { resendSignUpCode } from 'aws-amplify/auth' // Import direct pour le renvoi
// Auto-import: InputOtp, Button, Message, Toast (si dispo)

const route = useRoute()
const auth = useAuthStore()
const { t } = useI18n()
const email = ref('')
const code = ref('')
const resendLoading = ref(false)
const resendSuccess = ref(false)

onMounted(() => {
  email.value = route.query.email || ''
})

// 1. UX : Effacer l'erreur quand on tape
watch(code, () => {
  if (auth.error) auth.clearError()
})

const handleVerify = () => {
  if (code.value.length < 6) return
  auth.confirmRegistration(email.value, code.value)
}

// 2. Fonctionnalité : Renvoyer le code
const handleResend = async () => {
  resendLoading.value = true
  resendSuccess.value = false
  auth.clearError()

  try {
    await resendSignUpCode({ username: email.value })
    resendSuccess.value = true
    // Petit reset du message de succès après 5 secondes
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
              // Si erreur, bordure rouge, sinon bordure transparente/grise
              auth.error ? '!border-red-500 !ring-red-500/30' : '!border-none'
            ]
          }
        }"
      />
    </div>

    <Button
      :label="$t('auth.verify.btn')"
      class="w-full !bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 !rounded-md shadow-lg shadow-red-500/20 transition-transform active:scale-95"
      :loading="auth.isLoading"
      :disabled="code.length < 6"
      @click="handleVerify"
    />

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
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
