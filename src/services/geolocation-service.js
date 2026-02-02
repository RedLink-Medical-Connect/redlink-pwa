/**
 * Service de géolocalisation avancée pour RedLink
 * Calculs de distance, temps de trajet et optimisation géographique
 */

import { useMonitoring } from '@/utils/monitoring'

class GeolocationService {
  constructor(options = {}) {
    this.monitoring = useMonitoring()

    // Configuration
    this.defaultRadius = options.defaultRadius || 100 // km
    this.maxRadius = options.maxRadius || 200 // km
    this.cacheTimeout = options.cacheTimeout || 30 * 60 * 1000 // 30 minutes

    // Cache pour optimiser les performances
    this.routeCache = new Map()
    this.geocodeCache = new Map()

    // APIs disponibles (par ordre de préférence)
    this.routingAPIs = [
      'openrouteservice', // Gratuit, fiable
      'mapbox', // Payant mais précis
      'google', // Payant, très précis
      'osrm', // Gratuit, open source
    ]

    // Configuration des APIs
    this.apiConfig = {
      openrouteservice: {
        baseUrl: 'https://api.openrouteservice.org/v2',
        key: process.env.VITE_OPENROUTE_API_KEY,
        rateLimit: 40, // requêtes par minute
        timeout: 5000,
      },
      mapbox: {
        baseUrl: 'https://api.mapbox.com',
        key: process.env.VITE_MAPBOX_API_KEY,
        rateLimit: 600,
        timeout: 3000,
      },
      google: {
        baseUrl: 'https://maps.googleapis.com/maps/api',
        key: process.env.VITE_GOOGLE_MAPS_API_KEY,
        rateLimit: 1000,
        timeout: 3000,
      },
      osrm: {
        baseUrl: 'https://router.project-osrm.org',
        key: null, // Pas de clé nécessaire
        rateLimit: 100,
        timeout: 8000,
      },
    }

    // Statistiques d'utilisation des APIs
    this.apiStats = new Map()
    this.initializeApiStats()
  }

  /**
   * Initialise les statistiques des APIs
   */
  initializeApiStats() {
    this.routingAPIs.forEach((api) => {
      this.apiStats.set(api, {
        requests: 0,
        successes: 0,
        failures: 0,
        avgResponseTime: 0,
        lastUsed: null,
        isAvailable: true,
      })
    })
  }

  /**
   * Calcule la distance et le temps de trajet entre deux points
   */
  async calculateRoute(from, to, options = {}) {
    const startTime = performance.now()

    try {
      // Validation des coordonnées
      this.validateCoordinates(from, to)

      // Générer la clé de cache
      const cacheKey = this.generateRouteCacheKey(from, to, options)

      // Vérifier le cache
      const cached = this.getFromRouteCache(cacheKey)
      if (cached) {
        console.log('🎯 Route servie depuis le cache')
        return cached
      }

      // Calculer la route avec l'API la plus appropriée
      const result = await this.calculateRouteWithFallback(from, to, options)

      // Mettre en cache
      this.setRouteCache(cacheKey, result)

      // Enregistrer les métriques
      const processingTime = performance.now() - startTime
      this.monitoring.recordMetric('Geolocation.RouteCalculation', processingTime, 'Milliseconds', {
        API: result.apiUsed,
        CacheHit: false,
      })

      console.log(`🗺️ Route calculée en ${processingTime.toFixed(2)}ms via ${result.apiUsed}`)
      return result
    } catch (error) {
      this.monitoring.recordError(error, {
        context: 'geolocation-route',
        from,
        to,
      })

      // Fallback sur calcul de distance simple
      console.warn('Erreur calcul route, fallback sur distance:', error.message)
      return this.calculateSimpleDistance(from, to)
    }
  }

  /**
   * Calcule une route avec système de fallback
   */
  async calculateRouteWithFallback(from, to, options) {
    const availableAPIs = this.getAvailableAPIs()

    for (const apiName of availableAPIs) {
      try {
        const result = await this.calculateRouteWithAPI(apiName, from, to, options)
        this.updateApiStats(apiName, true, result.responseTime)
        return { ...result, apiUsed: apiName }
      } catch (error) {
        console.warn(`API ${apiName} échouée:`, error.message)
        this.updateApiStats(apiName, false)

        // Marquer l'API comme indisponible temporairement si trop d'échecs
        const stats = this.apiStats.get(apiName)
        if (stats.failures > 3 && stats.successes === 0) {
          stats.isAvailable = false
          setTimeout(
            () => {
              stats.isAvailable = true
              stats.failures = 0
            },
            5 * 60 * 1000,
          ) // 5 minutes
        }
      }
    }

    throw new Error('Toutes les APIs de routing ont échoué')
  }

