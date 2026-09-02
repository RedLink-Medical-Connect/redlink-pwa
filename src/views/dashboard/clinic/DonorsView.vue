<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import { useClinicDonors } from '@/composables/useClinicDonors.js'
import { Species } from '@/constants/enums.js'
import { breedLabel } from '@/constants/breeds.js'

const { t, te } = useI18n()
const { donors, filteredDonors, searchQuery, isLoading, loadError, fetchDonors } = useClinicDonors()

// Détail au clic/clavier (correctif UX, 2026-09) : `selectionMode="single"` +
// `v-model:selection` + `@row-select` (mécanisme natif PrimeVue DataTable) plutôt qu'un
// `@click` posé à la main sur `<tr>` -- une ligne devient nativement focusable/activable au
// clavier (Tab puis Entrée/Espace), sans geste de souris obligatoire. `selectedDonor` sert à
// la fois de modèle de sélection du DataTable et de source du dialog de détail.
const selectedDonor = ref(null)
const showDetails = ref(false)

const onRowSelect = (event) => {
  selectedDonor.value = event.data
  showDetails.value = true
}

// Revue a11y : sans ça, une ligne consultée puis le dialog fermé (Échap, bouton Fermer, croix)
// reste marquée `aria-selected="true"`/en surbrillance dans le DataTable -- désorientant pour un
// utilisateur clavier/lecteur d'écran qui reprend la navigation sans comprendre pourquoi cette
// ligne précise reste signalée différemment. `watch` plutôt qu'un handler dédié par bouton de
// fermeture : couvre TOUS les chemins de fermeture du Dialog (Échap, croix, bouton Fermer) en un
// seul endroit, y compris ceux pilotés par PrimeVue lui-même via `v-model:visible`.
watch(showDetails, (visible) => {
  if (!visible) selectedDonor.value = null
})

const speciesLabel = (species) =>
  species === Species.DOG ? t('request.species.dog') : t('request.species.cat')

// Les "autres animaux" du même propriétaire (DonorsView.vue est animal-centrique, une ligne =
// un couple Animal/Owner) -- `ownerAnimals` porte déjà TOUS les animaux du propriétaire
// (useClinicDonors.js, aucun aller-retour réseau ici), on exclut juste celui déjà affiché en
// tête de dialog pour ne pas le lister deux fois.
const otherOwnerAnimals = computed(() => {
  if (!selectedDonor.value) return []
  return (selectedDonor.value.ownerAnimals || []).filter(
    (a) => a.id !== selectedDonor.value.animalId,
  )
})

// Le filtre est déjà appliqué en direct via `v-model="searchQuery"` (computed
// `filteredDonors`, useClinicDonors.js) — ce bouton n'a donc pas de logique de recherche
// à déclencher lui-même. Il retire le focus du champ (masque le clavier virtuel mobile
// une fois la recherche lue), pour ne pas laisser un bouton "Rechercher" sans aucun
// `@click` (Phase 6.6).
const searchInputRef = ref(null)
const dismissSearchKeyboard = () => {
  searchInputRef.value?.$el?.blur()
}

onMounted(() => {
  fetchDonors()
})

