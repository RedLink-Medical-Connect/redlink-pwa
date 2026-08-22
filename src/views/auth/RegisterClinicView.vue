<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { usePassword } from '@/composables/usePassword'
import { useI18n } from 'vue-i18n'
import AddressAutocomplete from '@/components/common/AddressAutocomplete.vue'
import PhoneInput from '@/components/common/PhoneInput.vue'

const auth = useAuthStore()
const { t } = useI18n()
const router = useRouter()

const {
  password,
  confirmPassword,
  isValid: isPasswordValid,
  validate: validatePassword,
} = usePassword()

const step = ref(1)
const isLoading = ref(false)

const form = ref({
  lastname: '',
  firstname: '',
  email: '',

  clinic_name: '',
  rpps: '',
  phone: '',
  address: '',
  latitude: null,
  longitude: null,
})

const nextStep = () => {
  if (!form.value.lastname || !form.value.firstname || !form.value.email || !password.value) {
    auth.setError(t('errors.fill_required_fields'))
    return
  }

  const passwordError = validatePassword()
  if (passwordError) {
    auth.setError(passwordError)
    return
  }

  auth.clearError()
  step.value = 2
}

const onAddressSelect = (data) => {
  form.value.address = data.address
  form.value.latitude = data.latitude
  form.value.longitude = data.longitude
}

const handleRegister = async () => {
  if (!form.value.clinic_name || !form.value.rpps || !form.value.address) {
    auth.setError(t('errors.fill_required_fields'))
    return
  }
  if (!form.value.latitude || !form.value.longitude) {
    auth.setError(t('errors.invalid_address'))
    return
  }

  try {
    isLoading.value = true
    auth.clearError()

    const success = await auth.register(
      form.value.email,
      password.value,
      `${form.value.firstname} ${form.value.lastname}`,
      'vet',
    )
    if (!success) return

    const payload = { ...form.value, role: 'vet' }

    auth.setTempRegistrationData({ ...payload, password: password.value })

    const safePayload = { ...payload }
    localStorage.setItem('temp_register_safe_data', JSON.stringify(safePayload))

    await router.push({ name: 'verify-email', query: { email: form.value.email } })
  } catch (error) {
    console.error(error)
    auth.setError(error.message || t('errors.registration_failed'))
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
    <div
      class="hidden md:block relative h-[600px] w-full rounded-sm overflow-hidden shadow-2xl transition-all duration-500"
    >
      <img
        src="https://images.unsplash.com/photo-1629909613654-28e377c37b09?q=80&w=2068&auto=format&fit=crop"
        class="absolute inset-0 w-full h-full object-cover"
      />
      <div class="absolute inset-0 bg-black/20"></div>
    </div>

    <div class="flex flex-col gap-8 w-full max-w-md mx-auto md:mx-0">
      <h1
        class="text-3xl font-bold text-zinc-900 dark:text-white border-b-2 border-[#ff3b4e] pb-2 inline-block w-fit uppercase tracking-wider"
      >
        {{
          step === 1
            ? $t('auth.register_clinic.title_step1')
            : $t('auth.register_clinic.title_step2')
        }}
      </h1>

      <Message v-if="auth.error" severity="error" class="mb-4">
        {{
          typeof auth.error === 'string' && auth.error.startsWith('errors.')
            ? $t(auth.error)
            : auth.error
        }}
      </Message>

      <form
        v-if="step === 1"
        class="flex flex-col gap-4 animate-fade-in"
        @submit.prevent="nextStep"
      >
        <div class="grid grid-cols-2 gap-4">
          <InputText
            v-model="form.lastname"
            :placeholder="$t('auth.register_common.lastname')"
            class="p-3 bg-zinc-100 dark:bg-zinc-800 border-none rounded"
            required
          />
          <InputText
            v-model="form.firstname"
            :placeholder="$t('auth.register_common.firstname')"
            class="p-3 bg-zinc-100 dark:bg-zinc-800 border-none rounded"
            required
          />
        </div>

        <InputText
          v-model="form.email"
          type="email"
          :placeholder="$t('auth.register_common.email')"
          class="p-3 bg-zinc-100 dark:bg-zinc-800 border-none rounded"
          required
        />

        <div class="grid grid-cols-2 gap-4 items-start">
          <div class="flex flex-col gap-1">
            <Password
              v-model="password"
              :placeholder="$t('auth.register_common.password')"
              toggle-mask
              :feedback="false"
              class="w-full"
              input-class="w-full p-3 bg-zinc-100 dark:bg-zinc-800 border-none"
              :invalid="!isPasswordValid && password.length > 0"
              required
            />
            <small
              v-if="password.length > 0 && !isPasswordValid"
              class="text-red-500 text-[10px] font-bold ml-1"
            >
              {{ $t('errors.password_length') }}
            </small>
          </div>
          <Password
            v-model="confirmPassword"
            :placeholder="$t('auth.register_common.confirm_password')"
            :feedback="false"
            class="w-full"
            input-class="w-full p-3 bg-zinc-100 dark:bg-zinc-800 border-none"
            required
          />
        </div>

        <Button
          type="submit"
          :label="$t('auth.register_common.next')"
          class="!bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-3 !mt-4 rounded-md shadow-lg"
        />
      </form>

      <form v-else class="flex flex-col gap-4 animate-fade-in" @submit.prevent="handleRegister">
        <InputText
          v-model="form.clinic_name"
          :placeholder="$t('auth.register_clinic.fields.clinic_name')"
          class="p-3 bg-zinc-100 dark:bg-zinc-800 border-none rounded"
          required
        />

        <InputText
          v-model="form.rpps"
          :placeholder="$t('auth.register_clinic.fields.rpps')"
          class="p-3 bg-zinc-100 dark:bg-zinc-800 border-none rounded"
          required
        />

        <PhoneInput v-model="form.phone" />

        <AddressAutocomplete :model-value="form.address" @select="onAddressSelect" />

        <div class="flex gap-4 mt-4">
          <Button
            icon="pi pi-arrow-left"
            class="!bg-zinc-200 dark:!bg-zinc-800 !text-zinc-500 !border-none"
            @click="step = 1"
          />

          <Button
            type="submit"
            :label="$t('auth.register_common.finish')"
            class="flex-grow !bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-3 rounded-md shadow-lg"
            :loading="auth.isLoading"
          />
        </div>
      </form>
    </div>
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
