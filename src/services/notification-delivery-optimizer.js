/**
 * Service d'optimisation de la délivrabilité des notifications
 * Sprint 3.4 - Optimisation et Finalisation
 */

import { useMonitoring } from '@/utils/monitoring'

class NotificationDeliveryOptimizer {
  constructor() {
    this.monitoring = useMonitoring()

    // Statistiques de délivrabilité par canal
    this.deliveryStats = {
      websocket: { sent: 0, delivered: 0, failed: 0, avgLatency: 0 },
      push: { sent: 0, delivered: 0, failed: 0, avgLatency: 0 },
      sms: { sent: 0, delivered: 0, failed: 0, avgLatency: 0 },
      email: { sent: 0, delivered: 0, failed: 0, avgLatency: 0 },
    }

    // Configuration adaptative des timeouts
    this.adaptiveTimeouts = {
      websocket: 5000, // 5s
      push: 30000, // 30s
      sms: 60000, // 1min
      email: 120000, // 2min
    }

    // Queue de retry pour les échecs
    this.retryQueue = new Map()

    // Détection de la qualité réseau
    this.networkQuality = 'good' // good, fair, poor

    // Circuit breaker pour chaque canal
    this.circuitBreakers = {
      websocket: { failures: 0, lastFailure: null, isOpen: false },
      push: { failures: 0, lastFailure: null, isOpen: false },
      sms: { failures: 0, lastFailure: null, isOpen: false },
      email: { failures: 0, lastFailure: null, isOpen: false },
    }

    console.log('🚀 Optimiseur de délivrabilité initialisé')
  }

  /**
   * Optimise la stratégie de délivrance selon le contexte
   */
  optimizeDeliveryStrategy(notification, userPreferences = {}) {
    try {
      const strategy = {
        channels: this.selectOptimalChannels(notification, userPreferences),
        timeouts: this.calculateAdaptiveTimeouts(),
        retryPolicy: this.getRetryPolicy(notification.priority),
        fallbackChain: this.buildFallbackChain(notification),
      }

      console.log(`📊 Stratégie optimisée pour ${notification.type}:`, strategy)

      return strategy
    } catch (error) {
      console.error('❌ Erreur optimisation stratégie:', error)
      return this.getDefaultStrategy()
    }
  }

  /**
   * Sélectionne les canaux optimaux selon les performances
   */
  selectOptimalChannels(notification, userPreferences) {
    const availableChannels = ['websocket', 'push', 'sms', 'email']
    const optimalChannels = []

    for (const channel of availableChannels) {
      // Vérifier les préférences utilisateur
      if (userPreferences.channels && !userPreferences.channels[channel]) {
        continue
      }

      // Vérifier le circuit breaker
      if (this.isCircuitBreakerOpen(channel)) {
        console.warn(`⚠️ Circuit breaker ouvert pour ${channel}`)
        continue
      }

      // Calculer le score de fiabilité
      const reliabilityScore = this.calculateReliabilityScore(channel)

      // Seuil minimum de fiabilité
      if (reliabilityScore > 0.8) {
        optimalChannels.push({
          channel,
          score: reliabilityScore,
          estimatedLatency: this.deliveryStats[channel].avgLatency,
        })
      }
    }

    // Trier par score de fiabilité
    optimalChannels.sort((a, b) => b.score - a.score)

    return optimalChannels.map((c) => c.channel)
  }

  /**
   * Calcule les timeouts adaptatifs selon les performances
   */
  calculateAdaptiveTimeouts() {
    const timeouts = { ...this.adaptiveTimeouts }

    // Ajuster selon la qualité réseau
    const multiplier = this.getNetworkMultiplier()

    Object.keys(timeouts).forEach((channel) => {
      const baseTimeout = timeouts[channel]
      const avgLatency = this.deliveryStats[channel].avgLatency

      // Timeout adaptatif = base + (3 * latence moyenne) * multiplicateur réseau
      timeouts[channel] = Math.min(
        baseTimeout * multiplier,
        baseTimeout + avgLatency * 3 * multiplier,
      )
    })

    return timeouts
  }

  /**
   * Construit la chaîne de fallback optimale
   */
  buildFallbackChain(notification) {
    const urgencyLevel = notification.data?.urgencyLevel || 'NORMAL'

    const fallbackChains = {
      CRITICAL: ['websocket', 'push', 'sms', 'email'],
      URGENT: ['websocket', 'push', 'sms'],
      HIGH: ['websocket', 'push'],
      NORMAL: ['websocket'],
    }

    let chain = fallbackChains[urgencyLevel] || fallbackChains.NORMAL

    // Filtrer les canaux avec circuit breaker ouvert
    chain = chain.filter((channel) => !this.isCircuitBreakerOpen(channel))

    // Réorganiser selon les performances
    chain.sort((a, b) => {
      const scoreA = this.calculateReliabilityScore(a)
      const scoreB = this.calculateReliabilityScore(b)
      return scoreB - scoreA
    })

    return chain
  }

