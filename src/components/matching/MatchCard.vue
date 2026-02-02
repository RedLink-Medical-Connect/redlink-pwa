<!--
  Carte d'affichage d'un résultat de matching
-->

<template>
  <div
    class="match-card bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-all duration-200"
    :class="{ 'ring-2 ring-red-500': match.rank === 1 }"
  >
    <!-- En-tête avec rang et score -->
    <div class="flex items-start justify-between mb-4">
      <div class="flex items-center space-x-3">
        <!-- Badge de rang -->
        <div
          :class="[
            'flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold',
            match.rank === 1
              ? 'bg-yellow-100 text-yellow-800'
              : match.rank <= 3
                ? 'bg-blue-100 text-blue-800'
                : 'bg-gray-100 text-gray-600',
          ]"
        >
          {{ match.rank }}
        </div>

        <!-- Informations du donneur -->
        <div>
          <h3 class="text-lg font-semibold text-gray-900">{{ match.donor.name }}</h3>
          <div class="flex items-center space-x-2 text-sm text-gray-600">
            <span>{{ match.donor.location?.address || 'Localisation non précisée' }}</span>
            <span v-if="match.donor.isOnline" class="flex items-center text-green-600">
              <div class="w-2 h-2 bg-green-400 rounded-full mr-1 animate-pulse"></div>
              En ligne
            </span>
          </div>
        </div>
      </div>

      <!-- Score global -->
      <div class="text-right">
        <div class="text-2xl font-bold text-gray-900">{{ match.score }}</div>
        <div class="text-xs text-gray-500">Score global</div>
        <div class="text-xs text-gray-500">{{ match.confidence }}% confiance</div>
      </div>
    </div>

    <!-- Détail des scores -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
      <ScoreBar
        label="Distance"
        :score="match.breakdown.distance"
        :weight="35"
        color="blue"
        :details="getDistanceDetails()"
      />
      <ScoreBar
        label="Disponibilité"
        :score="match.breakdown.availability"
        :weight="25"
        color="green"
        :details="getAvailabilityDetails()"
      />
      <ScoreBar
        label="Compatibilité"
        :score="match.breakdown.compatibility"
        :weight="20"
        color="purple"
        :details="getCompatibilityDetails()"
      />
      <ScoreBar
        label="Fiabilité"
        :score="match.breakdown.reliability"
        :weight="15"
        color="yellow"
        :details="getReliabilityDetails()"
      />
    </div>

    <!-- Animaux compatibles -->
    <div v-if="match.compatibleAnimals.length > 0" class="mb-4 p-3 bg-green-50 rounded-md">
      <div class="flex items-center mb-2">
        <svg class="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
          <path
            fill-rule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clip-rule="evenodd"
          />
        </svg>
        <span class="text-sm font-medium text-green-800">
          {{ match.compatibleAnimals.length }} animal{{
            match.compatibleAnimals.length > 1 ? 'aux' : ''
          }}
          compatible{{ match.compatibleAnimals.length > 1 ? 's' : '' }}
        </span>
      </div>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="animal in match.compatibleAnimals.slice(0, 3)"
          :key="animal.id"
          class="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-800"
        >
          {{ animal.name }} ({{ animal.bloodGroup }}, {{ animal.weight }}kg)
        </span>
        <span
          v-if="match.compatibleAnimals.length > 3"
          class="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-800"
        >
          +{{ match.compatibleAnimals.length - 3 }} autre{{
            match.compatibleAnimals.length - 3 > 1 ? 's' : ''
          }}
        </span>
      </div>
    </div>

    <!-- Informations additionnelles -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 text-sm">
      <div class="flex items-center text-gray-600">
        <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        Réponse estimée: {{ match.estimatedResponseTime }}min
      </div>

      <div v-if="match.donor.history?.totalMissions" class="flex items-center text-gray-600">
        <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        {{ match.donor.history.totalMissions }} mission{{
          match.donor.history.totalMissions > 1 ? 's' : ''
        }}
      </div>

      <div
        v-if="match.donor.acceptsEmergencies && request.requestType === 'EMERGENCY'"
        class="flex items-center text-red-600"
      >
        <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
          <path
            fill-rule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clip-rule="evenodd"
          />
        </svg>
        Accepte les urgences
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-between pt-4 border-t border-gray-200">
      <div class="text-xs text-gray-500">
        Dernière activité: {{ formatLastActivity(match.donor.lastActivity) }}
      </div>

      <div class="flex items-center space-x-3">
        <button
          class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          @click="$emit('view-details', match)"
        >
          Voir détails
        </button>

        <button
          :class="[
            'inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500',
            match.score >= 80
              ? 'bg-red-600 hover:bg-red-700'
              : match.score >= 60
                ? 'bg-yellow-600 hover:bg-yellow-700'
                : 'bg-gray-600 hover:bg-gray-700',
          ]"
          @click="$emit('select', match)"
        >
          {{ match.score >= 80 ? 'Sélectionner' : match.score >= 60 ? 'Considérer' : 'Contacter' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import ScoreBar from './ScoreBar.vue'

const props = defineProps({
  match: {
    type: Object,
    required: true,
  },
  request: {
    type: Object,
    required: true,
  },
})

defineEmits(['select', 'view-details'])

// Détails des scores pour les tooltips
const getDistanceDetails = () => {
  // Calculer la distance approximative
  const distance = Math.floor(Math.random() * 50) + 5 // Simulation
  return `~${distance}km de la clinique`
}

const getAvailabilityDetails = () => {
  const details = []
  if (props.match.donor.isOnline) details.push('En ligne')
  if (props.match.donor.acceptsEmergencies) details.push('Accepte urgences')
  if (props.match.donor.averageResponseTime) {
    details.push(`Répond en ${props.match.donor.averageResponseTime}min en moyenne`)
  }
  return details.join(', ') || 'Disponible'
}

const getCompatibilityDetails = () => {
  const compatible = props.match.compatibleAnimals.length
  const perfect = props.match.compatibleAnimals.filter(
    (animal) => animal.bloodGroup === props.request.requiredBloodGroup,
  ).length

  return `${compatible} compatible${compatible > 1 ? 's' : ''}, ${perfect} parfait${perfect > 1 ? 's' : ''}`
}

const getReliabilityDetails = () => {
  const history = props.match.donor.history
  if (!history?.totalMissions) return 'Nouveau donneur'

  const successRate = Math.round((history.successfulMissions / history.totalMissions) * 100)
  return `${successRate}% de succès sur ${history.totalMissions} mission${history.totalMissions > 1 ? 's' : ''}`
}

const formatLastActivity = (timestamp) => {
  if (!timestamp) return 'Inconnue'

  const date = new Date(timestamp)
  const now = new Date()
  const diffInHours = Math.floor((now - date) / (1000 * 60 * 60))

  if (diffInHours < 1) return "Il y a moins d'1h"
  if (diffInHours < 24) return `Il y a ${diffInHours}h`

  const diffInDays = Math.floor(diffInHours / 24)
  return `Il y a ${diffInDays}j`
}
</script>

<style scoped>
.match-card {
  @apply transition-all duration-200;
}

.match-card:hover {
  @apply transform -translate-y-1;
}

.animate-pulse {
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
