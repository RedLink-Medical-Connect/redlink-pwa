<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import RequestDetailsPanel from '@/components/dashboard/RequestDetailsPanel.vue'
import { useClinicHistory, HistoryEventType } from '@/composables/useClinicHistory.js'
import { Species } from '@/constants/enums'

const { t } = useI18n()

const { requests, historyEvents, isLoading, loadError, fetchRequests } = useClinicHistory()

onMounted(() => {
  fetchRequests()
})

// Détail au clic (correctif UX, 2026-09) : un événement de l'historique pointe vers une
// Request (`event.requestId`) déjà chargée par `useClinicHistory()` (qui réutilise
// `useClinicRequests().requests` en interne, désormais exposée) -- aucun nouvel aller-retour
// réseau. Même composant de détail que RequestsView.vue (RequestDetailsPanel.vue), sans les
// slots `#actions`/`#rating` : une Mission déjà dans l'historique n'a plus d'action de
// terrain à proposer côté clinique depuis cet écran (voir RequestDetailsPanel.vue).
const showDetails = ref(false)
const selectedRequest = ref(null)

const openEventDetails = (event) => {
  const request = requests.value.find((r) => r.id === event.requestId)
  if (!request) return
  selectedRequest.value = request
  showDetails.value = true
}

// Icône + couleurs par type d'événement — pur habillage visuel (`.cursorrules` : les
// clés i18n ne portent que du texte). Étend le vocabulaire visuel de l'ancienne version
// figée (vert-check "clôturée", bleu-user-plus "donneur ajouté") aux 5 types d'événements
// réels : REQUEST_CREATED (neutre, gris), MISSION_ACCEPTED (bleu, reprend le "donneur
// ajouté"), MISSION_COMPLETED (vert, reprend le "clôturée avec succès"), MISSION_NO_SHOW
// (rouge, échec de la mission) et REQUEST_CLOSED sans donneur (gris/ambre, distinct du
// vert de succès pour ne pas laisser croire à une transfusion réalisée).
const EVENT_STYLES = {
  [HistoryEventType.REQUEST_CREATED]: {
    icon: 'pi pi-plus',
    bg: 'bg-zinc-100 dark:bg-zinc-500/20',
    text: 'text-zinc-600 dark:text-zinc-400',
  },
  [HistoryEventType.MISSION_ACCEPTED]: {
    icon: 'pi pi-user-plus',
    bg: 'bg-blue-100 dark:bg-blue-500/20',
    text: 'text-blue-600 dark:text-blue-500',
  },
  [HistoryEventType.MISSION_COMPLETED]: {
    icon: 'pi pi-check',
    bg: 'bg-green-100 dark:bg-green-500/20',
    text: 'text-green-600 dark:text-green-500',
  },
  [HistoryEventType.MISSION_NO_SHOW]: {
    icon: 'pi pi-times',
    bg: 'bg-red-100 dark:bg-red-500/20',
    text: 'text-red-600 dark:text-red-500',
  },
  [HistoryEventType.REQUEST_CLOSED]: {
    icon: 'pi pi-ban',
    bg: 'bg-amber-100 dark:bg-amber-500/20',
    text: 'text-amber-600 dark:text-amber-500',
  },
}

const eventStyle = (type) => EVENT_STYLES[type]

// Clé i18n du libellé par type d'événement (dashboard.history.events.*, src/locales/*.json).
const EVENT_LABEL_KEYS = {
  [HistoryEventType.REQUEST_CREATED]: 'dashboard.history.events.request_created',
  [HistoryEventType.MISSION_ACCEPTED]: 'dashboard.history.events.mission_accepted',
  [HistoryEventType.MISSION_COMPLETED]: 'dashboard.history.events.mission_completed',
  [HistoryEventType.MISSION_NO_SHOW]: 'dashboard.history.events.mission_no_show',
  [HistoryEventType.REQUEST_CLOSED]: 'dashboard.history.events.request_closed',
}

const eventLabel = (event) => {
  const species =
    event.requiredSpecies === Species.DOG ? t('request.species.dog') : t('request.species.cat')
  return t(EVENT_LABEL_KEYS[event.type], {
    species,
    bloodGroup: event.requiredBloodGroup,
    name: event.donorName,
  })
}

// Date + heure absolues (ex. "13/08/2026 14:30"), pas de "il y a 2 heures"/"hier à
// 14:30" comme l'ancienne version figée : ce repo n'a aucun utilitaire de temps relatif
// (grep confirmé), et en construire un pour cette seule vue serait disproportionné.
// Simplification MVP volontaire — cf. rapport de la sous-tâche Phase 3.3.
const formatDateTime = (dateString) => {
  if (!dateString) return ''
  return new Date(dateString).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />
      <div class="flex-grow">
        <h1
          class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider mb-6"
        >
          {{ $t('dashboard.history.title') }}
        </h1>

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
            <p>{{ $t('dashboard.history.load_error') }}</p>
            <Button
              :label="$t('dashboard.history.retry')"
              icon="pi pi-refresh"
              text
              class="mt-2"
              @click="fetchRequests"
            />
          </div>

          <div
            v-else-if="!isLoading && historyEvents.length === 0"
            class="flex flex-col items-center justify-center h-64 text-zinc-400"
          >
            <i class="pi pi-inbox text-5xl mb-4 opacity-20"></i>
            <p>{{ $t('dashboard.history.empty') }}</p>
          </div>

          <div v-else class="space-y-4 p-4">
            <div
              v-for="event in historyEvents"
              :key="event.id"
              role="button"
              tabindex="0"
              :aria-label="$t('dashboard.history.event_details_aria', { label: eventLabel(event) })"
              class="bg-white dark:bg-zinc-900 p-4 rounded border border-zinc-200 dark:border-zinc-800 flex gap-4 items-center shadow-sm transition-colors duration-300 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-[#ff3b4e]"
              @click="openEventDetails(event)"
              @keydown.enter="openEventDetails(event)"
              @keydown.space.prevent="openEventDetails(event)"
            >
              <div
                class="w-10 h-10 rounded-full flex items-center justify-center"
                :class="[eventStyle(event.type).bg, eventStyle(event.type).text]"
              >
                <i :class="eventStyle(event.type).icon"></i>
              </div>
              <div>
                <p class="text-zinc-900 dark:text-white font-medium">{{ eventLabel(event) }}</p>
                <p class="text-xs text-zinc-500 dark:text-zinc-400">
                  {{ formatDateTime(event.timestamp) }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Dialog
      v-model:visible="showDetails"
      modal
      :header="$t('dashboard.requests.dialog.title')"
      :style="{ width: '500px' }"
    >
      <RequestDetailsPanel v-if="selectedRequest" :request="selectedRequest" />
      <template #footer>
        <Button
          :label="$t('common.close')"
          icon="pi pi-times"
          text
          @click="showDetails = false"
        />
      </template>
    </Dialog>
  </div>
</template>
