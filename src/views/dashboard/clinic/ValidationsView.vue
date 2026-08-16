<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import {
  useAnimalValidation,
  mapValidationErrorKey,
  mapBloodGroupCorrectionErrorKey,
} from '@/composables/useAnimalValidation.js'
import { Species, BloodGroupsBySpecies } from '@/constants/enums'

const { t } = useI18n()
const toast = useToast()

const {
  pendingAnimals,
  isLoading,
  isValidating,
  isCorrectingBloodGroup,
  loadError,
  fetchPendingValidations,
  validateAnimal,
  correctBloodGroup,
} = useAnimalValidation()

// `isValidating` (composable) est un booléen GLOBAL partagé par tout appel à
// validateAnimal(), pas un état par ligne (voir useAnimalValidation.js). On garde ici
// l'id de l'Animal cliqué pour n'afficher le spinner que sur le bon bouton — et on
// désactive les AUTRES boutons pendant ce temps (via `isValidating` seul) plutôt que de
// laisser un second clic déclencher un appel concurrent sur ce ref partagé.
const validatingAnimalId = ref(null)

// Même raisonnement que `validatingAnimalId` ci-dessus, mais pour `correctBloodGroup`
// (ref `isCorrectingBloodGroup` distincte, elle aussi globale au composable).
const correctingAnimalId = ref(null)

// Id de l'Animal dont la ligne affiche actuellement l'éditeur inline de `bloodGroup`
// (au plus une ligne à la fois) et valeur en cours de saisie dans son `Select`.
const editingBloodGroupId = ref(null)
const newBloodGroup = ref(null)

onMounted(() => {
  fetchPendingValidations()
})

const handleValidate = async (animal) => {
  validatingAnimalId.value = animal.id
  try {
    await validateAnimal(animal.id)
    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t('dashboard.validations.toasts.success', { name: animal.name }),
      life: 3000,
    })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t(mapValidationErrorKey(e.message)),
      life: 4000,
    })
  } finally {
    validatingAnimalId.value = null
  }
}

// Options du Select alimentées par BloodGroupsBySpecies (constants/enums.js), jamais de
// liste en dur (voir R-15, BACKLOG.md, pour l'exemple précis de dette que ça évite) —
// dépend de l'espèce de la ligne éditée, pas un computed global.
const bloodGroupOptionsFor = (animal) => BloodGroupsBySpecies[animal.species] || []

const startEditBloodGroup = (animal) => {
  editingBloodGroupId.value = animal.id
  // Pré-remplit avec la valeur actuelle SAUF si elle est déjà 'UNKNOWN'/vide (le cas que
  // cette action sert justement à corriger) : dans ce cas on laisse le Select vide plutôt
  // que de proposer une valeur invalide comme pré-sélection.
  newBloodGroup.value =
    animal.bloodGroup && animal.bloodGroup !== 'UNKNOWN' ? animal.bloodGroup : null
}

const cancelEditBloodGroup = () => {
  editingBloodGroupId.value = null
  newBloodGroup.value = null
}

