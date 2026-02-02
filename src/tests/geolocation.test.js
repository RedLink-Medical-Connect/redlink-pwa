/**
 * Tests pour le service de géolocalisation avancée
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import GeolocationService from '@/services/geolocation-service'

// Mock du monitoring
vi.mock('@/utils/monitoring', () => ({
  useMonitoring: () => ({
    recordMetric: vi.fn(),
    recordError: vi.fn(),
  }),
}))

// Mock de fetch pour les APIs externes
global.fetch = vi.fn()

describe('GeolocationService', () => {
  let service
  let mockFrom
  let mockTo

  beforeEach(() => {
    service = new GeolocationService()

    // Coordonnées de test (Paris)
    mockFrom = {
      latitude: 48.8566,
      longitude: 2.3522,
    }

    // Coordonnées de test (Versailles)
    mockTo = {
      latitude: 48.8014,
      longitude: 2.1301,
    }

    // Reset des mocks
    vi.clearAllMocks()
    service.clearCache()
  })

  describe('Validation des coordonnées', () => {
    it('should validate correct coordinates', () => {
      expect(() => service.validateCoordinates(mockFrom, mockTo)).not.toThrow()
    })

    it('should reject invalid latitude', () => {
      const invalidCoord = { latitude: 91, longitude: 2.3522 }
      expect(() => service.validateCoordinates(invalidCoord, mockTo)).toThrow(
        'Coordonnées de départ invalides',
      )
    })

    it('should reject invalid longitude', () => {
      const invalidCoord = { latitude: 48.8566, longitude: 181 }
      expect(() => service.validateCoordinates(mockFrom, invalidCoord)).toThrow(
        "Coordonnées d'arrivée invalides",
      )
    })

    it('should reject missing coordinates', () => {
      expect(() => service.validateCoordinates(null, mockTo)).toThrow(
        'Coordonnées de départ invalides',
      )
      expect(() => service.validateCoordinates(mockFrom, null)).toThrow(
        "Coordonnées d'arrivée invalides",
      )
    })
  })

  describe('Calcul de distance Haversine', () => {
    it('should calculate distance between Paris and Versailles', () => {
      const distance = service.haversineDistance(mockFrom, mockTo)

      // Distance approximative Paris-Versailles: ~17km
      expect(distance).toBeGreaterThan(15)
      expect(distance).toBeLessThan(20)
    })

    it('should return 0 for same coordinates', () => {
      const distance = service.haversineDistance(mockFrom, mockFrom)
      expect(distance).toBe(0)
    })

    it('should handle antipodal points', () => {
      const antipodal = {
        latitude: -mockFrom.latitude,
        longitude: mockFrom.longitude + 180,
      }

      const distance = service.haversineDistance(mockFrom, antipodal)

      // Distance maximale sur Terre: ~20,015km
      expect(distance).toBeGreaterThan(19000)
      expect(distance).toBeLessThan(21000)
    })
  })

  describe('Calcul de route simple (fallback)', () => {
    it('should calculate simple route with estimation', () => {
      const result = service.calculateSimpleDistance(mockFrom, mockTo)

      expect(result).toHaveProperty('distance')
      expect(result).toHaveProperty('duration')
      expect(result).toHaveProperty('apiUsed', 'haversine-fallback')
      expect(result).toHaveProperty('isEstimated', true)

      expect(result.distance).toBeGreaterThan(15)
      expect(result.distance).toBeLessThan(20)
      expect(result.duration).toBeGreaterThan(20) // ~17km * 1.5 = 25min
    })
  })

  describe('Cache de routes', () => {
    it('should generate consistent cache keys', () => {
      const key1 = service.generateRouteCacheKey(mockFrom, mockTo)
      const key2 = service.generateRouteCacheKey(mockFrom, mockTo)

      expect(key1).toBe(key2)
    })

    it('should generate different keys for different coordinates', () => {
      const key1 = service.generateRouteCacheKey(mockFrom, mockTo)
      const key2 = service.generateRouteCacheKey(mockTo, mockFrom)

      expect(key1).not.toBe(key2)
    })

    it('should cache and retrieve route data', () => {
      const key = service.generateRouteCacheKey(mockFrom, mockTo)
      const data = { distance: 17, duration: 25 }

      service.setRouteCache(key, data)
      const retrieved = service.getFromRouteCache(key)

      expect(retrieved).toEqual(data)
    })

    it('should expire cached data after timeout', () => {
      const shortTimeoutService = new GeolocationService({ cacheTimeout: 100 })
      const key = shortTimeoutService.generateRouteCacheKey(mockFrom, mockTo)
      const data = { distance: 17, duration: 25 }

      shortTimeoutService.setRouteCache(key, data)

      // Immédiatement disponible
      expect(shortTimeoutService.getFromRouteCache(key)).toEqual(data)

      // Simuler l'expiration
      setTimeout(() => {
        expect(shortTimeoutService.getFromRouteCache(key)).toBeNull()
      }, 150)
    })

    it('should limit cache size', () => {
      // Remplir le cache au-delà de la limite
      for (let i = 0; i < 1005; i++) {
        const key = `test-key-${i}`
        service.setRouteCache(key, { distance: i })
      }

      expect(service.routeCache.size).toBeLessThanOrEqual(1000)
    })
  })

  describe('APIs de routing', () => {
    it('should have correct API configuration', () => {
      expect(service.apiConfig).toHaveProperty('openrouteservice')
      expect(service.apiConfig).toHaveProperty('mapbox')
      expect(service.apiConfig).toHaveProperty('google')
      expect(service.apiConfig).toHaveProperty('osrm')

      // Vérifier la structure de configuration
      Object.values(service.apiConfig).forEach((config) => {
        expect(config).toHaveProperty('baseUrl')
        expect(config).toHaveProperty('rateLimit')
        expect(config).toHaveProperty('timeout')
      })
    })

    it('should get available APIs based on configuration', () => {
      const availableAPIs = service.getAvailableAPIs()

      // Au minimum OSRM devrait être disponible (pas de clé requise)
      expect(availableAPIs).toContain('osrm')
      expect(Array.isArray(availableAPIs)).toBe(true)
    })

    it('should update API statistics correctly', () => {
      const apiName = 'osrm'
      const initialStats = service.apiStats.get(apiName)

      // Test succès
      service.updateApiStats(apiName, true, 500)
      const successStats = service.apiStats.get(apiName)

      expect(successStats.requests).toBe(initialStats.requests + 1)
      expect(successStats.successes).toBe(initialStats.successes + 1)
      expect(successStats.avgResponseTime).toBeGreaterThan(0)

      // Test échec
      service.updateApiStats(apiName, false)
      const failureStats = service.apiStats.get(apiName)

      expect(failureStats.failures).toBe(initialStats.failures + 1)
    })
  })

  describe('Calcul de route avec OSRM (mock)', () => {
    it('should calculate route with OSRM API', async () => {
      // Mock de la réponse OSRM
      const mockResponse = {
        code: 'Ok',
        routes: [
          {
            distance: 17000, // 17km en mètres
            duration: 1500, // 25min en secondes
            geometry: {
              coordinates: [
                [2.3522, 48.8566],
                [2.1301, 48.8014],
              ],
            },
          },
        ],
      }

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const config = service.apiConfig.osrm
      const result = await service.calculateWithOSRM(mockFrom, mockTo, {}, config)

      expect(result.distance).toBe(17) // Converti en km
      expect(result.duration).toBe(25) // Converti en minutes
      expect(result.geometry).toBeDefined()
    })

    it('should handle OSRM API errors', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const config = service.apiConfig.osrm

      await expect(service.calculateWithOSRM(mockFrom, mockTo, {}, config)).rejects.toThrow(
        'OSRM error: 500',
      )
    })

    it('should handle OSRM API error codes', async () => {
      const mockErrorResponse = {
        code: 'NoRoute',
        message: 'No route found',
      }

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockErrorResponse),
      })

      const config = service.apiConfig.osrm

      await expect(service.calculateWithOSRM(mockFrom, mockTo, {}, config)).rejects.toThrow(
        'OSRM API error: NoRoute',
      )
    })
  })

  describe('Recherche de donneurs dans un rayon', () => {
    it('should find donors within radius', async () => {
      const donors = [
        {
          id: 'donor-1',
          name: 'Proche',
          location: {
            latitude: 48.857, // Très proche de Paris
            longitude: 2.353,
          },
        },
        {
          id: 'donor-2',
          name: 'Loin',
          location: {
            latitude: 49.5, // Loin de Paris
            longitude: 3.0,
          },
        },
      ]

      const results = await service.findDonorsInRadius(mockFrom, 10, donors)

      // Seul le donneur proche devrait être trouvé
      expect(results).toHaveLength(1)
      expect(results[0].donor.id).toBe('donor-1')
      expect(results[0].distance).toBeLessThan(10)
    })

    it('should sort donors by distance', async () => {
      const donors = [
        {
          id: 'donor-far',
          location: { latitude: 48.9, longitude: 2.4 },
        },
        {
          id: 'donor-near',
          location: { latitude: 48.857, longitude: 2.353 },
        },
        {
          id: 'donor-medium',
          location: { latitude: 48.88, longitude: 2.37 },
        },
      ]

      const results = await service.findDonorsInRadius(mockFrom, 50, donors)

      expect(results).toHaveLength(3)

      // Vérifier que c'est trié par distance croissante
      for (let i = 1; i < results.length; i++) {
        expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance)
      }
    })
  })

  describe('Optimisation de route', () => {
    it('should optimize route order using nearest neighbor', async () => {
      const destinations = [
        {
          id: 'dest-1',
          location: { latitude: 48.9, longitude: 2.4 },
        },
        {
          id: 'dest-2',
          location: { latitude: 48.857, longitude: 2.353 }, // Plus proche
        },
        {
          id: 'dest-3',
          location: { latitude: 48.88, longitude: 2.37 },
        },
      ]

      const optimized = await service.optimizeRoute(mockFrom, destinations)

      expect(optimized).toHaveLength(3)
      expect(optimized[0].id).toBe('dest-2') // Le plus proche en premier
    })
  })

  describe('Statistiques et utilitaires', () => {
    it('should provide service statistics', () => {
      const stats = service.getStats()

      expect(stats).toHaveProperty('routeCacheSize')
      expect(stats).toHaveProperty('geocodeCacheSize')
      expect(stats).toHaveProperty('apiStats')
      expect(stats).toHaveProperty('config')

      expect(stats.config.defaultRadius).toBe(100)
      expect(stats.config.maxRadius).toBe(200)
    })

    it('should clear all caches', () => {
      // Ajouter des données aux caches
      service.setRouteCache('test-key', { distance: 10 })

      expect(service.routeCache.size).toBeGreaterThan(0)

      service.clearCache()

      expect(service.routeCache.size).toBe(0)
      expect(service.geocodeCache.size).toBe(0)
    })
  })

  describe('Gestion des erreurs et fallback', () => {
    it('should fallback to simple calculation on API failure', async () => {
      // Mock d'échec de toutes les APIs
      fetch.mockRejectedValue(new Error('Network error'))

      const result = await service.calculateRoute(mockFrom, mockTo)

      expect(result.apiUsed).toBe('haversine-fallback')
      expect(result.isEstimated).toBe(true)
      expect(result.distance).toBeGreaterThan(0)
      expect(result.duration).toBeGreaterThan(0)
    })

    it('should handle timeout correctly', async () => {
      // Mock d'un timeout
      fetch.mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100)),
      )

      const result = await service.calculateRoute(mockFrom, mockTo)

      expect(result.apiUsed).toBe('haversine-fallback')
      expect(result.isEstimated).toBe(true)
    })
  })
})
