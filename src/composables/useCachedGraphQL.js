/**
 * Composable pour les requêtes GraphQL avec cache
 * Intégration du système de cache personnalisé avec les composables existants
 */

import { ref, computed } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import {
  cachedGraphQLQuery,
  invalidateCacheAfterMutation,
  graphqlCache,
} from '@/utils/graphql-cache'
import { rateLimiter } from '@/utils/rate-limiter'

export function useCachedGraphQL() {
  const client = generateClient()
  const isLoading = ref(false)
  const error = ref(null)
  const cacheStats = ref(null)

  /**
   * Exécute une requête GraphQL avec cache et rate limiting
   */
  const query = async (options) => {
    isLoading.value = true
    error.value = null

    try {
      // Vérifier le rate limiting
      const user = await getCurrentUser().catch(() => ({ userId: 'anonymous' }))
      await rateLimiter.checkGraphQLRequest(user.userId, options.query, options.variables)

      const result = await cachedGraphQLQuery(client, options)

      // Log pour debug
      if (result.fromCache) {
        console.log('🎯 Données servies depuis le cache')
      } else {
        console.log("🌐 Données récupérées depuis l'API")
      }

      return result
    } catch (err) {
      error.value = err

      if (err.code === 'RATE_LIMIT_EXCEEDED') {
        console.warn(
          '⏱️ Rate limit atteint, retry dans',
          Math.ceil(err.retryAfter / 1000),
          'secondes',
        )
      } else {
        console.error('Erreur requête GraphQL:', err)
      }

      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Exécute une mutation GraphQL et invalide le cache
   */
  const mutate = async ({ mutation, variables, invalidateTypes = [] }) => {
    isLoading.value = true
    error.value = null

    try {
      const result = await client.graphql({
        query: mutation,
        variables,
        authMode: 'userPool',
      })

      // Invalider le cache pour les types affectés
      for (const entityType of invalidateTypes) {
        invalidateCacheAfterMutation(entityType, 'update')
      }

      console.log('✅ Mutation réussie, cache invalidé pour:', invalidateTypes)
      return result
    } catch (err) {
      error.value = err
      console.error('Erreur mutation GraphQL:', err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Invalide manuellement le cache
   */
  const invalidateCache = (entityTypes = []) => {
    for (const entityType of entityTypes) {
      graphqlCache.invalidateByType(entityType)
    }
    console.log('🗑️ Cache invalidé manuellement pour:', entityTypes)
  }

  /**
   * Rafraîchit les statistiques du cache
   */
  const refreshCacheStats = () => {
    cacheStats.value = graphqlCache.getStats()
  }

  /**
   * Vide complètement le cache
   */
  const clearCache = () => {
    graphqlCache.clear()
    refreshCacheStats()
  }

  // Statistiques du cache en temps réel
  const hitRatio = computed(() => {
    return cacheStats.value ? cacheStats.value.hitRatio.toFixed(1) : 0
  })

  const cacheSize = computed(() => {
    return cacheStats.value ? cacheStats.value.totalEntries : 0
  })

  const cacheSizeBytes = computed(() => {
    if (!cacheStats.value) return 0
    const bytes = cacheStats.value.totalSizeBytes
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  })

  return {
    // Méthodes principales
    query,
    mutate,

    // Gestion du cache
    invalidateCache,
    clearCache,
    refreshCacheStats,

    // États
    isLoading,
    error,

    // Statistiques
    cacheStats,
    hitRatio,
    cacheSize,
    cacheSizeBytes,
  }
}

/**
 * Composable spécialisé pour les requêtes paginées avec cache
 */
export function useCachedPagination() {
  const { query, invalidateCache } = useCachedGraphQL()

  const items = ref([])
  const isLoading = ref(false)
  const isLoadingMore = ref(false)
  const hasMore = ref(true)
  const nextToken = ref(null)
  const error = ref(null)

  /**
   * Charge la première page
   */
  const loadFirst = async (queryConfig) => {
    isLoading.value = true
    error.value = null
    items.value = []
    nextToken.value = null
    hasMore.value = true

    try {
      const result = await query({
        ...queryConfig,
        variables: {
          ...queryConfig.variables,
          nextToken: null,
        },
      })

      const data = result.data
      const listKey = Object.keys(data)[0] // Premier champ de la réponse
      const listData = data[listKey]

      items.value = listData.items || []
      nextToken.value = listData.nextToken
      hasMore.value = !!listData.nextToken

      return items.value
    } catch (err) {
      error.value = err
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Charge la page suivante
   */
  const loadMore = async (queryConfig) => {
    if (!hasMore.value || isLoadingMore.value) return []

    isLoadingMore.value = true

    try {
      const result = await query({
        ...queryConfig,
        variables: {
          ...queryConfig.variables,
          nextToken: nextToken.value,
        },
      })

      const data = result.data
      const listKey = Object.keys(data)[0]
      const listData = data[listKey]

      const newItems = listData.items || []
      items.value = [...items.value, ...newItems]
      nextToken.value = listData.nextToken
      hasMore.value = !!listData.nextToken

      return newItems
    } catch (err) {
      error.value = err
      throw err
    } finally {
      isLoadingMore.value = false
    }
  }

  /**
   * Rafraîchit la liste
   */
  const refresh = async (queryConfig) => {
    // Invalider le cache pour cette requête
    graphqlCache.invalidate(queryConfig.query, {
      ...queryConfig.variables,
      nextToken: null,
    })

    return await loadFirst(queryConfig)
  }

  /**
   * Supprime un élément de la liste
   */
  const removeItem = (itemId) => {
    items.value = items.value.filter((item) => item.id !== itemId)
  }

  /**
   * Ajoute un élément à la liste
   */
  const addItem = (item, position = 'start') => {
    if (position === 'start') {
      items.value = [item, ...items.value]
    } else {
      items.value = [...items.value, item]
    }
  }

  /**
   * Met à jour un élément de la liste
   */
  const updateItem = (itemId, updates) => {
    const index = items.value.findIndex((item) => item.id === itemId)
    if (index !== -1) {
      items.value[index] = { ...items.value[index], ...updates }
    }
  }

  return {
    // Données
    items,
    hasMore,

    // États
    isLoading,
    isLoadingMore,
    error,

    // Actions
    loadFirst,
    loadMore,
    refresh,
    removeItem,
    addItem,
    updateItem,

    // Utilitaires
    invalidateCache,
  }
}
