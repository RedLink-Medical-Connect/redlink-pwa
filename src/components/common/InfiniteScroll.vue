<!--
  Composant de pagination infinie réutilisable
  Phase 1 Sprint 1.3 - Performance Critique
-->

<template>
  <div class="infinite-scroll-container">
    <!-- Contenu principal -->
    <div class="items-container">
      <slot name="items" :items="items" :is-loading="isLoading" />
    </div>

    <!-- État de chargement initial -->
    <div v-if="isFirstLoad" class="loading-state">
      <slot name="loading">
        <div class="flex items-center justify-center py-8">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <span class="ml-3 text-gray-600">{{ $t('common.loading') }}</span>
        </div>
      </slot>
    </div>

    <!-- État vide -->
    <div v-else-if="isEmpty" class="empty-state">
      <slot name="empty">
        <div class="text-center py-12">
          <div class="text-gray-400 text-6xl mb-4">📭</div>
          <h3 class="text-lg font-medium text-gray-900 mb-2">
            {{ emptyTitle || $t('common.no_data') }}
          </h3>
          <p class="text-gray-500">
            {{ emptyMessage || $t('common.no_data_message') }}
          </p>
        </div>
      </slot>
    </div>

    <!-- Trigger pour le chargement automatique -->
    <div v-else-if="hasMore" ref="loadMoreTrigger" class="load-more-trigger">
      <!-- Chargement de plus d'éléments -->
      <div v-if="isLoadingMore" class="loading-more">
        <slot name="loading-more">
          <div class="flex items-center justify-center py-6">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
            <span class="ml-3 text-gray-600">{{ $t('common.loading_more') }}</span>
          </div>
        </slot>
      </div>

      <!-- Bouton de chargement manuel (fallback) -->
      <div v-else class="manual-load">
        <slot name="load-more-button">
          <button
            class="w-full py-3 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            @click="loadMore"
          >
            {{ $t('common.load_more') }}
          </button>
        </slot>
      </div>
    </div>

    <!-- Fin de liste -->
    <div v-else-if="!isEmpty" class="end-of-list">
      <slot name="end">
        <div class="text-center py-6 text-gray-500 text-sm">
          {{ $t('common.end_of_list') }}
        </div>
      </slot>
    </div>

    <!-- État d'erreur -->
    <div v-if="error" class="error-state">
      <slot name="error" :error="error" :retry="refresh">
        <div class="bg-red-50 border border-red-200 rounded-md p-4 mt-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <svg class="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-red-800">
                {{ $t('common.error_occurred') }}
              </h3>
              <div class="mt-2 text-sm text-red-700">
                {{ error }}
              </div>
              <div class="mt-3">
                <button
                  class="bg-red-100 px-3 py-2 rounded-md text-sm font-medium text-red-800 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                  @click="refresh"
                >
                  {{ $t('common.retry') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </slot>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  // Données de pagination
  items: {
    type: Array,
    default: () => [],
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
  isLoadingMore: {
    type: Boolean,
    default: false,
  },
  hasMore: {
    type: Boolean,
    default: true,
  },
  isEmpty: {
    type: Boolean,
    default: false,
  },
  isFirstLoad: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: null,
  },

  // Configuration
  autoLoad: {
    type: Boolean,
    default: true,
  },
  threshold: {
    type: Number,
    default: 0.1,
  },
  rootMargin: {
    type: String,
    default: '100px',
  },

  // Messages personnalisés
  emptyTitle: {
    type: String,
    default: null,
  },
  emptyMessage: {
    type: String,
    default: null,
  },
})

const emit = defineEmits(['load-more', 'refresh'])

const loadMoreTrigger = ref(null)
let observer = null

// Actions
const loadMore = () => {
  if (!props.isLoadingMore && props.hasMore) {
    emit('load-more')
  }
}

const refresh = () => {
  emit('refresh')
}

// Configuration de l'Intersection Observer
const setupIntersectionObserver = () => {
  if (!props.autoLoad || !loadMoreTrigger.value) return

  if (observer) {
    observer.disconnect()
  }

  observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      if (entry.isIntersecting && props.hasMore && !props.isLoadingMore) {
        loadMore()
      }
    },
    {
      root: null,
      rootMargin: props.rootMargin,
      threshold: props.threshold,
    },
  )

  observer.observe(loadMoreTrigger.value)
}

// Lifecycle
onMounted(() => {
  if (props.autoLoad) {
    setupIntersectionObserver()
  }
})

onUnmounted(() => {
  if (observer) {
    observer.disconnect()
  }
})

// Réactiver l'observer quand le trigger change
watch(loadMoreTrigger, () => {
  if (props.autoLoad) {
    setupIntersectionObserver()
  }
})

// Exposer les méthodes pour le parent
defineExpose({
  loadMore,
  refresh,
  setupIntersectionObserver,
})
</script>

<style scoped>
.infinite-scroll-container {
  @apply w-full;
}

.items-container {
  @apply space-y-4;
}

.load-more-trigger {
  @apply mt-6;
}

.loading-state,
.empty-state,
.end-of-list {
  @apply mt-6;
}

.error-state {
  @apply mt-4;
}

/* Animation pour le chargement */
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.loading-more {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>
