<script setup>
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'
// L'auto-import gère les composants (InputText, Button...)

const auth = useAuthStore()
const { t } = useI18n()
const step = ref(1) // 1 = Propriétaire, 2 = Animal

// Données réactives
const form = ref({
  lastname: '',
  firstname: '',
  email: '',
  phone: '',
  password: '',
  confirm_password: '',
  address: '',
  // Champs animaux (stockés pour plus tard)
  animal_name: '',
  animal_age: '',
  animal_species: '',
  animal_breed: '',
  blood_group: ''
})

const handleRegister = async () => {
  // 1. Validation simple
  if (form.value.password !== form.value.confirm_password) {
    auth.setError(t('errors.passwords_not_match'))
    return
  }

  // 2. Appel au Store (Création du compte Cognito)
  await auth.register(
    form.value.email,
    form.value.password,
    `${form.value.firstname} ${form.value.lastname}`, // On combine pour le nom complet
    'owner' // Rôle spécifique
  )
}
</script>

<template>
  <div class="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-12 items-start">

    <div class="hidden md:block relative h-[600px] w-full rounded-sm overflow-hidden shadow-2xl transition-all duration-500">
      <img
        :src="step === 1
          ? 'https://images.unsplash.com/photo-1517849845537-4d257902454a?q=80&w=1000&auto=format&fit=crop'
          : 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?q=80&w=1000&auto=format&fit=crop'"
        class="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
      />
      <div class="absolute inset-0 bg-black/20"></div>
    </div>

    <div class="flex flex-col gap-8 w-full max-w-md mx-auto md:mx-0">

      <h1 class="text-3xl font-bold text-zinc-900 dark:text-white border-b-2 border-[#ff3b4e] pb-2 inline-block w-fit uppercase tracking-wider">
        {{ step === 1 ? $t('auth.register_owner.title_step1') : $t('auth.register_owner.title_step2') }}
      </h1>

      <Message v-if="auth.error" severity="error">
        {{ typeof auth.error === 'string' && auth.error.startsWith('errors.') ? $t(auth.error) : auth.error }}
      </Message>

      <form v-if="step === 1" class="flex flex-col gap-4 animate-fade-in" @submit.prevent="step = 2">
        <div class="grid grid-cols-2 gap-4">
          <InputText v-model="form.lastname" :placeholder="$t('auth.register_owner.fields.lastname')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md" required />
          <InputText v-model="form.firstname" :placeholder="$t('auth.register_owner.fields.firstname')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md" required />
        </div>
        <InputText v-model="form.email" type="email" :placeholder="$t('auth.register_owner.fields.email')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md" required />
        <InputText v-model="form.phone" :placeholder="$t('auth.register_owner.fields.phone')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md" />
        <InputText v-model="form.address" :placeholder="$t('auth.register_owner.fields.address')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md" />

        <div class="grid grid-cols-2 gap-4">
          <Password v-model="form.password" :placeholder="$t('auth.register_owner.fields.password')" toggle-mask :feedback="false" class="w-full" input-class="w-full !bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3" required />
          <Password v-model="form.confirm_password" :placeholder="$t('auth.register_owner.fields.confirm_password')" :feedback="false" class="w-full" input-class="w-full !bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3" required />
        </div>

        <Button type="submit" :label="$t('auth.register_owner.next')" class="!bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 !mt-4 !rounded-md shadow-lg shadow-red-500/20" />
      </form>

      <form v-else class="flex flex-col gap-4 animate-fade-in" @submit.prevent="handleRegister">
        <div class="grid grid-cols-2 gap-4">
          <InputText v-model="form.animal_name" :placeholder="$t('auth.register_owner.fields.animal_name')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md" />
          <InputText v-model="form.animal_age" :placeholder="$t('auth.register_owner.fields.animal_age')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md" />
        </div>
        <div class="grid grid-cols-2 gap-4">
          <InputText v-model="form.animal_species" :placeholder="$t('auth.register_owner.fields.animal_species')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md" />
          <InputText v-model="form.animal_breed" :placeholder="$t('auth.register_owner.fields.animal_breed')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md" />
        </div>
        <InputText v-model="form.blood_group" :placeholder="$t('auth.register_owner.fields.blood_group')" class="!bg-zinc-200 dark:!bg-zinc-800 !border-none !text-zinc-900 dark:!text-white !p-3 !rounded-md" />

        <div class="flex gap-4 mt-4">
          <Button icon="pi pi-arrow-left" class="!bg-zinc-200 dark:!bg-zinc-800 !text-zinc-500 !border-none" @click="step = 1" />
          <Button
            type="submit"
            :label="$t('auth.register_owner.finish')"
            class="flex-grow !bg-[#ff3b4e] !border-none !text-white !font-black !uppercase !py-4 !rounded-md"
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
