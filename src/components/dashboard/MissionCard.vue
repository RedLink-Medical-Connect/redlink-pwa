<!--
  Carte de mission optimisée pour la performance
-->

<template>
  <div
    class="mission-card bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
  >
    <!-- En-tête avec priorité -->
    <div class="flex items-start justify-between mb-4">
      <div class="flex items-center space-x-3">
        <!-- Badge de priorité -->
        <span
          :class="[
            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
            mission.requestType === 'EMERGENCY'
              ? 'bg-red-100 text-red-800'
              : 'bg-blue-100 text-blue-800',
          ]"
        >
          <span
            v-if="mission.requestType === 'EMERGENCY'"
            class="w-2 h-2 bg-red-400 rounded-full mr-1 animate-pulse"
          ></span>
          {{
            mission.requestType === 'EMERGENCY'
              ? $t('missions.emergency')
              : $t('missions.appointment')
          }}
        </span>

        <!-- Temps écoulé -->
        <span class="text-sm text-gray-500">
          {{ formatTimeAgo(mission.createdAt) }}
        </span>
      </div>

      <!-- Distance (si disponible) -->
      <div v-if="mission.clinic?.latitude && mission.clinic?.longitude" class="text-right">
        <span class="text-sm font-medium text-gray-900">
          {{ calculateDistance(mission.clinic) }} km
        </span>
        <div class="text-xs text-gray-500">
          {{ $t('missions.distance') }}
        </div>
      </div>
    </div>

    <!-- Informations de la demande -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <div>
        <h3 class="text-lg font-semibold text-gray-900 mb-2">
          {{ mission.clinic?.name }}
        </h3>
        <p class="text-sm text-gray-600 mb-1">📍 {{ mission.clinic?.address }}</p>
        <p v-if="mission.clinic?.hasEmergencyService" class="text-xs text-green-600 font-medium">
          🚨 {{ $t('missions.emergency_service') }}
        </p>
      </div>

      <div class="space-y-2">
        <div class="flex items-center text-sm">
          <span class="font-medium text-gray-700 w-20">{{ $t('missions.species') }}:</span>
          <span class="text-gray-900">
            {{
              mission.requiredSpecies === 'DOG'
                ? '🐶 ' + $t('animals.dog')
                : '🐱 ' + $t('animals.cat')
            }}
          </span>
        </div>
        <div class="flex items-center text-sm">
          <span class="font-medium text-gray-700 w-20">{{ $t('missions.blood_group') }}:</span>
          <span class="text-gray-900 font-mono">{{ mission.requiredBloodGroup }}</span>
        </div>
        <div class="flex items-center text-sm">
          <span class="font-medium text-gray-700 w-20">{{ $t('missions.quantity') }}:</span>
          <span class="text-gray-900">{{ mission.quantity }} ml</span>
        </div>
      </div>
    </div>

    <!-- Compatibilité avec mes animaux -->
    <div v-if="compatibleAnimals.length > 0" class="mb-4 p-3 bg-green-50 rounded-md">
      <div class="flex items-center mb-2">
        <svg class="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
          <path
            fill-rule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clip-rule="evenodd"
          />
        </svg>
        <span class="text-sm font-medium text-green-800">
          {{ $t('missions.compatible_animals') }}
        </span>
      </div>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="animal in compatibleAnimals.slice(0, 3)"
          :key="animal.id"
          class="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-800"
        >
          {{ animal.name }} ({{ animal.weight }}kg)
        </span>
        <span
          v-if="compatibleAnimals.length > 3"
          class="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-800"
        >
          +{{ compatibleAnimals.length - 3 }} {{ $t('missions.more') }}
        </span>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-between pt-4 border-t border-gray-200">
      <div class="flex items-center space-x-4 text-sm text-gray-500">
        <span>{{ $t('missions.created') }} {{ formatDate(mission.createdAt) }}</span>
      </div>

      <div class="flex items-center space-x-3">
        <!-- Bouton de détails -->
        <button
          class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          @click="$emit('view-details', mission)"
        >
          {{ $t('missions.view_details') }}
        </button>

        <!-- Bouton d'acceptation -->
        <button
          v-if="compatibleAnimals.length > 0"
          :disabled="isAccepting"
          class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
          @click="$emit('accept', mission)"
        >
          <svg
            v-if="isAccepting"
            class="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            ></circle>
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          {{ isAccepting ? $t('missions.accepting') : $t('missions.accept') }}
        </button>

        <!-- Message si pas d'animaux compatibles -->
        <div v-else class="text-sm text-gray-500">
          {{ $t('missions.no_compatible_animals') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useAnimals } from '@/composables/useAnimals'

const props = defineProps({
  mission: {
    type: Object,
    required: true,
  },
  isAccepting: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['accept', 'view-details'])

// Récupérer les animaux pour vérifier la compatibilité
const { animals } = useAnimals()

// Calculer les animaux compatibles
const compatibleAnimals = computed(() => {
  return animals.value.filter(
    (animal) =>
      animal.species === props.mission.requiredSpecies &&
      animal.bloodGroup === props.mission.requiredBloodGroup &&
      animal.isVaccinated &&
      animal.isEligible,
  )
})

// Utilitaires de formatage
const formatTimeAgo = (dateString) => {
  const date = new Date(dateString)
  const now = new Date()
  const diffInMinutes = Math.floor((now - date) / (1000 * 60))

  if (diffInMinutes < 1) return "À l'instant"
  if (diffInMinutes < 60) return `Il y a ${diffInMinutes} min`

  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours < 24) return `Il y a ${diffInHours}h`

  const diffInDays = Math.floor(diffInHours / 24)
  return `Il y a ${diffInDays}j`
}

const formatDate = (dateString) => {
  return new Date(dateString).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const calculateDistance = (clinic) => {
  // Simulation du calcul de distance
  // En réalité, cela utiliserait la géolocalisation de l'utilisateur
  return Math.floor(Math.random() * 50) + 1
}
</script>

<style scoped>
.mission-card {
  @apply transition-all duration-200;
}

.mission-card:hover {
  @apply transform -translate-y-1;
}
</style>
