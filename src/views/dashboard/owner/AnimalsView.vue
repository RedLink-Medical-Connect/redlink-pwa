<script setup>
import { onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'

import { useAnimals } from '@/composables/useAnimals'

const { t } = useI18n()
const router = useRouter()
const toast = useToast()

const { animals, isLoading, isSaving, fetchAnimals, updateAnimalDetails, deleteAnimalById } =
  useAnimals()

const showEditModal = ref(false)
const showDeleteModal = ref(false)
const selectedAnimal = ref(null)
const editForm = ref({})

const speciesOptions = computed(() => [
  { label: t('request.species.dog'), value: 'DOG' },
  { label: t('request.species.cat'), value: 'CAT' },
])

const frequencyOptions = computed(() => [
  { label: t('dashboard.owner.animals.frequency.asap'), value: 'ASAP' },
  { label: t('dashboard.owner.animals.frequency.twice_year'), value: 'TWICE_YEAR' },
  { label: t('dashboard.owner.animals.frequency.once_year'), value: 'ONCE_YEAR' },
])

onMounted(() => {
  fetchAnimals().catch((err) => {
    if (err.message === 'SessionExpired') {
      router.push('/login')
    } else {
      toast.add({
        severity: 'error',
        summary: t('common.error'),
        detail: t('dashboard.owner.animals.toasts.load_failed'),
      })
    }
  })
})

const openEditModal = (animal) => {
  selectedAnimal.value = animal
  editForm.value = JSON.parse(JSON.stringify(animal))
  showEditModal.value = true
}

const onSave = async () => {
  try {
    await updateAnimalDetails(editForm.value)

    showEditModal.value = false
    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t('dashboard.owner.animals.toasts.saved'),
      life: 3000,
    })
  } catch (e) {
    console.error(e)
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t('dashboard.owner.animals.toasts.save_failed'),
      life: 3000,
    })
  }
}

const openDeleteModal = (animal) => {
  selectedAnimal.value = animal
  showDeleteModal.value = true
}

