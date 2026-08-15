<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'
import { resendSignUpCode, getCurrentUser } from 'aws-amplify/auth'
import { generateClient } from 'aws-amplify/api'

import {
  createOwnerSimple,
  createAnimalSimple,
  createOwnerAvailabilitySimple,
  createClinicSimple,
  createVeterinarianSimple
} from '@/graphql/custom-mutations'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { t } = useI18n()
const client = generateClient()

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
      if (!e.message.includes('Current status is CONFIRMED')) throw e
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

    const data = registrationData

    if (data.role === 'owner') {
      const ownerRes = await client.graphql({
        query: createOwnerSimple,
        variables: { input: {
            id: cognitoUserId,
            firstname: data.firstname,
            lastname: data.lastname,
            email: data.email,
            phone: data.phone || '',
            address: data.address || '',
            latitude: parseFloat(data.latitude || 0),
            longitude: parseFloat(data.longitude || 0),
            maxTravelDistance: 50,
            totalDonations: 0
          }}
      })

      const ownerID = ownerRes.data.createOwner.id

      if (data.animal_name) {
        await client.graphql({
          query: createAnimalSimple,
          variables: { input: {
              ownerID: ownerID,
              name: data.animal_name,
              species: (data.animal_species || 'DOG').toUpperCase(),
              breed: data.animal_breed || '',
              // Sous-tâche 6.8 : champ informatif uniquement, optionnel (voir schema.graphql).
              sex: data.animal_sex || null,
              weight: parseFloat(data.animal_weight || 0),
              bloodGroup: data.blood_group || 'UNKNOWN',
              isVaccinated: true,
              isSterilized: false,
              donationFrequency: 'ASAP'
            }}
        })
      }

      await client.graphql({
        query: createOwnerAvailabilitySimple,
        variables: { input: {
            ownerID: ownerID,
            dayOfWeek: 6,
            startTime: "09:00Z",
            endTime: "12:00Z"
          }}
      })

    } else if (data.role === 'vet') {
      // Clinic.id est un identifiant propre généré côté backend (comme Animal/OwnerAvailability) :
      // Clinic.veterinarians est une relation @hasMany, un Clinic peut donc avoir plusieurs
      // Veterinarian, et Clinic.id ne doit jamais être aliasé sur le cognitoUserId d'un vétérinaire.
      const clinicRes = await client.graphql({
        query: createClinicSimple,
        variables: { input: {
            name: data.clinic_name,
            rpps: data.rpps,
            email: data.email,
            phone: data.phone || '',
            address: data.address,
            latitude: parseFloat(data.latitude || 0),
            longitude: parseFloat(data.longitude || 0),
            hasEmergencyService: false,
            transfusionsDone: 0,
            donorOwnersCount: 0
          }}
      })

      await client.graphql({
        query: createVeterinarianSimple,
        variables: { input: {
            id: cognitoUserId,
            clinicID: clinicRes.data.createClinic.id,
            firstname: data.firstname,
            lastname: data.lastname,
            email: data.email
          }}
      })
    }

    auth.clearTempRegistrationData()
    localStorage.removeItem('temp_register_safe_data')
    await router.push('/dashboard')

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