const formatDate = (dateString) => {
  if (!dateString) return ''
  return new Date(dateString).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />

      <div class="flex-grow">
        <h1 class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider mb-6">{{ $t('dashboard.donors.title') }}</h1>

        <div class="bg-white dark:bg-zinc-900 p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 mb-6 flex gap-4 shadow-sm transition-colors duration-300">
          <InputText
            ref="searchInputRef"
            v-model="searchQuery"
            :placeholder="$t('dashboard.donors.search_placeholder')"
            class="flex-grow !bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white placeholder:!text-zinc-400"
          />
          <Button
            :label="$t('common.search')"
            icon="pi pi-search"
            class="!bg-zinc-800 !border-zinc-700 !text-white"
            @click="dismissSearchKeyboard"
          />
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
            <p>{{ $t('dashboard.donors.load_error') }}</p>
            <Button
              :label="$t('dashboard.donors.retry')"
              icon="pi pi-refresh"
              text
              class="mt-2"
              @click="fetchDonors"
            />
          </div>

          <div
            v-else-if="!isLoading && donors.length === 0"
            class="flex flex-col items-center justify-center h-64 text-zinc-400"
          >
            <i class="pi pi-inbox text-5xl mb-4 opacity-20"></i>
            <p>{{ $t('dashboard.donors.empty') }}</p>
          </div>

          <div
            v-else-if="!isLoading && filteredDonors.length === 0"
            class="flex flex-col items-center justify-center h-64 text-zinc-400"
          >
            <i class="pi pi-search text-5xl mb-4 opacity-20"></i>
            <p>{{ $t('dashboard.donors.no_search_results') }}</p>
          </div>

          <!-- Sous-tâche 6.B : le DataTable garde sa largeur minimale (colonnes lisibles sur
          desktop) mais le débordement horizontal résultant sur mobile/tablette est confiné à
          ce conteneur scrollable plutôt que de déborder toute la page. `tabindex="0"` +
          `role="region"` (revue a11y) : sans ça, les colonnes hors champ sur petit viewport
          ne sont atteignables qu'à la souris/au tactile (échec WCAG 2.1.1, technique SCR29) --
          `Tab` seul n'aurait révélé que les cellules interactives (ex. lien tel:), jamais les
          colonnes purement textuelles entre elles. -->
          <div v-else class="overflow-x-auto" tabindex="0" role="region" :aria-label="$t('dashboard.donors.title')">
            <DataTable
              :value="filteredDonors"
              striped-rows
              class="p-datatable-sm"
              table-style="min-width: 50rem"
              selection-mode="single"
              data-key="animalId"
              :selection="selectedDonor"
              @row-select="onRowSelect"
            >
              <Column field="animalName" :header="$t('dashboard.donors.columns.animal')" class="!text-zinc-900 dark:!text-white font-bold"></Column>
              <Column :header="$t('dashboard.donors.columns.owner')" class="!text-zinc-600 dark:!text-zinc-400">
                <template #body="slotProps">
                  {{ slotProps.data.ownerFirstname }} {{ slotProps.data.ownerLastname }}
                </template>
              </Column>
              <Column field="bloodGroup" :header="$t('dashboard.donors.columns.blood')">
                <template #body="slotProps">
                  <Tag :value="slotProps.data.bloodGroup" severity="warning" />
                </template>
              </Column>
              <Column field="distanceKM" :header="$t('dashboard.donors.columns.distance')" class="!text-zinc-600 dark:!text-zinc-400">
                <template #body="slotProps">
                  {{ slotProps.data.distanceKM !== null ? `${slotProps.data.distanceKM} ${$t('common.km')}` : $t('dashboard.donors.distance_unknown') }}
                </template>
              </Column>
              <Column :header="$t('dashboard.donors.columns.last_donation')" class="!text-zinc-600 dark:!text-zinc-400">
                <template #body="slotProps">
                  {{ slotProps.data.lastDonationDate ? formatDate(slotProps.data.lastDonationDate) : $t('dashboard.donors.never_donated') }}
                </template>
              </Column>
              <Column :header="$t('dashboard.donors.columns.action')">
                <template #body="slotProps">
                  <a
                    v-if="slotProps.data.ownerPhone"
                    :href="`tel:${slotProps.data.ownerPhone}`"
                    class="inline-flex"
                    @click.stop
                  >
                    <Button :label="$t('dashboard.donors.contact')" icon="pi pi-phone" size="small" class="!bg-[#ff3b4e] !border-[#ff3b4e]" />
                  </a>
                </template>
              </Column>
            </DataTable>
          </div>
        </div>
      </div>
    </div>

    <Dialog
      v-model:visible="showDetails"
      modal
      :header="$t('dashboard.donors.dialog.title')"
      :style="{ width: '480px' }"
    >
      <div v-if="selectedDonor" class="flex flex-col gap-4">
        <div class="p-4 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
          <h3 class="font-bold text-zinc-900 dark:text-white mb-2">
            {{ selectedDonor.animalName }}
            <span class="text-xs font-normal text-zinc-500">
              ({{ $t('dashboard.donors.dialog.animal_section') }})
            </span>
          </h3>
          <div class="grid grid-cols-2 gap-2 text-sm">
            <span class="text-zinc-500">{{ $t('dashboard.donors.dialog.species') }}</span>
            <span class="font-medium">{{ speciesLabel(selectedDonor.species) }}</span>
            <span class="text-zinc-500">{{ $t('dashboard.donors.dialog.breed') }}</span>
            <span class="font-medium">{{ breedLabel(selectedDonor.breed, t, te) || '—' }}</span>
            <span class="text-zinc-500">{{ $t('dashboard.donors.dialog.blood') }}</span>
            <span class="font-medium">{{ selectedDonor.bloodGroup }}</span>
            <span class="text-zinc-500">{{ $t('dashboard.donors.dialog.validation_status') }}</span>
            <span class="font-medium">
              <Tag
                v-if="selectedDonor.isValidatedDonor"
                :value="$t('dashboard.donors.dialog.validated_badge')"
                severity="success"
              />
              <Tag v-else :value="$t('dashboard.donors.dialog.not_validated_badge')" severity="secondary" />
              <span v-if="selectedDonor.isValidatedDonor && selectedDonor.validationExpiresAt" class="block text-xs text-zinc-500 mt-1">
                {{
                  $t('dashboard.donors.dialog.validated_until', {
                    date: formatDate(selectedDonor.validationExpiresAt),
                  })
                }}
              </span>
            </span>
          </div>
        </div>

        <div class="p-4 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
          <h3 class="font-bold text-zinc-900 dark:text-white mb-2">
            {{ $t('dashboard.donors.dialog.owner_section') }}
          </h3>
          <p class="font-medium text-zinc-900 dark:text-white">
            {{ selectedDonor.ownerFirstname }} {{ selectedDonor.ownerLastname }}
          </p>
          <a
            v-if="selectedDonor.ownerPhone"
            :href="`tel:${selectedDonor.ownerPhone}`"
            class="inline-flex items-center gap-2 mt-1 text-blue-600 hover:underline font-bold text-sm"
          >
            <i class="pi pi-phone"></i> {{ selectedDonor.ownerPhone }}
          </a>
          <p class="text-xs text-zinc-500 mt-2">
            {{ $t('dashboard.donors.dialog.distance') }}
            {{
              selectedDonor.distanceKM !== null
                ? `${selectedDonor.distanceKM} ${$t('common.km')}`
                : $t('dashboard.donors.distance_unknown')
            }}
          </p>
        </div>

        <div class="p-4 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
          <h3 class="font-bold text-zinc-900 dark:text-white mb-2">
            {{ $t('dashboard.donors.dialog.other_animals_section') }}
          </h3>
          <p v-if="otherOwnerAnimals.length === 0" class="text-xs text-zinc-400 italic">
            {{ $t('dashboard.donors.dialog.other_animals_empty') }}
          </p>
          <ul v-else class="flex flex-col gap-2">
            <li
              v-for="animal in otherOwnerAnimals"
              :key="animal.id"
              class="flex items-center justify-between text-sm border-b border-zinc-200 dark:border-zinc-700 last:border-0 pb-2 last:pb-0"
            >
              <span class="font-medium text-zinc-800 dark:text-zinc-200">
                {{ animal.name }}
                <span class="text-xs text-zinc-500 font-normal">
                  ({{ speciesLabel(animal.species)
                  }}{{ animal.breed ? ` • ${breedLabel(animal.breed, t, te)}` : '' }})
                </span>
              </span>
              <Tag
                :value="animal.isValidatedDonor
                  ? $t('dashboard.donors.dialog.validated_badge')
                  : $t('dashboard.donors.dialog.not_validated_badge')"
                :severity="animal.isValidatedDonor ? 'success' : 'secondary'"
              />
            </li>
          </ul>
        </div>
      </div>
      <template #footer>
        <Button :label="$t('common.close')" icon="pi pi-times" text @click="showDetails = false" />
      </template>
    </Dialog>
  </div>
</template>
