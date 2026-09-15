<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import BreedAutocomplete from '@/components/common/BreedAutocomplete.vue'
import { useClinicRequests } from '@/composables/useClinicRequest.js'
import { BloodGroupsBySpecies } from '@/constants/enums.js'
import { TIME_PRESETS, FULL_DAY_PRESET } from '@/services/availability-service.js'

const { t } = useI18n()
const toast = useToast()
const step = ref(1)
const requestType = ref('')

const { createNewRequest, isCreating } = useClinicRequests()

const form = ref({
  patientName: '',
  species: null,
  breed: '',
  weight: null,
  bloodGroup: null,
  quantity: null,
  date: null,
  details: '',
})

// Mode de saisie de la date souhaitée d'un don planifié (RequestType.APPOINTMENT) : "précis"
// (comportement historique, un seul instant via DatePicker) ou "plage horaire" (nouveau,
// même système que OwnerAvailability côté Owner -- présélections + heure manuelle -- mais
// ancré sur UNE date calendaire précise plutôt que récurrent par jour de semaine). Mutuellement
// exclusifs côté payload (voir handleSubmit/useClinicRequest.createNewRequest), jamais les deux
// envoyés à la fois.
const appointmentMode = ref('precise')
const windowDate = ref(null)
const selectedWindowPreset = ref(null)
const windowStartTime = ref(null)
const windowEndTime = ref(null)

// TIME_PRESETS (availability-service.js) + "Journée entière" (FULL_DAY_PRESET, réservé à ce
// formulaire, voir son commentaire) -- contrairement aux présélections combinables
// d'AvailabilityView.vue, UN SEUL preset est sélectionnable ici : une Request ne porte qu'une
// seule plage, pas une liste de créneaux.
const windowPresets = computed(() => [...TIME_PRESETS, FULL_DAY_PRESET])

// Sélection togglable (reclic = désélection) et mutuellement exclusive avec l'heure manuelle
// (windowStartTime/windowEndTime, réinitialisées ici) -- même intention qu'AvailabilityView.vue
// (togglePreset), adaptée à une sélection unique au lieu d'un multi-select.
const selectWindowPreset = (key) => {
  selectedWindowPreset.value = selectedWindowPreset.value === key ? null : key
  if (selectedWindowPreset.value) {
    windowStartTime.value = null
    windowEndTime.value = null
  }
}

// Résout la plage (Date de début / Date de fin) à soumettre pour le mode "plage horaire" --
// preset sélectionné (heures fixes appliquées à windowDate) sinon heure manuelle
// (windowStartTime/windowEndTime, jamais les deux à la fois, voir selectWindowPreset), jamais
// aucun sans l'autre. `null` si la sélection est incomplète (date manquante, ou ni preset ni
// heure manuelle renseignés) -- laisse handleSubmit décider que c'est un champ manquant.
const computeWindowRange = () => {
  if (!windowDate.value) return null

  const preset = windowPresets.value.find((p) => p.key === selectedWindowPreset.value)
  if (preset) {
    const start = new Date(windowDate.value)
    start.setHours(preset.startHour, 0, 0, 0)
    const end = new Date(windowDate.value)
    end.setHours(preset.endHour, 0, 0, 0)
    return { start, end }
  }

  if (windowStartTime.value && windowEndTime.value) {
    const start = new Date(windowDate.value)
    start.setHours(windowStartTime.value.getHours(), windowStartTime.value.getMinutes(), 0, 0)
    const end = new Date(windowDate.value)
    end.setHours(windowEndTime.value.getHours(), windowEndTime.value.getMinutes(), 0, 0)
    return { start, end }
  }

  return null
}

const speciesOptions = computed(() => [
  { label: t('request.species.dog'), value: 'dog' },
  { label: t('request.species.cat'), value: 'cat' },
])

