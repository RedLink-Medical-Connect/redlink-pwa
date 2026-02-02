<!--
  Dashboard de performance et monitoring pour les administrateurs
-->

<template>
  <div class="performance-dashboard p-6 bg-gray-50 min-h-screen">
    <div class="max-w-7xl mx-auto">
      <!-- En-tête -->
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-gray-900">Dashboard Performance</h1>
        <p class="text-gray-600 mt-2">Monitoring en temps réel de l'application RedLink</p>

        <!-- Contrôles -->
        <div class="flex items-center space-x-4 mt-4">
          <button
            :disabled="isRefreshing"
            class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            @click="refreshMetrics"
          >
            <svg
              :class="['w-4 h-4 mr-2', { 'animate-spin': isRefreshing }]"
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

          <div class="flex items-center space-x-2">
            <label class="text-sm font-medium text-gray-700">Auto-refresh:</label>
            <input
              v-model="autoRefresh"
              type="checkbox"
              class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </div>

          <span class="text-sm text-gray-500">
            Dernière mise à jour: {{ formatTime(lastUpdate) }}
          </span>
        </div>
      </div>

      <!-- Métriques système -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <MetricCard
          title="Uptime"
          :value="formatDuration(systemMetrics.uptime)"
          icon="⏱️"
          color="blue"
        />

        <MetricCard
          title="Pages Chargées"
          :value="systemMetrics.pageLoads"
          icon="📄"
          color="green"
        />

        <MetricCard
          title="Erreurs"
          :value="systemMetrics.errors"
          :subtitle="`${systemMetrics.errorRate.toFixed(1)}% taux d'erreur`"
          icon="❌"
          color="red"
        />

        <MetricCard title="Appels API" :value="systemMetrics.apiCalls" icon="🌐" color="purple" />
      </div>

      <!-- Métriques de cache -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div class="bg-white rounded-lg shadow p-6">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Cache Performance</h3>

          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-gray-700">Hit Ratio</span>
              <div class="flex items-center">
                <div class="w-32 bg-gray-200 rounded-full h-2 mr-3">
                  <div
                    class="bg-green-600 h-2 rounded-full transition-all duration-300"
                    :style="{ width: `${cacheStats.hitRatio}%` }"
                  ></div>
                </div>
                <span class="text-sm font-semibold">{{ cacheStats.hitRatio.toFixed(1) }}%</span>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div class="text-center p-3 bg-green-50 rounded-lg">
                <div class="text-2xl font-bold text-green-600">{{ cacheStats.cacheHits }}</div>
                <div class="text-sm text-green-700">Cache Hits</div>
              </div>
              <div class="text-center p-3 bg-red-50 rounded-lg">
                <div class="text-2xl font-bold text-red-600">{{ cacheStats.cacheMisses }}</div>
                <div class="text-sm text-red-700">Cache Misses</div>
              </div>
            </div>

            <div class="pt-4 border-t border-gray-200">
              <div class="flex justify-between text-sm">
                <span class="text-gray-600">Taille du cache:</span>
                <span class="font-medium">{{ cacheStats.size }} entrées</span>
              </div>
              <div class="flex justify-between text-sm mt-1">
                <span class="text-gray-600">Mémoire utilisée:</span>
                <span class="font-medium">{{ cacheStats.sizeBytes }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Rate Limiting -->
        <div class="bg-white rounded-lg shadow p-6">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Rate Limiting</h3>

          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <div class="text-center p-3 bg-blue-50 rounded-lg">
                <div class="text-2xl font-bold text-blue-600">{{ rateLimitStats.totalKeys }}</div>
                <div class="text-sm text-blue-700">Clés Actives</div>
              </div>
              <div class="text-center p-3 bg-yellow-50 rounded-lg">
                <div class="text-2xl font-bold text-yellow-600">
                  {{ rateLimitStats.activeRequests }}
                </div>
                <div class="text-sm text-yellow-700">Requêtes Actives</div>
              </div>
            </div>

            <div class="pt-4 border-t border-gray-200">
              <h4 class="text-sm font-medium text-gray-900 mb-2">Limites par Type</h4>
              <div class="space-y-2 text-sm">
                <div class="flex justify-between">
                  <span class="text-gray-600">Queries:</span>
                  <span class="font-medium">120/min</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">Mutations:</span>
                  <span class="font-medium">60/min</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">Urgences:</span>
                  <span class="font-medium">10/min</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Graphiques de performance -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div class="bg-white rounded-lg shadow p-6">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Temps de Réponse</h3>
          <div class="h-64 flex items-center justify-center text-gray-500">
            <!-- Placeholder pour graphique -->
            <div class="text-center">
              <div class="text-4xl mb-2">📊</div>
              <div>Graphique des temps de réponse</div>
              <div class="text-sm mt-1">Moyenne: {{ averageResponseTime }}ms</div>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Erreurs par Heure</h3>
          <div class="h-64 flex items-center justify-center text-gray-500">
            <!-- Placeholder pour graphique -->
            <div class="text-center">
              <div class="text-4xl mb-2">📈</div>
              <div>Graphique des erreurs</div>
              <div class="text-sm mt-1">Dernière heure: {{ recentErrors }} erreurs</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Actions rapides -->
      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">Actions Rapides</h3>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            class="inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            @click="clearCache"
          >
            🗑️ Vider le Cache
          </button>

          <button
            class="inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            @click="resetRateLimit"
          >
            🔄 Reset Rate Limit
          </button>

          <button
            class="inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            @click="exportMetrics"
          >
            📊 Exporter Métriques
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useCachedGraphQL } from '@/composables/useCachedGraphQL'
import { useMonitoring } from '@/utils/monitoring'

