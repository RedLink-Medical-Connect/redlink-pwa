<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const code = ref('')

onMounted(() => {
  email.value = route.query.email || ''
  // Cet écran n'est atteint que juste après un `signIn()` qui a répondu
  // `CONFIRM_SIGN_IN_WITH_TOTP_CODE` (voir `redirectIfMfaRequired()`, src/stores/auth.js) --
  // l'état de challenge Cognito, comme `autoSignIn`, ne survit pas à un rechargement de
  // cette page (pas de filet de sécurité localStorage ici, contrairement à
  // VerifyEmailView.vue : aucune PII à faire survivre, juste un code à 6 chiffres).
  if (!email.value) {
    router.push('/login')
  }
})

const handleVerify = async () => {
  if (code.value.length < 6) return
  await auth.confirmMfaChallenge(code.value)
}
</script>

<template>
  <div class="w-full max-w-md mx-auto text-center animate-fade-in">
    <div class="mb-8 relative inline-block">
      <div class="absolute inset-0 bg-[#ff3b4e]/20 blur-xl rounded-full"></div>
      <i class="pi pi-shield text-6xl text-[#ff3b4e] relative z-10"></i>
    </div>

    <h1 class="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider mb-2">
      {{ $t('auth.mfa_challenge.title') }}
    </h1>
    <p class="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
      {{ $t('auth.mfa_challenge.subtitle') }}
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

      <Button
        :label="$t('auth.mfa_challenge.btn')"
        type="submit"
        class="w-full !bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 !rounded-md shadow-lg shadow-red-500/20 transition-transform active:scale-95"
        :loading="auth.isLoading"
        :disabled="code.length < 6"
      />
    </form>
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
