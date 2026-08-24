<script setup>
import { ref, computed, onMounted } from 'vue'
import { useToast } from 'primevue/usetoast'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import { useOwnerAvailability } from '@/composables/useOwnerAvailability'
import { DAYS_OF_WEEK, getDayLabel } from '@/constants/date-constants'
import { TIME_PRESETS, mergeConsecutiveHourRanges } from '@/services/availability-service'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const toast = useToast()
const { availabilities, isLoading, fetchAvailabilities, addAvailabilityForDays, removeAvailability } =
  useOwnerAvailability()

// Raccourcis "Semaine"/"Weekend" (demande produit 2026-08-17) : un simple OU logique
// avec les presets horaires ci-dessous, pas des combos figés -- ce sont juste des
// sélections groupées de `selectedDays`, au même titre qu'un clic individuel sur un
// jour. `WEEK_DAYS`/`WEEKEND_DAYS` suivent la convention `Date.prototype.getDay()`
// (0 = dimanche), identique à `DAYS_OF_WEEK`/`matchesAvailability()`.
const WEEK_DAYS = [1, 2, 3, 4, 5]
const WEEKEND_DAYS = [6, 0]

// TIME_PRESETS : voir availability-service.js (bornes validées avec le repo owner,
// 2026-08-17). Demande produit (2026-08-23) : combinables entre eux (matin ET après-midi
// ET soir en une seule sauvegarde), pas exclusifs -- avant ce correctif, cliquer un second
// preset écrasait juste Début/Fin du premier au lieu de s'y ajouter. `selectedPresets` est
// un multi-select (même pattern que `selectedDays` ci-dessus, boutons togglables) ; l'heure
// exacte manuelle (Début/Fin ci-dessous) reste un moyen alternatif d'ajouter UN créneau
// précis, mutuellement exclusif avec les presets (voir handleAdd).

const selectedDays = ref([])
const selectedPresets = ref([])
const startTime = ref(null)
const endTime = ref(null)
const isSubmitting = ref(false)

const sameDaySet = (a, b) => a.length === b.length && b.every((d) => a.includes(d))
const isWeekSelected = computed(() => sameDaySet(selectedDays.value, WEEK_DAYS))
const isWeekendSelected = computed(() => sameDaySet(selectedDays.value, WEEKEND_DAYS))

const toggleDay = (value) => {
  selectedDays.value = selectedDays.value.includes(value)
    ? selectedDays.value.filter((d) => d !== value)
    : [...selectedDays.value, value]
}

const selectDayGroup = (days) => {
  selectedDays.value = [...days]
}

// Togglable (voir toggleDay ci-dessus) au lieu d'un simple `@click` qui écrasait
// Début/Fin -- sélectionner un preset désarme l'heure exacte manuelle (mutuellement
// exclusifs, voir handleAdd) plutôt que de laisser les deux se contredire silencieusement.
const togglePreset = (key) => {
  selectedPresets.value = selectedPresets.value.includes(key)
    ? selectedPresets.value.filter((p) => p !== key)
    : [...selectedPresets.value, key]

  if (selectedPresets.value.length > 0) {
    startTime.value = null
    endTime.value = null
  }
}

onMounted(() => {
  fetchAvailabilities()
})