  /**
   * Enregistre le résultat d'une tentative de délivrance
   */
  recordDeliveryAttempt(channel, success, latency = 0, error = null) {
    try {
      const stats = this.deliveryStats[channel]

      stats.sent++

      if (success) {
        stats.delivered++
        this.resetCircuitBreaker(channel)

        // Mettre à jour la latence moyenne
        stats.avgLatency = (stats.avgLatency + latency) / 2
      } else {
        stats.failed++
        this.recordCircuitBreakerFailure(channel, error)
      }

      // Métriques de monitoring
      this.monitoring.recordMetric(`Delivery.${channel}.Success`, success ? 1 : 0, 'Count')
      this.monitoring.recordMetric(`Delivery.${channel}.Latency`, latency, 'Milliseconds')

      if (error) {
        this.monitoring.recordError(error, {
          context: 'delivery-attempt',
          channel,
          latency,
        })
      }

      console.log(`📊 ${channel}: ${success ? '✅' : '❌'} (${latency}ms)`)
    } catch (err) {
      console.error('❌ Erreur enregistrement tentative:', err)
    }
  }

  /**
   * Ajoute une notification à la queue de retry
   */
  addToRetryQueue(notification, channel, error, attempt = 1) {
    const retryKey = `${notification.id}_${channel}`
    const maxRetries = this.getMaxRetries(notification.priority)

    if (attempt > maxRetries) {
      console.warn(
        `⚠️ Abandon retry ${channel} pour ${notification.id} après ${attempt} tentatives`,
      )
      return false
    }

    const retryDelay = this.calculateRetryDelay(attempt, channel)
    const retryAt = Date.now() + retryDelay

    this.retryQueue.set(retryKey, {
      notification,
      channel,
      attempt,
      error,
      retryAt,
      originalTimestamp: notification.createdAt || Date.now(),
    })

    console.log(
      `🔄 Retry ${channel} programmé dans ${retryDelay}ms (tentative ${attempt}/${maxRetries})`,
    )

    // Programmer le retry
    setTimeout(() => {
      this.processRetry(retryKey)
    }, retryDelay)

    return true
  }

  /**
   * Traite un retry de la queue
   */
  async processRetry(retryKey) {
    try {
      const retryItem = this.retryQueue.get(retryKey)

      if (!retryItem) {
        return
      }

      const { notification, channel, attempt } = retryItem

      console.log(`🔄 Tentative retry ${attempt} pour ${channel}`)

      // Supprimer de la queue
      this.retryQueue.delete(retryKey)

      // Tenter la relivraison (simulation)
      const success = await this.simulateDelivery(channel, notification)

      if (success) {
        this.recordDeliveryAttempt(channel, true, Math.random() * 1000)
        console.log(`✅ Retry ${channel} réussi`)
      } else {
        this.recordDeliveryAttempt(channel, false, 0, new Error('Retry failed'))

        // Programmer un nouveau retry si possible
        this.addToRetryQueue(notification, channel, new Error('Retry failed'), attempt + 1)
      }
    } catch (error) {
      console.error('❌ Erreur traitement retry:', error)
    }
  }

  /**
   * Simule une tentative de délivrance
   */
  async simulateDelivery(channel, notification) {
    // Simulation basée sur les statistiques du canal
    const stats = this.deliveryStats[channel]
    const successRate = stats.sent > 0 ? stats.delivered / stats.sent : 0.9

    // Facteur de qualité réseau
    const networkFactor = this.getNetworkQualityFactor()

    // Probabilité de succès ajustée
    const adjustedSuccessRate = Math.min(successRate * networkFactor, 0.99)

    return Math.random() < adjustedSuccessRate
  }

  /**
   * Calcule le score de fiabilité d'un canal
   */
  calculateReliabilityScore(channel) {
    const stats = this.deliveryStats[channel]

    if (stats.sent === 0) {
      return 0.9 // Score par défaut pour nouveaux canaux
    }

    const successRate = stats.delivered / stats.sent
    const latencyScore = Math.max(0, 1 - stats.avgLatency / 10000) // Pénalité latence
    const circuitBreakerPenalty = this.isCircuitBreakerOpen(channel) ? 0.5 : 1

    return successRate * latencyScore * circuitBreakerPenalty
  }

  /**
   * Gère le circuit breaker pour un canal
   */
  recordCircuitBreakerFailure(channel, error) {
    const breaker = this.circuitBreakers[channel]
    breaker.failures++
    breaker.lastFailure = Date.now()

    // Ouvrir le circuit après 5 échecs consécutifs
    if (breaker.failures >= 5) {
      breaker.isOpen = true
      console.warn(`🔴 Circuit breaker ouvert pour ${channel}`)

      // Fermer automatiquement après 5 minutes
      setTimeout(() => {
        this.resetCircuitBreaker(channel)
      }, 300000)
    }
  }

