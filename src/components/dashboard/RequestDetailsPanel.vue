<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { MissionStatus, MissionValidationOutcome, RequestType, Species } from '@/constants/enums'
import { breedLabel } from '@/constants/breeds.js'

// Bloc de détail d'une Request (type/espèce/groupe/quantité + RDV, et si une Mission existe :
// donneur/propriétaire/états de validation), extrait de RequestsView.vue (dialog de détail
// vétérinaire) pour être consommé aussi par HistoryView.vue (correctif UX, 2026-09) --
// aucun des deux appelants ne dupliquait plus ce markup, seule la vue clinique ayant des
// ACTIONS dessus (Compléter/Absent, notation propriétaire).
//
// Ce composant reste PUREMENT DE PRÉSENTATION : aucune écriture GraphQL, aucune décision
// métier au-delà de « quel état afficher » (déjà présente à l'identique dans RequestsView.vue
// avant cette extraction). Les DEUX actions interactives (voter Compléter/Absent, noter le
// propriétaire) restent la responsabilité de l'APPELANT -- passées en slots nommés
// (`#actions`/`#rating`, tous deux scoped avec `mission`) plutôt que dupliquées ici :
// HistoryView.vue n'a besoin d'aucune des deux (une Mission déjà dans l'historique n'a plus
// d'action de terrain à proposer), RequestsView.vue les fournit telles quelles.
//
// `canVote` (identique à `canVoteOnMission`, ex-RequestsView.vue) vit ICI plutôt que d'être
// dupliqué chez chaque appelant : c'est cette même condition qui décide si le slot `#actions`
// a un sens à être inséré (voir le `v-if` qui l'entoure ci-dessous) -- la dupliquer chez
// l'appelant risquerait de la faire diverger de celle qui gate réellement l'affichage.
const props = defineProps({
  request: {
    type: Object,
    required: true,
  },
})

const { t, te } = useI18n()

const canVote = computed(() => {
  const mission = props.request?.mission
  if (!mission) return false
  return (
    mission.status === MissionStatus.ACCEPTED ||
    mission.status === MissionStatus.PENDING_ARRIVAL ||
    (mission.status === MissionStatus.PENDING_VALIDATION && !mission.clinicValidationOutcome)
  )
})

const isCompletedOrAuto = computed(() => {
  const status = props.request?.mission?.status
  return status === MissionStatus.COMPLETED || status === MissionStatus.COMPLETED_AUTO
})

