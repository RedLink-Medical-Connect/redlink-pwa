/**
 * Système de monitoring et métriques pour RedLink
 * Collecte et envoie les métriques de performance vers CloudWatch
 */

class PerformanceMonitor {
  constructor(options = {}) {
    this.metrics = new Map()
    this.isEnabled = options.enabled !== false
    this.batchSize = options.batchSize || 10
    this.flushInterval = options.flushInterval || 30000 // 30 secondes
    this.endpoint = options.endpoint || null

    // Buffer pour les métriques
    this.buffer = []

    // Démarrer le flush automatique
    if (this.isEnabled) {
      this.startAutoFlush()
    }

    // Métriques système
    this.systemMetrics = {
      startTime: Date.now(),
      pageLoads: 0,
      errors: 0,
      apiCalls: 0,
      cacheHits: 0,
      cacheMisses: 0,
    }
  }

  /**
   * Enregistre une métrique de performance
   */
  recordMetric(name, value, unit = 'Count', dimensions = {}) {
    if (!this.isEnabled) return

    const metric = {
      name,
      value,
      unit,
      dimensions: {
        Environment: process.env.NODE_ENV || 'development',
        Version: process.env.VITE_APP_VERSION || '1.0.0',
        ...dimensions,
      },
      timestamp: Date.now(),
    }

    this.buffer.push(metric)

    // Flush si le buffer est plein
    if (this.buffer.length >= this.batchSize) {
      this.flush()
    }

    console.log(`📊 Métrique: ${name} = ${value} ${unit}`, dimensions)
  }

  /**
   * Enregistre le temps d'exécution d'une fonction
   */
  async measureTime(name, fn, dimensions = {}) {
    const startTime = performance.now()

    try {
      const result = await fn()
      const duration = performance.now() - startTime

      this.recordMetric(`${name}.Duration`, duration, 'Milliseconds', dimensions)
      this.recordMetric(`${name}.Success`, 1, 'Count', dimensions)

      return result
    } catch (error) {
      const duration = performance.now() - startTime

      this.recordMetric(`${name}.Duration`, duration, 'Milliseconds', dimensions)
      this.recordMetric(`${name}.Error`, 1, 'Count', {
        ...dimensions,
        ErrorType: error.constructor.name,
        ErrorMessage: error.message,
      })

      throw error
    }
  }

  /**
   * Enregistre une erreur
   */
  recordError(error, context = {}) {
    this.systemMetrics.errors++

    this.recordMetric('Application.Error', 1, 'Count', {
      ErrorType: error.constructor.name,
      ErrorMessage: error.message,
      Context: JSON.stringify(context),
    })

    // Envoyer immédiatement les erreurs critiques
    if (error.severity === 'critical') {
      this.flush()
    }
  }

  /**
   * Enregistre les métriques de cache
   */
  recordCacheMetrics(stats) {
    if (!stats) return

    this.recordMetric('Cache.HitRatio', stats.hitRatio, 'Percent')
    this.recordMetric('Cache.Size', stats.totalEntries, 'Count')
    this.recordMetric('Cache.SizeBytes', stats.totalSizeBytes, 'Bytes')
    this.recordMetric('Cache.ValidEntries', stats.validEntries, 'Count')
    this.recordMetric('Cache.ExpiredEntries', stats.expiredEntries, 'Count')
  }

  /**
   * Enregistre les métriques de rate limiting
   */
  recordRateLimitMetrics(stats) {
    if (!stats) return

    this.recordMetric('RateLimit.ActiveKeys', stats.totalKeys, 'Count')
    this.recordMetric('RateLimit.ActiveRequests', stats.activeRequests, 'Count')
  }

  /**
   * Enregistre les métriques de pagination
   */
  recordPaginationMetrics(pageSize, loadTime, fromCache = false) {
    this.recordMetric('Pagination.PageSize', pageSize, 'Count')
    this.recordMetric('Pagination.LoadTime', loadTime, 'Milliseconds')
    this.recordMetric('Pagination.CacheHit', fromCache ? 1 : 0, 'Count')

    if (fromCache) {
      this.systemMetrics.cacheHits++
    } else {
      this.systemMetrics.cacheMisses++
      this.systemMetrics.apiCalls++
    }
  }

  /**
   * Enregistre les métriques de mission
   */
  recordMissionMetrics(action, missionType, duration = null) {
    this.recordMetric('Mission.Action', 1, 'Count', {
      Action: action, // 'accept', 'view', 'refresh'
      MissionType: missionType, // 'EMERGENCY', 'APPOINTMENT'
    })

    if (duration !== null) {
      this.recordMetric('Mission.ActionDuration', duration, 'Milliseconds', {
        Action: action,
        MissionType: missionType,
      })
    }
  }

