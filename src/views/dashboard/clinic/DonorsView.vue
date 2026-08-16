<script setup>
import { onMounted, ref } from 'vue'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import { useClinicDonors } from '@/composables/useClinicDonors.js'

const { donors, filteredDonors, searchQuery, isLoading, loadError, fetchDonors } = useClinicDonors()

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
            <DataTable :value="filteredDonors" striped-rows class="p-datatable-sm" table-style="min-width: 50rem">
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
  </div>
</template>
