<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { usePassword } from '@/composables/usePassword'
import { useClinicVeterinarians } from '@/composables/useClinicVeterinarians'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { confirmOwnAccount } = useClinicVeterinarians()

const email = ref('')
const { password: newPassword, isValid: isPasswordValid } = usePassword()

onMounted(() => {
  email.value = route.query.email || ''
  // Même garde-fou que VerifyMfaView.vue : cet écran n'est atteint que juste après un
  // `login()` qui a répondu `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD` (compte créé par
  // `AdminCreateUser`, invitation d'un vétérinaire par le référent de sa clinique) --
  // l'état de challenge Cognito ne survit pas à un rechargement de cette page.
  if (!email.value) {
    router.push('/login')
  }
})

const handleSubmit = async () => {
  if (!isPasswordValid.value || !newPassword.value) return
  const ok = await auth.confirmNewPasswordChallenge(newPassword.value, email.value)
  // Après la redirection déjà effectuée par le store -- voir le commentaire de
  // `confirmOwnAccount()`, useClinicVeterinarians.js, sur pourquoi cet ordre est sûr.
  if (ok) {
    await confirmOwnAccount()
  }
}
</script>

<template>
  <div class="w-full max-w-md mx-auto text-center animate-fade-in">
    <div class="mb-8 relative inline-block">
      <div class="absolute inset-0 bg-[#ff3b4e]/20 blur-xl rounded-full"></div>
      <i class="pi pi-key text-6xl text-[#ff3b4e] relative z-10"></i>
    </div>

    <h1 class="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider mb-2">
      {{ $t('auth.set_new_password.title') }}
    </h1>
    <p class="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
      {{ $t('auth.set_new_password.subtitle') }} <br>
      <span class="text-[#ff3b4e] font-bold">{{ email }}</span>
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

    <form class="flex flex-col gap-2 text-left" @submit.prevent="handleSubmit">
      <label class="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
        {{ $t('auth.set_new_password.label') }}
      </label>
      <Password
        v-model="newPassword"
        toggle-mask
        :feedback="false"
        class="w-full"
        input-class="w-full !bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-4 !rounded-md focus:!ring-2 focus:!ring-[#ff3b4e]"
        :invalid="!!auth.error || (!isPasswordValid && newPassword.length > 0)"
      />
      <small
        v-if="newPassword.length > 0 && !isPasswordValid"
        class="text-red-500 text-[10px] font-bold ml-1"
      >
        {{ $t('errors.password_length') }}
      </small>

      <Button
        :label="$t('auth.set_new_password.btn')"
        type="submit"
        class="w-full mt-6 !bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 !rounded-md shadow-lg shadow-red-500/20 transition-transform active:scale-95"
        :loading="auth.isLoading"
        :disabled="!isPasswordValid || !newPassword"
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
