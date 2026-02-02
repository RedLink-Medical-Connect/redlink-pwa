<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import AddressAutocomplete from '@/components/common/AddressAutocomplete.vue'
import PhoneInput from '@/components/common/PhoneInput.vue'
import DataMigrationHelper from '@/components/debug/DataMigrationHelper.vue'
import { useToast } from 'primevue/usetoast'
import { useClinicSettings } from '@/composables/useClinicSettings'
import Dialog from 'primevue/dialog'

const { t } = useI18n()
const showDeleteConfirm = ref(false)
const showMigrationHelper = ref(false)
const toast = useToast()

const activeTab = ref('general')

const {
  clinicForm,
  vetForm,
  isLoading,
  isSaving,
  fetchSettings,
  updateClinicDetails,
  updateVetDetails,
  deleteAccount,
} = useClinicSettings()

const tabs = [
  { id: 'general', label: 'dashboard.settings.tabs.general' },
  { id: 'vet_ref', label: 'dashboard.settings.tabs.vet_ref' },
]

onMounted(() => {
  fetchSettings().catch((error) => {
    console.error('❌ Erreur lors du chargement des paramètres:', error)
    console.log('🔧 SOLUTIONS DE DÉBOGAGE DISPONIBLES:')
    console.log('1. Tapez "debugData()" pour analyser les données')
    console.log('2. Tapez "createTestData()" pour créer des données de test')
    console.log('3. Tapez "migrateVeterinarianData()" pour migrer les données existantes')
    console.log('4. Tapez "analyzeCurrentData()" pour analyser la situation actuelle')

    showMigrationHelper.value = true

    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail:
        'Aucun profil vétérinaire trouvé. Consultez la console pour les solutions de débogage.',
      life: 10000,
    })
  })
})

const onMigrationSuccess = async () => {
  showMigrationHelper.value = false
  try {
    await fetchSettings()
    toast.add({
      severity: 'success',
      summary: 'Succès',
      detail: 'Données rechargées avec succès',
      life: 3000,
    })
  } catch (error) {
    console.error('Erreur lors du rechargement:', error)
  }
}

const onAddressSelect = (data) => {
  clinicForm.value.address = data.address
  clinicForm.value.latitude = data.latitude
  clinicForm.value.longitude = data.longitude
}

const onSaveClinic = async () => {
  try {
    await updateClinicDetails()
    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t('dashboard.settings.toasts.save_clinic'),
      life: 3000,
    })
  } catch (e) {
    console.error(e)
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: e.message || t('dashboard.settings.toasts.save_failed'),
      life: 3000,
    })
  }
}

const onSaveVet = async () => {
  try {
    await updateVetDetails()
    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t('dashboard.settings.toasts.save_vet'),
      life: 3000,
    })
  } catch (e) {
    console.error(e)
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: e.message || t('dashboard.settings.toasts.save_failed'),
      life: 3000,
    })
  }
}

