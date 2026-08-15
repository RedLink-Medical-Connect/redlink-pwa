<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getCurrentUser } from 'aws-amplify/auth'
import { useAnimals } from '@/composables/useAnimals'
import { Species, DonationFrequency, BloodGroupsBySpecies, AnimalSex } from '@/constants/enums.js'

const { t } = useI18n()
const router = useRouter()

const error = ref('')
const currentOwnerId = ref(null)
const { createNewAnimal, isSaving } = useAnimals()

const form = ref({
  name: '',
  species: Species.DOG,
  breed: '',
  sex: null,
  birthDate: '',
  weight: null,
  bloodGroup: '',
  isVaccinated: false,
  isSterilized: false,
  donationFrequency: DonationFrequency.ASAP,
})

const speciesOptions = computed(() => [
  { label: t('request.species.dog'), value: Species.DOG },
  { label: t('request.species.cat'), value: Species.CAT },
])

const bloodOptions = computed(() => BloodGroupsBySpecies[form.value.species] || [])

const sexOptions = computed(() => [
  { label: t('dashboard.owner.animals.sex.male'), value: AnimalSex.MALE },
  { label: t('dashboard.owner.animals.sex.female'), value: AnimalSex.FEMALE },
])

const frequencyOptions = computed(() => [
  { label: t('dashboard.owner.animals.frequency.asap'), value: DonationFrequency.ASAP },
  { label: t('dashboard.owner.animals.frequency.twice_year'), value: DonationFrequency.TWICE_YEAR },
  { label: t('dashboard.owner.animals.frequency.once_year'), value: DonationFrequency.ONCE_YEAR },
])

onMounted(async () => {
  try {
    const { userId } = await getCurrentUser()

    if (userId) {
      currentOwnerId.value = userId
    } else {
      error.value = t('errors.auth_required')
      await router.push('/login')
    }
  } catch (e) {
    console.error(e)
    error.value = t('errors.auth_required')
    await router.push('/login')
  }
})

