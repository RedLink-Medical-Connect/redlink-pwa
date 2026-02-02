<!--
  Composant de liste des missions avec pagination infinie
  Exemple d'utilisation du système de pagination optimisé
-->

<template>
  <div class="missions-list">
    <InfiniteScroll
      :items="availableMissions"
      :is-loading="isLoadingMissions"
      :is-loading-more="isLoadingMoreMissions"
      :has-more="hasMoreMissions"
      :is-empty="availableMissions.length === 0 && !isLoadingMissions"
      :is-first-load="isLoadingMissions && availableMissions.length === 0"
      :empty-title="$t('missions.no_missions_title')"
      :empty-message="$t('missions.no_missions_message')"
      @load-more="loadMoreMissions"
      @refresh="refreshMissions"
    >
      <!-- Template pour les éléments -->
      <template #items="{ items }">
        <div class="space-y-4">
          <MissionCard
            v-for="mission in items"
            :key="mission.id"
            :mission="mission"
            :is-accepting="acceptingMissionId === mission.id"
            @accept="handleAcceptMission"
          />
        </div>
      </template>

      <!-- Template de chargement personnalisé -->
      <template #loading>
        <div class="space-y-4">
          <MissionCardSkeleton v-for="i in 3" :key="i" />
        </div>
      </template>

      <!-- Template de chargement de plus d'éléments -->
      <template #loading-more>
        <div class="flex items-center justify-center py-6">
          <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-red-600"></div>
          <span class="ml-3 text-gray-600">{{ $t('missions.loading_more') }}</span>
        </div>
      </template>

      <!-- Template d'état vide personnalisé -->
      <template #empty>
        <div class="text-center py-12">
          <div class="text-6xl mb-4">🩺</div>
          <h3 class="text-lg font-medium text-gray-900 mb-2">
            {{ $t('missions.no_missions_available') }}
          </h3>
          <p class="text-gray-500 mb-6">
            {{ $t('missions.check_back_later') }}
          </p>
          <button
            class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            @click="refreshMissions"
          >
            <svg class="-ml-1 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {{ $t('common.refresh') }}
          </button>
        </div>
      </template>

      <!-- Template de fin de liste -->
      <template #end>
        <div class="text-center py-6">
          <div class="text-gray-400 text-2xl mb-2">✅</div>
          <p class="text-gray-500 text-sm">
            {{ $t('missions.all_missions_loaded') }}
          </p>
        </div>
      </template>
    </InfiniteScroll>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useOwnerMissions } from '@/composables/useOwnerMissions'
import InfiniteScroll from '@/components/common/InfiniteScroll.vue'
import MissionCard from '@/components/dashboard/MissionCard.vue'
import MissionCardSkeleton from '@/components/dashboard/MissionCardSkeleton.vue'

// Composable pour les missions
const {
  availableMissions,
  isLoadingMissions,
  isLoadingMoreMissions,
  hasMoreMissions,
  isAccepting,
  fetchAvailableMissions,
  loadMoreMissions,
  acceptMission,
  refreshMissions,
} = useOwnerMissions()

// État local pour l'acceptation de missions spécifiques
const acceptingMissionId = ref(null)

// Actions
const handleAcceptMission = async (mission) => {
  acceptingMissionId.value = mission.id
  try {
    const animalName = await acceptMission(mission)
    // Afficher un message de succès
    console.log(`Mission acceptée avec ${animalName}`)
    // TODO: Ajouter une notification toast de succès
  } catch (error) {
    console.error('Erreur acceptation mission:', error)
    // TODO: Ajouter une notification toast d'erreur
    if (error.message === 'NO_MATCHING_ANIMAL') {
      console.error('Aucun animal compatible trouvé')
    }
  } finally {
    acceptingMissionId.value = null
  }
}

// Initialisation
onMounted(async () => {
  try {
    await fetchAvailableMissions()
  } catch (error) {
    console.error('Erreur chargement missions:', error)
    // TODO: Ajouter une notification toast d'erreur
  }
})
</script>

<style scoped>
.missions-list {
  @apply w-full max-w-4xl mx-auto;
}
</style>