  /**
   * Calcule une route avec une API spécifique
   */
  async calculateRouteWithAPI(apiName, from, to, options) {
    const config = this.apiConfig[apiName]
    const startTime = performance.now()

    switch (apiName) {
      case 'openrouteservice':
        return await this.calculateWithOpenRouteService(from, to, options, config)
      case 'mapbox':
        return await this.calculateWithMapbox(from, to, options, config)
      case 'google':
        return await this.calculateWithGoogle(from, to, options, config)
      case 'osrm':
        return await this.calculateWithOSRM(from, to, options, config)
      default:
        throw new Error(`API ${apiName} non supportée`)
    }
  }

  /**
   * Calcul avec OpenRouteService (gratuit, fiable)
   */
  async calculateWithOpenRouteService(from, to, options, config) {
    if (!config.key) {
      throw new Error('Clé API OpenRouteService manquante')
    }

    const profile = options.profile || 'driving-car'
    const url = `${config.baseUrl}/directions/${profile}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: config.key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        coordinates: [
          [from.longitude, from.latitude],
          [to.longitude, to.latitude],
        ],
        format: 'json',
        instructions: false,
        geometry: true,
      }),
      signal: AbortSignal.timeout(config.timeout),
    })

    if (!response.ok) {
      throw new Error(`OpenRouteService error: ${response.status}`)
    }

    const data = await response.json()
    const route = data.routes[0]

    return {
      distance: Math.round((route.summary.distance / 1000) * 100) / 100, // km avec 2 décimales
      duration: Math.round(route.summary.duration / 60), // minutes
      geometry: route.geometry,
      responseTime: performance.now() - Date.now(),
    }
  }

  /**
   * Calcul avec Mapbox (payant, précis)
   */
  async calculateWithMapbox(from, to, options, config) {
    if (!config.key) {
      throw new Error('Clé API Mapbox manquante')
    }

    const profile = options.profile || 'driving'
    const coordinates = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`
    const url = `${config.baseUrl}/directions/v5/mapbox/${profile}/${coordinates}?access_token=${config.key}&geometries=geojson`

    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.timeout),
    })

    if (!response.ok) {
      throw new Error(`Mapbox error: ${response.status}`)
    }

    const data = await response.json()
    const route = data.routes[0]

    return {
      distance: Math.round((route.distance / 1000) * 100) / 100,
      duration: Math.round(route.duration / 60),
      geometry: route.geometry,
      responseTime: performance.now() - Date.now(),
    }
  }

  /**
   * Calcul avec Google Maps (payant, très précis)
   */
  async calculateWithGoogle(from, to, options, config) {
    if (!config.key) {
      throw new Error('Clé API Google Maps manquante')
    }

    const mode = options.mode || 'driving'
    const url = `${config.baseUrl}/directions/json?origin=${from.latitude},${from.longitude}&destination=${to.latitude},${to.longitude}&mode=${mode}&key=${config.key}`

    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.timeout),
    })

    if (!response.ok) {
      throw new Error(`Google Maps error: ${response.status}`)
    }

    const data = await response.json()

    if (data.status !== 'OK') {
      throw new Error(`Google Maps API error: ${data.status}`)
    }

    const route = data.routes[0].legs[0]

    return {
      distance: Math.round((route.distance.value / 1000) * 100) / 100,
      duration: Math.round(route.duration.value / 60),
      geometry: data.routes[0].overview_polyline.points,
      responseTime: performance.now() - Date.now(),
    }
  }

  /**
   * Calcul avec OSRM (gratuit, open source)
   */
  async calculateWithOSRM(from, to, options, config) {
    const coordinates = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`
    const url = `${config.baseUrl}/route/v1/driving/${coordinates}?overview=full&geometries=geojson`

    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.timeout),
    })

    if (!response.ok) {
      throw new Error(`OSRM error: ${response.status}`)
    }

    const data = await response.json()

    if (data.code !== 'Ok') {
      throw new Error(`OSRM API error: ${data.code}`)
    }

    const route = data.routes[0]

    return {
      distance: Math.round((route.distance / 1000) * 100) / 100,
      duration: Math.round(route.duration / 60),
      geometry: route.geometry,
      responseTime: performance.now() - Date.now(),
    }
  }

  /**
   * Calcul de distance simple (fallback)
   */
  calculateSimpleDistance(from, to) {
    const distance = this.haversineDistance(from, to)
    const estimatedDuration = Math.round(distance * 1.5) // Estimation 40km/h moyenne

    return {
      distance: Math.round(distance * 100) / 100,
      duration: estimatedDuration,
      geometry: null,
      apiUsed: 'haversine-fallback',
      isEstimated: true,
    }
  }

  /**
   * Formule de Haversine pour calcul de distance
   */
  haversineDistance(point1, point2) {
    const R = 6371 // Rayon de la Terre en km
    const dLat = this.toRad(point2.latitude - point1.latitude)
    const dLon = this.toRad(point2.longitude - point1.longitude)

    const lat1 = this.toRad(point1.latitude)
    const lat2 = this.toRad(point2.latitude)

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c
  }

  toRad(degrees) {
    return degrees * (Math.PI / 180)
  }

  /**
   * Trouve les donneurs dans un rayon donné
   */
  async findDonorsInRadius(centerPoint, radius = this.defaultRadius, donors = []) {
    const results = []

    for (const donor of donors) {
      if (!donor.location) continue

      try {
        const route = await this.calculateRoute(centerPoint, donor.location)

        if (route.distance <= radius) {
          results.push({
            donor,
            distance: route.distance,
            duration: route.duration,
            route: route.geometry,
          })
        }
      } catch (error) {
        // Fallback sur distance simple si erreur
        const distance = this.haversineDistance(centerPoint, donor.location)
        if (distance <= radius) {
          results.push({
            donor,
            distance: Math.round(distance * 100) / 100,
            duration: Math.round(distance * 1.5),
            route: null,
            isEstimated: true,
          })
        }
      }
    }

    // Trier par distance
    return results.sort((a, b) => a.distance - b.distance)
  }

  /**
   * Optimise l'ordre de visite de plusieurs points
   */
  async optimizeRoute(startPoint, destinations, options = {}) {
    // Algorithme simple du plus proche voisin
    // TODO: Implémenter TSP (Traveling Salesman Problem) pour optimisation avancée

    const unvisited = [...destinations]
    const optimizedRoute = []
    let currentPoint = startPoint

    while (unvisited.length > 0) {
      let nearestIndex = 0
      let shortestDistance = Infinity

      for (let i = 0; i < unvisited.length; i++) {
        const distance = this.haversineDistance(currentPoint, unvisited[i].location)
        if (distance < shortestDistance) {
          shortestDistance = distance
          nearestIndex = i
        }
      }

      const nearest = unvisited.splice(nearestIndex, 1)[0]
      optimizedRoute.push(nearest)
      currentPoint = nearest.location
    }

    return optimizedRoute
  }

  /**
   * Gestion du cache de routes
   */
  generateRouteCacheKey(from, to, options = {}) {
    const fromKey = `${from.latitude.toFixed(4)},${from.longitude.toFixed(4)}`
    const toKey = `${to.latitude.toFixed(4)},${to.longitude.toFixed(4)}`
    const optionsKey = JSON.stringify(options)
    return `${fromKey}-${toKey}-${optionsKey}`
  }

  getFromRouteCache(key) {
    const cached = this.routeCache.get(key)
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data
    }
    this.routeCache.delete(key)
    return null
  }

  setRouteCache(key, data) {
    // Limiter la taille du cache
    if (this.routeCache.size > 1000) {
      const oldestKey = this.routeCache.keys().next().value
      this.routeCache.delete(oldestKey)
    }

    this.routeCache.set(key, {
      data,
      timestamp: Date.now(),
    })
  }

  /**
   * Utilitaires
   */
  validateCoordinates(from, to) {
    const isValidCoord = (coord) =>
      coord &&
      typeof coord.latitude === 'number' &&
      typeof coord.longitude === 'number' &&
      coord.latitude >= -90 &&
      coord.latitude <= 90 &&
      coord.longitude >= -180 &&
      coord.longitude <= 180

    if (!isValidCoord(from)) {
      throw new Error('Coordonnées de départ invalides')
    }
    if (!isValidCoord(to)) {
      throw new Error("Coordonnées d'arrivée invalides")
    }
  }

  getAvailableAPIs() {
    return this.routingAPIs.filter((api) => {
      const stats = this.apiStats.get(api)
      return stats.isAvailable && this.apiConfig[api].key !== undefined
    })
  }

  updateApiStats(apiName, success, responseTime = 0) {
    const stats = this.apiStats.get(apiName)
    stats.requests++
    stats.lastUsed = Date.now()

    if (success) {
      stats.successes++
      stats.avgResponseTime = (stats.avgResponseTime + responseTime) / 2
    } else {
      stats.failures++
    }
  }

  /**
   * Obtient les statistiques du service
   */
  getStats() {
    return {
      routeCacheSize: this.routeCache.size,
      geocodeCacheSize: this.geocodeCache.size,
      apiStats: Object.fromEntries(this.apiStats),
      config: {
        defaultRadius: this.defaultRadius,
        maxRadius: this.maxRadius,
        cacheTimeout: this.cacheTimeout,
      },
    }
  }

  /**
   * Nettoie les caches
   */
  clearCache() {
    this.routeCache.clear()
    this.geocodeCache.clear()
  }
}

// Instance globale
const geolocationService = new GeolocationService()

export { geolocationService }
export default GeolocationService
