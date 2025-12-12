<script setup>
import { ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'

const auth = useAuthStore()
const { t } = useI18n()
const step = ref(1) // 1 = Email, 2 = Reset

const email = ref('')
const code = ref('')
const newPassword = ref('')

watch([email, code, newPassword], () => {
  if (auth.error) auth.clearError()
})

const handleSendCode = async () => {
  if (!email.value) {
    auth.setError(t('errors.enter_email'))
    return
  }

  if (await auth.forgotPass(email.value)) {
    auth.clearError()
    step.value = 2
  }
}

const handleReset = async () => {
  if (!code.value || !newPassword.value) {
    auth.setError(t('errors.fill_code_password'))
    return
  }

  await auth.resetPassSubmit(email.value, code.value, newPassword.value)
}
</script>

<template>
  <div class="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-12 items-center">

    <div class="hidden md:block relative h-[500px] w-full rounded-sm overflow-hidden shadow-2xl">
      <img
        src="https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?q=80&w=2043&auto=format&fit=crop"
        alt="Chat curieux"
        class="absolute inset-0 w-full h-full object-cover grayscale opacity-80"
      />
      <div class="absolute inset-0 bg-black/10"></div>
    </div>

    <div class="flex flex-col gap-8 w-full max-w-md mx-auto md:mx-0">

      <h1 class="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider border-b-2 border-[#ff3b4e] pb-2 inline-block w-fit">
        {{ $t('auth.forgot.title') }}
      </h1>

      <Message v-if="auth.error" severity="error" icon="pi pi-exclamation-triangle">
        {{ typeof auth.error === 'string' && auth.error.startsWith('errors.') ? $t(auth.error) : auth.error }}
      </Message>

      <form v-if="step === 1" class="flex flex-col gap-6 animate-fade-in" @submit.prevent="handleSendCode">
        <div class="flex flex-col gap-2">
          <label class="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
            {{ $t('auth.forgot.email_label') }}
          </label>
          <InputText
            v-model="email"
            type="email"
            :placeholder="$t('layout.footer.email_placeholder')"
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-4 !rounded-md focus:!ring-2 focus:!ring-[#ff3b4e]"
            :invalid="!!auth.error"
          />
        </div>

        <Button
          type="submit"
          :label="$t('auth.forgot.btn_send')"
          class="!bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 !rounded-md shadow-lg shadow-red-500/20"
          :loading="auth.isLoading"
        />
      </form>

      <form v-else class="flex flex-col gap-6 animate-fade-in" @submit.prevent="handleReset">

        <div class="text-center mb-2">
          <p class="text-sm text-zinc-500 dark:text-zinc-400">
            {{ $t('auth.forgot.subtitle_step2') }} <br>
            <span class="text-[#ff3b4e] font-bold">{{ email }}</span>
          </p>
        </div>

        <div class="flex flex-col gap-2 items-center">
          <label class="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
            {{ $t('auth.forgot.code_label') }}
          </label>
          <InputOtp
            v-model="code"
            :length="6"
            integer-only
            :pt="{
              input: { class: '!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !w-10 !h-12 !text-lg font-bold focus:!ring-2 focus:!ring-[#ff3b4e]' }
            }"
          />
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
            {{ $t('auth.forgot.new_password_label') }}
          </label>
          <Password
            v-model="newPassword"
            toggle-mask
            class="w-full"
            input-class="w-full !bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-4 !rounded-md focus:!ring-2 focus:!ring-[#ff3b4e]"
            :invalid="!!auth.error"
          />
        </div>

        <Button
          type="submit"
          :label="$t('auth.forgot.btn_reset')"
          class="!bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 shadow-lg shadow-red-500/20"
          :loading="auth.isLoading"
        />
      </form>

      <router-link to="/login" class="text-center text-xs text-zinc-500 hover:text-[#ff3b4e] uppercase font-bold mt-4 transition-colors">
        <i class="pi pi-arrow-left mr-1"></i> {{ $t('auth.forgot.back') }}
      </router-link>

    </div>
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
