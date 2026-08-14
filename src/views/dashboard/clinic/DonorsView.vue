<script setup>
import { onMounted } from 'vue'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import { useClinicDonors } from '@/composables/useClinicDonors.js'

const { donors, isLoading, loadError, fetchDonors } = useClinicDonors()

onMounted(() => {
  fetchDonors()
})

const formatDate = (dateString) => {
  if (!dateString) return ''
  return new Date(dateString).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />

      <div class="flex-grow">
        <h1 class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider mb-6">{{ $t('dashboard.donors.title') }}</h1>

        <div class="bg-white dark:bg-zinc-900 p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 mb-6 flex gap-4 shadow-sm transition-colors duration-300">
          <InputText
            :placeholder="$t('dashboard.donors.search_placeholder')"
            class="flex-grow !bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white placeholder:!text-zinc-400"
          />
          <Button :label="$t('common.search')" icon="pi pi-search" class="!bg-zinc-800 !border-zinc-700 !text-white" />
        </div>

        <div
          class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden shadow-sm transition-colors duration-300 min-h-[400px] relative"
        >
          <div
            v-if="isLoading"
            class="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-zinc-900/80 z-20"
          >
            <i class="pi pi-spin pi-spinner text-4xl text-[#ff3b4e]"></i>
          </div>

          <div
            v-if="!isLoading && loadError"
            class="flex flex-col items-center justify-center h-64 text-zinc-400"
          >
            <i class="pi pi-exclamation-triangle text-5xl mb-4 text-amber-500 opacity-60"></i>
            <p>{{ $t('dashboard.donors.load_error') }}</p>
            <Button
              :label="$t('dashboard.donors.retry')"
              icon="pi pi-refresh"
              text
              class="mt-2"
              @click="fetchDonors"
            />
          </div>

          <div
            v-else-if="!isLoading && donors.length === 0"
            class="flex flex-col items-center justify-center h-64 text-zinc-400"
          >
            <i class="pi pi-inbox text-5xl mb-4 opacity-20"></i>
            <p>{{ $t('dashboard.donors.empty') }}</p>
          </div>

          <DataTable v-else :value="donors" striped-rows class="p-datatable-sm" table-style="min-width: 50rem">
            <Column field="animalName" :header="$t('dashboard.donors.columns.animal')" class="!text-zinc-900 dark:!text-white font-bold"></Column>
            <Column field="bloodGroup" :header="$t('dashboard.donors.columns.blood')">
              <template #body="slotProps">
                <Tag :value="slotProps.data.bloodGroup" severity="warning" />
              </template>
            </Column>
            <Column field="distanceKM" :header="$t('dashboard.donors.columns.distance')" class="!text-zinc-600 dark:!text-zinc-400">
              <template #body="slotProps">
                {{ slotProps.data.distanceKM !== null ? `${slotProps.data.distanceKM} ${$t('common.km')}` : $t('dashboard.donors.distance_unknown') }}
              </template>
            </Column>
            <Column :header="$t('dashboard.donors.columns.last_donation')" class="!text-zinc-600 dark:!text-zinc-400">
              <template #body="slotProps">
                {{ slotProps.data.lastDonationDate ? formatDate(slotProps.data.lastDonationDate) : $t('dashboard.donors.never_donated') }}
              </template>
            </Column>
            <Column :header="$t('dashboard.donors.columns.action')">
              <template #body="slotProps">
                <a
                  v-if="slotProps.data.ownerPhone"
                  :href="`tel:${slotProps.data.ownerPhone}`"
                  class="inline-flex"
                >
                  <Button :label="$t('dashboard.donors.contact')" icon="pi pi-phone" size="small" class="!bg-[#ff3b4e] !border-[#ff3b4e]" />
                </a>
              </template>
            </Column>
          </DataTable>
        </div>
      </div>
    </div>
  </div>
</template>
