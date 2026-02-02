<!--
  Composant d'affichage des résultats de matching intelligent
-->

<template>
  <div class="match-results">
    <!-- En-tête avec statistiques -->
    <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-xl font-semibold text-gray-900">Résultats du Matching</h2>
          <p class="text-sm text-gray-600 mt-1">
            {{ matchResults.length }} donneur{{ matchResults.length > 1 ? 's' : '' }} trouvé{{
              matchResults.length > 1 ? 's' : ''
            }}
            {{ metadata ? `en ${metadata.processingTime.toFixed(0)}ms` : '' }}
          </p>
        </div>

        <!-- Actions -->
        <div class="flex items-center space-x-3">
          <button
            :disabled="isMatching"
            class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
            @click="refreshMatches"
          >
            <svg
              :class="['w-4 h-4 mr-2', { 'animate-spin': isMatching }]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Actualiser
          </button>

          <select
            v-model="sortBy"
            class="block w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm rounded-md"
            @change="applySorting"
          >
            <option value="score">Trier par Score</option>
            <option value="distance">Trier par Distance</option>
            <option value="availability">Trier par Disponibilité</option>
            <option value="reliability">Trier par Fiabilité</option>
          </select>
        </div>
      </div>

      <!-- Statistiques rapides -->
      <div v-if="stats" class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="text-center p-3 bg-blue-50 rounded-lg">
          <div class="text-lg font-semibold text-blue-600">{{ stats.averageScore }}</div>
          <div class="text-xs text-blue-700">Score Moyen</div>
        </div>
        <div class="text-center p-3 bg-green-50 rounded-lg">
          <div class="text-lg font-semibold text-green-600">{{ stats.highQualityMatches }}</div>
          <div class="text-xs text-green-700">Matches Excellents</div>
        </div>
        <div class="text-center p-3 bg-yellow-50 rounded-lg">
          <div class="text-lg font-semibold text-yellow-600">{{ stats.onlineDonors }}</div>
          <div class="text-xs text-yellow-700">En Ligne</div>
        </div>
        <div class="text-center p-3 bg-red-50 rounded-lg">
          <div class="text-lg font-semibold text-red-600">{{ stats.emergencyCapable }}</div>
          <div class="text-xs text-red-700">Urgences OK</div>
        </div>
      </div>
    </div>

    <!-- Filtres -->
    <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
      <div class="flex flex-wrap items-center gap-4">
        <div class="flex items-center space-x-2">
          <label class="text-sm font-medium text-gray-700">Score min:</label>
          <input
            v-model.number="filters.minScore"
            type="range"
            min="0"
            max="100"
            step="5"
            class="w-24"
            @input="applyFilters"
          />
          <span class="text-sm text-gray-600 w-8">{{ filters.minScore }}</span>
        </div>

        <div class="flex items-center space-x-2">
          <label class="text-sm font-medium text-gray-700">Distance max:</label>
          <input
            v-model.number="filters.maxDistance"
            type="range"
            min="5"
            max="100"
            step="5"
            class="w-24"
            @input="applyFilters"
          />
          <span class="text-sm text-gray-600 w-12">{{ filters.maxDistance }}km</span>
        </div>

        <label class="flex items-center space-x-2">
          <input
            v-model="filters.onlineOnly"
            type="checkbox"
            class="rounded border-gray-300 text-red-600 focus:ring-red-500"
            @change="applyFilters"
          />
          <span class="text-sm text-gray-700">En ligne seulement</span>
        </label>

        <label v-if="request?.requestType === 'EMERGENCY'" class="flex items-center space-x-2">
          <input
            v-model="filters.emergencyCapable"
            type="checkbox"
            class="rounded border-gray-300 text-red-600 focus:ring-red-500"
            @change="applyFilters"
          />
          <span class="text-sm text-gray-700">Accepte urgences</span>
        </label>
      </div>
    </div>

    <!-- Liste des résultats -->
    <div class="space-y-4">
      <MatchCard
        v-for="match in displayedMatches"
        :key="match.donor.id"
        :match="match"
        :request="request"
        @select="$emit('select-donor', match)"
        @view-details="$emit('view-details', match)"
      />

      <!-- Message si aucun résultat -->
      <div
        v-if="displayedMatches.length === 0 && !isMatching"
        class="text-center py-12 bg-gray-50 rounded-lg"
      >
        <div class="text-4xl mb-4">🔍</div>
        <h3 class="text-lg font-medium text-gray-900 mb-2">Aucun match trouvé</h3>
        <p class="text-gray-600 mb-4">Aucun donneur ne correspond aux critères actuels.</p>
        <button
          class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          @click="clearFilters"
        >
          Réinitialiser les filtres
        </button>
      </div>

      <!-- Skeleton loading -->
      <div v-if="isMatching" class="space-y-4">
        <MatchCardSkeleton v-for="i in 3" :key="i" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useMatching } from '@/composables/useMatching'
import MatchCard from './MatchCard.vue'
import MatchCardSkeleton from './MatchCardSkeleton.vue'

const props = defineProps({
  request: {
    type: Object,
    required: true,
  },
  initialMatches: {
    type: Array,
    default: () => [],
  },
})

defineEmits(['select-donor', 'view-details'])

// Composable de matching
const {
  isMatching,
  matchResults,
  matchMetadata,
  findMatches,
  filterMatches,
  sortMatches,
  getMatchingStats,
} = useMatching()

// États locaux
const sortBy = ref('score')
const filters = ref({
  minScore: 0,
  maxDistance: 100,
  onlineOnly: false,
  emergencyCapable: false,
})

// Propriétés calculées
const metadata = computed(() => matchMetadata.value)
const stats = computed(() => getMatchingStats())

const displayedMatches = computed(() => {
  let matches = [...matchResults.value]

  // Appliquer les filtres
  matches = filterMatches(filters.value)

  // Appliquer le tri
  matches = sortMatches(sortBy.value)

  return matches
})

// Actions
const refreshMatches = async () => {
  try {
    await findMatches(props.request)
  } catch (error) {
    console.error('Erreur lors du rafraîchissement:', error)
  }
}

const applySorting = () => {
  // Le tri est automatiquement appliqué via displayedMatches
}

const applyFilters = () => {
  // Les filtres sont automatiquement appliqués via displayedMatches
}

const clearFilters = () => {
  filters.value = {
    minScore: 0,
    maxDistance: 100,
    onlineOnly: false,
    emergencyCapable: false,
  }
}

// Initialisation avec les matches fournis
if (props.initialMatches.length > 0) {
  matchResults.value = props.initialMatches
}

// Watcher pour les changements de requête
watch(
  () => props.request,
  async (newRequest) => {
    if (newRequest) {
      await refreshMatches()
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.match-results {
  @apply w-full max-w-4xl mx-auto;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