// Composants
const MetricCard = {
  props: ['title', 'value', 'subtitle', 'icon', 'color'],
  template: `
    <div class="bg-white rounded-lg shadow p-6">
      <div class="flex items-center">
        <div class="flex-shrink-0">
          <div class="text-2xl">{{ icon }}</div>
        </div>
        <div class="ml-4 flex-1">
          <div class="text-sm font-medium text-gray-500">{{ title }}</div>
          <div class="text-2xl font-bold text-gray-900">{{ value }}</div>
          <div v-if="subtitle" class="text-sm text-gray-600">{{ subtitle }}</div>
        </div>
      </div>
    </div>
  `,
}

// Composables
const {
  refreshCacheStats,
  clearCache: clearCacheAction,
  resetRateLimit: resetRateLimitAction,
  cacheStats,
  hitRatio,
  cacheSize,
  cacheSizeBytes,
  rateLimitStats,
} = useCachedGraphQL()

const { getSystemMetrics, recordMetric } = useMonitoring()

// État local
const isRefreshing = ref(false)
const autoRefresh = ref(true)
const lastUpdate = ref(Date.now())
const systemMetrics = ref({
  uptime: 0,
  pageLoads: 0,
  errors: 0,
  apiCalls: 0,
  cacheHits: 0,
  cacheMisses: 0,
  errorRate: 0,
})

// Métriques calculées
const averageResponseTime = ref(0)
const recentErrors = ref(0)

// Statistiques du cache formatées
const cacheStatsFormatted = computed(() => ({
  hitRatio: parseFloat(hitRatio.value) || 0,
  cacheHits: systemMetrics.value.cacheHits,
  cacheMisses: systemMetrics.value.cacheMisses,
  size: cacheSize.value,
  sizeBytes: cacheSizeBytes.value,
}))

// Actions
const refreshMetrics = async () => {
  isRefreshing.value = true

  try {
    // Rafraîchir les statistiques
    refreshCacheStats()
    systemMetrics.value = getSystemMetrics()
    lastUpdate.value = Date.now()

    // Simuler des métriques additionnelles
    averageResponseTime.value = Math.floor(Math.random() * 500) + 100
    recentErrors.value = Math.floor(Math.random() * 5)

    recordMetric('Dashboard.Refresh', 1, 'Count')
  } catch (error) {
    console.error('Erreur rafraîchissement métriques:', error)
  } finally {
    isRefreshing.value = false
  }
}

const clearCache = async () => {
  if (confirm('Êtes-vous sûr de vouloir vider le cache ?')) {
    clearCacheAction()
    recordMetric('Dashboard.CacheCleared', 1, 'Count')
    await refreshMetrics()
  }
}

const resetRateLimit = async () => {
  if (confirm('Êtes-vous sûr de vouloir réinitialiser les limites de taux ?')) {
    resetRateLimitAction()
    recordMetric('Dashboard.RateLimitReset', 1, 'Count')
    await refreshMetrics()
  }
}

const exportMetrics = () => {
  const data = {
    timestamp: new Date().toISOString(),
    systemMetrics: systemMetrics.value,
    cacheStats: cacheStatsFormatted.value,
    rateLimitStats: rateLimitStats.value,
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `redlink-metrics-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)

  recordMetric('Dashboard.MetricsExported', 1, 'Count')
}

// Utilitaires
const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString('fr-FR')
}

const formatDuration = (ms) => {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}j ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

// Auto-refresh
let refreshInterval = null

const startAutoRefresh = () => {
  if (refreshInterval) clearInterval(refreshInterval)

  if (autoRefresh.value) {
    refreshInterval = setInterval(refreshMetrics, 30000) // 30 secondes
  }
}

// Lifecycle
onMounted(async () => {
  await refreshMetrics()
  startAutoRefresh()
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})

// Watchers
watch(autoRefresh, startAutoRefresh)
</script>

<style scoped>
.performance-dashboard {
  font-family: 'Inter', sans-serif;
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
