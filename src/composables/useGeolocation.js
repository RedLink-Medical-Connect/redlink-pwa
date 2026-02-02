/**
 * Composable pour la géolocalisation avancée
 * Interface Vue.js pour le service de géolocalisation
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { geolocationService } from '@/services/geolocation-service'
import { useMonitoring } from '@/utils/monitoring'

export function useGeolocation() {
  const monitoring = useMonitoring()

  // États
  const currentPosition = ref(null)
  const isLocating = ref(false)
  const locationError = ref(null)
  const watchId = ref(null)
  const locationPermission = ref('prompt') // 'granted', 'denied', 'prompt'

  // Configuration
  const locationOptions = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 60000, // 1 minute
  }

  /**
   * Obtient la position actuelle de l'utilisateur
   */
  const getCurrentPosition = async (options = {}) => {
    isLocating.value = true
    locationError.value = null

    try {
      // Vérifier le support de la géolocalisation
      if (!navigator.geolocation) {
        throw new Error('Géolocalisation non supportée par ce navigateur')
      }

      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          ...locationOptions,
          ...options,
        })
      })

      currentPosition.value = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      }

      locationPermission.value = 'granted'

      monitoring.recordMetric('Geolocation.PositionObtained', 1, 'Count', {
        Accuracy: position.coords.accuracy,
      })

      console.log('📍 Position obtenue:', currentPosition.value)
      return currentPosition.value
    } catch (error) {
      locationError.value = error

      // Gérer les différents types d'erreurs
      switch (error.code) {
        case error.PERMISSION_DENIED:
          locationPermission.value = 'denied'
          locationError.value = new Error('Permission de géolocalisation refusée')
          break
        case error.POSITION_UNAVAILABLE:
          locationError.value = new Error('Position indisponible')
          break
        case error.TIMEOUT:
          locationError.value = new Error('Timeout de géolocalisation')
          break
        default:
          locationError.value = new Error('Erreur de géolocalisation inconnue')
      }

      monitoring.recordError(locationError.value, {
        context: 'geolocation',
        errorCode: error.code,
      })

      throw locationError.value
    } finally {
      isLocating.value = false
    }
  }

  /**
   * Démarre le suivi de position en temps réel
   */
  const startWatching = (options = {}) => {
    if (!navigator.geolocation) {
      locationError.value = new Error('Géolocalisation non supportée')
      return
    }

    if (watchId.value) {
      stopWatching()
    }

    watchId.value = navigator.geolocation.watchPosition(
      (position) => {
        currentPosition.value = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        }
        locationError.value = null

        monitoring.recordMetric('Geolocation.PositionUpdated', 1, 'Count')
      },
      (error) => {
        locationError.value = error
        monitoring.recordError(error, { context: 'geolocation-watch' })
      },
      { ...locationOptions, ...options },
    )

    console.log('👁️ Suivi de position démarré')
  }

  /**
   * Arrête le suivi de position
   */
  const stopWatching = () => {
    if (watchId.value) {
      navigator.geolocation.clearWatch(watchId.value)
      watchId.value = null
      console.log('⏹️ Suivi de position arrêté')
    }
  }

  /**
   * Calcule la route vers une destination
   */
  const calculateRoute = async (destination, options = {}) => {
    if (!currentPosition.value) {
      throw new Error('Position actuelle non disponible')
    }

    try {
      const route = await geolocationService.calculateRoute(
        currentPosition.value,
        destination,
        options,
      )

      monitoring.recordMetric('Geolocation.RouteCalculated', 1, 'Count', {
        Distance: route.distance,
        Duration: route.duration,
      })

      return route
    } catch (error) {
      monitoring.recordError(error, {
        context: 'route-calculation',
        destination,
      })
      throw error
    }
  }

  /**
   * Trouve les donneurs dans un rayon
   */
  const findNearbyDonors = async (donors, radius = 50) => {
    if (!currentPosition.value) {
      throw new Error('Position actuelle non disponible')
    }

    try {
      const nearbyDonors = await geolocationService.findDonorsInRadius(
        currentPosition.value,
        radius,
        donors,
      )

      monitoring.recordMetric('Geolocation.NearbyDonorsFound', nearbyDonors.length, 'Count', {
        Radius: radius,
        TotalDonors: donors.length,
      })

      return nearbyDonors
    } catch (error) {
      monitoring.recordError(error, {
        context: 'nearby-donors',
        radius,
        donorsCount: donors.length,
      })
      throw error
    }
  }

  /**
   * Calcule la distance entre deux points
   */
  const calculateDistance = (point1, point2) => {
    return geolocationService.haversineDistance(point1, point2)
  }

  /**
   * Demande la permission de géolocalisation
   */
  const requestPermission = async () => {
    try {
      if ('permissions' in navigator) {
        const permission = await navigator.permissions.query({ name: 'geolocation' })
        locationPermission.value = permission.state

        permission.addEventListener('change', () => {
          locationPermission.value = permission.state
        })
      }

      // Tenter d'obtenir la position pour déclencher la demande de permission
      await getCurrentPosition()
    } catch (error) {
      console.warn('Erreur demande permission géolocalisation:', error)
    }
  }

  /**
   * Formate une distance pour l'affichage
   */
  const formatDistance = (distance) => {
    if (distance < 1) {
      return `${Math.round(distance * 1000)}m`
    }
    return `${distance.toFixed(1)}km`
  }

  /**
   * Formate une durée pour l'affichage
   */
  const formatDuration = (minutes) => {
    if (minutes < 60) {
      return `${minutes}min`
    }
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    return `${hours}h${remainingMinutes > 0 ? remainingMinutes.toString().padStart(2, '0') : ''}`
  }

  /**
   * Génère une URL Google Maps pour navigation
   */
  const getNavigationUrl = (destination, mode = 'driving') => {
    if (!currentPosition.value) return null

    const { latitude: fromLat, longitude: fromLng } = currentPosition.value
    const { latitude: toLat, longitude: toLng } = destination

    return `https://www.google.com/maps/dir/${fromLat},${fromLng}/${toLat},${toLng}/@${fromLat},${fromLng},15z/data=!3m1!4b1!4m2!4m1!3e${mode === 'driving' ? '0' : '2'}`
  }

  /**
   * Vérifie si une position est dans un rayon donné
   */
  const isWithinRadius = (position, center, radius) => {
    const distance = calculateDistance(position, center)
    return distance <= radius
  }

  // Propriétés calculées
  const hasPosition = computed(() => currentPosition.value !== null)
  const hasPermission = computed(() => locationPermission.value === 'granted')
  const isWatching = computed(() => watchId.value !== null)
  const accuracy = computed(() => currentPosition.value?.accuracy || null)

  // Formatage de la position actuelle
  const formattedPosition = computed(() => {
    if (!currentPosition.value) return null

    return {
      ...currentPosition.value,
      formattedCoords: `${currentPosition.value.latitude.toFixed(6)}, ${currentPosition.value.longitude.toFixed(6)}`,
      formattedAccuracy: accuracy.value ? `±${Math.round(accuracy.value)}m` : 'Inconnue',
    }
  })

  // Nettoyage automatique
  onUnmounted(() => {
    stopWatching()
  })

  return {
    // États
    currentPosition,
    isLocating,
    locationError,
    locationPermission,

    // Propriétés calculées
    hasPosition,
    hasPermission,
    isWatching,
    accuracy,
    formattedPosition,

    // Actions
    getCurrentPosition,
    startWatching,
    stopWatching,
    calculateRoute,
    findNearbyDonors,
    calculateDistance,
    requestPermission,

    // Utilitaires
    formatDistance,
    formatDuration,
    getNavigationUrl,
    isWithinRadius,

    // Service direct (pour cas avancés)
    geolocationService,
  }
}

