<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import { generateClient } from 'aws-amplify/data'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import StarRating from '@/components/common/StarRating.vue'
import {
  useOwnerMissions,
  mapSubmitDonationValidationError,
} from '@/composables/useOwnerMissions'
import { useRatings, mapSubmitRatingError } from '@/composables/useRatings'
import { throwIfGraphqlError } from '@/services/graphql-error-service'
import {
  MissionStatus,
  MissionValidationOutcome,
  RatingParticipantRole,
  Species,
} from '@/constants/enums'

const {
  fetchMyMissions,
  activeMissions,
  awaitingValidationMissions,
  historyMissions,
  isLoading,
  loadError,
  isSubmittingValidation,
  submitDonationValidation,
} = useOwnerMissions()
const { isSubmitting: isSubmittingRating, submitRating } = useRatings()

const { t } = useI18n()
const toast = useToast()

// État des onglets (0 = En cours, 1 = Historique, 2 = En attente de validation -- ajouté en
// dernier plutôt qu'inséré entre les deux existants, pour ne pas déplacer les index déjà
// utilisés par `activeTab`/le style de tabs existant).
const activeTab = ref(0)

onMounted(() => {
  fetchMyMissions()
})

// ── Double validation (« le don a-t-il eu lieu ? ») ───────────────────────────────────────
// Dialog à deux étapes : 'choose' (Confirmer/Infirmer), 'deny' (motif de litige optionnel
// avant soumission DENIED). Confirmer soumet directement (pas de second écran, rien à
// justifier côté Owner sur une confirmation).
const showValidationDialog = ref(false)
const selectedValidationMission = ref(null)
const validationStep = ref('choose')
const disputeReason = ref('')

const openValidationDialog = (mission) => {
  selectedValidationMission.value = mission
  validationStep.value = 'choose'
  disputeReason.value = ''
  showValidationDialog.value = true
}

const handleSubmitValidation = async (outcome) => {
  if (!selectedValidationMission.value) return
  try {
    await submitDonationValidation(
      selectedValidationMission.value.id,
      outcome,
      outcome === MissionValidationOutcome.DENIED ? disputeReason.value : undefined,
    )
    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t('dashboard.owner.missions_list.validation.toasts.success'),
      life: 3000,
    })
    showValidationDialog.value = false
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: mapSubmitDonationValidationError(e.message),
      life: 5000,
    })
  }
}

// ── Notation de la clinique (COMPLETED/COMPLETED_AUTO, historique) ────────────────────────
// Asymétrie `@auth` documentée dans useRatings.js : un Owner peut relire SA PROPRE `Rating`
// (`allow.ownerDefinedIn('raterID')`), donc un pré-check est possible ICI (contrairement au
// côté clinique, RequestsView.vue) -- fait en LAZY (au moment où la carte Historique
// s'affiche réellement, via le watch sur `activeTab`/`historyMissions` ci-dessous), pas en
// eager sur toute la liste au chargement de `fetchMyMissions()`.
const ratingClient = generateClient()
// missionId -> 'checking' | 'rated' | 'unrated'
const ratingCheckStatus = reactive({})
// missionId -> { stars, comment } -- formulaire de notation, un par mission de l'historique.
const ratingForms = reactive({})

const getRatingForm = (missionId) => {
  if (!ratingForms[missionId]) ratingForms[missionId] = { stars: 0, comment: '' }
  return ratingForms[missionId]
}

const ensureRatingStatusChecked = async (mission) => {
  const id = mission.id
  if (ratingCheckStatus[id]) return
  ratingCheckStatus[id] = 'checking'
  try {
    const { data, errors } = await ratingClient.models.Rating.get(
      { missionID: id, raterRole: RatingParticipantRole.OWNER },
      { selectionSet: ['missionID'] },
    )
    throwIfGraphqlError(errors, 'getRating')
    ratingCheckStatus[id] = data ? 'rated' : 'unrated'
  } catch (e) {
    // Lecture secondaire non-exclusive (CLAUDE.md) : un échec de CETTE vérification ne doit
    // jamais bloquer l'Owner -- repli neutre sur "unrated" (affiche le widget, au pire une
    // seconde soumission serait rejetée côté serveur par `RATING_ALREADY_SUBMITTED`), jamais
    // "rated" (qui masquerait le widget à tort).
    console.error(`Erreur vérification notation existante pour la mission ${id} :`, e)
    ratingCheckStatus[id] = 'unrated'
  }
}

watch(
  [activeTab, historyMissions],
  ([tab, missions]) => {
    if (tab !== 1) return
    missions
      .filter((m) => [MissionStatus.COMPLETED, MissionStatus.COMPLETED_AUTO].includes(m.status))
      .forEach((m) => ensureRatingStatusChecked(m))
  },
  { immediate: true },
)

