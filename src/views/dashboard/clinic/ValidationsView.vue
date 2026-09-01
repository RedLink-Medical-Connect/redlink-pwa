<script setup>
import { onMounted, ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import {
  useAnimalValidation,
  mapValidationErrorKey,
  mapCriticalFieldsCorrectionErrorKey,
} from '@/composables/useAnimalValidation.js'
import { Species, BloodGroupsBySpecies } from '@/constants/enums'

const { t } = useI18n()
const toast = useToast()

const {
  pendingAnimals,
  isLoading,
  isValidating,
  isCorrectingCriticalFields,
  loadError,
  fetchPendingValidations,
  validateAnimal,
  correctCriticalFields,
} = useAnimalValidation()

const speciesOptions = [
  { label: t('request.species.dog'), value: Species.DOG },
  { label: t('request.species.cat'), value: Species.CAT },
]

// Dialogue de correction ("première analyse", demande produit 2026-08-23, amende
// ADR-0006) : remplace l'ancien éditeur inline bloodGroup seul (Phase 6 section B),
// étendu à species/weight/isVaccinated -- ces quatre champs sont désormais verrouillés
// côté schéma pour l'Owner après la création (`ownerCreateReadOnlyVetReadUpdate`,
// amplify/data/resource.ts), donc SEUL un Veterinarian peut encore les corriger, ici,
// avant de valider l'Animal comme donneur.
const editingAnimal = ref(null)
const editForm = ref({ species: null, bloodGroup: null, weight: null, isVaccinated: false })

// Scaffolding légal/RGPD (2026-08-25, docs/adr/0014) : attestation sur l'honneur, étape de
// confirmation OBLIGATOIRE avant que "Valider" (bouton ci-dessous) n'ait le moindre effet --
// remplace l'ancien appel direct à `validateAnimal(animal.id)` par un dialogue intermédiaire
// (même structure que le dialogue de correction ci-dessus). `attestationChecked` : jamais
// pré-cochée à l'ouverture (acte positif, même exigence que le consentement RGPD à
// l'inscription, voir RegisterOwnerView.vue).
const attestingAnimal = ref(null)
const attestationChecked = ref(false)

// Options du Select alimentées par BloodGroupsBySpecies (constants/enums.js), jamais de
// liste en dur (voir R-15, BACKLOG.md, pour l'exemple précis de dette que ça évite) —
// dépend de l'espèce en cours d'édition dans le dialogue, pas un computed global.
// 'UNKNOWN' exclu délibérément ici (contrairement aux Selects owner) : ce dialogue sert À
// corriger un bloodGroup inconnu vers une vraie valeur -- `correctCriticalFields`
// (useAnimalValidation.js) rejette de toute façon 'UNKNOWN' comme correction, l'exclure de
// la liste évite un aller-retour d'erreur inutile pour le vétérinaire.
const bloodGroupOptions = computed(
  () => (BloodGroupsBySpecies[editForm.value.species] || []).filter((group) => group !== 'UNKNOWN'),
)

onMounted(() => {
  fetchPendingValidations()
})

const openAttestationDialog = (animal) => {
  attestingAnimal.value = animal
  attestationChecked.value = false
}

const closeAttestationDialog = () => {
  attestingAnimal.value = null
  attestationChecked.value = false
}

// `isValidating` (composable) est un booléen GLOBAL, pas un état par ligne
// (useAnimalValidation.js) -- suffisant ici : un seul dialogue d'attestation peut être
// ouvert à la fois (contrairement à l'ancien bouton "Valider" direct sur chaque ligne du
// tableau, qui avait besoin de `validatingAnimalId` pour isoler le spinner sur la bonne
// ligne), donc `isValidating` seul pilote le spinner du bouton de confirmation du dialogue.
const confirmValidation = async () => {
  const animal = attestingAnimal.value
  try {
    await validateAnimal(animal.id, attestationChecked.value)
    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t('dashboard.validations.toasts.success', { name: animal.name }),
      life: 3000,
    })
    closeAttestationDialog()
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t(mapValidationErrorKey(e.message)),
      life: 4000,
    })
  }
}

const openEditDialog = (animal) => {
  editingAnimal.value = animal
  editForm.value = {
    species: animal.species,
    // Pré-remplit avec la valeur actuelle SAUF si elle est déjà 'UNKNOWN'/vide (le cas que
    // ce dialogue sert justement à corriger) : dans ce cas on laisse le Select vide plutôt
    // que de proposer une valeur invalide comme pré-sélection.
    bloodGroup: animal.bloodGroup && animal.bloodGroup !== 'UNKNOWN' ? animal.bloodGroup : null,
    weight: animal.weight,
    isVaccinated: animal.isVaccinated,
  }
}

const closeEditDialog = () => {
  editingAnimal.value = null
}