const formatTime = (date) => {
  if (!date) return null
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// Résout les plages horaires (Début/Fin) à soumettre pour ce clic sur "Enregistrer" --
// un preset sélectionné par plage cochée (`selectedPresets`, combinables), sinon la plage
// manuelle (Début/Fin), jamais les deux (voir togglePreset ci-dessus). Presets fusionnés
// via `mergeConsecutiveHourRanges` (availability-service.js) quand ils sont consécutifs
// (matin+après-midi, après-midi+soir, ou les trois) -- voir sa doc pour le détail
// (fonction pure, testée séparément, pas de logique métier dupliquée ici).
const rangesToSubmit = () => {
  if (selectedPresets.value.length > 0) {
    return mergeConsecutiveHourRanges(selectedPresets.value).map((group) => ({
      start: `${String(group.startHour).padStart(2, '0')}:00`,
      end: `${String(group.endHour).padStart(2, '0')}:00`,
    }))
  }
  if (startTime.value && endTime.value) {
    return [{ start: formatTime(startTime.value), end: formatTime(endTime.value) }]
  }
  return []
}

const handleAdd = async () => {
  const ranges = rangesToSubmit()

  if (selectedDays.value.length === 0 || ranges.length === 0) {
    toast.add({
      severity: 'warn',
      summary: t('dashboard.owner.availability.toasts.missing_fields'),
      detail: t('dashboard.owner.availability.toasts.fill'),
      life: 3000,
    })
    return
  }

  if (selectedPresets.value.length === 0 && startTime.value >= endTime.value) {
    toast.add({
      severity: 'error',
      summary: t('dashboard.owner.availability.toasts.error'),
      detail: t('dashboard.owner.availability.toasts.end_date_after_start_date'),
      life: 3000,
    })
    return
  }

  isSubmitting.value = true
  try {
    // Un appel par plage (best-effort, comme addAvailabilityForDays lui-même) --
    // combiner matin+après-midi+soir crée donc jusqu'à 3 créneaux par jour sélectionné en
    // une seule action utilisateur.
    const results = await Promise.all(
      ranges.map((range) => addAvailabilityForDays(selectedDays.value, range.start, range.end)),
    )
    const succeeded = results.reduce((sum, r) => sum + r.succeeded, 0)
    const failed = results.reduce((sum, r) => sum + r.failed, 0)
    const total = results.reduce((sum, r) => sum + r.total, 0)

    if (succeeded === 0) {
      toast.add({
        severity: 'error',
        summary: t('common.error'),
        detail: t('dashboard.owner.availability.toasts.add_failed'),
        life: 3000,
      })
    } else if (failed > 0) {
      toast.add({
        severity: 'warn',
        summary: t('dashboard.owner.availability.toasts.error'),
        detail: t('dashboard.owner.availability.toasts.add_partial_failed', { succeeded, total }),
        life: 4000,
      })
    } else {
      toast.add({
        severity: 'success',
        summary: t('common.success'),
        detail:
          succeeded === 1
            ? t('dashboard.owner.availability.toasts.slot_added')
            : t('dashboard.owner.availability.toasts.slots_added', { count: succeeded }),
        life: 3000,
      })
    }

    selectedDays.value = []
    selectedPresets.value = []
    startTime.value = null
    endTime.value = null
  } catch {
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t('dashboard.owner.availability.toasts.add_failed'),
      life: 3000,
    })
  } finally {
    isSubmitting.value = false
  }
}