// Même format que HistoryView.vue/RequestsView.vue (date + heure, `toLocaleString('fr-FR', ...)`)
// -- pas de nouvel utilitaire de temps relatif pour ce seul composant (même choix MVP que
// HistoryView.vue).
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
  <div v-if="request" class="flex flex-col gap-4">
    <div class="p-4 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
      <h3 class="font-bold text-zinc-900 dark:text-white mb-2">
        {{ $t('dashboard.requests.dialog.request_title') }}
      </h3>
      <div class="grid grid-cols-2 gap-2 text-sm">
        <span class="text-zinc-500">{{ $t('dashboard.requests.dialog.type') }}</span>
        <span class="font-medium">{{
          request.requestType === RequestType.EMERGENCY
            ? $t('dashboard.requests.dialog.type_emergency')
            : $t('dashboard.requests.dialog.type_appointment')
        }}</span>
        <span class="text-zinc-500">{{ $t('dashboard.requests.dialog.species') }}</span>
        <span class="font-medium">{{
          request.requiredSpecies === Species.DOG
            ? $t('request.species.dog')
            : $t('request.species.cat')
        }}</span>
        <span class="text-zinc-500">{{ $t('dashboard.requests.dialog.blood') }}</span>
        <span class="font-medium">{{ request.requiredBloodGroup }}</span>
        <span class="text-zinc-500">{{ $t('dashboard.requests.dialog.quantity') }}</span>
        <span class="font-medium">{{ request.quantity }} ml</span>
        <template
          v-if="request.requestType === RequestType.APPOINTMENT && request.appointmentDatetime"
        >
          <span class="text-zinc-500">{{ $t('dashboard.requests.dialog.appointment_datetime') }}</span>
          <span class="font-medium">{{ formatDateTime(request.appointmentDatetime) }}</span>
        </template>
      </div>
    </div>

    <div
      v-if="request.mission"
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
              {{ request.mission.animal.name }}
            </p>
            <p class="text-xs text-zinc-500">
              {{ breedLabel(request.mission.animal.breed, t, te) }} •
              {{ request.mission.animal.weight }}kg
            </p>
          </div>
        </div>

        <div class="border-t border-green-200 dark:border-green-800 pt-3 mt-2">
          <p class="text-xs text-green-700 dark:text-green-400 uppercase font-bold mb-1">
            {{ $t('dashboard.requests.dialog.owner_contact') }}
          </p>
          <p class="font-medium text-zinc-900 dark:text-white">
            {{ request.mission.animal.ownerProfile?.firstname }}
            {{ request.mission.animal.ownerProfile?.lastname }}
          </p>
          <a
            :href="`tel:${request.mission.animal.ownerProfile?.phone}`"
            class="inline-flex items-center gap-2 mt-1 text-blue-600 hover:underline font-bold"
          >
            <i class="pi pi-phone"></i> {{ request.mission.animal.ownerProfile?.phone }}
          </a>
        </div>

        <!-- Actions (Compléter/Absent) : fournies par l'appelant (RequestsView.vue), jamais
             insérées si `canVote` est faux ou si l'appelant n'en fournit aucune (HistoryView.vue) --
             dans ce dernier cas, une Mission encore votable retombe sur l'état "en attente"
             ci-dessous plutôt que de n'afficher aucune information. -->
        <div
          v-if="canVote && $slots.actions"
          class="border-t border-green-200 dark:border-green-800 pt-3 mt-2 flex gap-2"
        >
          <slot name="actions" :mission="request.mission" />
        </div>

        <!-- La clinique a déjà voté, l'Owner pas encore (double validation, ADR-0018) -- ou,
             pour un appelant sans slot `#actions` (HistoryView.vue), toute Mission encore
             `PENDING_VALIDATION`. -->
        <div
          v-else-if="request.mission.status === MissionStatus.PENDING_VALIDATION"
          class="border-t border-green-200 dark:border-green-800 pt-3 mt-2 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"
        >
          <i class="pi pi-clock"></i>
          {{ $t('dashboard.requests.validation.awaiting_owner') }}
        </div>

        <!-- Litige : les deux ont voté, en désaccord -- aucune UI admin de résolution
             n'existe ni n'est construite ici (ADR-0016 §6), juste l'affichage en lecture
             seule des deux issues et du motif de l'Owner. -->
        <div
          v-else-if="request.mission.status === MissionStatus.DISPUTED"
          class="border-t border-red-200 dark:border-red-800 pt-3 mt-2"
        >
          <div class="flex items-center gap-2 mb-2">
            <i class="pi pi-exclamation-triangle text-red-600"></i>
            <p class="font-bold text-red-700 dark:text-red-400">
              {{ $t('dashboard.requests.validation.disputed_title') }}
            </p>
          </div>
          <p class="text-xs text-zinc-500 dark:text-zinc-400">
            {{
              request.mission.clinicValidationOutcome === MissionValidationOutcome.CONFIRMED
                ? $t('dashboard.requests.validation.your_answer_confirmed')
                : $t('dashboard.requests.validation.your_answer_denied')
            }}
          </p>
          <p class="text-xs text-zinc-500 dark:text-zinc-400">
            {{
              request.mission.ownerValidationOutcome === MissionValidationOutcome.CONFIRMED
                ? $t('dashboard.requests.validation.owner_answer_confirmed')
                : $t('dashboard.requests.validation.owner_answer_denied')
            }}
          </p>
          <p
            v-if="request.mission.ownerDisputeReason"
            class="text-xs text-zinc-500 dark:text-zinc-400 italic mt-2"
          >
            {{ $t('dashboard.requests.validation.dispute_reason_label') }}
            {{ request.mission.ownerDisputeReason }}
          </p>
        </div>

        <!-- Finalisation automatique (Lambda planifiée, ADR-0016) : même bloc visuel de
             succès que COMPLETED, libellé distinct pour ne pas laisser croire que la
             clinique a elle-même clôturé la Mission. -->
        <div
          v-else-if="request.mission.status === MissionStatus.COMPLETED_AUTO"
          class="border-t border-green-200 dark:border-green-800 pt-3 mt-2"
        >
          <Tag :value="$t('dashboard.requests.validation.completed_auto_label')" severity="success" />
        </div>

        <!-- Notation (widget propre à l'appelant, ex. RequestsView.vue -- voir son propre
             commentaire sur l'asymétrie `@auth` de la notation) -- jamais insérée si
             l'appelant n'en fournit pas (HistoryView.vue). -->
        <div
          v-if="isCompletedOrAuto && $slots.rating"
          class="border-t border-green-200 dark:border-green-800 pt-3 mt-2"
        >
          <slot name="rating" :mission="request.mission" />
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
</template>