const handleSaveCorrection = async () => {
  const animal = editingAnimal.value
  try {
    await correctCriticalFields(animal.id, { ...editForm.value })
    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t('dashboard.validations.toasts.critical_fields_corrected', { name: animal.name }),
      life: 3000,
    })
    closeEditDialog()
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t(mapCriticalFieldsCorrectionErrorKey(e.message)),
      life: 4000,
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
                <Tag
                  :value="slotProps.data.bloodGroup"
                  severity="info"
                  class="!bg-zinc-100 dark:!bg-zinc-800 !text-zinc-600 dark:!text-zinc-300 !border !border-zinc-200 dark:!border-zinc-700"
                />
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
                <div class="flex items-center gap-2">
                  <Button
                    :label="$t('dashboard.validations.edit_btn')"
                    icon="pi pi-pencil"
                    size="small"
                    text
                    :disabled="isValidating || isCorrectingCriticalFields"
                    @click="openEditDialog(slotProps.data)"
                  />
                  <Button
                    :label="$t('dashboard.validations.validate_btn')"
                    icon="pi pi-check"
                    size="small"
                    class="!bg-[#ff3b4e] !border-[#ff3b4e]"
                    :disabled="isValidating || isCorrectingCriticalFields"
                    @click="openAttestationDialog(slotProps.data)"
                  />
                </div>
              </template>
            </Column>
          </DataTable>
        </div>
      </div>
    </div>

    <!-- Dialogue "première analyse" (demande produit 2026-08-23, amende ADR-0006) : seul
         moyen désormais de corriger species/bloodGroup/weight/isVaccinated, verrouillés
         pour l'Owner après la création (amplify/data/resource.ts,
         ownerCreateReadOnlyVetReadUpdate). -->
    <Dialog
      :visible="!!editingAnimal"
      modal
      :header="editingAnimal ? $t('dashboard.validations.dialog.title', { name: editingAnimal.name }) : ''"
      :style="{ width: '450px' }"
      @update:visible="closeEditDialog"
    >
      <p class="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
        {{ $t('dashboard.validations.dialog.subtitle') }}
      </p>
      <div v-if="editingAnimal" class="flex flex-col gap-4">
        <div class="grid grid-cols-2 gap-2">
          <Select
            v-model="editForm.species"
            :options="speciesOptions"
            option-label="label"
            option-value="value"
            class="w-full"
            :aria-label="$t('dashboard.owner.animals.form.species')"
          />
          <InputNumber
            v-model="editForm.weight"
            suffix=" kg"
            :placeholder="$t('dashboard.owner.animals.form.weight')"
            :min-fraction-digits="1"
            class="w-full"
            input-class="w-full"
            :aria-label="$t('dashboard.owner.animals.form.weight')"
          />
        </div>
        <Select
          v-model="editForm.bloodGroup"
          :options="bloodGroupOptions"
          :placeholder="$t('dashboard.owner.animals.form.blood_group_placeholder')"
          :aria-label="$t('dashboard.owner.animals.form.blood_group')"
        />
        <div class="flex items-center gap-2">
          <Checkbox v-model="editForm.isVaccinated" :binary="true" input-id="val-vaccinated" />
          <label for="val-vaccinated" class="cursor-pointer select-none">{{
            $t('dashboard.owner.animals.form.vaccinated')
          }}</label>
        </div>
      </div>
      <template #footer>
        <Button
          :label="$t('common.cancel')"
          text
          severity="secondary"
          :disabled="isCorrectingCriticalFields"
          @click="closeEditDialog"
        />
        <Button
          :label="$t('common.save')"
          icon="pi pi-check"
          :loading="isCorrectingCriticalFields"
          :disabled="!editForm.bloodGroup"
          class="!bg-[#ff3b4e] !border-[#ff3b4e]"
          @click="handleSaveCorrection"
        />
      </template>
    </Dialog>

    <!-- Attestation sur l'honneur (scaffolding légal/RGPD, 2026-08-25, docs/adr/0014) --
         étape de confirmation obligatoire avant que "Valider" n'ait le moindre effet. Le
         texte ci-dessous est un PLACEHOLDER (dashboard.validations.attestation.text,
         src/locales/*.json) : le texte définitif sera fourni séparément après relecture
         juridique. -->
    <Dialog
      :visible="!!attestingAnimal"
      modal
      :header="attestingAnimal ? $t('dashboard.validations.attestation.title', { name: attestingAnimal.name }) : ''"
      :style="{ width: '450px' }"
      @update:visible="closeAttestationDialog"
    >
      <div v-if="attestingAnimal" class="flex flex-col gap-4">
        <p class="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed italic">
          {{ $t('dashboard.validations.attestation.text') }}
        </p>
        <div class="flex items-start gap-2">
          <Checkbox v-model="attestationChecked" :binary="true" input-id="attestation-checkbox" />
          <label for="attestation-checkbox" class="text-sm cursor-pointer select-none">
            {{ $t('dashboard.validations.attestation.checkbox_label') }}
          </label>
        </div>
      </div>
      <template #footer>
        <Button
          :label="$t('common.cancel')"
          text
          severity="secondary"
          :disabled="isValidating"
          @click="closeAttestationDialog"
        />
        <Button
          :label="$t('dashboard.validations.attestation.confirm_btn')"
          icon="pi pi-check"
          :loading="isValidating"
          :disabled="!attestationChecked"
          class="!bg-[#ff3b4e] !border-[#ff3b4e]"
          @click="confirmValidation"
        />
      </template>
    </Dialog>
  </div>
</template>