const onDelete = async () => {
  try {
    await deleteAccount()
    toast.add({
      severity: 'info',
      summary: t('common.deleted'),
      detail: t('dashboard.settings.toasts.deleted'),
      life: 3000,
    })
  } catch (e) {
    console.error(e)
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t('dashboard.settings.toasts.delete_failed'),
      life: 5000,
    })
    showDeleteConfirm.value = false
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <Toast />

    <Dialog
      v-model:visible="showDeleteConfirm"
      modal
      :header="$t('dashboard.profile.dialog.title')"
      :style="{ width: '350px' }"
    >
      <div class="flex items-center gap-3 mb-4">
        <i class="pi pi-exclamation-triangle text-red-600 text-3xl"></i>
        <span class="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
          {{ $t('dashboard.settings.dialog.confirm') }}
        </span>
      </div>
      <template #footer>
        <Button
          :label="$t('common.cancel')"
          text
          class="!text-zinc-500"
          @click="showDeleteConfirm = false"
        />
        <Button
          :label="$t('dashboard.settings.dialog.confirm_action')"
          severity="danger"
          :loading="isSaving"
          @click="onDelete"
        />
      </template>
    </Dialog>
    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />

      <div class="flex-grow">
        <div
          class="bg-white dark:bg-zinc-900 rounded-t-lg border-b border-zinc-200 dark:border-zinc-800 p-2 flex flex-wrap gap-1 transition-colors duration-300"
        >
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="px-4 py-2 text-[10px] md:text-xs font-bold uppercase rounded transition-colors"
            :class="
              activeTab === tab.id
                ? 'bg-[#ff3b4e] text-white shadow-md'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            "
            @click="activeTab = tab.id"
          >
            {{ $t(tab.label) }}
          </button>
        </div>

        <div
          class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-b-lg p-6 md:p-10 animate-fade-in min-h-[500px] shadow-sm transition-colors duration-300 relative"
        >
          <div
            v-if="isLoading"
            class="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-zinc-900/80 z-10 rounded-b-lg"
          >
            <i class="pi pi-spin pi-spinner text-4xl text-[#ff3b4e]"></i>
          </div>

          <!-- Composant d'aide à la migration -->
          <DataMigrationHelper v-if="showMigrationHelper" @migration-success="onMigrationSuccess" />

          <form
            v-if="activeTab === 'general'"
            class="flex flex-col gap-6 max-w-3xl"
            @submit.prevent="onSaveClinic"
          >
            <h2
              class="text-xl font-bold text-zinc-900 dark:text-white mb-4 border-l-4 border-[#ff3b4e] pl-3"
            >
              {{ $t('dashboard.settings.tabs.general') }}
            </h2>

            <div class="flex flex-col gap-2">
              <label class="text-xs font-bold text-zinc-500 uppercase">{{
                $t('dashboard.settings.clinic_name')
              }}</label>
              <InputText
                v-model="clinicForm.name"
                class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]"
              />
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">
                  {{ $t('dashboard.settings.tabs.general') }}
                </label>
                <InputText
                  v-model="clinicForm.rpps"
                  class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]"
                />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{
                  $t('dashboard.settings.email')
                }}</label>
                <InputText
                  v-model="clinicForm.email"
                  class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]"
                />
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs font-bold text-zinc-500 uppercase">{{
                $t('dashboard.settings.phone')
              }}</label>
              <PhoneInput
                v-model="clinicForm.phone"
                class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]"
              />
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs font-bold text-zinc-500 uppercase">{{
                $t('dashboard.settings.address')
              }}</label>
              <AddressAutocomplete
                :model-value="clinicForm.address"
                class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]"
                @select="onAddressSelect"
              />
            </div>

            <div
              class="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-950/50 rounded-lg border border-zinc-200 dark:border-zinc-800"
            >
              <Checkbox
                v-model="clinicForm.hasEmergencyService"
                :binary="true"
                input-id="emergency"
              />
              <label for="emergency" class="text-sm font-medium cursor-pointer">{{
                $t('dashboard.settings.emergency')
              }}</label>
            </div>

            <div class="flex justify-end mt-4 pt-6 border-t border-zinc-200 dark:border-zinc-800">
              <Button
                type="submit"
                :label="$t('dashboard.settings.save')"
                :loading="isSaving"
                class="!bg-[#ff3b4e] !border-[#ff3b4e] !text-white font-bold px-8 py-3 shadow-lg hover:!bg-[#e63545]"
              />
            </div>
          </form>

          <form
            v-else-if="activeTab === 'vet_ref'"
            class="flex flex-col gap-6 max-w-3xl"
            @submit.prevent="onSaveVet"
          >
            <h2
              class="text-xl font-bold text-zinc-900 dark:text-white mb-4 border-l-4 border-[#ff3b4e] pl-3"
            >
              {{ $t('dashboard.settings.tabs.vet_ref') }}
            </h2>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">
                  {{ $t('dashboard.settings.firstname') }}
                </label>
                <InputText
                  v-model="vetForm.firstname"
                  class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]"
                />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">
                  {{ $t('dashboard.settings.lastname') }}
                </label>
                <InputText
                  v-model="vetForm.lastname"
                  class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]"
                />
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <InputText
                v-model="vetForm.email"
                disabled
                class="!bg-zinc-100 dark:!bg-zinc-900 !border-zinc-200 dark:!border-zinc-800 !text-zinc-400 !p-3 cursor-not-allowed"
              />
            </div>

            <div
              class="flex justify-between items-center mt-10 pt-6 border-t border-zinc-200 dark:border-zinc-800"
            >
              <Button
                class="!bg-transparent !text-red-600 dark:!text-red-500 hover:!text-red-700 !text-[10px] font-bold border border-red-500/30 px-3 py-2"
                :loading="isSaving"
                :label="$t('dashboard.settings.delete_account')"
                @click="showDeleteConfirm = true"
              />

              <Button
                type="submit"
                :label="$t('dashboard.settings.save')"
                :loading="isSaving"
                class="!bg-[#ff3b4e] !border-[#ff3b4e] !text-white font-bold px-8 py-3 shadow-lg hover:!bg-[#e63545]"
              />
            </div>
          </form>

          <div
            v-else
            class="h-full flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-600"
          >
            <i class="pi pi-briefcase text-4xl mb-2 opacity-20"></i>
            <p>{{ $t('dashboard.settings.under_construction') }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
:deep(.p-confirmdialog) {
  background-color: var(--p-content-background);
  border: 1px solid #27272a;
}
:deep(.p-dialog-header),
:deep(.p-dialog-content),
:deep(.p-dialog-footer) {
  background-color: transparent !important;
  color: inherit;
}
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