  /**
   * Enregistre les métriques de navigation
   */
  recordNavigationMetrics(route, loadTime) {
    this.systemMetrics.pageLoads++

    this.recordMetric('Navigation.PageLoad', 1, 'Count', {
      Route: route,
    })

    this.recordMetric('Navigation.LoadTime', loadTime, 'Milliseconds', {
      Route: route,
    })
  }

  /**
   * Enregistre les Core Web Vitals
   */
  recordWebVitals() {
    if (typeof window === 'undefined') return

    // Largest Contentful Paint (LCP)
    new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const lastEntry = entries[entries.length - 1]
      this.recordMetric('WebVitals.LCP', lastEntry.startTime, 'Milliseconds')
    }).observe({ entryTypes: ['largest-contentful-paint'] })

    // First Input Delay (FID)
    new PerformanceObserver((list) => {
      const entries = list.getEntries()
      entries.forEach((entry) => {
        this.recordMetric('WebVitals.FID', entry.processingStart - entry.startTime, 'Milliseconds')
      })
    }).observe({ entryTypes: ['first-input'] })

    // Cumulative Layout Shift (CLS)
    let clsValue = 0
    new PerformanceObserver((list) => {
      const entries = list.getEntries()
      entries.forEach((entry) => {
        if (!entry.hadRecentInput) {
          clsValue += entry.value
        }
      })
      this.recordMetric('WebVitals.CLS', clsValue, 'Count')
    }).observe({ entryTypes: ['layout-shift'] })
  }

  /**
   * Obtient les métriques système actuelles
   */
  getSystemMetrics() {
    const uptime = Date.now() - this.systemMetrics.startTime
    const cacheHitRatio =
      this.systemMetrics.cacheHits + this.systemMetrics.cacheMisses > 0
        ? (this.systemMetrics.cacheHits /
            (this.systemMetrics.cacheHits + this.systemMetrics.cacheMisses)) *
          100
        : 0

    return {
      ...this.systemMetrics,
      uptime,
      cacheHitRatio,
      errorRate:
        this.systemMetrics.pageLoads > 0
          ? (this.systemMetrics.errors / this.systemMetrics.pageLoads) * 100
          : 0,
    }
  }

  /**
   * Flush les métriques vers le backend
   */
  async flush() {
    if (this.buffer.length === 0) return

    const metricsToSend = [...this.buffer]
    this.buffer = []

    try {
      if (this.endpoint) {
        // Envoyer vers un endpoint personnalisé
        await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            metrics: metricsToSend,
            timestamp: Date.now(),
          }),
        })
      } else {
        // Log local pour le développement
        console.log('📊 Métriques à envoyer:', metricsToSend.length)
        metricsToSend.forEach((metric) => {
          console.log(`  ${metric.name}: ${metric.value} ${metric.unit}`)
        })
      }
    } catch (error) {
      console.error('Erreur envoi métriques:', error)
      // Remettre les métriques dans le buffer en cas d'erreur
      this.buffer.unshift(...metricsToSend)
    }
  }

  /**
   * Démarre le flush automatique
   */
  startAutoFlush() {
    this.flushTimer = setInterval(() => {
      this.flush()
    }, this.flushInterval)
  }

  /**
   * Arrête le monitoring
   */
  stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
    }
    this.flush() // Flush final
  }

  /**
   * Crée un wrapper pour instrumenter automatiquement les fonctions
   */
  instrument(name, fn, dimensions = {}) {
    return async (...args) => {
      return await this.measureTime(name, () => fn(...args), dimensions)
    }
  }
}

// Instance globale
const monitor = new PerformanceMonitor({
  enabled: process.env.NODE_ENV === 'production',
  endpoint: process.env.VITE_METRICS_ENDPOINT,
})

// Enregistrer les Web Vitals au démarrage
if (typeof window !== 'undefined') {
  monitor.recordWebVitals()

  // Métriques de navigation
  window.addEventListener('load', () => {
    const loadTime = performance.timing.loadEventEnd - performance.timing.navigationStart
    monitor.recordNavigationMetrics(window.location.pathname, loadTime)
  })
}

// Wrapper pour les composables
export function useMonitoring() {
  return {
    recordMetric: monitor.recordMetric.bind(monitor),
    recordError: monitor.recordError.bind(monitor),
    recordCacheMetrics: monitor.recordCacheMetrics.bind(monitor),
    recordRateLimitMetrics: monitor.recordRateLimitMetrics.bind(monitor),
    recordPaginationMetrics: monitor.recordPaginationMetrics.bind(monitor),
    recordMissionMetrics: monitor.recordMissionMetrics.bind(monitor),
    recordNavigationMetrics: monitor.recordNavigationMetrics.bind(monitor),
    measureTime: monitor.measureTime.bind(monitor),
    getSystemMetrics: monitor.getSystemMetrics.bind(monitor),
    instrument: monitor.instrument.bind(monitor),
  }
}

export { monitor }
export default PerformanceMonitor
