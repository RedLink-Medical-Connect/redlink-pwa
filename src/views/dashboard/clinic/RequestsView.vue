<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import { useClinicRequests } from '@/composables/useClinicRequest.js'
import { useMissionClosure } from '@/composables/useMissionClosure.js'
import { useClinicStats } from '@/composables/useClinicStats.js'
import { MissionStatus, RequestStatus } from '@/constants/enums'

const { t } = useI18n()
const toast = useToast()

const { requests, isLoading, isClosing, isCancelling, fetchRequests, closeRequest, cancelRequest } =
  useClinicRequests()
const { closeMission } = useMissionClosure()
// Phase 6.7 (CdC §2.4) : indicateurs tableau de bord vétérinaire, chargés indépendamment de
// la liste des Requests (échec de l'un n'affecte pas l'autre — même esprit que les lectures
// secondaires non-exclusives ailleurs dans ce repo, voir CLAUDE.md).
const {
  transfusionsDone,
  donorOwnersCount,
  loadError: statsLoadError,
  fetchStats: fetchClinicStats,
} = useClinicStats()

const showDetails = ref(false)
const selectedRequest = ref(null)
const selectedMission = ref(null)

// Confirmation avant fermeture/annulation d'une Request OPEN (Phase 6.6) — même pattern
// de Dialog que la confirmation de suppression de compte (SettingsView.vue,
// `showDeleteConfirm`) : un ref booléen de visibilité + une dialog PrimeVue dédiée, pas
// de `useConfirm()`. Un seul état `pendingAction` (au lieu de deux dialogs quasi
// identiques) porte à la fois le TYPE d'action ('close' | 'cancel') — pour afficher le
// bon titre/texte/libellé — et la Request ciblée, afin de garder fermeture et annulation
// clairement distinctes dans le code appelant (deux boutons, deux handlers) tout en
// réutilisant une seule dialog de confirmation.
const showActionConfirm = ref(false)
const pendingAction = ref(null)

// `closeMission()` expose un seul `isClosing` par instance de composable (voir
// useMissionClosure.js) : ici, une seule instance sert les deux boutons "Terminé"/"Absent"
// de la dialog, donc ce ref serait partagé entre les deux (même limitation que
// `isValidating` dans useAnimalValidation.js / ValidationsView.vue). On retrace ici l'issue
// (outcome) en cours de clôture pour n'afficher le spinner que sur le bon bouton, et
// désactiver l'AUTRE pendant ce temps plutôt que de laisser un second clic déclencher un
// second appel concurrent sur la même Mission.
const closingOutcome = ref(null)

onMounted(() => {
  fetchRequests()
  fetchClinicStats()
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

const askClose = (id) => {
  pendingAction.value = { type: 'close', id }
  showActionConfirm.value = true
}

const askCancel = (id) => {
  pendingAction.value = { type: 'cancel', id }
  showActionConfirm.value = true
}

/**
 * Exécute l'action confirmée dans la dialog (fermeture ou annulation, selon
 * `pendingAction.type`) — Phase 6.6. `closeRequest`/`cancelRequest` (useClinicRequest.js)
 * mettent déjà à jour `requests` localement en cas de succès, pas besoin de refetch ici.
 */
const confirmPendingAction = async () => {
  if (!pendingAction.value) return
  const { type, id } = pendingAction.value
  try {
    if (type === 'cancel') {
      await cancelRequest(id)
      toast.add({
        severity: 'success',
        summary: t('common.success'),
        detail: t('dashboard.requests.toasts.cancel_success'),
        life: 3000,
      })
    } else {
      await closeRequest(id)
      toast.add({
        severity: 'success',
        summary: t('common.success'),
        detail: t('dashboard.requests.toasts.close_success'),
        life: 3000,
      })
    }
    showActionConfirm.value = false
  } catch {
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t(
        type === 'cancel'
          ? 'dashboard.requests.toasts.cancel_failed'
          : 'dashboard.requests.toasts.close_failed',
      ),
      life: 3000,
    })
    // Dialog refermée même sur échec (même choix que SettingsView.vue/onDelete) : l'erreur
    // reste visible via le toast, pas besoin de garder la dialog ouverte pour ça.
    showActionConfirm.value = false
  } finally {
    pendingAction.value = null
  }
}

const openDetails = (request) => {
  selectedRequest.value = request
  selectedMission.value = request.mission
  showDetails.value = true
}