  /**
   * Remet à zéro le circuit breaker
   */
  resetCircuitBreaker(channel) {
    const breaker = this.circuitBreakers[channel]
    breaker.failures = 0
    breaker.lastFailure = null
    breaker.isOpen = false
  }

  /**
   * Vérifie si le circuit breaker est ouvert
   */
  isCircuitBreakerOpen(channel) {
    return this.circuitBreakers[channel].isOpen
  }

  /**
   * Détecte la qualité du réseau
   */
  detectNetworkQuality() {
    // Simulation de détection réseau
    if (navigator.connection) {
      const connection = navigator.connection
      const effectiveType = connection.effectiveType

      if (effectiveType === '4g' || effectiveType === '3g') {
        this.networkQuality = 'good'
      } else if (effectiveType === '2g') {
        this.networkQuality = 'fair'
      } else {
        this.networkQuality = 'poor'
      }
    }

    return this.networkQuality
  }

  /**
   * Obtient le multiplicateur selon la qualité réseau
   */
  getNetworkMultiplier() {
    const multipliers = {
      good: 1.0,
      fair: 1.5,
      poor: 2.0,
    }
    return multipliers[this.networkQuality] || 1.0
  }

  /**
   * Obtient le facteur de qualité réseau pour les calculs de succès
   */
  getNetworkQualityFactor() {
    const factors = {
      good: 1.0,
      fair: 0.8,
      poor: 0.6,
    }
    return factors[this.networkQuality] || 1.0
  }

  /**
   * Calcule le délai de retry exponentiel
   */
  calculateRetryDelay(attempt, channel) {
    const baseDelay = 1000 // 1 seconde
    const maxDelay = 300000 // 5 minutes

    // Backoff exponentiel avec jitter
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1)
    const jitter = Math.random() * 1000 // Jusqu'à 1s de jitter

    return Math.min(exponentialDelay + jitter, maxDelay)
  }

  /**
   * Obtient le nombre maximum de retries selon la priorité
   */
  getMaxRetries(priority) {
    const maxRetries = {
      CRITICAL: 5,
      HIGH: 3,
      NORMAL: 2,
      LOW: 1,
    }
    return maxRetries[priority] || 2
  }

  /**
   * Obtient la politique de retry selon la priorité
   */
  getRetryPolicy(priority) {
    return {
      maxRetries: this.getMaxRetries(priority),
      baseDelay: 1000,
      maxDelay: 300000,
      backoffMultiplier: 2,
      jitter: true,
    }
  }

  /**
   * Obtient la stratégie par défaut en cas d'erreur
   */
  getDefaultStrategy() {
    return {
      channels: ['websocket', 'push'],
      timeouts: { ...this.adaptiveTimeouts },
      retryPolicy: this.getRetryPolicy('NORMAL'),
      fallbackChain: ['websocket', 'push', 'sms', 'email'],
    }
  }

  /**
   * Obtient les statistiques de délivrabilité
   */
  getDeliveryStats() {
    const stats = {}

    Object.keys(this.deliveryStats).forEach((channel) => {
      const channelStats = this.deliveryStats[channel]
      stats[channel] = {
        ...channelStats,
        successRate: channelStats.sent > 0 ? channelStats.delivered / channelStats.sent : 0,
        failureRate: channelStats.sent > 0 ? channelStats.failed / channelStats.sent : 0,
        reliabilityScore: this.calculateReliabilityScore(channel),
        circuitBreakerOpen: this.isCircuitBreakerOpen(channel),
      }
    })

    return {
      channels: stats,
      networkQuality: this.networkQuality,
      retryQueueSize: this.retryQueue.size,
      adaptiveTimeouts: this.adaptiveTimeouts,
    }
  }

  /**
   * Optimise automatiquement les paramètres selon les performances
   */
  autoOptimize() {
    try {
      console.log('🔧 Optimisation automatique en cours...')

      // Ajuster les timeouts selon les latences observées
      Object.keys(this.deliveryStats).forEach((channel) => {
        const stats = this.deliveryStats[channel]
        if (stats.sent > 10) {
          // Minimum de données
          const optimalTimeout = Math.max(
            stats.avgLatency * 3, // 3x la latence moyenne
            this.adaptiveTimeouts[channel] * 0.5, // Minimum 50% du timeout actuel
          )
          this.adaptiveTimeouts[channel] = Math.min(optimalTimeout, 300000) // Max 5min
        }
      })

      // Détecter la qualité réseau
      this.detectNetworkQuality()

      console.log('✅ Optimisation automatique terminée')
    } catch (error) {
      console.error('❌ Erreur optimisation automatique:', error)
    }
  }
}

// Instance globale
const deliveryOptimizer = new NotificationDeliveryOptimizer()

export { deliveryOptimizer }
export default NotificationDeliveryOptimizer
