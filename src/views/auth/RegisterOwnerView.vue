<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { usePassword } from '@/composables/usePassword'
import { useI18n } from 'vue-i18n'
import AddressAutocomplete from '@/components/common/AddressAutocomplete.vue'
import PhoneInput from '@/components/common/PhoneInput.vue'
import { Species, BloodGroupsBySpecies } from '@/constants/enums.js'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()

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
  phone: '',
  address: '',
  latitude: null,
  longitude: null,

  animal_name: '',
  animal_species: Species.DOG,
  animal_breed: '',
  animal_birthDate: '',
  animal_weight: null,
  blood_group: '',
})

const bloodOptions = computed(() => {
  return BloodGroupsBySpecies[form.value.animal_species] || []
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

  if (!form.value.latitude || !form.value.longitude) {
    auth.setError(t('errors.invalid_address'))
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
  // Sous-tâche 6.1 : bloodGroup est le seul champ obligatoire ajouté à ce step 2 —
  // sans lui, `useAnimals.js`/`createAnimalSimple` enverrait un `bloodGroup` vide
  // (accepté par le schéma, `String!`) et l'Animal ne matcherait jamais aucune Request
  // à groupe précis, sans le moindre avertissement (voir roadmap 6.1).
  if (!form.value.blood_group) {
    auth.setError(t('errors.fill_required_fields'))
    return
  }

  isLoading.value = true
  auth.clearError()

  try {
    await auth.register(
      form.value.email,
      password.value,
      `${form.value.firstname} ${form.value.lastname}`,
      'owner',
    )

    const payload = {
      ...form.value,
      role: 'owner',
    }

    auth.setTempRegistrationData({
      ...payload,
      password: password.value,
    })

    const safePayload = { ...payload }
    localStorage.setItem('temp_register_safe_data', JSON.stringify(safePayload))

    await router.push({ name: 'verify-email', query: { email: form.value.email } })
  } catch (err) {
    console.error(err)
    auth.setError(err.message || t('errors.registration_failed'))
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
        :src="
          step === 1
            ? 'https://images.unsplash.com/photo-1517849845537-4d257902454a?q=80&w=1000&auto=format&fit=crop'
            : 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?q=80&w=1000&auto=format&fit=crop'
        "
        class="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
      />
      <div class="absolute inset-0 bg-black/20"></div>
    </div>

    <div class="flex flex-col gap-8 w-full max-w-md mx-auto md:mx-0">
      <h1
        class="text-3xl font-bold text-zinc-900 dark:text-white border-b-2 border-[#ff3b4e] pb-2 inline-block w-fit uppercase tracking-wider"
      >
        {{
          step === 1 ? $t('auth.register_owner.title_step1') : $t('auth.register_owner.title_step2')
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
            :placeholder="$t('auth.register_owner.fields.lastname')"
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md"
            required
          />
          <InputText
            v-model="form.firstname"
            :placeholder="$t('auth.register_owner.fields.firstname')"
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md"
            required
          />
        </div>

        <InputText
          v-model="form.email"
          type="email"
          :placeholder="$t('auth.register_owner.fields.email')"
          class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md"
          required
        />

        <PhoneInput v-model="form.phone" />

        <AddressAutocomplete :model-value="form.address" @select="onAddressSelect" />

        <div class="grid grid-cols-2 gap-4 items-start">
          <div class="flex flex-col gap-1">
            <Password
              v-model="password"
              :placeholder="$t('auth.register_owner.fields.password')"
              toggle-mask
              :feedback="false"
              class="w-full"
              input-class="w-full !bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3"
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
            :placeholder="$t('auth.register_owner.fields.confirm_password')"
            :feedback="false"
            class="w-full"
            input-class="w-full !bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3"
            required
          />
        </div>

        <Button
          type="submit"
          :label="$t('auth.register_owner.next')"
          class="!bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 !mt-4 !rounded-md shadow-lg shadow-red-500/20"
        />
      </form>

      <form v-else class="flex flex-col gap-4 animate-fade-in" @submit.prevent="handleRegister">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputText
            v-model="form.animal_name"
            :placeholder="$t('auth.register_owner.fields.animal_name')"
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md w-full"
          />

          <Calendar
            v-model="form.animal_birthDate"
            date-format="dd/mm/yy"
            :placeholder="$t('auth.register_owner.fields.animal_birth_date')"
            :manual-input="false"
            show-icon
            icon-display="input"
            class="w-full"
            input-class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md w-full placeholder:!text-zinc-500"
            :pt="{
              root: { class: 'w-full' },
              input: { class: 'w-full !shadow-none focus:!ring-0' },
              dropdownButton: { class: '!bg-transparent !text-zinc-500 !border-none' },
            }"
          />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <select
            v-model="form.animal_species"
            class="bg-zinc-200 dark:bg-zinc-800 border-none text-zinc-900 dark:text-white p-3 rounded-md w-full appearance-none"
          >
            <option :value="Species.DOG">{{ $t('request.species.dog') }}</option>
            <option :value="Species.CAT">{{ $t('request.species.cat') }}</option>
          </select>
          <InputText
            v-model="form.animal_breed"
            :placeholder="$t('auth.register_owner.fields.animal_breed')"
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md"
          />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <InputText
            v-model="form.animal_weight"
            type="number"
            step="0.1"
            :placeholder="$t('auth.register_owner.fields.animal_weight')"
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md"
          />
          <Select
            v-model="form.blood_group"
            :options="bloodOptions"
            :disabled="!form.animal_species"
            :placeholder="$t('auth.register_owner.fields.blood_group')"
            required
            class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md"
          />
        </div>

        <div class="flex gap-4 mt-4">
          <Button
            icon="pi pi-arrow-left"
            class="!bg-zinc-200 dark:!bg-zinc-800 !text-zinc-500 !border-none"
            @click="step = 1"
          />
          <Button
            type="submit"
            :label="$t('auth.register_owner.finish')"
            class="flex-grow !bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 !rounded-md shadow-lg shadow-red-500/20"
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
