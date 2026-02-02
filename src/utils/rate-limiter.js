/**
 * Rate Limiter côté client pour protéger contre les abus
 * Complément au rate limiting AWS WAF côté serveur
 */

class RateLimiter {
  constructor(options = {}) {
    this.limits = new Map()
    this.defaultLimit = options.defaultLimit || 60 // Requêtes par minute
    this.windowMs = options.windowMs || 60 * 1000 // Fenêtre de 1 minute
    this.storage = options.storage || 'memory' // 'memory' ou 'localStorage'

    // Configuration par type de requête
    this.requestLimits = {
      query: 100, // Lectures
      mutation: 30, // Écritures
      subscription: 10, // Temps réel
      emergency: 5, // Urgences (plus strict)
      auth: 10, // Authentification
    }

    // Initialiser depuis le localStorage si configuré
    if (this.storage === 'localStorage') {
      this.loadFromStorage()
    }
  }

  /**
   * Vérifie si une requête est autorisée
   */
  isAllowed(key, requestType = 'query') {
    const limit = this.requestLimits[requestType] || this.defaultLimit
    const now = Date.now()
    const windowStart = now - this.windowMs

    // Récupérer ou créer l'historique pour cette clé
    if (!this.limits.has(key)) {
      this.limits.set(key, [])
    }

    const requests = this.limits.get(key)

    // Nettoyer les requêtes anciennes
    const validRequests = requests.filter((timestamp) => timestamp > windowStart)
    this.limits.set(key, validRequests)

    // Vérifier la limite
    if (validRequests.length >= limit) {
      console.warn(
        `🚫 Rate limit atteint pour ${key} (${requestType}): ${validRequests.length}/${limit}`,
      )
      return {
        allowed: false,
        remaining: 0,
        resetTime: Math.min(...validRequests) + this.windowMs,
        retryAfter: Math.min(...validRequests) + this.windowMs - now,
      }
    }

    // Enregistrer la nouvelle requête
    validRequests.push(now)
    this.limits.set(key, validRequests)

    // Sauvegarder si configuré
    if (this.storage === 'localStorage') {
      this.saveToStorage()
    }

    return {
      allowed: true,
      remaining: limit - validRequests.length,
      resetTime: windowStart + this.windowMs,
      retryAfter: 0,
    }
  }

  /**
   * Génère une clé unique pour l'utilisateur/action
   */
  generateKey(userId, action, context = '') {
    return `${userId || 'anonymous'}_${action}_${context}`.toLowerCase()
  }

  /**
   * Middleware pour les requêtes GraphQL
   */
  async checkGraphQLRequest(userId, query, variables = {}) {
    const queryType = this.detectQueryType(query)
    const action = this.extractActionFromQuery(query)
    const key = this.generateKey(userId, action)

    const result = this.isAllowed(key, queryType)

    if (!result.allowed) {
      const error = new Error(
        `Rate limit exceeded. Retry after ${Math.ceil(result.retryAfter / 1000)} seconds`,
      )
      error.code = 'RATE_LIMIT_EXCEEDED'
      error.retryAfter = result.retryAfter
      error.resetTime = result.resetTime
      throw error
    }

    return result
  }

  /**
   * Détecte le type de requête GraphQL
   */
  detectQueryType(query) {
    const queryString = typeof query === 'string' ? query : query.loc?.source?.body || ''

    if (queryString.includes('mutation')) return 'mutation'
    if (queryString.includes('subscription')) return 'subscription'
    if (queryString.includes('EMERGENCY')) return 'emergency'

    return 'query'
  }

  /**
   * Extrait l'action de la requête GraphQL
   */
  extractActionFromQuery(query) {
    const queryString = typeof query === 'string' ? query : query.loc?.source?.body || ''

    // Extraire le nom de la requête/mutation
    const match = queryString.match(/(?:query|mutation|subscription)\s+(\w+)|(\w+)\s*\(/i)
    return match ? match[1] || match[2] : 'unknown'
  }

  /**
   * Sauvegarde dans localStorage
   */
  saveToStorage() {
    try {
      const data = {}
      for (const [key, requests] of this.limits.entries()) {
        data[key] = requests
      }
      localStorage.setItem('rateLimiter', JSON.stringify(data))
    } catch (error) {
      console.warn('Impossible de sauvegarder le rate limiter:', error)
    }
  }

  /**
   * Charge depuis localStorage
   */
  loadFromStorage() {
    try {
      const data = localStorage.getItem('rateLimiter')
      if (data) {
        const parsed = JSON.parse(data)
        for (const [key, requests] of Object.entries(parsed)) {
          this.limits.set(key, requests)
        }
      }
    } catch (error) {
      console.warn('Impossible de charger le rate limiter:', error)
    }
  }

  /**
   * Nettoie les données expirées
   */
  cleanup() {
    const now = Date.now()
    const windowStart = now - this.windowMs

    for (const [key, requests] of this.limits.entries()) {
      const validRequests = requests.filter((timestamp) => timestamp > windowStart)
      if (validRequests.length === 0) {
        this.limits.delete(key)
      } else {
        this.limits.set(key, validRequests)
      }
    }

    if (this.storage === 'localStorage') {
      this.saveToStorage()
    }
  }

  /**
   * Obtient les statistiques actuelles
   */
  getStats() {
    const stats = {
      totalKeys: this.limits.size,
      activeRequests: 0,
      limits: this.requestLimits,
    }

    for (const requests of this.limits.values()) {
      stats.activeRequests += requests.length
    }

    return stats
  }

  /**
   * Réinitialise toutes les limites
   */
  reset() {
    this.limits.clear()
    if (this.storage === 'localStorage') {
      localStorage.removeItem('rateLimiter')
    }
  }
}

// Instance globale
const rateLimiter = new RateLimiter({
  storage: 'localStorage',
  windowMs: 60 * 1000, // 1 minute
  requestLimits: {
    query: 120, // 2 requêtes par seconde max
    mutation: 60, // 1 mutation par seconde max
    subscription: 20, // Limité pour les WebSockets
    emergency: 10, // Très limité pour les urgences
    auth: 15, // Authentification limitée
  },
})

// Nettoyage automatique toutes les 5 minutes
setInterval(
  () => {
    rateLimiter.cleanup()
  },
  5 * 60 * 1000,
)

export { rateLimiter }
export default RateLimiter
