/**
 * Système de cache GraphQL personnalisé compatible avec AWS Amplify
 * Alternative à Apollo Client pour éviter les conflits de dépendances
 */

class GraphQLCache {
  constructor(options = {}) {
    this.cache = new Map()
    this.ttl = options.ttl || 5 * 60 * 1000 // 5 minutes par défaut
    this.maxSize = options.maxSize || 100 // Limite de taille du cache
    this.policies = options.policies || {}

    // Nettoyage automatique du cache expiré
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 60 * 1000) // Nettoyage chaque minute
  }

  /**
   * Génère une clé de cache basée sur la requête et les variables
   */
  generateKey(query, variables = {}) {
    const queryString = typeof query === 'string' ? query : query.loc?.source?.body || ''
    const variablesString = JSON.stringify(variables, Object.keys(variables).sort())
    return `${this.hashString(queryString)}_${this.hashString(variablesString)}`
  }

  /**
   * Hash simple pour les clés de cache
   */
  hashString(str) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convertir en 32bit integer
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * Met en cache une réponse GraphQL
   */
  set(query, variables, data, customTtl = null) {
    const key = this.generateKey(query, variables)
    const ttl = customTtl || this.ttl
    const expiresAt = Date.now() + ttl

    // Vérifier la taille du cache
    if (this.cache.size >= this.maxSize) {
      this.evictOldest()
    }

    this.cache.set(key, {
      data,
      expiresAt,
      createdAt: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    })

    console.log(`📦 Cache SET: ${key} (expires in ${ttl}ms)`)
  }

  /**
   * Récupère une réponse du cache
   */
  get(query, variables) {
    const key = this.generateKey(query, variables)
    const cached = this.cache.get(key)

    if (!cached) {
      console.log(`❌ Cache MISS: ${key}`)
      return null
    }

    if (Date.now() > cached.expiresAt) {
      console.log(`⏰ Cache EXPIRED: ${key}`)
      this.cache.delete(key)
      return null
    }

    // Mettre à jour les statistiques d'accès
    cached.accessCount++
    cached.lastAccessed = Date.now()

    console.log(`✅ Cache HIT: ${key} (accessed ${cached.accessCount} times)`)
    return cached.data
  }

  /**
   * Invalide le cache pour une requête spécifique
   */
  invalidate(query, variables = null) {
    if (variables) {
      // Invalider une requête spécifique
      const key = this.generateKey(query, variables)
      const deleted = this.cache.delete(key)
      console.log(`🗑️ Cache INVALIDATE: ${key} (${deleted ? 'found' : 'not found'})`)
      return deleted
    } else {
      // Invalider toutes les variantes d'une requête
      const queryString = typeof query === 'string' ? query : query.loc?.source?.body || ''
      const queryHash = this.hashString(queryString)
      let deletedCount = 0

      for (const [key, value] of this.cache.entries()) {
        if (key.startsWith(queryHash)) {
          this.cache.delete(key)
          deletedCount++
        }
      }

      console.log(`🗑️ Cache INVALIDATE ALL: ${queryHash} (${deletedCount} entries deleted)`)
      return deletedCount > 0
    }
  }

  /**
   * Invalide le cache par type d'entité
   */
  invalidateByType(entityType) {
    const patterns = this.getInvalidationPatterns(entityType)
    let deletedCount = 0

    for (const pattern of patterns) {
      for (const [key, value] of this.cache.entries()) {
        if (key.includes(pattern)) {
          this.cache.delete(key)
          deletedCount++
        }
      }
    }

    console.log(`🗑️ Cache INVALIDATE BY TYPE: ${entityType} (${deletedCount} entries deleted)`)
    return deletedCount > 0
  }

  /**
   * Patterns d'invalidation par type d'entité
   */
  getInvalidationPatterns(entityType) {
    const patterns = {
      Request: ['listRequests', 'getRequest', 'listOpenRequests'],
      Mission: ['listMissions', 'getMission', 'listMyMissions'],
      Animal: ['listAnimals', 'getAnimal', 'listMyAnimals'],
      Owner: ['listOwners', 'getOwner'],
      Clinic: ['listClinics', 'getClinic'],
      Veterinarian: ['listVeterinarians', 'getVeterinarian'],
    }

    return patterns[entityType] || [entityType.toLowerCase()]
  }

  /**
   * Nettoie les entrées expirées
   */
  cleanup() {
    const now = Date.now()
    let cleanedCount = 0

    for (const [key, value] of this.cache.entries()) {
      if (now > value.expiresAt) {
        this.cache.delete(key)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cache CLEANUP: ${cleanedCount} expired entries removed`)
    }
  }

  /**
   * Évince l'entrée la plus ancienne (LRU)
   */
  evictOldest() {
    let oldestKey = null
    let oldestTime = Date.now()

    for (const [key, value] of this.cache.entries()) {
      if (value.lastAccessed < oldestTime) {
        oldestTime = value.lastAccessed
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
      console.log(`🚮 Cache EVICT: ${oldestKey} (LRU)`)
    }
  }

  /**
   * Statistiques du cache
   */
  getStats() {
    const now = Date.now()
    let validEntries = 0
    let expiredEntries = 0
    let totalSize = 0

    for (const [key, value] of this.cache.entries()) {
      if (now > value.expiresAt) {
        expiredEntries++
      } else {
        validEntries++
      }
      totalSize += JSON.stringify(value.data).length
    }

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries,
      totalSizeBytes: totalSize,
      maxSize: this.maxSize,
      hitRatio: this.calculateHitRatio(),
    }
  }

  /**
   * Calcule le taux de succès du cache
   */
  calculateHitRatio() {
    let totalHits = 0
    let totalAccess = 0

    for (const [key, value] of this.cache.entries()) {
      totalHits += value.accessCount
      totalAccess += value.accessCount + 1 // +1 pour le premier accès (miss)
    }

    return totalAccess > 0 ? (totalHits / totalAccess) * 100 : 0
  }

  /**
   * Vide complètement le cache
   */
  clear() {
    const size = this.cache.size
    this.cache.clear()
    console.log(`🗑️ Cache CLEAR: ${size} entries removed`)
  }

  /**
   * Détruit le cache et nettoie les ressources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    this.clear()
  }
}

// Instance globale du cache
const graphqlCache = new GraphQLCache({
  ttl: 5 * 60 * 1000, // 5 minutes
  maxSize: 200,
  policies: {
    // Policies spécifiques par type de requête
    listRequests: { ttl: 30 * 1000 }, // 30 secondes pour les listes de missions
    listAnimals: { ttl: 10 * 60 * 1000 }, // 10 minutes pour les animaux
    getClinic: { ttl: 60 * 60 * 1000 }, // 1 heure pour les infos cliniques
  },
})

/**
 * Wrapper pour les requêtes GraphQL avec cache
 */
export async function cachedGraphQLQuery(
  client,
  { query, variables = {}, authMode, useCache = true },
) {
  // Vérifier le cache d'abord
  if (useCache) {
    const cached = graphqlCache.get(query, variables)
    if (cached) {
      return { data: cached, fromCache: true }
    }
  }

  try {
    // Exécuter la requête
    const result = await client.graphql({
      query,
      variables,
      authMode,
    })

    // Mettre en cache le résultat
    if (useCache && result && result.data) {
      const queryName = extractQueryName(query)
      const policy = graphqlCache.policies[queryName]
      const ttl = policy?.ttl || graphqlCache.ttl

      graphqlCache.set(query, variables, result.data, ttl)
    }

    return { data: result.data, fromCache: false }
  } catch (error) {
    console.error('GraphQL Query Error:', error)
    throw error
  }
}

/**
 * Extrait le nom de la requête GraphQL
 */
function extractQueryName(query) {
  const queryString = typeof query === 'string' ? query : query.loc?.source?.body || ''
  const match = queryString.match(/(?:query|mutation)\s+(\w+)|(\w+)\s*\(/i)
  return match ? match[1] || match[2] : 'unknown'
}

/**
 * Hook pour invalider le cache après les mutations
 */
export function invalidateCacheAfterMutation(entityType, operation = 'update') {
  // Invalider les listes liées à l'entité
  graphqlCache.invalidateByType(entityType)

  // Invalider les caches liés selon l'opération
  if (operation === 'create' || operation === 'delete') {
    // Invalider toutes les listes
    graphqlCache.invalidateByType('Request')
    graphqlCache.invalidateByType('Mission')
    graphqlCache.invalidateByType('Animal')
  }
}

export { graphqlCache }
export default GraphQLCache