/**
 * Clôture la Mission de `selectedRequest` avec `outcome` (COMPLETED ou NO_SHOW), PUIS
 * clôture la Request sous-jacente (`closeRequest`, useClinicRequest.js — déjà exportée,
 * aucune nouvelle mutation ici).
 *
 * Pourquoi les deux écritures ensemble (choix délibéré, hors périmètre strict de la
 * Phase 2.1 qui ne posait que `closeMission`) : sans `closeRequest`, une Request dont la
 * Mission vient de conclure (succès ou no-show) resterait indéfiniment `IN_PROGRESS` dans
 * la liste de la clinique, sans aucune clôture de cycle de vie visible — `closeRequest`
 * fait exactement l'écriture `Request.status -> CLOSED` nécessaire et existe déjà, donc
 * pas de nouvelle mutation à écrire.
 *
 * Limitation connue et volontairement non traitée ici : sur NO_SHOW, la Request se
 * retrouve CLOSED sans qu'aucun nouveau donneur n'ait été trouvé — il n'existe aucun
 * mécanisme pour la "rouvrir" en vue d'une nouvelle recherche de donneur. La clinique doit
 * recréer une Request de zéro si elle a toujours besoin de sang. Non construit ici
 * (explicitement hors périmètre de cette sous-tâche) — trou fonctionnel à garder visible
 * pour une phase ultérieure plutôt qu'à masquer.
 */