const handleRemove = async (id) => {
  try {
    await removeAvailability(id)
  } catch {
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t('dashboard.owner.availability.toasts.remove_failed'),
      life: 3000,
    })
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <Toast />
    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />

      <div class="flex-grow">
        <h1
          class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider border-l-4 border-[#ff3b4e] pl-4 mb-8"
        >
          {{ $t('dashboard.owner.availability.title') }}
        </h1>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div class="lg:col-span-1">
            <div
              class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm sticky top-6"
            >
              <h3
                class="font-bold text-lg mb-4 text-zinc-900 dark:text-white flex items-center gap-2"
              >
                <i class="pi pi-plus-circle text-[#ff3b4e]"></i>
                {{ $t('dashboard.owner.availability.form.add_title') }}
              </h3>

              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                  <div class="flex items-center justify-between gap-2">
                    <label class="text-xs font-bold uppercase text-zinc-500">
                      {{ $t('dashboard.owner.availability.form.days_label') }}
                    </label>
                    <div class="flex gap-1.5">
                      <button
                        type="button"
                        class="px-2.5 py-1 rounded-full text-xs font-bold border transition-colors"
                        :class="
                          isWeekSelected
                            ? 'bg-[#ff3b4e] border-[#ff3b4e] text-white'
                            : 'bg-transparent border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:border-[#ff3b4e] hover:text-[#ff3b4e]'
                        "
                        @click="selectDayGroup(WEEK_DAYS)"
                      >
                        {{ $t('dashboard.owner.availability.form.days_shortcut_week') }}
                      </button>
                      <button
                        type="button"
                        class="px-2.5 py-1 rounded-full text-xs font-bold border transition-colors"
                        :class="
                          isWeekendSelected
                            ? 'bg-[#ff3b4e] border-[#ff3b4e] text-white'
                            : 'bg-transparent border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:border-[#ff3b4e] hover:text-[#ff3b4e]'
                        "
                        @click="selectDayGroup(WEEKEND_DAYS)"
                      >
                        {{ $t('dashboard.owner.availability.form.days_shortcut_weekend') }}
                      </button>
                    </div>
                  </div>

                  <div class="flex flex-wrap gap-1.5" role="group" :aria-label="$t('dashboard.owner.availability.form.days_label')">
                    <button
                      v-for="day in DAYS_OF_WEEK"
                      :key="day.value"
                      type="button"
                      :aria-pressed="selectedDays.includes(day.value)"
                      class="w-11 h-11 rounded-full text-xs font-bold uppercase border transition-colors"
                      :class="
                        selectedDays.includes(day.value)
                          ? 'bg-[#ff3b4e] border-[#ff3b4e] text-white'
                          : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-300 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:border-[#ff3b4e] hover:text-[#ff3b4e]'
                      "
                      @click="toggleDay(day.value)"
                    >
                      {{ day.label.substring(0, 3) }}
                    </button>
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  <label class="text-xs font-bold uppercase text-zinc-500">
                    {{ $t('dashboard.owner.availability.form.time_presets_label') }}
                  </label>
                  <div
                    class="flex flex-wrap gap-1.5"
                    role="group"
                    :aria-label="$t('dashboard.owner.availability.form.time_presets_label')"
                  >
                    <button
                      v-for="preset in TIME_PRESETS"
                      :key="preset.key"
                      type="button"
                      :aria-pressed="selectedPresets.includes(preset.key)"
                      class="px-3 py-1.5 rounded-full text-xs font-bold border transition-colors"
                      :class="
                        selectedPresets.includes(preset.key)
                          ? 'bg-[#ff3b4e] border-[#ff3b4e] text-white'
                          : 'bg-transparent border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-[#ff3b4e] hover:text-[#ff3b4e]'
                      "
                      @click="togglePreset(preset.key)"
                    >
                      {{ $t(`dashboard.owner.availability.form.time_preset_${preset.key}`) }}
                    </button>
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  <label class="text-xs font-bold uppercase text-zinc-500">
                    {{ $t('dashboard.owner.availability.form.exact_time_label') }}
                  </label>
                  <div class="grid grid-cols-2 gap-3">
                    <div class="flex flex-col gap-1">
                      <span class="text-[11px] font-semibold text-zinc-400">
                        {{ $t('dashboard.owner.availability.form.start_label') }}
                      </span>
                      <Calendar
                        v-model="startTime"
                        time-only
                        show-icon
                        icon-display="input"
                        step-minute="30"
                        :placeholder="$t('dashboard.owner.availability.form.start_placeholder')"
                        class="w-full"
                        input-class="w-full !bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800"
                      />
                    </div>
                    <div class="flex flex-col gap-1">
                      <span class="text-[11px] font-semibold text-zinc-400">
                        {{ $t('dashboard.owner.availability.form.end_label') }}
                      </span>
                      <Calendar
                        v-model="endTime"
                        time-only
                        show-icon
                        icon-display="input"
                        step-minute="30"
                        :placeholder="$t('dashboard.owner.availability.form.end_placeholder')"
                        class="w-full"
                        input-class="w-full !bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800"
                      />
                    </div>
                  </div>
                </div>

                <Button
                  :label="$t('dashboard.owner.availability.form.save_button')"
                  icon="pi pi-check"
                  class="w-full !bg-[#ff3b4e] !border-[#ff3b4e] mt-2"
                  :loading="isSubmitting"
                  @click="handleAdd"
                />
              </div>
            </div>
          </div>

          <div class="lg:col-span-2">
            <div
              v-if="availabilities.length === 0 && !isLoading"
              class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-6 text-center"
            >
              <i class="pi pi-info-circle text-2xl text-blue-500 mb-2"></i>
              <h3 class="font-bold text-blue-700 dark:text-blue-400">
                {{ $t('dashboard.owner.availability.empty.title') }}
              </h3>
              <p class="text-sm text-blue-600/80 dark:text-blue-400/80 mt-1">
                {{ $t('dashboard.owner.availability.empty.description') }}
              </p>
            </div>

            <div v-if="isLoading" class="flex justify-center py-10">
              <i class="pi pi-spin pi-spinner text-3xl text-[#ff3b4e]"></i>
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="slot in availabilities"
                :key="slot.id"
                class="flex items-center justify-between bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-lg shadow-sm hover:border-[#ff3b4e] transition-colors group"
              >
                <div class="flex items-center gap-4">
                  <div
                    class="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center font-black text-zinc-400 text-sm uppercase"
                  >
                    {{ getDayLabel(slot.dayOfWeek).substring(0, 3) }}
                  </div>

                  <div>
                    <p class="font-bold text-zinc-900 dark:text-white text-lg leading-tight">
                      {{ getDayLabel(slot.dayOfWeek) }}
                    </p>
                    <div class="flex items-center gap-2 text-sm text-zinc-500 mt-1">
                      <span
                        class="bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-zinc-700 dark:text-zinc-300 font-mono"
                      >
                        {{ slot.startTime.substring(0, 5) }}
                      </span>
                      <i class="pi pi-arrow-right text-[10px]"></i>
                      <span
                        class="bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-zinc-700 dark:text-zinc-300 font-mono"
                      >
                        {{ slot.endTime.substring(0, 5) }}
                      </span>
                    </div>
                  </div>
                </div>

                <Button
                  icon="pi pi-trash"
                  text
                  rounded
                  severity="danger"
                  class="opacity-50 group-hover:opacity-100 transition-opacity"
                  @click="handleRemove(slot.id)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