/**
 * Composable spécialisé pour le matching géographique
 */
export function useGeoMatching() {
  const {
    currentPosition,
    calculateRoute,
    findNearbyDonors,
    calculateDistance,
    formatDistance,
    formatDuration,
  } = useGeolocation()

  const isCalculating = ref(false)
  const routeResults = ref([])

  /**
   * Enrichit les résultats de matching avec des données géographiques
   */
  const enrichMatchesWithGeo = async (matches, clinicLocation) => {
    if (!currentPosition.value) {
      console.warn('Position non disponible pour enrichissement géographique')
      return matches
    }

    isCalculating.value = true

    try {
      const enrichedMatches = await Promise.all(
        matches.map(async (match) => {
          try {
            // Calculer la route du donneur vers la clinique
            const route = await calculateRoute(clinicLocation, {
              latitude: match.donor.location.latitude,
              longitude: match.donor.location.longitude,
            })

            return {
              ...match,
              geoData: {
                distance: route.distance,
                duration: route.duration,
                route: route.geometry,
                formattedDistance: formatDistance(route.distance),
                formattedDuration: formatDuration(route.duration),
                isEstimated: route.isEstimated || false,
              },
            }
          } catch (error) {
            // Fallback sur distance simple
            const distance = calculateDistance(clinicLocation, match.donor.location)

            return {
              ...match,
              geoData: {
                distance,
                duration: Math.round(distance * 1.5),
                route: null,
                formattedDistance: formatDistance(distance),
                formattedDuration: formatDuration(Math.round(distance * 1.5)),
                isEstimated: true,
              },
            }
          }
        }),
      )

      // Trier par distance réelle
      return enrichedMatches.sort((a, b) => a.geoData.distance - b.geoData.distance)
    } finally {
      isCalculating.value = false
    }
  }

  /**
   * Calcule les zones de couverture optimales
   */
  const calculateCoverageZones = (clinicLocation, maxRadius = 100) => {
    const zones = []
    const radiusSteps = [10, 25, 50, maxRadius]

    radiusSteps.forEach((radius, index) => {
      zones.push({
        id: `zone-${index}`,
        radius,
        priority: radiusSteps.length - index,
        color: getZoneColor(index),
        label: `Zone ${index + 1} (${radius}km)`,
      })
    })

    return zones
  }

  const getZoneColor = (index) => {
    const colors = ['#22c55e', '#eab308', '#f97316', '#ef4444'] // vert, jaune, orange, rouge
    return colors[index] || '#6b7280'
  }

  return {
    // États
    isCalculating,
    routeResults,

    // Actions
    enrichMatchesWithGeo,
    calculateCoverageZones,

    // Réexporter les utilitaires géo
    formatDistance,
    formatDuration,
    calculateDistance,
  }
}
