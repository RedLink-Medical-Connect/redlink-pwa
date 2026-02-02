/**
 * Tests pour le service d'analytics et machine learning
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import AnalyticsService from '@/services/analytics-service'

// Mock du monitoring pour éviter les dépendances
vi.mock('@/utils/monitoring', () => ({
  useMonitoring: () => ({
    recordMetric: vi.fn(),
    recordError: vi.fn(),
  }),
}))

describe('AnalyticsService', () => {
  let analyticsService

  beforeEach(() => {
    analyticsService = new AnalyticsService({
      learningRate: 0.1,
      minSampleSize: 10, // Réduire pour les tests
      maxHistorySize: 100,
      confidenceThreshold: 0.7,
    })
  })

  describe('Enregistrement des missions', () => {
    it('devrait enregistrer une mission avec succès', () => {
      const missionData = {
        id: 'mission-1',
        matchScore: 85.5,
        scoreBreakdown: {
          distance: 90,
          availability: 80,
          compatibility: 85,
          reliability: 75,
          urgency: 10,
        },
        success: true,
        responseTime: 15,
        completionTime: 45,
        requestType: 'EMERGENCY',
        distance: 12.5,
        createdAt: new Date().toISOString(),
      }

      analyticsService.recordMissionOutcome(missionData)

      expect(analyticsService.missionHistory).toHaveLength(1)
      expect(analyticsService.missionHistory[0].success).toBe(true)
      expect(analyticsService.missionHistory[0].context.urgencyType).toBe('EMERGENCY')
    })

    it("devrait limiter la taille de l'historique", () => {
      const maxSize = analyticsService.maxHistorySize

      // Ajouter plus de missions que la limite
      for (let i = 0; i < maxSize + 10; i++) {
        analyticsService.recordMissionOutcome({
          id: `mission-${i}`,
          matchScore: 80,
          scoreBreakdown: {
            distance: 80,
            availability: 80,
            compatibility: 80,
            reliability: 80,
            urgency: 0,
          },
          success: i % 2 === 0,
          responseTime: 20,
          completionTime: 60,
          requestType: 'APPOINTMENT',
          distance: 15,
          createdAt: new Date().toISOString(),
        })
      }

      expect(analyticsService.missionHistory).toHaveLength(maxSize)
    })
  })

  describe('Analyse des patterns', () => {
    beforeEach(() => {
      // Ajouter des données de test
      const testMissions = [
        {
          id: 'mission-1',
          matchScore: 90,
          scoreBreakdown: {
            distance: 95,
            availability: 85,
            compatibility: 90,
            reliability: 80,
            urgency: 15,
          },
          success: true,
          responseTime: 10,
          completionTime: 30,
          requestType: 'EMERGENCY',
          distance: 5,
          createdAt: new Date('2024-01-15T10:00:00Z').toISOString(),
        },
        {
          id: 'mission-2',
          matchScore: 60,
          scoreBreakdown: {
            distance: 40,
            availability: 70,
            compatibility: 80,
            reliability: 60,
            urgency: 0,
          },
          success: false,
          responseTime: 45,
          completionTime: 120,
          requestType: 'APPOINTMENT',
          distance: 35,
          createdAt: new Date('2024-01-15T14:00:00Z').toISOString(),
        },
        {
          id: 'mission-3',
          matchScore: 85,
          scoreBreakdown: {
            distance: 80,
            availability: 90,
            compatibility: 85,
            reliability: 85,
            urgency: 0,
          },
          success: true,
          responseTime: 20,
          completionTime: 50,
          requestType: 'APPOINTMENT',
          distance: 15,
          createdAt: new Date('2024-01-15T16:00:00Z').toISOString(),
        },
      ]

      testMissions.forEach((mission) => analyticsService.recordMissionOutcome(mission))
    })

    it('devrait analyser les patterns de succès', () => {
      expect(analyticsService.successPatterns.size).toBeGreaterThan(0)
      expect(analyticsService.failurePatterns.size).toBeGreaterThan(0)
    })

    it('devrait analyser les patterns contextuels', () => {
      expect(analyticsService.contextualPatterns.timeOfDay.size).toBeGreaterThan(0)
      expect(analyticsService.contextualPatterns.urgencyType.size).toBeGreaterThan(0)
    })

    it('devrait calculer le taux de succès global', () => {
      const successRate = analyticsService.calculateOverallSuccessRate()
      expect(successRate).toBeCloseTo(66.67, 1) // 2 succès sur 3 missions
    })
  })

  describe('Optimisation des poids', () => {
    beforeEach(() => {
      // Ajouter des données déterministes pour éviter les boucles infinies
      const testData = [
        { success: true, compatibility: 90, distance: 85, availability: 80, reliability: 75 },
        { success: true, compatibility: 85, distance: 90, availability: 75, reliability: 80 },
        { success: false, compatibility: 40, distance: 30, availability: 50, reliability: 45 },
        { success: false, compatibility: 35, distance: 25, availability: 45, reliability: 40 },
        { success: true, compatibility: 95, distance: 80, availability: 85, reliability: 90 },
      ]

      testData.forEach((data, i) => {
        analyticsService.recordMissionOutcome({
          id: `mission-${i}`,
          matchScore: data.success ? 80 : 40,
          scoreBreakdown: {
            distance: data.distance,
            availability: data.availability,
            compatibility: data.compatibility,
            reliability: data.reliability,
            urgency: 0,
          },
          success: data.success,
          responseTime: 15,
          completionTime: 45,
          requestType: 'APPOINTMENT',
          distance: 15,
          createdAt: new Date().toISOString(),
        })
      })

      // Ajouter quelques missions supplémentaires pour atteindre minSampleSize
      for (let i = 5; i < 12; i++) {
        analyticsService.recordMissionOutcome({
          id: `mission-${i}`,
          matchScore: 70,
          scoreBreakdown: {
            distance: 70,
            availability: 70,
            compatibility: 70,
            reliability: 70,
            urgency: 0,
          },
          success: true,
          responseTime: 20,
          completionTime: 50,
          requestType: 'APPOINTMENT',
          distance: 20,
          createdAt: new Date().toISOString(),
        })
      }
    })

    it("devrait calculer l'importance des critères", () => {
      const importance = analyticsService.calculateCriteriaImportance()

      expect(importance).toHaveProperty('distance')
      expect(importance).toHaveProperty('availability')
      expect(importance).toHaveProperty('compatibility')
      expect(importance).toHaveProperty('reliability')
      expect(importance).toHaveProperty('urgency')

      Object.values(importance).forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      })
    })

    it('devrait valider les nouveaux poids', () => {
      const validWeights = {
        distance: 0.3,
        availability: 0.25,
        compatibility: 0.2,
        reliability: 0.15,
        urgency: 0.1,
      }

      expect(analyticsService.validateWeights(validWeights)).toBe(true)

      const invalidWeights = {
        distance: 0.8, // Trop dominant
        availability: 0.1,
        compatibility: 0.05,
        reliability: 0.03,
        urgency: 0.02,
      }

      expect(analyticsService.validateWeights(invalidWeights)).toBe(false)
    })

    it('devrait obtenir les poids optimisés', () => {
      const weights = analyticsService.getOptimizedWeights()

      expect(weights).toHaveProperty('distance')
      expect(weights).toHaveProperty('availability')
      expect(weights).toHaveProperty('compatibility')
      expect(weights).toHaveProperty('reliability')
      expect(weights).toHaveProperty('urgency')

      // Vérifier que la somme est proche de 1
      const sum = Object.values(weights).reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1, 2)
    })
  })

  describe('Prédiction de succès', () => {
    beforeEach(() => {
      // Ajouter des données avec patterns clairs
      const patterns = [
        // Pattern de succès: haute compatibilité + courte distance
        { compatibility: 95, distance: 90, success: true },
        { compatibility: 90, distance: 85, success: true },
        { compatibility: 88, distance: 92, success: true },

        // Pattern d'échec: faible disponibilité + longue distance
        { availability: 30, distance: 20, success: false },
        { availability: 25, distance: 15, success: false },
        { availability: 35, distance: 25, success: false },
      ]

      patterns.forEach((pattern, index) => {
        analyticsService.recordMissionOutcome({
          id: `pattern-mission-${index}`,
          matchScore: 70,
          scoreBreakdown: {
            distance: pattern.distance || 70,
            availability: pattern.availability || 70,
            compatibility: pattern.compatibility || 70,
            reliability: 70,
            urgency: 0,
          },
          success: pattern.success,
          responseTime: 20,
          completionTime: 60,
          requestType: 'APPOINTMENT',
          distance: 20,
          createdAt: new Date().toISOString(),
        })
      })
    })

    it('devrait prédire la probabilité de succès', () => {
      const matchData = {
        scoreBreakdown: {
          distance: 90,
          availability: 80,
          compatibility: 95,
          reliability: 75,
          urgency: 0,
        },
        context: {
          timeOfDay: 10,
          dayOfWeek: 1,
          urgencyType: 'APPOINTMENT',
          distance: 10,
        },
      }

      const probability = analyticsService.predictSuccessProbability(matchData)

      expect(probability).toBeGreaterThanOrEqual(0)
      expect(probability).toBeLessThanOrEqual(1)
    })

    it('devrait retourner 0.5 pour des données inconnues', () => {
      const unknownMatchData = {
        scoreBreakdown: {
          distance: 50,
          availability: 50,
          compatibility: 50,
          reliability: 50,
          urgency: 0,
        },
        context: {
          timeOfDay: 12,
          dayOfWeek: 3,
          urgencyType: 'UNKNOWN',
          distance: 25,
        },
      }

      const probability = analyticsService.predictSuccessProbability(unknownMatchData)
      expect(probability).toBe(0.5)
    })
  })

  describe('Insights et recommandations', () => {
    beforeEach(() => {
      // Ajouter des données déterministes pour les insights
      const patterns = [
        { hour: 10, success: true, score: 85 },
        { hour: 10, success: true, score: 90 },
        { hour: 14, success: false, score: 45 },
        { hour: 16, success: true, score: 80 },
        { hour: 20, success: false, score: 40 },
      ]

      patterns.forEach((pattern, i) => {
        const date = new Date()
        date.setHours(pattern.hour)

        analyticsService.recordMissionOutcome({
          id: `insight-mission-${i}`,
          matchScore: pattern.score,
          scoreBreakdown: {
            distance: pattern.score - 5,
            availability: pattern.score,
            compatibility: pattern.score + 5,
            reliability: pattern.score - 10,
            urgency: 0,
          },
          success: pattern.success,
          responseTime: 15,
          completionTime: 45,
          requestType: 'APPOINTMENT',
          distance: 20,
          createdAt: date.toISOString(),
        })
      })

      // Ajouter quelques missions supplémentaires
      for (let i = 5; i < 15; i++) {
        analyticsService.recordMissionOutcome({
          id: `insight-mission-${i}`,
          matchScore: 75,
          scoreBreakdown: {
            distance: 70,
            availability: 75,
            compatibility: 80,
            reliability: 70,
            urgency: 0,
          },
          success: true,
          responseTime: 20,
          completionTime: 50,
          requestType: 'APPOINTMENT',
          distance: 25,
          createdAt: new Date().toISOString(),
        })
      }
    })

    it('devrait générer des insights complets', () => {
      const insights = analyticsService.getAnalyticsInsights()

      expect(insights).toHaveProperty('totalMissions')
      expect(insights).toHaveProperty('successRate')
      expect(insights).toHaveProperty('bestPerformingCriteria')
      expect(insights).toHaveProperty('contextualInsights')
      expect(insights).toHaveProperty('recommendations')
      expect(insights).toHaveProperty('performanceMetrics')

      expect(insights.totalMissions).toBe(20)
      expect(insights.successRate).toBeGreaterThan(0)
      expect(insights.successRate).toBeLessThanOrEqual(100)
    })

    it('devrait générer des recommandations', () => {
      const recommendations = analyticsService.generateRecommendations()

      expect(Array.isArray(recommendations)).toBe(true)

      recommendations.forEach((rec) => {
        expect(rec).toHaveProperty('type')
        expect(rec).toHaveProperty('message')
        expect(rec).toHaveProperty('impact')
        expect(['high', 'medium', 'low']).toContain(rec.impact)
      })
    })
  })

  describe('Export/Import des données', () => {
    beforeEach(() => {
      // Ajouter quelques missions de test
      for (let i = 0; i < 5; i++) {
        analyticsService.recordMissionOutcome({
          id: `export-mission-${i}`,
          matchScore: 75,
          scoreBreakdown: {
            distance: 80,
            availability: 70,
            compatibility: 75,
            reliability: 70,
            urgency: 5,
          },
          success: true,
          responseTime: 15,
          completionTime: 45,
          requestType: 'APPOINTMENT',
          distance: 20,
          createdAt: new Date().toISOString(),
        })
      }
    })

    it("devrait exporter les données d'apprentissage", () => {
      const exportedData = analyticsService.exportLearningData()

      expect(exportedData).toHaveProperty('missionHistory')
      expect(exportedData).toHaveProperty('learnedWeights')
      expect(exportedData).toHaveProperty('successPatterns')
      expect(exportedData).toHaveProperty('failurePatterns')
      expect(exportedData).toHaveProperty('contextualPatterns')
      expect(exportedData).toHaveProperty('performanceMetrics')
      expect(exportedData).toHaveProperty('exportDate')

      expect(exportedData.missionHistory).toHaveLength(5)
    })

    it("devrait importer les données d'apprentissage", () => {
      const exportedData = analyticsService.exportLearningData()

      // Créer un nouveau service
      const newService = new AnalyticsService()
      expect(newService.missionHistory).toHaveLength(0)

      // Importer les données
      const success = newService.importLearningData(exportedData)

      expect(success).toBe(true)
      expect(newService.missionHistory).toHaveLength(5)
      expect(newService.learnedWeights).toEqual(analyticsService.learnedWeights)
    })

    it("devrait gérer les erreurs d'import", () => {
      const invalidData = { invalid: 'data' }

      const success = analyticsService.importLearningData(invalidData)
      expect(success).toBe(false)
    })
  })

  describe('Gestion des erreurs', () => {
    it('devrait gérer les données de mission invalides', () => {
      expect(() => {
        analyticsService.recordMissionOutcome(null)
      }).not.toThrow()

      expect(() => {
        analyticsService.recordMissionOutcome({})
      }).not.toThrow()
    })

    it('devrait gérer les erreurs de prédiction', () => {
      const invalidMatchData = null

      expect(() => {
        const probability = analyticsService.predictSuccessProbability(invalidMatchData)
        expect(probability).toBe(0.5)
      }).not.toThrow()
    })
  })
})

describe('Intégration avec MatchingEngine', () => {
  let analyticsService
  let mockMatchingEngine

  beforeEach(() => {
    analyticsService = new AnalyticsService({ minSampleSize: 5 })

    mockMatchingEngine = {
      weights: {
        distance: 0.35,
        availability: 0.25,
        compatibility: 0.2,
        reliability: 0.15,
        urgency: 0.05,
      },
      analyticsService,
      getOptimizedWeights: () => analyticsService.getOptimizedWeights(),
      recordMissionOutcome: (data) => analyticsService.recordMissionOutcome(data),
    }
  })

  it('devrait utiliser les poids optimisés dans le matching', () => {
    // Ajouter des données pour déclencher l'optimisation
    for (let i = 0; i < 10; i++) {
      analyticsService.recordMissionOutcome({
        id: `integration-mission-${i}`,
        matchScore: 80,
        scoreBreakdown: {
          distance: 85,
          availability: 75,
          compatibility: 90, // Critère le plus important
          reliability: 70,
          urgency: 0,
        },
        success: true,
        responseTime: 15,
        completionTime: 45,
        requestType: 'APPOINTMENT',
        distance: 15,
        createdAt: new Date().toISOString(),
      })
    }

    const optimizedWeights = mockMatchingEngine.getOptimizedWeights()

    // Les poids devraient être différents des poids initiaux
    expect(optimizedWeights).not.toEqual(mockMatchingEngine.weights)

    // La compatibilité devrait avoir un poids plus élevé (pattern de succès)
    expect(optimizedWeights.compatibility).toBeGreaterThanOrEqual(
      mockMatchingEngine.weights.compatibility,
    )
  })
})