const handleSubmitRating = async (mission) => {
  const form = getRatingForm(mission.id)
  try {
    await submitRating({
      missionId: mission.id,
      targetRole: RatingParticipantRole.CLINIC,
      targetID: mission.request?.clinicID,
      stars: form.stars,
      comment: form.comment,
    })
    ratingCheckStatus[mission.id] = 'rated'
    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t('dashboard.owner.missions_list.rating.toasts.success'),
      life: 3000,
    })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: mapSubmitRatingError(e.message),
      life: 5000,
    })
  }
}

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
    case MissionStatus.PENDING_ARRIVAL:
      return t('dashboard.owner.missions_list.status.pending_arrival')
    case MissionStatus.ACCEPTED:
      return t('dashboard.owner.missions_list.status.accepted')
    case MissionStatus.COMPLETED:
      return t('dashboard.owner.missions_list.status.completed')
    case MissionStatus.NO_SHOW:
      return t('dashboard.owner.missions_list.status.no_show')
    // Double validation (2026-08-26) : COMPLETED_AUTO/DISPUTED sont deux issues TERMINALES au
    // même titre que COMPLETED/NO_SHOW ci-dessus (voir historyMissions, useOwnerMissions.js) --
    // libellés distincts pour ne pas les confondre avec une clôture "normale" côté utilisateur.
    case MissionStatus.COMPLETED_AUTO:
      return t('dashboard.owner.missions_list.status.completed_auto')
    case MissionStatus.DISPUTED:
      return t('dashboard.owner.missions_list.status.disputed')
    case MissionStatus.PENDING_VALIDATION:
      return t('dashboard.owner.missions_list.status.pending_validation')
    default:
      return status
  }
}

const getStatusSeverity = (status) => {
  switch (status) {
    case MissionStatus.PENDING_ARRIVAL:
      return 'warn'
    case MissionStatus.ACCEPTED:
      return 'info'
    case MissionStatus.COMPLETED:
      return 'success'
    case MissionStatus.NO_SHOW:
      return 'danger'
    case MissionStatus.COMPLETED_AUTO:
      return 'success'
    case MissionStatus.DISPUTED:
      return 'danger'
    case MissionStatus.PENDING_VALIDATION:
      return 'warn'
    default:
      return 'secondary'
  }
}