const onDelete = async () => {
  try {
    await deleteAnimalById(selectedAnimal.value.id)
    showDeleteModal.value = false
    toast.add({
      severity: 'info',
      summary: t('common.deleted'),
      detail: t('dashboard.owner.animals.toasts.deleted'),
      life: 3000,
    })
  } catch (e) {
    console.error(e)
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t('dashboard.owner.animals.toasts.delete_failed'),
      life: 3000,
    })
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <Toast />

    <Dialog
      v-model:visible="showEditModal"
      modal
      :header="$t('dashboard.owner.animals.dialog.edit_title')"
      :style="{ width: '500px' }"
      class="p-fluid"
    >
      <div class="flex flex-col gap-4 pt-2">
        <InputText v-model="editForm.name" :placeholder="$t('dashboard.owner.animals.form.name')" />
        <div class="grid grid-cols-2 gap-2">
          <Select
            v-model="editForm.species"
            :options="speciesOptions"
            option-label="label"
            option-value="value"
          />
          <InputText v-model="editForm.breed" :placeholder="$t('dashboard.owner.animals.form.breed')" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <InputNumber
            v-model="editForm.weight"
            suffix=" kg"
            :placeholder="$t('dashboard.owner.animals.form.weight')"
            :min-fraction-digits="1"
          />
          <InputText v-model="editForm.birthDate" type="date" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <InputText
            v-model="editForm.bloodGroup"
            :placeholder="$t('dashboard.owner.animals.form.blood_group_placeholder')"
          />
          <Select
            v-model="editForm.donationFrequency"
            :options="frequencyOptions"
            option-label="label"
            option-value="value"
          />
        </div>
        <div class="flex gap-4 mt-2 p-3 bg-zinc-50 dark:bg-zinc-800 rounded">
          <div class="flex items-center gap-2">
            <Checkbox v-model="editForm.isVaccinated" :binary="true" />
            <label>{{ $t('dashboard.owner.animals.form.vaccinated') }}</label>
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="editForm.isSterilized" :binary="true" />
            <label>{{ $t('dashboard.owner.animals.form.sterilized') }}</label>
          </div>
        </div>
      </div>
      <template #footer>
        <Button
          :label="$t('common.cancel')"
          text
          class="text-zinc-500!"
          @click="showEditModal = false"
        />
        <Button
          :label="$t('common.save')"
          icon="pi pi-check"
          :loading="isSaving"
          class="bg-[#ff3b4e]! border-[#ff3b4e]!"
          @click="onSave"
        />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="showDeleteModal"
      modal
      :header="$t('dashboard.owner.animals.dialog.delete_title')"
      :style="{ width: '400px' }"
    >
      <div class="flex items-center gap-3">
        <i class="pi pi-exclamation-triangle text-red-500 text-2xl"></i>
        <p class="m-0 text-zinc-600 dark:text-zinc-300">
          {{ $t('dashboard.owner.animals.dialog.delete_confirm') }}
        </p>
      </div>
      <template #footer>
        <Button
          :label="$t('common.no')"
          text
          class="text-zinc-500!"
          @click="showDeleteModal = false"
        />
        <Button
          :label="$t('dashboard.owner.animals.dialog.delete_confirm_yes')"
          severity="danger"
          icon="pi pi-trash"
          :loading="isSaving"
          @click="onDelete"
        />
      </template>
    </Dialog>

    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />

      <div class="grow">
        <h1
          class="text-2xl font-bold text-zinc-900 dark:text-white border-l-4 border-[#ff3b4e] pl-4 mb-2"
        >
          {{ $t('dashboard.owner.animals.title') }}
        </h1>
        <p class="text-zinc-500 dark:text-zinc-400 text-sm mb-8 ml-5">
          {{ $t('dashboard.owner.animals.subtitle') }}
        </p>

        <div v-if="isLoading" class="p-20 text-center flex flex-col items-center gap-4">
          <i class="pi pi-spin pi-spinner text-4xl text-[#ff3b4e]"></i>
          <span class="text-zinc-400 text-sm">{{ $t('common.loading') }}</span>
        </div>

        <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
          <div
            class="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[#ff3b4e] hover:bg-red-50 dark:hover:bg-red-900/10 min-h-[250px] transition-all group"
            @click="router.push('/dashboard/animals/add')"
          >
            <div
              class="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center group-hover:bg-[#ff3b4e] transition-colors shadow-sm"
            >
              <i
                class="pi pi-plus text-2xl text-zinc-400 dark:text-zinc-500 group-hover:text-white"
              ></i>
            </div>
            <span
              class="font-bold text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors"
              >{{ $t('dashboard.owner.animals.add_card') }}</span
            >
          </div>

          <div
            v-for="animal in animals"
            :key="animal.id"
            class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 flex flex-col justify-between shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 transition-all min-h-[250px]"
          >
            <div class="flex justify-between items-start mb-4">
              <div class="flex items-center gap-4">
                <div
                  class="w-14 h-14 bg-zinc-50 dark:bg-zinc-800 rounded-full flex items-center justify-center text-3xl ring-4 ring-zinc-50 dark:ring-zinc-800 shadow-inner"
                >
                  {{ animal.species === 'DOG' ? '🐶' : '🐱' }}
                </div>
                <div>
                  <h3 class="font-black text-xl leading-none text-zinc-900 dark:text-white mb-1">
                    {{ animal.name }}
                  </h3>
                  <span class="text-xs font-bold uppercase text-zinc-400 tracking-wider">{{
                    animal.breed || $t('dashboard.owner.animals.unknown_breed')
                  }}</span>
                </div>
              </div>
              <Tag
                :value="animal.bloodGroup || '?'"
                :severity="animal.bloodGroup ? 'danger' : 'warning'"
                rounded
                class="font-bold shadow-sm"
              />
            </div>

            <div class="grid grid-cols-2 gap-3 text-sm text-zinc-500 mb-6">
              <div
                class="bg-zinc-50 dark:bg-zinc-950/50 p-3 rounded-lg text-center border border-zinc-100 dark:border-zinc-800"
              >
                <span class="block font-black text-lg text-zinc-800 dark:text-white"
                  >{{ animal.weight }} <small>kg</small></span
                >
                <span class="text-[10px] uppercase font-bold tracking-wide">{{
                  $t('dashboard.owner.animals.weight_label')
                }}</span>
              </div>
              <div
                class="bg-zinc-50 dark:bg-zinc-950/50 p-3 rounded-lg text-center border border-zinc-100 dark:border-zinc-800"
              >
                <span class="block font-black text-lg text-zinc-800 dark:text-white"
                  >{{ animal.age }} <small>{{ $t('common.years') }}</small></span
                >
                <span class="text-[10px] uppercase font-bold tracking-wide">{{
                  $t('dashboard.owner.animals.age_label')
                }}</span>
              </div>
            </div>

            <div class="flex gap-2 mt-auto">
              <Button
                :label="$t('common.edit')"
                icon="pi pi-pencil"
                size="small"
                variant="outlined"
                class="grow border-zinc-200! dark:border-zinc-700! text-zinc-600! dark:text-zinc-300! hover:bg-zinc-50! dark:hover:bg-zinc-800!"
                @click="openEditModal(animal)"
              />
              <Button
                icon="pi pi-trash"
                severity="danger"
                variant="outlined"
                size="small"
                class="border-red-100! dark:border-red-900/30! hover:bg-red-50! hover:border-red-500!"
                @click="openDeleteModal(animal)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
