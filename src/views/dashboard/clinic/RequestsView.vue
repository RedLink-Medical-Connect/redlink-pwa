<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import { useClinicRequests } from '@/composables/useClinicRequest.js'

const { t } = useI18n()
const toast = useToast()

const { requests, isLoading, fetchRequests, closeRequest } = useClinicRequests()

const showDetails = ref(false)
const selectedRequest = ref(null)
const selectedMission = ref(null)

onMounted(() => {
  fetchRequests()
})

const getSeverity = (status) => {
  switch (status) {
    case 'OPEN':
      return 'danger'
    case 'IN_PROGRESS':
      return 'warn'
    case 'CLOSED':
      return 'secondary'
    case 'CANCELLED':
      return 'contrast'
    default:
      return 'info'
  }
}

const formatDate = (dateString) => {
  if (!dateString) return ''
  return new Date(dateString).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const handleClose = async (id) => {
  try {
    await closeRequest(id)
    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t('dashboard.requests.toasts.close_success'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t('dashboard.requests.toasts.close_failed'),
      life: 3000,
    })
  }
}

const openDetails = (request) => {
  selectedRequest.value = request
  selectedMission.value = request.mission
  showDetails.value = true
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <Toast />
    <Dialog
      v-model:visible="showDetails"
      modal
      :header="$t('dashboard.requests.dialog.title')"
      :style="{ width: '500px' }"
    >
      <div v-if="selectedRequest" class="flex flex-col gap-4">
        <div class="p-4 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
          <h3 class="font-bold text-zinc-900 dark:text-white mb-2">
            {{ $t('dashboard.requests.dialog.request_title') }}
          </h3>
          <div class="grid grid-cols-2 gap-2 text-sm">
            <span class="text-zinc-500">{{ $t('dashboard.requests.dialog.type') }}</span>
            <span class="font-medium">{{
              selectedRequest.requestType === 'EMERGENCY'
                ? $t('dashboard.requests.dialog.type_emergency')
                : $t('dashboard.requests.dialog.type_appointment')
            }}</span>
            <span class="text-zinc-500">{{ $t('dashboard.requests.dialog.species') }}</span>
            <span class="font-medium">{{ selectedRequest.requiredSpecies }}</span>
            <span class="text-zinc-500">{{ $t('dashboard.requests.dialog.blood') }}</span>
            <span class="font-medium">{{ selectedRequest.requiredBloodGroup }}</span>
            <span class="text-zinc-500">{{ $t('dashboard.requests.dialog.quantity') }}</span>
            <span class="font-medium">{{ selectedRequest.quantity }} ml</span>
          </div>
        </div>

        <div
          v-if="selectedRequest.mission"
          class="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg"
        >
          <div class="flex items-center gap-2 mb-3">
            <i class="pi pi-check-circle text-green-600 text-xl"></i>
            <h3 class="font-bold text-green-700 dark:text-green-400">
              {{ $t('dashboard.requests.dialog.donor_found') }}
            </h3>
          </div>

          <div class="space-y-3">
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 bg-white rounded-full flex items-center justify-center text-xl shadow-sm"
              >
                🐶
              </div>
              <div>
                <p class="font-bold text-zinc-900 dark:text-white">
                  {{ selectedRequest.mission.animal.name }}
                </p>
                <p class="text-xs text-zinc-500">
                  {{ selectedRequest.mission.animal.breed }} •
                  {{ selectedRequest.mission.animal.weight }}kg
                </p>
              </div>
            </div>

            <div class="border-t border-green-200 dark:border-green-800 pt-3 mt-2">
              <p class="text-xs text-green-700 dark:text-green-400 uppercase font-bold mb-1">
                {{ $t('dashboard.requests.dialog.owner_contact') }}
              </p>
              <p class="font-medium text-zinc-900 dark:text-white">
                {{ selectedRequest.mission.animal.ownerProfile?.firstname }}
                {{ selectedRequest.mission.animal.ownerProfile?.lastname }}
              </p>
              <a
                :href="`tel:${selectedRequest.mission.animal.ownerProfile?.phone}`"
                class="inline-flex items-center gap-2 mt-1 text-blue-600 hover:underline font-bold"
              >
                <i class="pi pi-phone"></i> {{ selectedRequest.mission.animal.ownerProfile?.phone }}
              </a>
            </div>
          </div>
        </div>

        <div
          v-else
          class="p-8 text-center text-zinc-400 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-dashed border-zinc-300"
        >
          <i class="pi pi-search text-2xl mb-2"></i>
          <p>{{ $t('dashboard.requests.dialog.waiting_donor') }}</p>
        </div>
      </div>
      <template #footer>
        <Button
          :label="$t('common.close')"
          icon="pi pi-times"
          text
          @click="showDetails = false"
        />
      </template>
    </Dialog>

    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />

      <div class="flex-grow">
        <div class="flex justify-between items-center mb-6">
          <h1
            class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider border-l-4 border-[#ff3b4e] pl-4"
          >
            {{ $t('dashboard.requests.title') }}
          </h1>
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
            v-if="!isLoading && requests.length === 0"
            class="flex flex-col items-center justify-center h-64 text-zinc-400"
          >
            <i class="pi pi-inbox text-5xl mb-4 opacity-20"></i>
        <p>{{ $t('dashboard.requests.empty') }}</p>
          </div>

          <DataTable
            v-else
            :value="requests"
            striped-rows
            class="p-datatable-sm"
            table-style="min-width: 50rem"
          >
            <Column
              field="createdAt"
              :header="$t('dashboard.requests.columns.date')"
              class="!text-zinc-600 dark:!text-zinc-300"
            >
              <template #body="slotProps">
                {{ formatDate(slotProps.data.createdAt) }}
              </template>
            </Column>

            <Column
              field="requestType"
              :header="$t('dashboard.requests.columns.type')"
              class="!font-bold"
            >
              <template #body="slotProps">
                <span
                  v-if="slotProps.data.requestType === 'EMERGENCY'"
                  class="text-red-600 flex items-center gap-1 uppercase text-xs font-black"
                >
                  <i class="pi pi-bolt"></i> {{ $t('dashboard.requests.type_emergency_short') }}
                </span>
                <span
                  v-else
                  class="text-blue-600 flex items-center gap-1 uppercase text-xs font-bold"
                >
                  <i class="pi pi-calendar"></i> {{ $t('dashboard.requests.type_appointment_short') }}
                </span>
              </template>
            </Column>

            <Column :header="$t('dashboard.requests.columns.patient')">
              <template #body="slotProps">
                <span class="font-bold text-zinc-800 dark:text-white">
                  {{
                    slotProps.data.requiredSpecies === 'DOG'
                      ? $t('request.species.dog')
                      : $t('request.species.cat')
                  }}
                </span>
                <span class="text-xs text-zinc-500 ml-1">({{ slotProps.data.quantity }}{{ $t('common.ml') }})</span>
              </template>
            </Column>

            <Column
              field="requiredBloodGroup"
              :header="$t('dashboard.requests.columns.blood_group')"
            >
              <template #body="slotProps">
                <Tag
                  :value="slotProps.data.requiredBloodGroup"
                  severity="info"
                  class="!bg-zinc-100 dark:!bg-zinc-800 !text-zinc-600 dark:!text-zinc-300 !border !border-zinc-200 dark:!border-zinc-700"
                />
              </template>
            </Column>

            <Column :header="$t('dashboard.requests.columns.donor')">
              <template #body="slotProps">
                <div
                  v-if="slotProps.data.mission"
                  class="flex items-center gap-2 cursor-pointer"
                  @click="openDetails(slotProps.data)"
                >
                  <div class="flex flex-col">
                    <span class="text-sm font-bold ...">{{
                      slotProps.data.mission.animal.name
                    }}</span>
                    <span class="text-[10px] text-zinc-500">{{
                      $t('dashboard.requests.columns.on_the_way')
                    }}</span>
                  </div>
                </div>
                <span v-else class="text-zinc-400 text-xs italic">{{
                  $t('dashboard.requests.columns.waiting')
                }}</span>
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

            <Column :header="$t('dashboard.requests.columns.action')">
              <template #body="slotProps">
                <div class="flex gap-2">
                  <Button
                    v-if="slotProps.data.status === 'OPEN'"
                    icon="pi pi-check"
                    text
                    rounded
                    severity="success"
                    :pt="{
                      root: {
                        'v-tooltip.top': $t('dashboard.requests.columns.close_tooltip'),
                      },
                    }"
                    @click="handleClose(slotProps.data.id)"
                  />
                  <Button
                    icon="pi pi-eye"
                    text
                    rounded
                    class="!text-zinc-400 hover:!text-zinc-900 dark:hover:!text-white"
                    @click="openDetails(slotProps.data)"
                  />
                </div>
              </template>
            </Column>
          </DataTable>
        </div>
      </div>
    </div>
  </div>
</template>
