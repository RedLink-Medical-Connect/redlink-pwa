<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import { useOwnerMissions } from '@/composables/useOwnerMissions'

const { fetchMyMissions, activeMissions, historyMissions, isLoading, loadError } =
  useOwnerMissions()

const { t } = useI18n()

// État des onglets (0 = En cours, 1 = Historique)
const activeTab = ref(0)

onMounted(() => {
  fetchMyMissions()
})

const formatDate = (dateString) => {
  if (!dateString) return ''
  return new Date(dateString).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Ouvrir GPS
const openMaps = (clinic) => {
  if (!clinic) return
  const query = clinic.address
    ? encodeURIComponent(clinic.address)
    : `${clinic.latitude},${clinic.longitude}`
  window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank')
}

const getStatusLabel = (status) => {
  switch (status) {
    case 'PENDING_ARRIVAL':
      return t('dashboard.owner.missions_list.status.pending_arrival')
    case 'ACCEPTED':
      return t('dashboard.owner.missions_list.status.accepted')
    case 'COMPLETED':
      return t('dashboard.owner.missions_list.status.completed')
    case 'NO_SHOW':
      return t('dashboard.owner.missions_list.status.no_show')
    default:
      return status
  }
}

const getStatusSeverity = (status) => {
  switch (status) {
    case 'PENDING_ARRIVAL':
      return 'warn'
    case 'ACCEPTED':
      return 'info'
    case 'COMPLETED':
      return 'success'
    case 'NO_SHOW':
      return 'danger'
    default:
      return 'secondary'
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />

      <div class="flex-grow">
        <h1
          class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider border-l-4 border-[#ff3b4e] pl-4 mb-6"
        >
          {{ $t('dashboard.owner.missions_list.title') }}
        </h1>

        <div class="flex gap-4 mb-6 border-b border-zinc-200 dark:border-zinc-800">
          <button
            class="pb-3 px-2 font-bold text-sm transition-colors relative"
            :class="
              activeTab === 0
                ? 'text-[#ff3b4e]'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
            "
            @click="activeTab = 0"
          >
            {{ $t('dashboard.owner.missions_list.tabs.active') }}
            <Badge
              v-if="activeMissions.length > 0"
              :value="activeMissions.length"
              severity="danger"
              class="ml-2"
            ></Badge>
            <div
              v-if="activeTab === 0"
              class="absolute bottom-0 left-0 w-full h-0.5 bg-[#ff3b4e]"
            ></div>
          </button>

          <button
            class="pb-3 px-2 font-bold text-sm transition-colors relative"
            :class="
              activeTab === 1
                ? 'text-[#ff3b4e]'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
            "
            @click="activeTab = 1"
          >
            {{ $t('dashboard.owner.missions_list.tabs.history') }}
            <div
              v-if="activeTab === 1"
              class="absolute bottom-0 left-0 w-full h-0.5 bg-[#ff3b4e]"
            ></div>
          </button>
        </div>

        <div v-if="isLoading" class="flex justify-center py-12">
          <i class="pi pi-spin pi-spinner text-4xl text-[#ff3b4e]"></i>
        </div>

        <!-- Phase 7.6 (R-09) : état d'erreur distinct de "aucune mission" -- sans ça, un échec
             de fetchMyMissions() (loadError, useOwnerMissions.js) affichait silencieusement le
             même état vide qu'un Owner sans mission, cf. CLAUDE.md/roadmap Phase 6.2. -->
        <div
          v-else-if="loadError"
          class="flex flex-col items-center justify-center py-12 text-zinc-400"
        >
          <i class="pi pi-exclamation-triangle text-5xl mb-4 text-amber-500 opacity-60"></i>
          <p>{{ $t('dashboard.owner.missions_list.load_error') }}</p>
          <Button
            :label="$t('dashboard.owner.missions_list.retry')"
            icon="pi pi-refresh"
            text
            class="mt-2"
            @click="fetchMyMissions"
          />
        </div>

        <div v-else>
          <div v-if="activeTab === 0" class="space-y-4">
            <div
              v-if="activeMissions.length === 0"
              class="text-center py-12 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700"
            >
              <i class="pi pi-calendar-times text-4xl text-zinc-300 mb-3"></i>
              <p class="text-zinc-500">
                {{ $t('dashboard.owner.missions_list.empty.active') }}
              </p>
              <router-link
                to="/dashboard/board"
                class="text-[#ff3b4e] font-bold text-sm hover:underline mt-2 inline-block"
              >
                {{ $t('dashboard.owner.missions_list.empty.go_to_board') }}
              </router-link>
            </div>

            <div
              v-for="mission in activeMissions"
              :key="mission.id"
              class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
            >
              <div
                class="bg-zinc-50 dark:bg-zinc-950/50 p-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center"
              >
                <div class="flex items-center gap-3">
                  <div
                    class="w-8 h-8 rounded-full bg-white dark:bg-zinc-800 flex items-center justify-center text-lg shadow-sm"
                  >
                    🐶
                  </div>
                  <span class="font-bold text-zinc-900 dark:text-white">{{
                    mission.animalName
                  }}</span>
                </div>
                <Tag
                  :value="getStatusLabel(mission.status)"
                  :severity="getStatusSeverity(mission.status)"
                />
              </div>

              <div class="p-6">
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div class="space-y-2">
                    <div class="flex items-start gap-3">
                      <i class="pi pi-building text-zinc-400 mt-1"></i>
                      <div>
                        <p class="font-bold text-lg text-zinc-900 dark:text-white">
                          {{
                            mission.request?.clinic?.name
                              || $t('dashboard.owner.missions_list.unknown_clinic')
                          }}
                        </p>
                        <p class="text-zinc-500 text-sm">{{ mission.request?.clinic?.address }}</p>
                      </div>
                    </div>

                    <div class="flex items-center gap-3">
                      <i class="pi pi-clock text-zinc-400"></i>
                      <p class="text-zinc-600 dark:text-zinc-300 text-sm">
                        {{ $t('dashboard.owner.missions_list.planned_on') }}
                        <span class="font-semibold">{{
                          formatDate(mission.appointmentDatetime)
                        }}</span>
                      </p>
                    </div>
                  </div>

                  <div class="flex flex-col sm:flex-row gap-3">
                    <Button
                      v-if="mission.request?.clinic?.phone"
                      icon="pi pi-phone"
                      :label="$t('dashboard.owner.missions_list.actions.call')"
                      severity="secondary"
                      outlined
                      as="a"
                      :href="`tel:${mission.request.clinic.phone}`"
                    />
                    <Button
                      icon="pi pi-map-marker"
                      :label="$t('dashboard.owner.missions_list.actions.go')"
                      class="!bg-[#ff3b4e] !border-[#ff3b4e]"
                      @click="openMaps(mission.request?.clinic)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="activeTab === 1" class="space-y-4">
            <div v-if="historyMissions.length === 0" class="text-center py-12 text-zinc-400">
              <p>{{ $t('dashboard.owner.missions_list.empty.history') }}</p>
            </div>

            <div
              v-for="mission in historyMissions"
              :key="mission.id"
              class="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 opacity-75"
            >
              <div>
                <p class="font-bold text-zinc-900 dark:text-white">
                  {{ mission.animalName }}
                  <span class="text-zinc-400 font-normal"
                    >chez {{ mission.request?.clinic?.name }}</span
                  >
                </p>
                <p class="text-xs text-zinc-500">{{ formatDate(mission.createdAt) }}</p>
              </div>
              <Tag
                :value="getStatusLabel(mission.status)"
                :severity="getStatusSeverity(mission.status)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
