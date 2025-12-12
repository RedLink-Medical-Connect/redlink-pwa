<script setup>
import { ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'

const auth = useAuthStore()
const { t } = useI18n()
const email = ref('')
const password = ref('')

watch([email, password], () => {
  if (auth.error) auth.clearError()
})

const handleLogin = async () => {
  if (!email.value || !password.value) {
    auth.setError(t('errors.fill_all_fields'))
    return
  }

  await auth.login(email.value, password.value)
}
</script>

<template>
  <div class="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
    <div class="hidden md:block relative h-[500px] w-full rounded-sm overflow-hidden shadow-2xl">
      <img
        src="https://images.unsplash.com/photo-1576201836106-db1758fd1c97?q=80&w=2070&auto=format&fit=crop"
        :alt="$t('auth.login.image_alt')"
        class="absolute inset-0 w-full h-full object-cover"
      />
      <div class="absolute inset-0 bg-black/10"></div>
    </div>

    <div class="flex flex-col gap-8 w-full max-w-md mx-auto md:mx-0">
      <h1
        class="text-3xl md:text-4xl font-bold text-zinc-900 dark:text-white border-b-2 border-[#ff3b4e] pb-2 inline-block w-fit uppercase tracking-wider"
      >
        {{ $t('auth.login.title') }}
      </h1>

      <Message v-if="auth.error" severity="error" class="mb-4" icon="pi pi-exclamation-triangle">
        {{
          typeof auth.error === 'string' && auth.error.startsWith('errors.')
            ? $t(auth.error)
            : auth.error
        }}
      </Message>

      <form class="flex flex-col gap-6" @submit.prevent="handleLogin">
        <div class="flex flex-col gap-2">
          <label
            class="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest"
          >
            {{ $t('auth.login.email_label') }}
          </label>
          <InputText
            v-model="email"
            type="email"
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-4 !rounded-md focus:!ring-2 focus:!ring-[#ff3b4e] placeholder:!text-zinc-500"
            :invalid="!!auth.error"
          />
        </div>

        <div class="flex flex-col gap-2">
          <label
            class="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest"
          >
            {{ $t('auth.login.password_label') }}
          </label>
          <Password
            v-model="password"
            :feedback="false"
            toggle-mask
            class="w-full"
            input-class="w-full !bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-4 !rounded-md focus:!ring-2 focus:!ring-[#ff3b4e] placeholder:!text-zinc-500"
            :invalid="!!auth.error"
          />

          <div class="text-right mt-1">
            <router-link
              to="/forgot-password"
              class="text-[10px] text-zinc-500 dark:text-zinc-400 hover:text-[#ff3b4e] uppercase underline decoration-zinc-500 hover:decoration-[#ff3b4e] transition"
            >
              {{ $t('auth.login.forgot_password') }}
            </router-link>
          </div>
        </div>

        <Button
          type="submit"
          :label="$t('auth.login.btn')"
          class="!bg-[#ff3b4e] !border-none hover:!bg-[#e63545] !text-white !font-black !uppercase !tracking-widest !py-4 !text-lg !rounded-md shadow-lg shadow-red-500/20 mt-4"
          :loading="auth.isLoading"
        />
      </form>

      <div
        class="text-center md:text-right text-xs text-zinc-500 dark:text-zinc-400 font-medium mt-4"
      >
        {{ $t('auth.login.no_account') }}
        <router-link
          to="/register"
          class="text-white bg-zinc-900 dark:bg-white dark:text-zinc-900 px-2 py-1 ml-2 rounded hover:bg-[#ff3b4e] dark:hover:bg-[#ff3b4e] hover:text-white transition inline-flex items-center gap-1 group"
        >
          {{ $t('auth.login.create_account') }}
          <i class="pi pi-arrow-right group-hover:translate-x-1 transition-transform"></i>
        </router-link>
      </div>
    </div>
  </div>
</template>
