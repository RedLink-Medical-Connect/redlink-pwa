<!--
  Barre de score avec visualisation et détails
-->

<template>
  <div class="score-bar">
    <div class="flex items-center justify-between mb-1">
      <span class="text-xs font-medium text-gray-700">{{ label }}</span>
      <span class="text-xs text-gray-600">{{ score }}/100</span>
    </div>

    <!-- Barre de progression -->
    <div class="w-full bg-gray-200 rounded-full h-2 mb-1">
      <div
        :class="['h-2 rounded-full transition-all duration-300', getColorClass()]"
        :style="{ width: `${Math.min(100, Math.max(0, score))}%` }"
      ></div>
    </div>

    <!-- Poids et détails -->
    <div class="flex items-center justify-between">
      <span class="text-xs text-gray-500">{{ weight }}%</span>
      <div v-if="details" class="relative group">
        <svg class="w-3 h-3 text-gray-400 cursor-help" fill="currentColor" viewBox="0 0 20 20">
          <path
            fill-rule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
            clip-rule="evenodd"
          />
        </svg>

        <!-- Tooltip -->
        <div
          class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-900 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10"
        >
          {{ details }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  label: {
    type: String,
    required: true,
  },
  score: {
    type: Number,
    required: true,
  },
  weight: {
    type: Number,
    required: true,
  },
  color: {
    type: String,
    default: 'blue',
  },
  details: {
    type: String,
    default: '',
  },
})

const getColorClass = () => {
  const score = props.score
  const color = props.color

  // Déterminer l'intensité basée sur le score
  let intensity = 'bg-gray-300'

  if (score >= 80) {
    intensity = getColorIntensity(color, '600') // Excellent
  } else if (score >= 60) {
    intensity = getColorIntensity(color, '500') // Bon
  } else if (score >= 40) {
    intensity = getColorIntensity(color, '400') // Moyen
  } else if (score >= 20) {
    intensity = getColorIntensity(color, '300') // Faible
  } else {
    intensity = 'bg-red-300' // Très faible
  }

  return intensity
}

const getColorIntensity = (color, intensity) => {
  const colorMap = {
    blue: `bg-blue-${intensity}`,
    green: `bg-green-${intensity}`,
    purple: `bg-purple-${intensity}`,
    yellow: `bg-yellow-${intensity}`,
    red: `bg-red-${intensity}`,
    indigo: `bg-indigo-${intensity}`,
    pink: `bg-pink-${intensity}`,
    gray: `bg-gray-${intensity}`,
  }

  return colorMap[color] || `bg-blue-${intensity}`
}
</script>

<style scoped>
.score-bar {
  @apply min-w-0; /* Permet la flexibilité dans les grilles */
}

/* Assurer que les tooltips sont visibles */
.group:hover .group-hover\:opacity-100 {
  z-index: 50;
}
</style>
