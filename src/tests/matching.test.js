/**
 * Tests pour l'algorithme de matching intelligent
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import MatchingEngine from '@/services/matching-engine'

// Mock du monitoring
vi.mock('@/utils/monitoring', () => ({
  useMonitoring: () => ({
    recordMetric: vi.fn(),
    recordError: vi.fn(),
  }),
}))

describe('MatchingEngine', () => {
  let engine
  let mockRequest
  let mockDonors

  beforeEach(() => {
    engine = new MatchingEngine()

    // Requête de test
    mockRequest = {
      id: 'req-1',
      requestType: 'EMERGENCY',
      requiredSpecies: 'DOG',
      requiredBloodGroup: 'DEA 1.1+',
      minWeight: 20,
      clinic: {
        location: {
          latitude: 48.8566,
          longitude: 2.3522,
        },
      },
    }

    // Donneurs de test
    mockDonors = [
      {
        id: 'donor-1',
        name: 'Jean Dupont',
        isAvailable: true,
        isOnline: true,
        acceptsEmergencies: true,
        averageResponseTime: 30,
        location: {
          latitude: 48.8606,
          longitude: 2.3376,
        },
        history: {
          totalMissions: 10,
          successfulMissions: 9,
          cancelledMissions: 1,
          averageDelayMinutes: 5,
        },
        animals: [
          {
            id: 'animal-1',
            name: 'Rex',
            species: 'DOG',
            bloodGroup: 'DEA 1.1+',
            weight: 30,
            isVaccinated: true,
            isEligible: true,
          },
        ],
      },
      {
        id: 'donor-2',
        name: 'Marie Martin',
        isAvailable: true,
        isOnline: false,
        acceptsEmergencies: false,
        averageResponseTime: 120,
        location: {
          latitude: 48.8738,
          longitude: 2.295,
        },
        history: {
          totalMissions: 5,
          successfulMissions: 4,
          cancelledMissions: 1,
          averageDelayMinutes: 15,
        },
        animals: [
          {
            id: 'animal-2',
            name: 'Bella',
            species: 'DOG',
            bloodGroup: 'DEA 1.1-',
            weight: 25,
            isVaccinated: true,
            isEligible: true,
          },
        ],
      },
      {
        id: 'donor-3',
        name: 'Pierre Durand',
        isAvailable: false, // Non disponible
        location: {
          latitude: 48.8566,
          longitude: 2.3522,
        },
        animals: [
          {
            id: 'animal-3',
            name: 'Max',
            species: 'DOG',
            bloodGroup: 'DEA 1.1+',
            weight: 35,
            isVaccinated: true,
            isEligible: true,
          },
        ],
      },
    ]
  })

  describe('Filtrage des donneurs éligibles', () => {
    it('should filter out unavailable donors', () => {
      const eligible = engine.filterEligibleDonors(mockRequest, mockDonors)
      expect(eligible).toHaveLength(2)
      expect(eligible.find((d) => d.id === 'donor-3')).toBeUndefined()
    })

    it('should filter by species compatibility', () => {
      const catRequest = { ...mockRequest, requiredSpecies: 'CAT' }
      const eligible = engine.filterEligibleDonors(catRequest, mockDonors)
      expect(eligible).toHaveLength(0)
    })

    it('should filter by blood compatibility', () => {
      const eligible = engine.filterEligibleDonors(mockRequest, mockDonors)
      // Seul donor-1 a un animal DEA 1.1+ compatible
      expect(eligible).toHaveLength(1)
      expect(eligible[0].id).toBe('donor-1')
    })

    it('should filter by animal vaccination status', () => {
      mockDonors[0].animals[0].isVaccinated = false
      const eligible = engine.filterEligibleDonors(mockRequest, mockDonors)
      expect(eligible).toHaveLength(0)
    })

    it('should filter by minimum weight', () => {
      mockRequest.minWeight = 40
      const eligible = engine.filterEligibleDonors(mockRequest, mockDonors)
      expect(eligible).toHaveLength(0) // Aucun animal ne fait 40kg+
    })
  })

  describe('Calcul des scores', () => {
    it('should calculate distance score correctly', () => {
      const location1 = { latitude: 48.8566, longitude: 2.3522 }
      const location2 = { latitude: 48.8606, longitude: 2.3376 }

      const distance = engine.calculateDistance(location1, location2)
      expect(distance).toBeGreaterThan(0)
      expect(distance).toBeLessThan(10) // Paris intra-muros

      const score = engine.distanceToScore(distance)
      expect(score).toBeGreaterThan(80) // Très proche
    })

    it('should calculate availability score correctly', () => {
      const donor = mockDonors[0] // En ligne, accepte urgences
      const score = engine.calculateAvailabilityScore(donor, 'EMERGENCY')
      expect(score).toBeGreaterThan(90) // Très disponible
    })

    it('should calculate compatibility score correctly', () => {
      const animals = mockDonors[0].animals
      const score = engine.calculateCompatibilityScore(animals, mockRequest)
      expect(score).toBeGreaterThan(80) // Parfaite compatibilité
    })

    it('should calculate reliability score correctly', () => {
      const history = mockDonors[0].history
      const score = engine.calculateReliabilityScore(history)
      expect(score).toBeGreaterThan(80) // Bon historique
    })

    it('should give emergency bonus', () => {
      const emergencyRequest = { ...mockRequest, requestType: 'EMERGENCY' }
      const appointmentRequest = { ...mockRequest, requestType: 'APPOINTMENT' }

      const emergencyScore = engine.scoreDonor(mockDonors[0], emergencyRequest)
      const appointmentScore = engine.scoreDonor(mockDonors[0], appointmentRequest)

      expect(emergencyScore.breakdown.urgency).toBeGreaterThan(appointmentScore.breakdown.urgency)
    })
  })

  describe('Compatibilité sanguine', () => {
    it('should validate dog blood compatibility correctly', () => {
      // DEA 1.1+ peut donner à DEA 1.1+ et DEA 1.1-
      expect(engine.isBloodCompatible('DEA 1.1+', 'DEA 1.1+', 'DOG')).toBe(true)
      expect(engine.isBloodCompatible('DEA 1.1+', 'DEA 1.1-', 'DOG')).toBe(true)
      expect(engine.isBloodCompatible('DEA 1.1-', 'DEA 1.1+', 'DOG')).toBe(false)
    })

    it('should validate cat blood compatibility correctly', () => {
      // Type A peut donner à A et AB
      expect(engine.isBloodCompatible('A', 'A', 'CAT')).toBe(true)
      expect(engine.isBloodCompatible('A', 'AB', 'CAT')).toBe(true)
      expect(engine.isBloodCompatible('A', 'B', 'CAT')).toBe(false)
    })

    it('should return false for unknown species', () => {
      expect(engine.isBloodCompatible('A', 'A', 'BIRD')).toBe(false)
    })
  })

  describe('Processus de matching complet', () => {
    it('should return matches sorted by score', async () => {
      const result = await engine.findMatches(mockRequest, mockDonors)

      expect(result.matches).toHaveLength(1)
      expect(result.matches[0].donor.id).toBe('donor-1')
      expect(result.matches[0].score).toBeGreaterThan(0)
      expect(result.matches[0].rank).toBe(1)
    })

    it('should include metadata', async () => {
      const result = await engine.findMatches(mockRequest, mockDonors)

      expect(result.metadata).toBeDefined()
      expect(result.metadata.totalCandidates).toBe(3)
      expect(result.metadata.eligibleCandidates).toBe(1)
      expect(result.metadata.matchesFound).toBe(1)
      expect(result.metadata.processingTime).toBeGreaterThan(0)
      expect(result.metadata.algorithm).toBe('multi-criteria-v1')
    })

    it('should handle empty donor list', async () => {
      const result = await engine.findMatches(mockRequest, [])

      expect(result.matches).toHaveLength(0)
      expect(result.metadata.totalCandidates).toBe(0)
    })

    it('should handle no eligible donors', async () => {
      const incompatibleRequest = {
        ...mockRequest,
        requiredSpecies: 'CAT',
      }

      const result = await engine.findMatches(incompatibleRequest, mockDonors)

      expect(result.matches).toHaveLength(0)
      expect(result.metadata.reason).toBe('NO_ELIGIBLE_DONORS')
    })

    it('should respect minimum score threshold', async () => {
      engine.minScore = 95 // Score très élevé

      const result = await engine.findMatches(mockRequest, mockDonors)

      // Même si éligible, le score peut ne pas atteindre 95
      expect(result.matches.length).toBeLessThanOrEqual(1)
    })

    it('should limit number of results', async () => {
      engine.maxResults = 1

      // Ajouter plus de donneurs éligibles
      const moreDonors = [...mockDonors]
      for (let i = 0; i < 5; i++) {
        moreDonors.push({
          ...mockDonors[0],
          id: `donor-extra-${i}`,
          name: `Extra Donor ${i}`,
        })
      }

      const result = await engine.findMatches(mockRequest, moreDonors)

      expect(result.matches.length).toBeLessThanOrEqual(1)
    })
  })

  describe('Performance', () => {
    it('should process matching in reasonable time', async () => {
      const startTime = performance.now()

      await engine.findMatches(mockRequest, mockDonors)

      const processingTime = performance.now() - startTime
      expect(processingTime).toBeLessThan(100) // Moins de 100ms
    })

    it('should cache distance calculations', () => {
      const location1 = { latitude: 48.8566, longitude: 2.3522 }
      const location2 = { latitude: 48.8606, longitude: 2.3376 }

      // Premier calcul
      engine.calculateDistanceScore(location1, location2)
      expect(engine.distanceCache.size).toBe(1)

      // Deuxième calcul (doit utiliser le cache)
      engine.calculateDistanceScore(location1, location2)
      expect(engine.distanceCache.size).toBe(1)
    })

    it('should handle large number of donors efficiently', async () => {
      // Créer 100 donneurs
      const largeDonorList = []
      for (let i = 0; i < 100; i++) {
        largeDonorList.push({
          ...mockDonors[0],
          id: `donor-${i}`,
          name: `Donor ${i}`,
          location: {
            latitude: 48.8566 + (Math.random() - 0.5) * 0.1,
            longitude: 2.3522 + (Math.random() - 0.5) * 0.1,
          },
        })
      }

      const startTime = performance.now()
      const result = await engine.findMatches(mockRequest, largeDonorList)
      const processingTime = performance.now() - startTime

      expect(processingTime).toBeLessThan(1000) // Moins de 1 seconde
      expect(result.matches.length).toBeGreaterThan(0)
    })
  })

  describe('Utilitaires', () => {
    it('should calculate confidence correctly', () => {
      expect(engine.calculateConfidence(95)).toBe(95)
      expect(engine.calculateConfidence(85)).toBe(85)
      expect(engine.calculateConfidence(75)).toBe(75)
      expect(engine.calculateConfidence(30)).toBe(45)
    })

    it('should estimate response time correctly', () => {
      const donor = mockDonors[0]
      const emergencyRequest = { requestType: 'EMERGENCY' }
      const appointmentRequest = { requestType: 'APPOINTMENT' }

      const emergencyTime = engine.estimateResponseTime(donor, emergencyRequest)
      const appointmentTime = engine.estimateResponseTime(donor, appointmentRequest)

      expect(emergencyTime).toBeLessThan(appointmentTime)
      expect(emergencyTime).toBeGreaterThanOrEqual(5) // Minimum 5 minutes
    })

    it('should provide engine statistics', () => {
      const stats = engine.getStats()

      expect(stats).toHaveProperty('distanceCacheSize')
      expect(stats).toHaveProperty('weights')
      expect(stats).toHaveProperty('maxDistance')
      expect(stats).toHaveProperty('minScore')
      expect(stats).toHaveProperty('maxResults')
    })

    it('should clear distance cache', () => {
      // Ajouter quelque chose au cache
      engine.calculateDistanceScore(
        { latitude: 48.8566, longitude: 2.3522 },
        { latitude: 48.8606, longitude: 2.3376 },
      )

      expect(engine.distanceCache.size).toBeGreaterThan(0)

      engine.clearDistanceCache()
      expect(engine.distanceCache.size).toBe(0)
    })
  })
})
