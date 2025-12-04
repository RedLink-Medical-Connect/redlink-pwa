<script setup>
import { ref } from 'vue'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import { useConfirm } from "primevue/useconfirm"
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.js'

const activeTab = ref('general')
const confirm = useConfirm()
const { t } = useI18n()
const auth = useAuthStore()
const form = ref({
  clinicName: 'Clinique Vétérinaire St-Bernard',
  phone: '01 23 45 67 89',
  address: '12 Rue des Chiens',
  zip: '75000',
  city: 'Paris',
  email: 'contact@st-bernard.vet'
})

const tabs = [
  { id: 'general', label: 'dashboard.settings.tabs.general' },
  { id: 'subscription', label: 'dashboard.settings.tabs.subscription' },
  { id: 'vet_ref', label: 'dashboard.settings.tabs.vet_ref' },
  { id: 'notifications', label: 'dashboard.settings.tabs.notifications' }
]

const handleDeleteAccount = () => {
  confirm.require({
    message: t('dashboard.settings.delete_confirm.message'),
    header: t('dashboard.settings.delete_confirm.header'),
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: t('dashboard.settings.delete_confirm.reject'),
    acceptLabel: t('dashboard.settings.delete_confirm.accept'),
    rejectClass: '!bg-zinc-800 !border-zinc-700 !text-white hover:!bg-zinc-700',
    acceptClass: '!bg-red-600 !border-red-600 !text-white hover:!bg-red-700',
    accept: () => {
      auth.deleteAccount()
    }
  });
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <ConfirmDialog />
    <Toast />
    <div class="flex flex-col md:flex-row gap-8">

      <DashboardSidebar />

      <div class="flex-grow">

        <div class="bg-white dark:bg-zinc-900 rounded-t-lg border-b border-zinc-200 dark:border-zinc-800 p-2 flex flex-wrap gap-1 transition-colors duration-300">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="px-4 py-2 text-[10px] md:text-xs font-bold uppercase rounded transition-colors"
            :class="activeTab === tab.id
              ? 'bg-[#ff3b4e] text-white shadow-md'
              : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'"
            @click="activeTab = tab.id"
          >
            {{ $t(tab.label) }}
          </button>
        </div>

        <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-b-lg p-6 md:p-10 animate-fade-in min-h-[500px] shadow-sm transition-colors duration-300">

          <form v-if="activeTab === 'general'" class="flex flex-col gap-6 max-w-3xl">
            <h2 class="text-xl font-bold text-zinc-900 dark:text-white mb-4 border-l-4 border-[#ff3b4e] pl-3">
              {{ $t('dashboard.settings.tabs.general') }}
            </h2>

            <div class="flex flex-col gap-2">
              <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('dashboard.settings.clinic_name') }}</label>
              <InputText v-model="form.clinicName" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('dashboard.settings.phone') }}</label>
                <InputText v-model="form.phone" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('dashboard.settings.email') }}</label>
                <InputText v-model="form.email" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('dashboard.settings.address') }}</label>
              <InputText v-model="form.address" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
            </div>

            <div class="grid grid-cols-2 gap-6">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('dashboard.settings.zip') }}</label>
                <InputText v-model="form.zip" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('dashboard.settings.city') }}</label>
                <InputText v-model="form.city" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
              </div>
            </div>

            <div class="flex justify-between items-center mt-10 pt-6 border-t border-zinc-200 dark:border-zinc-800">
              <Button
                class="!bg-transparent !text-red-600 dark:!text-red-500 hover:!text-red-700 !text-[10px] font-bold border border-red-500/30 px-3 py-2"
                :loading="auth.isLoading"
                :label="$t('dashboard.settings.delete_account')"
                @click="handleDeleteAccount"
              />
              <Button
                :label="$t('dashboard.settings.save')"
                class="!bg-[#ff3b4e] !border-[#ff3b4e] !text-white font-bold px-8 py-3 shadow-lg hover:!bg-[#e63545]"
              />
            </div>
          </form>

          <div v-else class="h-full flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-600">
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
:deep(.p-dialog-header), :deep(.p-dialog-content), :deep(.p-dialog-footer) {
  background-color: transparent !important;
  color: inherit;
}
.animate-fade-in {
  animation: fadeIn 0.4s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
