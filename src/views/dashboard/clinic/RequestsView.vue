<script setup>
import { ref } from 'vue'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'

// Mock Data
const requests = ref([
  {
    id: 102,
    date: '12/10/2025',
    type: 'Urgence',
    animal: 'Rex (Chien)',
    blood: 'DEA 1.1-',
    status: 'OPEN',
    matches: 3,
  },
  {
    id: 101,
    date: '10/10/2025',
    type: 'RDV',
    animal: 'Luna (Chat)',
    blood: 'A',
    status: 'CLOSED',
    matches: 1,
  },
])

const getSeverity = (status) => {
  return status === 'OPEN' ? 'danger' : 'success'
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />

      <div class="flex-grow">
        <div class="flex justify-between items-center mb-6">
          <h1 class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
            {{ $t('dashboard.requests.title') }}
          </h1>
          <Button
            as="router-link"
            to="/dashboard/requests/new"
            :label="$t('dashboard.requests.new_request')"
            icon="pi pi-plus"
            class="!bg-[#ff3b4e] !border-[#ff3b4e]"
          />
        </div>

        <div
          class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden shadow-sm transition-colors duration-300"
        >
          <DataTable
            :value="requests"
            striped-rows
            class="p-datatable-sm"
            table-style="min-width: 50rem"
          >
            <Column field="id" :header="$t('dashboard.requests.columns.id')" class="!text-zinc-500 dark:!text-zinc-400"></Column>
            <Column field="date" :header="$t('dashboard.requests.columns.date')" class="!text-zinc-600 dark:!text-zinc-300"></Column>

            <Column
              field="animal"
              :header="$t('dashboard.requests.columns.patient')"
              class="!text-zinc-900 dark:!text-white font-bold"
            ></Column>

            <Column field="blood" :header="$t('dashboard.requests.columns.blood_group')">
              <template #body="slotProps">
                <Tag :value="slotProps.data.blood" severity="info" />
              </template>
            </Column>

            <Column :header="$t('dashboard.requests.columns.status')">
              <template #body="slotProps">
                <Tag
                  :value="slotProps.data.status"
                  :severity="getSeverity(slotProps.data.status)"
                />
              </template>
            </Column>

            <Column :header="$t('dashboard.requests.columns.donors_found')">
              <template #body="slotProps">
                <span class="font-bold text-[#ff3b4e]">{{ slotProps.data.matches }}</span>
                <span class="text-zinc-500 dark:text-zinc-400 ml-1">{{ $t('dashboard.requests.status.contacted') }}</span>
              </template>
            </Column>

            <Column :header="$t('dashboard.requests.columns.action')">
              <template #body>
                <Button
                  icon="pi pi-eye"
                  text
                  rounded
                  :aria-label="$t('common.view')"
                  class="!text-zinc-400 hover:!text-zinc-900 dark:hover:!text-white"
                />
              </template>
            </Column>
          </DataTable>
        </div>
      </div>
    </div>
  </div>
</template>