const handleSubmit = async () => {
  // Sous-tâche 6.1 : bloodGroup ajouté aux champs obligatoires — sans lui,
  // `useAnimals.js`/`createAnimalSimple` enverrait un `bloodGroup` vide (accepté par
  // le schéma, `String!`) et l'Animal ne matcherait jamais aucune Request à groupe
  // précis, sans le moindre avertissement (voir roadmap 6.1).
  if (!form.value.name || !form.value.weight || !form.value.bloodGroup || !currentOwnerId.value) {
    error.value = t('errors.fill_required_fields')
    return
  }

  try {
    error.value = ''

    await createNewAnimal(form.value, currentOwnerId.value)
    await router.push('/dashboard/animals')
  } catch (err) {
    console.error('Erreur Ajout Animal:', err)
    if (err.errors && err.errors.length > 0) {
      error.value = t('errors.technical_with_message', { message: err.errors[0].message })
    } else {
      error.value = t('errors.generic')
    }
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto p-6 animate-fade-in">
    <div class="mb-8 flex items-center justify-between">
      <div>
        <h1
          class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider border-l-4 border-[#ff3b4e] pl-4"
        >
          {{ $t('dashboard.owner.animals.add.title') }}
        </h1>
        <p class="text-zinc-500 mt-2 ml-5 text-sm">
          {{ $t('dashboard.owner.animals.add.subtitle') }}
        </p>
      </div>
      <Button
        icon="pi pi-times"
        variant="text"
        class="!text-zinc-400 hover:!text-zinc-900 dark:hover:!text-white"
        @click="router.back()"
      />
    </div>

    <div
      class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 md:p-8 shadow-sm"
    >
      <Message v-if="error" severity="error" class="mb-6">{{ error }}</Message>

      <form class="flex flex-col gap-6" @submit.prevent="handleSubmit">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="flex flex-col gap-2">
            <label class="text-xs font-bold text-zinc-500 uppercase">{{
              $t('dashboard.owner.animals.form.name')
            }}</label>
            <InputText
              v-model="form.name"
              :placeholder="$t('dashboard.owner.animals.form.name_placeholder')"
              class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !p-3 focus:!border-[#ff3b4e]"
              required
            />
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs font-bold text-zinc-500 uppercase">{{
              $t('dashboard.owner.animals.form.species')
            }}</label>
            <Select
              v-model="form.species"
              :options="speciesOptions"
              option-label="label"
              option-value="value"
              class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white w-full"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="flex flex-col gap-2">
            <label class="text-xs font-bold text-zinc-500 uppercase">{{
              $t('dashboard.owner.animals.form.breed_optional')
            }}</label>
            <InputText
              v-model="form.breed"
              :placeholder="$t('dashboard.owner.animals.form.breed_placeholder')"
              class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !p-3 focus:!border-[#ff3b4e]"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs font-bold text-zinc-500 uppercase">{{
              $t('dashboard.owner.animals.form.birthdate')
            }}</label>
            <AppDatePicker
              v-model="form.birthDate"
              :placeholder="$t('auth.register_owner.fields.animal_birth_date')"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs font-bold text-zinc-500 uppercase">{{
              $t('dashboard.owner.animals.form.sex')
            }}</label>
            <Select
              v-model="form.sex"
              :options="sexOptions"
              option-label="label"
              option-value="value"
              :placeholder="$t('dashboard.owner.animals.form.sex_placeholder')"
              show-clear
              class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white w-full"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="flex flex-col gap-2">
            <label class="text-xs font-bold text-zinc-500 uppercase">{{
              $t('dashboard.owner.animals.form.weight_label')
            }}</label>
            <InputNumber
              v-model="form.weight"
              :min-fraction-digits="1"
              :max-fraction-digits="1"
              suffix=" kg"
              placeholder="25.5"
              class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 focus:!border-[#ff3b4e]"
              input-class="!bg-transparent !border-none !p-3"
              required
            />
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs font-bold text-zinc-500 uppercase">{{
              $t('dashboard.owner.animals.form.blood_group')
            }}</label>
            <Select
              v-model="form.bloodGroup"
              :options="bloodOptions"
              :disabled="!form.species"
              :placeholder="$t('dashboard.owner.animals.form.blood_group_placeholder')"
              required
              class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !p-3 focus:!border-[#ff3b4e]"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs font-bold text-zinc-500 uppercase">{{
              $t('dashboard.owner.animals.form.donation_frequency')
            }}</label>
            <Select
              v-model="form.donationFrequency"
              :options="frequencyOptions"
              option-label="label"
              option-value="value"
              class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white w-full"
            />
          </div>
        </div>

        <div
          class="flex flex-col md:flex-row gap-6 mt-2 p-4 bg-zinc-50 dark:bg-zinc-950/50 rounded-lg border border-zinc-200 dark:border-zinc-800"
        >
          <div class="flex items-center gap-3">
            <Checkbox v-model="form.isVaccinated" :binary="true" input-id="vac" />
            <label for="vac" class="text-sm cursor-pointer select-none">{{
              $t('dashboard.owner.animals.form.vaccinated_required')
            }}</label>
          </div>
          <div class="flex items-center gap-3">
            <Checkbox v-model="form.isSterilized" :binary="true" input-id="ster" />
            <label for="ster" class="text-sm cursor-pointer select-none">{{
              $t('dashboard.owner.animals.form.sterilized')
            }}</label>
          </div>
        </div>

        <div class="pt-6 mt-2 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-4">
          <Button
            :label="$t('common.cancel')"
            variant="text"
            class="text-zinc-500! hover:!text-zinc-900 dark:hover:!text-white"
            @click="router.back()"
          />
          <Button
            type="submit"
            :label="$t('dashboard.owner.animals.add.submit')"
            icon="pi pi-check"
            class="bg-[#ff3b4e]! border-[#ff3b4e]! hover:bg-[#e63545]!"
            :loading="isSaving"
          />
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.4s ease-out;
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
