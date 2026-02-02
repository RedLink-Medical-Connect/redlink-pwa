<!--
  Composant de carte pour visualiser les résultats de matching
-->

<template>
  <div class="match-map">
    <!-- En-tête de la carte -->
    <div class="bg-white rounded-t-lg border border-gray-200 p-4">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-lg font-semibold text-gray-900">Carte des Donneurs</h3>
          <p class="text-sm text-gray-600">
            {{ matches.length }} donneur{{ matches.length > 1 ? 's' : '' }} dans un rayon de
            {{ maxRadius }}km
          </p>
        </div>

        <!-- Contrôles -->
        <div class="flex items-center space-x-3">
          <div class="flex items-center space-x-2">
            <label class="text-sm text-gray-700">Rayon:</label>
            <select
              v-model="selectedRadius"
              class="block w-20 pl-2 pr-8 py-1 text-sm border-gray-300 focus:outline-none focus:ring-red-500 focus:border-red-500 rounded-md"
              @change="updateRadius"
            >
              <option value="25">25km</option>
              <option value="50">50km</option>
              <option value="100">100km</option>
              <option value="200">200km</option>
            </select>
          </div>

          <button
            class="inline-flex items-center px-3 py-1 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            @click="centerOnClinic"
          >
            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Centrer
          </button>
        </div>
      </div>
    </div>

    <!-- Carte -->
    <div class="relative">
      <div ref="mapContainer" class="w-full h-96 bg-gray-100 border-l border-r border-gray-200">
        <!-- Placeholder de carte (en attendant l'intégration d'une vraie carte) -->
        <div class="flex items-center justify-center h-full">
          <div class="text-center">
            <div class="text-4xl mb-4">🗺️</div>
            <div class="text-lg font-medium text-gray-900 mb-2">Carte Interactive</div>
            <div class="text-sm text-gray-600 mb-4">
              Visualisation des {{ matches.length }} donneurs trouvés
            </div>

            <!-- Simulation de points sur la carte -->
            <div class="grid grid-cols-3 gap-4 max-w-md mx-auto">
              <div
                v-for="(match, index) in matches.slice(0, 9)"
                :key="match.donor.id"
                class="relative"
              >
                <div
                  :class="[
                    'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white cursor-pointer transform hover:scale-110 transition-transform',
                    getMarkerColor(match.score),
                  ]"
                  :title="`${match.donor.name} - Score: ${match.score}`"
                  @click="selectMatch(match)"
                >
                  {{ index + 1 }}
                </div>

                <!-- Tooltip au survol -->
                <div
                  class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-900 rounded opacity-0 hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10"
                >
                  {{ match.donor.name }}<br />
                  Score: {{ match.score }}<br />
                  {{ match.geoData?.formattedDistance || 'Distance inconnue' }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Overlay pour le match sélectionné -->
      <div
        v-if="selectedMatch"
        class="absolute top-4 left-4 bg-white rounded-lg shadow-lg border border-gray-200 p-4 max-w-sm"
      >
        <div class="flex items-start justify-between mb-3">
          <div>
            <h4 class="font-semibold text-gray-900">{{ selectedMatch.donor.name }}</h4>
            <p class="text-sm text-gray-600">{{ selectedMatch.donor.location?.address }}</p>
          </div>
          <button class="text-gray-400 hover:text-gray-600" @click="selectedMatch = null">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-gray-600">Score:</span>
            <span class="font-medium">{{ selectedMatch.score }}/100</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">Distance:</span>
            <span class="font-medium">{{
              selectedMatch.geoData?.formattedDistance || 'Inconnue'
            }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">Temps trajet:</span>
            <span class="font-medium">{{
              selectedMatch.geoData?.formattedDuration || 'Inconnu'
            }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">Animaux:</span>
            <span class="font-medium">{{ selectedMatch.compatibleAnimals.length }}</span>
          </div>
        </div>

        <div class="mt-4 flex space-x-2">
          <button
            class="flex-1 inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            @click="$emit('select-donor', selectedMatch)"
          >
            Sélectionner
          </button>
          <button
            class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            @click="openNavigation(selectedMatch)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 4m0 13V4m-6 3l6-3"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Légende -->
    <div class="bg-white rounded-b-lg border border-gray-200 border-t-0 p-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-6">
          <div class="flex items-center space-x-2">
            <div class="w-4 h-4 bg-red-600 rounded-full"></div>
            <span class="text-sm text-gray-600">Clinique</span>
          </div>

          <div class="flex items-center space-x-4">
            <div class="flex items-center space-x-2">
              <div class="w-3 h-3 bg-green-500 rounded-full"></div>
              <span class="text-xs text-gray-600">Excellent (80+)</span>
            </div>
            <div class="flex items-center space-x-2">
              <div class="w-3 h-3 bg-yellow-500 rounded-full"></div>
              <span class="text-xs text-gray-600">Bon (60-79)</span>
            </div>
            <div class="flex items-center space-x-2">
              <div class="w-3 h-3 bg-orange-500 rounded-full"></div>
              <span class="text-xs text-gray-600">Moyen (40-59)</span>
            </div>
            <div class="flex items-center space-x-2">
              <div class="w-3 h-3 bg-red-500 rounded-full"></div>
              <span class="text-xs text-gray-600">Faible (<40)</span>
            </div>
          </div>
        </div>

        <div class="text-sm text-gray-500">Cliquez sur un point pour voir les détails</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useGeolocation } from '@/composables/useGeolocation'

const props = defineProps({
  matches: {
    type: Array,
    default: () => [],
  },
  clinicLocation: {
    type: Object,
    required: true,
  },
  maxRadius: {
    type: Number,
    default: 100,
  },
})

defineEmits(['select-donor', 'radius-changed'])

// Composables
const { getNavigationUrl } = useGeolocation()

// États locaux
const mapContainer = ref(null)
const selectedMatch = ref(null)
const selectedRadius = ref(props.maxRadius)

// Actions
const selectMatch = (match) => {
  selectedMatch.value = match
}

const centerOnClinic = () => {
  // TODO: Centrer la vraie carte sur la clinique
  console.log('Centrage sur la clinique:', props.clinicLocation)
}

const updateRadius = () => {
  emit('radius-changed', selectedRadius.value)
}

const openNavigation = (match) => {
  const url = getNavigationUrl(match.donor.location)
  if (url) {
    window.open(url, '_blank')
  }
}

const getMarkerColor = (score) => {
  if (score >= 80) return 'bg-green-500'
  if (score >= 60) return 'bg-yellow-500'
  if (score >= 40) return 'bg-orange-500'
  return 'bg-red-500'
}

// Propriétés calculées
const sortedMatches = computed(() => {
  return [...props.matches].sort((a, b) => b.score - a.score)
})

// TODO: Intégration d'une vraie carte (Leaflet, Mapbox, Google Maps)
onMounted(() => {
  // Initialiser la carte ici
  console.log('Initialisation de la carte avec', props.matches.length, 'donneurs')
})
</script>

<style scoped>
.match-map {
  @apply w-full;
}

/* Animations pour les marqueurs */
.marker-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
