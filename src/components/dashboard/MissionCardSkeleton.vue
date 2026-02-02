<!--
  Skeleton loader pour MissionCard pendant le chargement
-->

<template>
  <div class="mission-card-skeleton bg-white rounded-lg shadow-sm border border-gray-200 p-6">
    <!-- En-tête avec priorité -->
    <div class="flex items-start justify-between mb-4">
      <div class="flex items-center space-x-3">
        <!-- Badge de priorité skeleton -->
        <div class="h-5 w-20 bg-gray-200 rounded-full animate-pulse"></div>
        <!-- Temps écoulé skeleton -->
        <div class="h-4 w-16 bg-gray-200 rounded animate-pulse"></div>
      </div>
      <!-- Distance skeleton -->
      <div class="text-right">
        <div class="h-4 w-12 bg-gray-200 rounded animate-pulse mb-1"></div>
        <div class="h-3 w-16 bg-gray-200 rounded animate-pulse"></div>
      </div>
    </div>

    <!-- Informations de la demande -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <div>
        <!-- Nom clinique skeleton -->
        <div class="h-6 w-48 bg-gray-200 rounded animate-pulse mb-2"></div>
        <!-- Adresse skeleton -->
        <div class="h-4 w-64 bg-gray-200 rounded animate-pulse mb-1"></div>
        <!-- Service urgence skeleton -->
        <div class="h-3 w-32 bg-gray-200 rounded animate-pulse"></div>
      </div>

      <div class="space-y-2">
        <!-- Espèce skeleton -->
        <div class="flex items-center">
          <div class="h-4 w-16 bg-gray-200 rounded animate-pulse mr-2"></div>
          <div class="h-4 w-20 bg-gray-200 rounded animate-pulse"></div>
        </div>
        <!-- Groupe sanguin skeleton -->
        <div class="flex items-center">
          <div class="h-4 w-20 bg-gray-200 rounded animate-pulse mr-2"></div>
          <div class="h-4 w-12 bg-gray-200 rounded animate-pulse"></div>
        </div>
        <!-- Quantité skeleton -->
        <div class="flex items-center">
          <div class="h-4 w-16 bg-gray-200 rounded animate-pulse mr-2"></div>
          <div class="h-4 w-16 bg-gray-200 rounded animate-pulse"></div>
        </div>
      </div>
    </div>

    <!-- Compatibilité skeleton -->
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

    <!-- Actions skeleton -->
    <div class="flex items-center justify-between pt-4 border-t border-gray-200">
      <div class="h-4 w-32 bg-gray-200 rounded animate-pulse"></div>
      <div class="flex items-center space-x-3">
        <!-- Bouton détails skeleton -->
        <div class="h-9 w-24 bg-gray-200 rounded-md animate-pulse"></div>
        <!-- Bouton accepter skeleton -->
        <div class="h-9 w-20 bg-gray-200 rounded-md animate-pulse"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
// Pas de logique nécessaire pour un skeleton
</script>

<style scoped>
.mission-card-skeleton {
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