const handleCloseMission = async (outcome) => {
  closingOutcome.value = outcome
  // Distingue "rien n'a été écrit" de "la Mission a fermé mais pas la Request" (relevé en
  // Lead Dev review) : sans ça, un échec de `closeRequest` après un `closeMission` réussi
  // affichait un message générique d'échec total — un vétérinaire confus pouvait alors
  // cliquer l'AUTRE bouton en pensant que rien n'avait marché, écrasant silencieusement le
  // statut réel de la Mission (et, sur un second clic "Terminé" après un "Absent" déjà
  // écrit ailleurs, désynchronisant Animal.lastDonationDate de ce que la Mission dit
  // vraiment s'être passé). `closeMission()` n'a pas d'écriture atomique conditionnelle
  // (voir useMissionClosure.js) : c'est ici, côté UI, que ce risque doit être coupé.
  let missionClosed = false
  try {
    // clinicID/ownerID (Phase 3.1) : déjà présents dans `selectedRequest` via
    // `listRequestsByClinic` (custom-queries.js, étendue pour cette sous-tâche) — aucun
    // aller-retour GraphQL dédié pour les obtenir. Utilisés par closeMission() pour upserter
    // (best-effort) la ClinicOwnerRelation quand outcome === COMPLETED ; ignorés sur NO_SHOW.
    await closeMission(
      selectedRequest.value.mission.id,
      selectedRequest.value.mission.animalID,
      outcome,
      selectedRequest.value.clinicID,
      selectedRequest.value.mission.animal.ownerID,
    )
    missionClosed = true
    await closeRequest(selectedRequest.value.id)

    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t(
        outcome === MissionStatus.COMPLETED
          ? 'dashboard.requests.toasts.mission_completed_success'
          : 'dashboard.requests.toasts.mission_no_show_success',
      ),
      life: 3000,
    })

    showDetails.value = false
    await fetchRequests()
  } catch (e) {
    console.error('Erreur clôture mission/request:', e)
    // closeMission() n'a pas de contrat de codes d'erreur documenté (contrairement à
    // acceptMission/validateAnimal) — voir useMissionClosure.js : elle relaie telle quelle
    // toute erreur du client GraphQL. Message générique ici, pas de mapping par code.
    if (missionClosed) {
      // La Mission a réellement fermé — on rafraîchit pour que l'UI reflète cet état
      // (retrouve la version à jour de la Request dans la liste rechargée : `requests`
      // change de référence à chaque fetch, `selectedRequest` doit être resynchronisé,
      // sinon le v-if des boutons continuerait de lire l'ancien statut ACCEPTED/
      // PENDING_ARRIVAL et laisserait les deux boutons cliquables sur une Mission déjà
      // close). Ça retire les deux boutons du DOM (Mission plus dans cet état), coupant
      // court à tout second clic sur l'autre issue.
      await fetchRequests()
      const refreshed = requests.value.find((r) => r.id === selectedRequest.value.id)
      if (refreshed) selectedRequest.value = refreshed

      toast.add({
        severity: 'warn',
        summary: t('common.error'),
        detail: t('dashboard.requests.toasts.mission_closed_request_still_open'),
        life: 6000,
      })
    } else {
      toast.add({
        severity: 'error',
        summary: t('common.error'),
        detail: t('dashboard.requests.toasts.mission_closure_failed'),
        life: 4000,
      })
    }
  } finally {
    closingOutcome.value = null
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <Toast />
    <Dialog
      v-model:visible="showActionConfirm"
      modal
      :header="
        pendingAction?.type === 'cancel'
          ? $t('dashboard.requests.dialog.cancel_confirm_title')
          : $t('dashboard.requests.dialog.close_confirm_title')
      "
      :style="{ width: '350px' }"
    >
      <div class="flex items-center gap-3 mb-4">
        <i class="pi pi-exclamation-triangle text-red-600 text-3xl"></i>
        <span class="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
          {{
            pendingAction?.type === 'cancel'
              ? $t('dashboard.requests.dialog.cancel_confirm_message')
              : $t('dashboard.requests.dialog.close_confirm_message')
          }}
        </span>
      </div>
      <template #footer>
        <Button
          :label="$t('common.cancel')"
          text
          class="!text-zinc-500"
          @click="showActionConfirm = false"
        />
        <Button
          :label="$t('dashboard.requests.dialog.confirm_action')"
          severity="danger"
          :loading="isClosing || isCancelling"
          @click="confirmPendingAction"
        />
      </template>
    </Dialog>
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

            <div
              v-if="
                selectedRequest.mission.status === MissionStatus.ACCEPTED ||
                selectedRequest.mission.status === MissionStatus.PENDING_ARRIVAL
              "
              class="border-t border-green-200 dark:border-green-800 pt-3 mt-2 flex gap-2"
            >
              <Button
                :label="$t('dashboard.requests.dialog.complete_btn')"
                icon="pi pi-check"
                size="small"
                severity="success"
                :loading="closingOutcome === MissionStatus.COMPLETED"
                :disabled="closingOutcome !== null && closingOutcome !== MissionStatus.COMPLETED"
                @click="handleCloseMission(MissionStatus.COMPLETED)"
              />
              <Button
                :label="$t('dashboard.requests.dialog.no_show_btn')"
                icon="pi pi-times"
                size="small"
                severity="danger"
                outlined
                :loading="closingOutcome === MissionStatus.NO_SHOW"
                :disabled="closingOutcome !== null && closingOutcome !== MissionStatus.NO_SHOW"
                @click="handleCloseMission(MissionStatus.NO_SHOW)"
              />
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

        <div class="grid grid-cols-2 gap-4 mb-6">
          <div
            class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex flex-col gap-1"
          >
            <!-- statsLoadError distingue "chargement en erreur" de "vraiment 0" (CLAUDE.md,
                 convention loadError) -- sans ça, un échec réseau afficherait silencieusement
                 le même 0 qu'une clinique sans activité (voir roadmap Phase 6.7). -->
            <span
              v-if="statsLoadError"
              class="flex items-center gap-2 text-2xl font-bold text-amber-500"
              :title="$t('dashboard.requests.stats.load_error')"
            >
              <i class="pi pi-exclamation-triangle text-xl"></i>
              {{ $t('dashboard.requests.stats.unavailable') }}
            </span>
            <span v-else class="text-3xl font-bold text-zinc-900 dark:text-white">{{ transfusionsDone }}</span>
            <span class="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              {{ $t('dashboard.requests.stats.transfusions_done') }}
            </span>
          </div>
          <div
            class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex flex-col gap-1"
          >
            <span
              v-if="statsLoadError"
              class="flex items-center gap-2 text-2xl font-bold text-amber-500"
              :title="$t('dashboard.requests.stats.load_error')"
            >
              <i class="pi pi-exclamation-triangle text-xl"></i>
              {{ $t('dashboard.requests.stats.unavailable') }}
            </span>
            <span v-else class="text-3xl font-bold text-zinc-900 dark:text-white">{{ donorOwnersCount }}</span>
            <span class="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              {{ $t('dashboard.requests.stats.donor_owners_count') }}
            </span>
          </div>
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
                    v-if="slotProps.data.status === RequestStatus.OPEN"
                    icon="pi pi-check"
                    text
                    rounded
                    severity="success"
                    :aria-label="$t('dashboard.requests.columns.close_tooltip')"
                    :title="$t('dashboard.requests.columns.close_tooltip')"
                    @click="askClose(slotProps.data.id)"
                  />
                  <Button
                    v-if="slotProps.data.status === RequestStatus.OPEN"
                    icon="pi pi-ban"
                    text
                    rounded
                    severity="danger"
                    :aria-label="$t('dashboard.requests.columns.cancel_tooltip')"
                    :title="$t('dashboard.requests.columns.cancel_tooltip')"
                    @click="askCancel(slotProps.data.id)"
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
