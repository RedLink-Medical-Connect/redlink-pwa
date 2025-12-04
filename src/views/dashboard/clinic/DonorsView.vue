<script setup>
import { ref } from 'vue'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'

const donors = ref([
  { name: 'Simba', owner: 'M. Martin', city: 'Lyon', distance: '2 km', group: 'DEA 1.1+', lastDonation: 'Jamais' },
  { name: 'Polly', owner: 'Mme Durand', city: 'Villeurbanne', distance: '5 km', group: 'DEA 1.1-', lastDonation: '3 mois' },
])
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

        <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden shadow-sm transition-colors duration-300">
          <DataTable :value="donors" striped-rows>
            <Column field="name" :header="$t('dashboard.donors.columns.animal')" class="!text-zinc-900 dark:!text-white font-bold"></Column>
            <Column field="group" :header="$t('dashboard.donors.columns.blood')">
              <template #body="slotProps">
                <Tag :value="slotProps.data.group" severity="warning" />
              </template>
            </Column>
            <Column field="distance" :header="$t('dashboard.donors.columns.distance')" class="!text-zinc-600 dark:!text-zinc-400"></Column>
            <Column field="lastDonation" :header="$t('dashboard.donors.columns.last_donation')" class="!text-zinc-600 dark:!text-zinc-400"></Column>
            <Column :header="$t('dashboard.donors.columns.action')">
              <template #body>
                <Button :label="$t('dashboard.donors.contact')" size="small" class="!bg-[#ff3b4e] !border-[#ff3b4e]" />
              </template>
            </Column>
          </DataTable>
        </div>
      </div>
    </div>
  </div>
</template>