// R-15 : source unique de vérité (constants/enums.js) au lieu d'une liste dupliquée en dur
// ici. `form.value.species` reste en minuscules ('dog'/'cat', valeurs des `speciesOptions`
// ci-dessus, hors périmètre de ce correctif) alors que `BloodGroupsBySpecies` est indexée
// par `Species.DOG`/`Species.CAT` ('DOG'/'CAT') -- d'où le `toUpperCase()` pour faire le pont.
const bloodOptions = computed(() => BloodGroupsBySpecies[form.value.species?.toUpperCase()] || [])

const selectType = (type) => {
  requestType.value = type
  step.value = 2
}

const handleSubmit = async () => {
  // Phase 6.5 : pour un RDV, la date/heure souhaitée est la seule donnée qui permet ensuite au
  // moteur de matching de confronter cette Request aux OwnerAvailability d'un Owner
  // (useMatchingRequests.js, matchesAvailability()/matchesAvailabilityWindow()) — sans elle, la
  // Request APPOINTMENT créée ne matchera jamais aucun Owner. `breed`/`weight`/`patientName`
  // restent volontairement collectés par ce formulaire (mode emergency seulement, voir le
  // template) mais jamais envoyés : ce sont des attributs de l'Animal matché, pas de la
  // Request elle-même (voir docs/adr/0005).
  const windowRange = appointmentMode.value === 'window' ? computeWindowRange() : null
  const isAppointmentDateMissing =
    requestType.value === 'appointment' &&
    (appointmentMode.value === 'precise'
      ? !form.value.date
      : !windowRange || windowRange.start >= windowRange.end)

  if (!form.value.species || !form.value.bloodGroup || !form.value.quantity || isAppointmentDateMissing) {
    toast.add({
      severity: 'warn',
      summary: t('common.error'),
      detail: t('request.toasts.missing_required'),
      life: 3000,
    })
    return
  }

  try {
    const payload = {
      type: requestType.value, // 'emergency' ou 'appointment'
      species: form.value.species,
      bloodGroup: form.value.bloodGroup,
      quantity: form.value.quantity,
      // Non pertinents pour 'emergency' (createNewRequest ne les envoie que pour 'appointment',
      // et jamais les deux modes à la fois).
      appointmentDatetime: appointmentMode.value === 'precise' ? form.value.date : null,
      appointmentWindowStart: windowRange?.start ?? null,
      appointmentWindowEnd: windowRange?.end ?? null,
      // Note: breed, weight, details peuvent être ajoutés si le backend les supporte plus tard
    }

    await createNewRequest(payload)

    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t('request.toasts.create_success'),
      life: 3000,
    })
  } catch (e) {
    console.error(e)
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t('request.toasts.create_failed'),
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
        <div class="mb-8">
          <h1
            class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider border-l-4 border-[#ff3b4e] pl-4"
          >
            {{ $t('request.title') }}
          </h1>
          <p v-if="step === 1" class="text-zinc-500 mt-2 ml-5">
            {{ $t('request.step1_subtitle') }}
          </p>
        </div>

        <div v-if="step === 1" class="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
          <div
            class="group cursor-pointer relative overflow-hidden rounded-2xl border-2 border-[#ff3b4e] bg-red-50 dark:bg-red-900/10 p-8 hover:bg-[#ff3b4e] transition-all duration-300 shadow-lg hover:shadow-red-500/30"
            @click="selectType('emergency')"
          >
            <div
              class="absolute -right-10 -bottom-10 w-40 h-40 bg-[#ff3b4e]/20 rounded-full blur-3xl group-hover:bg-white/20 transition-colors"
            ></div>

            <div class="relative z-10 flex flex-col h-full">
              <div class="flex justify-between items-start mb-6">
                <div
                  class="w-14 h-14 rounded-full bg-[#ff3b4e] text-white flex items-center justify-center text-2xl shadow-md group-hover:bg-white group-hover:text-[#ff3b4e] transition-colors"
                >
                  <i class="pi pi-bolt"></i>
                </div>
                <Tag
                  :value="$t('request.emergency.badge')"
                  severity="danger"
                  class="uppercase text-[10px]"
                />
              </div>

              <h3
                class="text-xl font-black text-zinc-900 dark:text-white mb-2 uppercase group-hover:text-white"
              >
                {{ $t('request.emergency.title') }}
              </h3>
              <p
                class="text-sm text-zinc-600 dark:text-zinc-300 group-hover:text-white/90 leading-relaxed"
              >
                {{ $t('request.emergency.desc') }}
              </p>
            </div>
          </div>

          <div
            class="group cursor-pointer relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-8 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all duration-300 shadow-sm hover:shadow-blue-500/20"
            @click="selectType('appointment')"
          >
            <div class="relative z-10 flex flex-col h-full">
              <div class="flex justify-between items-start mb-6">
                <div
                  class="w-14 h-14 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 flex items-center justify-center text-2xl group-hover:bg-blue-500 group-hover:text-white transition-colors"
                >
                  <i class="pi pi-calendar"></i>
                </div>
                <Tag
                  :value="$t('request.appointment.badge')"
                  severity="info"
                  class="uppercase text-[10px]"
                />
              </div>

              <h3
                class="text-xl font-black text-zinc-900 dark:text-white mb-2 uppercase group-hover:text-blue-600 dark:group-hover:text-blue-400"
              >
                {{ $t('request.appointment.title') }}
              </h3>
              <p class="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {{ $t('request.appointment.desc') }}
              </p>
            </div>
          </div>
        </div>

        <div
          v-else
          class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 md:p-8 animate-slide-up shadow-sm"
        >
          <div
            class="flex items-center justify-between mb-8 pb-4 border-b border-zinc-100 dark:border-zinc-800"
          >
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 rounded-full flex items-center justify-center text-white shadow-md"
                :class="requestType === 'emergency' ? 'bg-[#ff3b4e]' : 'bg-blue-500'"
              >
                <i :class="requestType === 'emergency' ? 'pi pi-bolt' : 'pi pi-calendar'"></i>
              </div>
              <h2 class="text-lg font-bold text-zinc-900 dark:text-white uppercase">
                {{
                  requestType === 'emergency'
                    ? $t('request.form.title_emergency')
                    : $t('request.form.title_appointment')
                }}
              </h2>
            </div>
            <Button
              :label="$t('request.form.back')"
              icon="pi pi-arrow-left"
              variant="text"
              size="small"
              class="!text-zinc-500 hover:!text-zinc-800 dark:hover:!text-white"
              @click="step = 1"
            />
          </div>

          <form class="flex flex-col gap-6 max-w-3xl" @submit.prevent="handleSubmit">
            <!-- Nom / espèce / race : uniquement en urgence, où l'Animal recherché est un
                 animal précis. En don planifié, la clinique ne cherche pas forcément pour un
                 animal donné -- seuls l'espèce (pour filtrer le groupe sanguin), le groupe
                 sanguin et la quantité comptent, voir le bloc `v-else` plus bas. -->
            <div v-if="requestType === 'emergency'" class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{
                  $t('request.form.patient_name')
                }}</label>
                <InputText
                  v-model="form.patientName"
                  class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]"
                />
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div class="flex flex-col gap-2">
                  <label class="text-xs font-bold text-zinc-500 uppercase">{{
                    $t('request.form.species')
                  }}</label>
                  <Select
                    v-model="form.species"
                    :options="speciesOptions"
                    option-label="label"
                    option-value="value"
                    :placeholder="$t('request.form.select_placeholder')"
                    class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white"
                  />
                </div>
                <div class="flex flex-col gap-2">
                  <label class="text-xs font-bold text-zinc-500 uppercase">{{
                    $t('request.form.breed')
                  }}</label>
                  <!-- `form.species` reste en minuscules ('dog'/'cat', voir `speciesOptions`
                       ci-dessus) alors que `breedsForSpecies()` (constants/breeds.js) compare
                       strictement à `Species.DOG`/`Species.CAT` ('DOG'/'CAT') -- même pont
                       `toUpperCase()` que `bloodOptions` juste au-dessus, sinon la liste de
                       suggestions resterait silencieusement vide (le champ resterait
                       utilisable en texte libre, `forceSelection` étant absent, mais sans
                       aucune suggestion). -->
                  <BreedAutocomplete
                    v-model="form.breed"
                    :species="form.species?.toUpperCase()"
                    :aria-label="$t('request.form.breed')"
                    class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]"
                  />
                </div>
              </div>
            </div>

            <div v-if="requestType === 'emergency'" class="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{
                  $t('request.form.weight')
                }}</label>
                <InputNumber
                  v-model="form.weight"
                  suffix=" kg"
                  class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white focus:!border-[#ff3b4e]"
                  input-class="!bg-transparent !border-none"
                />
              </div>

              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{
                  $t('request.form.blood_group')
                }}</label>
                <Select
                  v-model="form.bloodGroup"
                  :options="bloodOptions"
                  :disabled="!form.species"
                  :placeholder="$t('request.form.select_blood_placeholder')"
                  class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white"
                />
              </div>

              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{
                  $t('request.form.quantity')
                }}</label>
                <InputNumber
                  v-model="form.quantity"
                  suffix=" ml"
                  class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white focus:!border-[#ff3b4e]"
                  input-class="!bg-transparent !border-none"
                />
              </div>
            </div>

            <div v-else class="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{
                  $t('request.form.species')
                }}</label>
                <Select
                  v-model="form.species"
                  :options="speciesOptions"
                  option-label="label"
                  option-value="value"
                  :placeholder="$t('request.form.select_placeholder')"
                  class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white"
                />
              </div>

              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{
                  $t('request.form.blood_group')
                }}</label>
                <Select
                  v-model="form.bloodGroup"
                  :options="bloodOptions"
                  :disabled="!form.species"
                  :placeholder="$t('request.form.select_blood_placeholder')"
                  class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white"
                />
              </div>

              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{
                  $t('request.form.quantity')
                }}</label>
                <InputNumber
                  v-model="form.quantity"
                  suffix=" ml"
                  class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white focus:!border-[#ff3b4e]"
                  input-class="!bg-transparent !border-none"
                />
              </div>
            </div>

            <div
              v-if="requestType === 'appointment'"
              class="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-900/30 flex flex-col gap-4 animate-fade-in"
            >
              <!-- Mode "heure précise" (historique) vs "plage horaire" (nouveau, même système
                   que les disponibilités Owner -- voir AvailabilityView.vue) : mutuellement
                   exclusifs, voir handleSubmit. -->
              <div
                class="flex gap-1.5"
                role="group"
                :aria-label="$t('request.form.mode_label')"
              >
                <button
                  type="button"
                  :aria-pressed="appointmentMode === 'precise'"
                  class="px-3 py-1.5 rounded-full text-xs font-bold border transition-colors"
                  :class="
                    appointmentMode === 'precise'
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-transparent border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:border-blue-500'
                  "
                  @click="appointmentMode = 'precise'"
                >
                  {{ $t('request.form.mode_precise') }}
                </button>
                <button
                  type="button"
                  :aria-pressed="appointmentMode === 'window'"
                  class="px-3 py-1.5 rounded-full text-xs font-bold border transition-colors"
                  :class="
                    appointmentMode === 'window'
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-transparent border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:border-blue-500'
                  "
                  @click="appointmentMode = 'window'"
                >
                  {{ $t('request.form.mode_window') }}
                </button>
              </div>

              <div v-if="appointmentMode === 'precise'" class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="flex flex-col gap-2">
                  <label class="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase">{{
                    $t('request.form.date_label')
                  }}</label>
                  <DatePicker
                    v-model="form.date"
                    show-icon
                    show-time
                    hour-format="24"
                    class="w-full"
                    input-class="!bg-white dark:!bg-zinc-900 !border-blue-200 dark:!border-blue-800"
                  />
                </div>
                <div class="flex flex-col justify-center text-sm text-blue-600 dark:text-blue-400">
                  <i class="pi pi-info-circle mb-1"></i>
                  {{ $t('request.appointment.info') }}
                </div>
              </div>

              <div v-else class="flex flex-col gap-4">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div class="flex flex-col gap-2">
                    <label class="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase">{{
                      $t('request.form.date_label')
                    }}</label>
                    <DatePicker
                      v-model="windowDate"
                      show-icon
                      class="w-full"
                      input-class="!bg-white dark:!bg-zinc-900 !border-blue-200 dark:!border-blue-800"
                    />
                  </div>
                  <div class="flex flex-col justify-center text-sm text-blue-600 dark:text-blue-400">
                    <i class="pi pi-info-circle mb-1"></i>
                    {{ $t('request.appointment.info') }}
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  <label class="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase">{{
                    $t('request.form.time_label')
                  }}</label>
                  <div
                    class="flex flex-wrap gap-1.5"
                    role="group"
                    :aria-label="$t('request.form.time_label')"
                  >
                    <button
                      v-for="preset in windowPresets"
                      :key="preset.key"
                      type="button"
                      :aria-pressed="selectedWindowPreset === preset.key"
                      class="px-3 py-1.5 rounded-full text-xs font-bold border transition-colors"
                      :class="
                        selectedWindowPreset === preset.key
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-transparent border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:border-blue-500'
                      "
                      @click="selectWindowPreset(preset.key)"
                    >
                      {{ $t(`request.form.time_preset_${preset.key}`) }}
                    </button>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-3 max-w-sm">
                  <div class="flex flex-col gap-1">
                    <span class="text-[11px] font-semibold text-blue-500">{{
                      $t('request.form.start_label')
                    }}</span>
                    <Calendar
                      v-model="windowStartTime"
                      time-only
                      show-icon
                      icon-display="input"
                      step-minute="30"
                      class="w-full"
                      input-class="w-full !bg-white dark:!bg-zinc-900 !border-blue-200 dark:!border-blue-800"
                      @update:model-value="selectedWindowPreset = null"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <span class="text-[11px] font-semibold text-blue-500">{{
                      $t('request.form.end_label')
                    }}</span>
                    <Calendar
                      v-model="windowEndTime"
                      time-only
                      show-icon
                      icon-display="input"
                      step-minute="30"
                      class="w-full"
                      input-class="w-full !bg-white dark:!bg-zinc-900 !border-blue-200 dark:!border-blue-800"
                      @update:model-value="selectedWindowPreset = null"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs font-bold text-zinc-500 uppercase">{{
                $t('request.form.details')
              }}</label>
              <Textarea
                v-model="form.details"
                rows="3"
                class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]"
              />
            </div>

            <div class="pt-6 mt-2 border-t border-zinc-200 dark:border-zinc-800">
              <Button
                type="submit"
                :label="
                  requestType === 'emergency'
                    ? $t('request.form.submit_emergency')
                    : $t('request.form.submit_appointment')
                "
                :icon="requestType === 'emergency' ? 'pi pi-megaphone' : 'pi pi-search'"
                :loading="isCreating"
                class="w-full md:w-auto !text-white font-bold px-8 py-3 shadow-lg transition-transform hover:scale-105"
                :class="
                  requestType === 'emergency'
                    ? '!bg-[#ff3b4e] !border-[#ff3b4e] hover:!bg-[#e63545]'
                    : '!bg-blue-600 !border-blue-600 hover:!bg-blue-700'
                "
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.4s ease-out;
}
.animate-slide-up {
  animation: slideUp 0.4s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