// Phase 6.B/2 : réplique le mapping espèce -> emoji déjà utilisé dans AnimalsView.vue
// (Species.DOG/Species.CAT) -- avant ce fix, 🐶 était codé en dur pour toute Mission
// active, y compris pour un chat.
const getAnimalEmoji = (species) => (species === Species.DOG ? '🐶' : '🐱')
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <Toast />
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

          <button
            class="pb-3 px-2 font-bold text-sm transition-colors relative"
            :class="
              activeTab === 2
                ? 'text-[#ff3b4e]'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
            "
            @click="activeTab = 2"
          >
            {{ $t('dashboard.owner.missions_list.tabs.pending_validation') }}
            <Badge
              v-if="awaitingValidationMissions.length > 0"
              :value="awaitingValidationMissions.length"
              severity="danger"
              class="ml-2"
            ></Badge>
            <div
              v-if="activeTab === 2"
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
          role="alert"
          aria-live="polite"
          class="flex flex-col items-center justify-center py-12 text-zinc-600 dark:text-zinc-300"
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
                    {{ getAnimalEmoji(mission.animalSpecies) }}
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
                        <p v-if="mission.request?.clinic?.phone" class="text-zinc-500 text-sm">
                          {{ $t('dashboard.owner.missions_list.phone_label', { phone: mission.request.clinic.phone }) }}
                        </p>
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
              class="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800"
            >
              <div class="flex items-center justify-between">
                <div>
                  <p class="font-bold text-zinc-700 dark:text-zinc-300">
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

              <!-- Litige (DISPUTED) : motif fourni par l'Owner, en lecture seule -- écrit
                   UNIQUEMENT si l'Owner a infirmé (jamais sur CONFIRMED, voir la doc de
                   `submitDonationValidation`, useOwnerMissions.js). -->
              <p
                v-if="mission.status === MissionStatus.DISPUTED && mission.ownerDisputeReason"
                class="text-xs text-zinc-500 dark:text-zinc-400 italic mt-2"
              >
                {{ $t('dashboard.owner.missions_list.dispute_reason_label') }}
                {{ mission.ownerDisputeReason }}
              </p>

              <!-- Notation de la clinique -- flux totalement indépendant de la double
                   validation ci-dessus (CdC : "la notation ne bloque jamais la validation de
                   mission et inversement"), affiché sur une mission dont le don est
                   effectivement arrivé à COMPLETED/COMPLETED_AUTO. -->
              <div
                v-if="[MissionStatus.COMPLETED, MissionStatus.COMPLETED_AUTO].includes(mission.status)"
                class="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800"
              >
                <div
                  v-if="ratingCheckStatus[mission.id] === 'checking'"
                  class="text-xs text-zinc-400 flex items-center gap-2"
                >
                  <i class="pi pi-spin pi-spinner"></i>
                  {{ $t('dashboard.owner.missions_list.rating.checking') }}
                </div>
                <div
                  v-else-if="ratingCheckStatus[mission.id] === 'rated'"
                  class="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2"
                >
                  <i class="pi pi-check-circle text-emerald-500"></i>
                  {{ $t('dashboard.owner.missions_list.rating.already_rated') }}
                </div>
                <div v-else-if="ratingCheckStatus[mission.id] === 'unrated'" class="flex flex-col gap-2">
                  <p class="text-xs font-bold text-zinc-500 uppercase">
                    {{ $t('dashboard.owner.missions_list.rating.prompt') }}
                  </p>
                  <StarRating
                    v-model="getRatingForm(mission.id).stars"
                    :aria-label="$t('dashboard.owner.missions_list.rating.stars_aria')"
                  />
                  <Textarea
                    v-model="getRatingForm(mission.id).comment"
                    rows="2"
                    :placeholder="$t('dashboard.owner.missions_list.rating.comment_placeholder')"
                    class="!bg-white dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-xs !p-2"
                  />
                  <Button
                    size="small"
                    :label="$t('dashboard.owner.missions_list.rating.submit_btn')"
                    class="!bg-[#ff3b4e] !border-[#ff3b4e] self-end"
                    :loading="isSubmittingRating"
                    :disabled="!getRatingForm(mission.id).stars"
                    @click="handleSubmitRating(mission)"
                  />
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="activeTab === 2" class="space-y-4">
            <div
              v-if="awaitingValidationMissions.length === 0"
              class="text-center py-12 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700"
            >
              <i class="pi pi-hourglass text-4xl text-zinc-300 mb-3"></i>
              <p class="text-zinc-500">
                {{ $t('dashboard.owner.missions_list.empty.pending_validation') }}
              </p>
            </div>

            <div
              v-for="mission in awaitingValidationMissions"
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
                    {{ getAnimalEmoji(mission.animalSpecies) }}
                  </div>
                  <span class="font-bold text-zinc-900 dark:text-white">{{
                    mission.animalName
                  }}</span>
                </div>
                <Tag :value="getStatusLabel(mission.status)" severity="warn" />
              </div>

              <div class="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <p class="font-bold text-zinc-900 dark:text-white">
                  {{
                    mission.request?.clinic?.name
                      || $t('dashboard.owner.missions_list.unknown_clinic')
                  }}
                </p>

                <Button
                  v-if="!mission.ownerValidationOutcome"
                  icon="pi pi-question-circle"
                  :label="$t('dashboard.owner.missions_list.validation.cta')"
                  class="!bg-[#ff3b4e] !border-[#ff3b4e]"
                  @click="openValidationDialog(mission)"
                />
                <div v-else class="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                  <i class="pi pi-clock"></i>
                  {{ $t('dashboard.owner.missions_list.validation.awaiting_clinic') }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog
        v-model:visible="showValidationDialog"
        modal
        :header="$t('dashboard.owner.missions_list.validation.dialog_title')"
        :style="{ width: '420px' }"
      >
        <div v-if="selectedValidationMission" class="flex flex-col gap-4">
          <p class="text-sm text-zinc-600 dark:text-zinc-300">
            {{
              $t('dashboard.owner.missions_list.validation.question', {
                name: selectedValidationMission.animalName,
              })
            }}
          </p>

          <div v-if="validationStep === 'choose'" class="flex flex-col sm:flex-row gap-3 justify-end">
            <Button
              :label="$t('dashboard.owner.missions_list.validation.deny_btn')"
              severity="danger"
              outlined
              @click="validationStep = 'deny'"
            />
            <Button
              :label="$t('dashboard.owner.missions_list.validation.confirm_btn')"
              severity="success"
              :loading="isSubmittingValidation"
              @click="handleSubmitValidation(MissionValidationOutcome.CONFIRMED)"
            />
          </div>

          <div v-else class="flex flex-col gap-3">
            <label class="text-xs font-bold text-zinc-500 uppercase">
              {{ $t('dashboard.owner.missions_list.validation.dispute_reason_label') }}
            </label>
            <Textarea
              v-model="disputeReason"
              rows="3"
              :placeholder="$t('dashboard.owner.missions_list.validation.dispute_reason_placeholder')"
              class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !p-3"
            />
            <div class="flex justify-end gap-3">
              <Button
                :label="$t('dashboard.owner.missions_list.validation.back_btn')"
                text
                @click="validationStep = 'choose'"
              />
              <Button
                :label="$t('dashboard.owner.missions_list.validation.send_btn')"
                severity="danger"
                :loading="isSubmittingValidation"
                @click="handleSubmitValidation(MissionValidationOutcome.DENIED)"
              />
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  </div>
</template>
