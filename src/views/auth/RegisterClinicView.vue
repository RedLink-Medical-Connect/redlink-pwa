<script setup>
import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'
// Auto-import: InputText, Password, Button, Message

const auth = useAuthStore()
const { t } = useI18n()
const step = ref(1) // 1 = Véto (Compte), 2 = Clinique (Infos)

// Données réactives complètes
const form = ref({
  // Etape 1 : Le compte utilisateur (Véto référent)
  lastname: '',
  firstname: '',
  email: '',
  rpps: '',
  password: '',
  confirm_password: '',

  // Etape 2 : La structure (Clinique)
  clinic_name: '',
  address: '',
  city: '',
  zip: ''
})

// Validation Mot de passe (Temps réel)
const isPasswordValid = computed(() => {
  if (!form.value.password) return true
  return form.value.password.length >= 8
})

// Passage à l'étape 2 (Validation locale)
const nextStep = () => {
  // Vérification basique des champs requis de l'étape 1
  if (!form.value.lastname || !form.value.firstname || !form.value.email || !form.value.password) {
    auth.setError(t('errors.fill_required_fields'))
    return
  }

  if (form.value.password !== form.value.confirm_password) {
    auth.setError(t('errors.passwords_not_match'))
    return
  }

  if (!isPasswordValid.value) {
    auth.setError(t('errors.password_too_short'))
    return
  }

  auth.clearError() // Nettoyage des erreurs
  step.value = 2
}

// Soumission Finale (Vers AWS)
const handleRegister = async () => {
  // Appel au Store (Rôle = 'vet')
  // On passe toutes les infos, même si pour l'instant 'register' ne stocke que l'email/password/nom dans Cognito.
  // Plus tard, vous pourrez modifier 'auth.register' pour qu'il sauvegarde aussi 'clinic_name' et 'rpps' dans DynamoDB.
  await auth.register(
    form.value.email,
    form.value.password,
    `${form.value.firstname} ${form.value.lastname}`,
    'vet' // Rôle spécifique
  )
}
</script>

<template>
  <div class="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-12 items-start">

    <div class="hidden md:block relative h-[600px] w-full rounded-sm overflow-hidden shadow-2xl">
      <img src="https://images.unsplash.com/photo-1629909613654-28e377c37b09?q=80&w=2068&auto=format&fit=crop" class="absolute inset-0 w-full h-full object-cover" />
      <div class="absolute inset-0 bg-black/20"></div>
    </div>

    <div class="flex flex-col gap-8 w-full max-w-md mx-auto md:mx-0">

      <h1 class="text-3xl font-bold text-zinc-900 dark:text-white border-b-2 border-[#ff3b4e] pb-2 inline-block w-fit uppercase tracking-wider">
        {{ step === 1 ? $t('auth.register_clinic.title_step1') : $t('auth.register_clinic.title_step2') }}
      </h1>

      <Message v-if="auth.error" severity="error" class="mb-4">
        {{ typeof auth.error === 'string' && auth.error.startsWith('errors.') ? $t(auth.error) : auth.error }}
      </Message>

      <form v-if="step === 1" class="flex flex-col gap-4 animate-fade-in" @submit.prevent="nextStep">
        <div class="grid grid-cols-2 gap-4">
          <InputText v-model="form.lastname" :placeholder="$t('auth.register_owner.fields.lastname')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3" required />
          <InputText v-model="form.firstname" :placeholder="$t('auth.register_owner.fields.firstname')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3" required />
        </div>

        <InputText v-model="form.email" type="email" :placeholder="$t('auth.register_owner.fields.email')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3" required />
        <InputText v-model="form.rpps" :placeholder="$t('auth.register_clinic.fields.rpps')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3" />

        <div class="grid grid-cols-2 gap-4 items-start">
          <div class="flex flex-col gap-1">
            <Password
              v-model="form.password"
              :placeholder="$t('auth.register_owner.fields.password')"
              toggle-mask
              :feedback="false"
              class="w-full"
              input-class="w-full !bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3"
              :invalid="!isPasswordValid && form.password.length > 0"
              required
            />
            <small v-if="form.password.length > 0 && !isPasswordValid" class="text-red-500 text-[10px] font-bold ml-1">
              {{ $t('errors.password_too_short') }}
            </small>
          </div>

          <Password v-model="form.confirm_password" :placeholder="$t('auth.register_owner.fields.confirm_password')" :feedback="false" class="w-full" input-class="w-full !bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3" required />
        </div>

        <Button type="submit" :label="$t('auth.register_clinic.next')" class="!bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 !mt-4 shadow-lg shadow-red-500/20" />
      </form>

      <form v-else class="flex flex-col gap-4 animate-fade-in" @submit.prevent="handleRegister">
        <InputText v-model="form.clinic_name" :placeholder="$t('auth.register_clinic.fields.clinic_name')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3" />
        <InputText v-model="form.address" :placeholder="$t('auth.register_owner.fields.address')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3" />

        <div class="grid grid-cols-2 gap-4">
          <InputText v-model="form.city" :placeholder="$t('auth.register_owner.fields.city')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3" />
          <InputText v-model="form.zip" :placeholder="$t('auth.register_owner.fields.zip')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3" />
        </div>

        <div class="flex gap-4 mt-4">
          <Button icon="pi pi-arrow-left" class="!bg-zinc-200 dark:!bg-zinc-800 !text-zinc-500 !border-none" @click="step = 1" />

          <Button
            type="submit"
            :label="$t('auth.register_clinic.finish')"
            class="flex-grow !bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 shadow-lg shadow-red-500/20"
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
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