const handleSaveBloodGroup = async (animal) => {
  correctingAnimalId.value = animal.id
  try {
    await correctBloodGroup(animal.id, newBloodGroup.value)
    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t('dashboard.validations.toasts.blood_group_corrected', { name: animal.name }),
      life: 3000,
    })
    editingBloodGroupId.value = null
    newBloodGroup.value = null
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t(mapBloodGroupCorrectionErrorKey(e.message)),
      life: 4000,
    })
  } finally {
    correctingAnimalId.value = null
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <Toast />

    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />

      <div class="flex-grow">
        <div class="flex justify-between items-center mb-6">
          <h1
            class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider border-l-4 border-[#ff3b4e] pl-4"
          >
            {{ $t('dashboard.validations.title') }}
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
            v-if="!isLoading && loadError"
            class="flex flex-col items-center justify-center h-64 text-zinc-400"
          >
            <i class="pi pi-exclamation-triangle text-5xl mb-4 text-amber-500 opacity-60"></i>
            <p>{{ $t('dashboard.validations.load_error') }}</p>
            <Button
              :label="$t('dashboard.validations.retry')"
              icon="pi pi-refresh"
              text
              class="mt-2"
              @click="fetchPendingValidations"
            />
          </div>

          <div
            v-else-if="!isLoading && pendingAnimals.length === 0"
            class="flex flex-col items-center justify-center h-64 text-zinc-400"
          >
            <i class="pi pi-verified text-5xl mb-4 opacity-20"></i>
            <p>{{ $t('dashboard.validations.empty') }}</p>
          </div>

          <DataTable
            v-else
            :value="pendingAnimals"
            striped-rows
            class="p-datatable-sm"
            table-style="min-width: 50rem"
            data-key="id"
          >
            <Column
              field="name"
              :header="$t('dashboard.validations.columns.animal')"
              class="!font-bold !text-zinc-900 dark:!text-white"
            />

            <Column :header="$t('dashboard.validations.columns.species')">
              <template #body="slotProps">
                <span class="text-zinc-600 dark:text-zinc-300">
                  {{
                    slotProps.data.species === Species.DOG
                      ? $t('request.species.dog')
                      : $t('request.species.cat')
                  }}
                </span>
              </template>
            </Column>

            <Column
              field="breed"
              :header="$t('dashboard.validations.columns.breed')"
              class="!text-zinc-600 dark:!text-zinc-300"
            />

            <Column :header="$t('dashboard.validations.columns.blood_group')">
              <template #body="slotProps">
                <div v-if="editingBloodGroupId === slotProps.data.id" class="flex items-center gap-2">
                  <Select
                    v-model="newBloodGroup"
                    :options="bloodGroupOptionsFor(slotProps.data)"
                    :placeholder="$t('dashboard.owner.animals.form.blood_group_placeholder')"
                    class="!w-40 !bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800"
                  />
                  <Button
                    :label="$t('common.save')"
                    icon="pi pi-check"
                    size="small"
                    text
                    :loading="correctingAnimalId === slotProps.data.id"
                    :disabled="!newBloodGroup"
                    @click="handleSaveBloodGroup(slotProps.data)"
                  />
                  <Button
                    :label="$t('common.cancel')"
                    icon="pi pi-times"
                    size="small"
                    text
                    severity="secondary"
                    :disabled="correctingAnimalId === slotProps.data.id"
                    @click="cancelEditBloodGroup"
                  />
                </div>
                <div v-else class="flex items-center gap-2">
                  <Tag
                    :value="slotProps.data.bloodGroup"
                    severity="info"
                    class="!bg-zinc-100 dark:!bg-zinc-800 !text-zinc-600 dark:!text-zinc-300 !border !border-zinc-200 dark:!border-zinc-700"
                  />
                  <Button
                    :label="$t('common.edit')"
                    icon="pi pi-pencil"
                    size="small"
                    text
                    :disabled="isCorrectingBloodGroup"
                    @click="startEditBloodGroup(slotProps.data)"
                  />
                </div>
              </template>
            </Column>

            <Column :header="$t('dashboard.validations.columns.owner')">
              <template #body="slotProps">
                <span class="text-zinc-600 dark:text-zinc-300">
                  {{ slotProps.data.ownerProfile?.firstname }}
                  {{ slotProps.data.ownerProfile?.lastname }}
                </span>
              </template>
            </Column>

            <Column :header="$t('dashboard.validations.columns.action')">
              <template #body="slotProps">
                <Button
                  :label="$t('dashboard.validations.validate_btn')"
                  icon="pi pi-check"
                  size="small"
                  class="!bg-[#ff3b4e] !border-[#ff3b4e]"
                  :loading="validatingAnimalId === slotProps.data.id"
                  :disabled="
                    (isValidating && validatingAnimalId !== slotProps.data.id) ||
                    editingBloodGroupId === slotProps.data.id
                  "
                  @click="handleValidate(slotProps.data)"
                />
              </template>
            </Column>
          </DataTable>
        </div>
      </div>
    </div>
  </div>
</template>
