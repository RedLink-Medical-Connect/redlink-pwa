/**
 * Composable pour la pagination GraphQL
 * Gère la pagination infinie et le cache des résultats
 */

import { ref, computed, reactive } from 'vue'
import { generateClient } from 'aws-amplify/api'

export function usePagination() {
  const client = generateClient()

  // État de la pagination
  const isLoading = ref(false)
  const isLoadingMore = ref(false)
  const hasMore = ref(true)
  const error = ref(null)

  // Données paginées
  const items = ref([])
  const nextToken = ref(null)
  const totalCount = ref(0)

  // Configuration
  const config = reactive({
    limit: 20,
    query: null,
    variables: {},
    authMode: 'userPool',
  })

  /**
   * Initialise la pagination avec une requête
   * @param {Object} options - Configuration de la pagination
   */
  const initialize = (options) => {
    Object.assign(config, options)
    items.value = []
    nextToken.value = null
    hasMore.value = true
    error.value = null
    totalCount.value = 0
  }

  /**
   * Charge la première page
   */
  const loadFirst = async () => {
    if (!config.query) {
      throw new Error("Query non définie. Utilisez initialize() d'abord.")
    }

    isLoading.value = true
    error.value = null

    try {
      const variables = {
        ...config.variables,
        limit: config.limit,
        nextToken: null,
      }

      const { data } = await client.graphql({
        query: config.query,
        variables,
        authMode: config.authMode,
      })

      // Extraire les données (assume une structure standard)
      const queryName = Object.keys(data)[0]
      const result = data[queryName]

      items.value = result.items || []
      nextToken.value = result.nextToken
      hasMore.value = !!result.nextToken
      totalCount.value = items.value.length

      return items.value
    } catch (err) {
      console.error('Erreur chargement première page:', err)
      error.value = err.message
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Charge la page suivante (pagination infinie)
   */
  const loadMore = async () => {
    if (!hasMore.value || isLoadingMore.value || !nextToken.value) {
      return []
    }

    isLoadingMore.value = true

    try {
      const variables = {
        ...config.variables,
        limit: config.limit,
        nextToken: nextToken.value,
      }

      const { data } = await client.graphql({
        query: config.query,
        variables,
        authMode: config.authMode,
      })

      const queryName = Object.keys(data)[0]
      const result = data[queryName]

      const newItems = result.items || []
      items.value.push(...newItems)
      nextToken.value = result.nextToken
      hasMore.value = !!result.nextToken
      totalCount.value = items.value.length

      return newItems
    } catch (err) {
      console.error('Erreur chargement page suivante:', err)
      error.value = err.message
      throw err
    } finally {
      isLoadingMore.value = false
    }
  }

  /**
   * Recharge complètement les données
   */
  const refresh = async () => {
    items.value = []
    nextToken.value = null
    hasMore.value = true
    return loadFirst()
  }

  /**
   * Ajoute un élément au début de la liste (pour les nouveaux éléments)
   */
  const prependItem = (item) => {
    items.value.unshift(item)
    totalCount.value = items.value.length
  }

  /**
   * Met à jour un élément dans la liste
   */
  const updateItem = (id, updates) => {
    const index = items.value.findIndex((item) => item.id === id)
    if (index !== -1) {
      items.value[index] = { ...items.value[index], ...updates }
    }
  }

  /**
   * Supprime un élément de la liste
   */
  const removeItem = (id) => {
    const index = items.value.findIndex((item) => item.id === id)
    if (index !== -1) {
      items.value.splice(index, 1)
      totalCount.value = items.value.length
    }
  }

  /**
   * Filtre les éléments localement (pour les recherches rapides)
   */
  const filterItems = (predicate) => {
    return computed(() => items.value.filter(predicate))
  }

  /**
   * Trie les éléments localement
   */
  const sortItems = (compareFn) => {
    return computed(() => [...items.value].sort(compareFn))
  }

  // États calculés
  const isEmpty = computed(() => items.value.length === 0 && !isLoading.value)
  const isFirstLoad = computed(() => isLoading.value && items.value.length === 0)

  return {
    // État
    items,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    totalCount,
    isEmpty,
    isFirstLoad,

    // Actions
    initialize,
    loadFirst,
    loadMore,
    refresh,
    prependItem,
    updateItem,
    removeItem,

    // Utilitaires
    filterItems,
    sortItems,
  }
}

/**
 * Composable spécialisé pour la pagination infinie avec intersection observer
 */
export function useInfinitePagination(options = {}) {
  const pagination = usePagination()
  const loadMoreTrigger = ref(null)

  // Configuration de l'intersection observer
  const observerOptions = {
    root: null,
    rootMargin: '100px',
    threshold: 0.1,
    ...options.observer,
  }

  let observer = null

  /**
   * Configure l'intersection observer pour le chargement automatique
   */
  const setupIntersectionObserver = () => {
    if (observer) {
      observer.disconnect()
    }

    observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry.isIntersecting && pagination.hasMore.value && !pagination.isLoadingMore.value) {
        pagination.loadMore()
      }
    }, observerOptions)

    if (loadMoreTrigger.value) {
      observer.observe(loadMoreTrigger.value)
    }
  }

  /**
   * Nettoie l'intersection observer
   */
  const cleanup = () => {
    if (observer) {
      observer.disconnect()
      observer = null
    }
  }

  return {
    ...pagination,
    loadMoreTrigger,
    setupIntersectionObserver,
    cleanup,
  }
}

/**
 * Composable pour la pagination avec recherche
 */
export function useSearchPagination() {
  const pagination = usePagination()
  const searchQuery = ref('')
  const searchResults = ref([])
  const isSearching = ref(false)

  /**
   * Effectue une recherche avec pagination
   */
  const search = async (query, searchConfig = {}) => {
    searchQuery.value = query

    if (!query.trim()) {
      searchResults.value = []
      return []
    }

    isSearching.value = true

    try {
      // Réinitialiser la pagination pour la recherche
      pagination.initialize({
        ...pagination.config,
        ...searchConfig,
        variables: {
          ...pagination.config.variables,
          ...searchConfig.variables,
          searchQuery: query,
        },
      })

      const results = await pagination.loadFirst()
      searchResults.value = results
      return results
    } catch (error) {
      console.error('Erreur de recherche:', error)
      throw error
    } finally {
      isSearching.value = false
    }
  }

  /**
   * Efface la recherche
   */
  const clearSearch = () => {
    searchQuery.value = ''
    searchResults.value = []
  }

  return {
    ...pagination,
    searchQuery,
    searchResults,
    isSearching,
    search,
    clearSearch,
  }
}
