<!--
  Skeleton loader pour MatchCard pendant le matching
-->

<template>
  <div class="match-card-skeleton bg-white rounded-lg shadow-sm border border-gray-200 p-6">
    <!-- En-tête avec rang et score -->
    <div class="flex items-start justify-between mb-4">
      <div class="flex items-center space-x-3">
        <!-- Badge de rang skeleton -->
        <div class="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>

        <!-- Informations du donneur skeleton -->
        <div>
          <div class="h-5 w-32 bg-gray-200 rounded animate-pulse mb-2"></div>
          <div class="h-4 w-48 bg-gray-200 rounded animate-pulse"></div>
        </div>
      </div>

      <!-- Score global skeleton -->
      <div class="text-right">
        <div class="h-8 w-12 bg-gray-200 rounded animate-pulse mb-1"></div>
        <div class="h-3 w-16 bg-gray-200 rounded animate-pulse mb-1"></div>
        <div class="h-3 w-20 bg-gray-200 rounded animate-pulse"></div>
      </div>
    </div>

    <!-- Détail des scores skeleton -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
      <div v-for="i in 4" :key="i" class="space-y-2">
        <div class="flex items-center justify-between">
          <div class="h-3 w-16 bg-gray-200 rounded animate-pulse"></div>
          <div class="h-3 w-8 bg-gray-200 rounded animate-pulse"></div>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-2 animate-pulse"></div>
        <div class="flex items-center justify-between">
          <div class="h-3 w-6 bg-gray-200 rounded animate-pulse"></div>
          <div class="h-3 w-3 bg-gray-200 rounded animate-pulse"></div>
        </div>
      </div>
    </div>

    <!-- Animaux compatibles skeleton -->
    <div class="mb-4 p-3 bg-gray-50 rounded-md">
      <div class="flex items-center mb-2">
        <div class="h-4 w-4 bg-gray-200 rounded animate-pulse mr-2"></div>
        <div class="h-4 w-32 bg-gray-200 rounded animate-pulse"></div>
      </div>
      <div class="flex flex-wrap gap-2">
        <div class="h-6 w-24 bg-gray-200 rounded-md animate-pulse"></div>
        <div class="h-6 w-28 bg-gray-200 rounded-md animate-pulse"></div>
        <div class="h-6 w-20 bg-gray-200 rounded-md animate-pulse"></div>
      </div>
    </div>

    <!-- Informations additionnelles skeleton -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
      <div class="flex items-center">
        <div class="h-4 w-4 bg-gray-200 rounded animate-pulse mr-2"></div>
        <div class="h-4 w-24 bg-gray-200 rounded animate-pulse"></div>
      </div>
      <div class="flex items-center">
        <div class="h-4 w-4 bg-gray-200 rounded animate-pulse mr-2"></div>
        <div class="h-4 w-20 bg-gray-200 rounded animate-pulse"></div>
      </div>
      <div class="flex items-center">
        <div class="h-4 w-4 bg-gray-200 rounded animate-pulse mr-2"></div>
        <div class="h-4 w-28 bg-gray-200 rounded animate-pulse"></div>
      </div>
    </div>

    <!-- Actions skeleton -->
    <div class="flex items-center justify-between pt-4 border-t border-gray-200">
      <div class="h-3 w-32 bg-gray-200 rounded animate-pulse"></div>
      <div class="flex items-center space-x-3">
        <div class="h-8 w-20 bg-gray-200 rounded-md animate-pulse"></div>
        <div class="h-8 w-24 bg-gray-200 rounded-md animate-pulse"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
// Pas de logique nécessaire pour un skeleton
</script>

<style scoped>
.match-card-skeleton {
  @apply transition-all duration-200;
}

/* Animation pulse personnalisée pour un effet plus fluide */
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>
