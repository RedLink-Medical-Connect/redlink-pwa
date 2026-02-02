/**
 * Tests simplifiés pour le service d'analytics et machine learning
 * Version optimisée pour éviter les timeouts
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

describe('AnalyticsService - Tests Rapides', () => {
  let analyticsService

  beforeEach(() => {
    analyticsService = new AnalyticsService({
      learningRate: 0.1,
      minSampleSize: 3, // Très petit pour les tests
      maxHistorySize: 10,
      confidenceThreshold: 0.7,
    })
  })

  describe('Fonctionnalités de base', () => {
    it('devrait créer une instance avec les bonnes propriétés', () => {
      expect(analyticsService).toBeDefined()
      expect(analyticsService.missionHistory).toEqual([])
      expect(analyticsService.learnedWeights).toHaveProperty('distance')
      expect(analyticsService.learnedWeights).toHaveProperty('availability')
      expect(analyticsService.learnedWeights).toHaveProperty('compatibility')
      expect(analyticsService.learnedWeights).toHaveProperty('reliability')
      expect(analyticsService.learnedWeights).toHaveProperty('urgency')
    })

    it('devrait enregistrer une mission', () => {
      const missionData = {
        id: 'test-mission',
        matchScore: 85,
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
    })

    it('devrait calculer le taux de succès', () => {
      // Ajouter quelques missions
      analyticsService.recordMissionOutcome({
        id: 'mission-1',
        success: true,
        matchScore: 80,
        scoreBreakdown: {
          distance: 80,
          availability: 80,
          compatibility: 80,
          reliability: 80,
          urgency: 0,
        },
        responseTime: 15,
        completionTime: 45,
        requestType: 'APPOINTMENT',
        distance: 15,
        createdAt: new Date().toISOString(),
      })

      analyticsService.recordMissionOutcome({
        id: 'mission-2',
        success: false,
        matchScore: 40,
        scoreBreakdown: {
          distance: 40,
          availability: 40,
          compatibility: 40,
          reliability: 40,
          urgency: 0,
        },
        responseTime: 30,
        completionTime: 90,
        requestType: 'APPOINTMENT',
        distance: 30,
        createdAt: new Date().toISOString(),
      })

      const successRate = analyticsService.calculateOverallSuccessRate()
      expect(successRate).toBe(50) // 1 succès sur 2 missions
    })
  })

  describe('Poids et optimisation', () => {
    it('devrait retourner les poids optimisés', () => {
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

    it('devrait valider les poids correctement', () => {
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
  })

  describe('Prédictions', () => {
    it('devrait prédire une probabilité de succès', () => {
      const matchData = {
        scoreBreakdown: {
          distance: 80,
          availability: 75,
          compatibility: 85,
          reliability: 70,
          urgency: 0,
        },
        context: {
          timeOfDay: 10,
          dayOfWeek: 1,
          urgencyType: 'APPOINTMENT',
          distance: 15,
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

  describe('Insights', () => {
    beforeEach(() => {
      // Ajouter quelques missions de test
      const missions = [
        { success: true, score: 85 },
        { success: true, score: 90 },
        { success: false, score: 45 },
      ]

      missions.forEach((mission, i) => {
        analyticsService.recordMissionOutcome({
          id: `insight-mission-${i}`,
          matchScore: mission.score,
          scoreBreakdown: {
            distance: mission.score - 5,
            availability: mission.score,
            compatibility: mission.score + 5,
            reliability: mission.score - 10,
            urgency: 0,
          },
          success: mission.success,
          responseTime: 15,
          completionTime: 45,
          requestType: 'APPOINTMENT',
          distance: 20,
          createdAt: new Date().toISOString(),
        })
      })
    })

    it('devrait générer des insights', () => {
      const insights = analyticsService.getAnalyticsInsights()

      expect(insights).toHaveProperty('totalMissions')
      expect(insights).toHaveProperty('successRate')
      expect(insights).toHaveProperty('bestPerformingCriteria')
      expect(insights).toHaveProperty('contextualInsights')
      expect(insights).toHaveProperty('recommendations')

      expect(insights.totalMissions).toBe(3)
      expect(insights.successRate).toBeCloseTo(66.67, 1)
    })

    it('devrait générer des recommandations', () => {
      const recommendations = analyticsService.generateRecommendations()

      expect(Array.isArray(recommendations)).toBe(true)
      // Les recommandations peuvent être vides avec peu de données
    })
  })

  describe('Export/Import', () => {
    it('devrait exporter les données', () => {
      // Ajouter une mission
      analyticsService.recordMissionOutcome({
        id: 'export-test',
        matchScore: 75,
        scoreBreakdown: {
          distance: 70,
          availability: 75,
          compatibility: 80,
          reliability: 70,
          urgency: 0,
        },
        success: true,
        responseTime: 15,
        completionTime: 45,
        requestType: 'APPOINTMENT',
        distance: 20,
        createdAt: new Date().toISOString(),
      })

      const exportedData = analyticsService.exportLearningData()

      expect(exportedData).toHaveProperty('missionHistory')
      expect(exportedData).toHaveProperty('learnedWeights')
      expect(exportedData).toHaveProperty('exportDate')
      expect(exportedData.missionHistory).toHaveLength(1)
    })

    it('devrait importer les données', () => {
      const testData = {
        missionHistory: [
          {
            id: 'imported-mission',
            success: true,
            matchScore: 80,
          },
        ],
        learnedWeights: {
          distance: 0.3,
          availability: 0.25,
          compatibility: 0.2,
          reliability: 0.15,
          urgency: 0.1,
        },
      }

      const success = analyticsService.importLearningData(testData)
      expect(success).toBe(true)
      expect(analyticsService.missionHistory).toHaveLength(1)
    })
  })

  describe('Gestion des erreurs', () => {
    it('devrait gérer les données invalides sans planter', () => {
      expect(() => {
        analyticsService.recordMissionOutcome(null)
      }).not.toThrow()

      expect(() => {
        analyticsService.recordMissionOutcome({})
      }).not.toThrow()
    })

    it('devrait gérer les erreurs de prédiction', () => {
      expect(() => {
        const probability = analyticsService.predictSuccessProbability(null)
        expect(probability).toBe(0.5)
      }).not.toThrow()
    })
  })
})
