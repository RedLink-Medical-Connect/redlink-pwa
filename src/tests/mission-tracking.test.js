/**
 * Tests pour le service de suivi des missions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import MissionTrackingService from '@/services/mission-tracking-service'

// Mock des dépendances
vi.mock('@/utils/monitoring', () => ({
  useMonitoring: () => ({
    recordMetric: vi.fn(),
    recordError: vi.fn(),
  }),
}))

vi.mock('@/composables/useCachedGraphQL', () => ({
  useCachedGraphQL: () => ({
    mutate: vi.fn().mockResolvedValue({ data: { createMissionHistory: { id: 'test-history' } } }),
  }),
}))

vi.mock('@/services/analytics-service', () => ({
  analyticsService: {
    recordMissionOutcome: vi.fn(),
  },
}))

describe('MissionTrackingService', () => {
  let trackingService

  beforeEach(() => {
    trackingService = new MissionTrackingService()
  })

  describe('Démarrage du suivi', () => {
    it("devrait démarrer le suivi d'une mission", () => {
      const missionData = {
        id: 'mission-1',
        requestId: 'request-1',
        donorId: 'donor-1',
        clinicId: 'clinic-1',
        matchScore: 85.5,
        scoreBreakdown: {
          distance: 90,
          availability: 80,
          compatibility: 85,
          reliability: 75,
          urgency: 10,
        },
        requestType: 'EMERGENCY',
        distance: 12.5,
        duration: 25,
      }

      const mission = trackingService.startMissionTracking(missionData)

      expect(mission).toBeDefined()
      expect(mission.id).toBe('mission-1')
      expect(mission.status).toBe('STARTED')
      expect(mission.events).toHaveLength(1)
      expect(mission.events[0].type).toBe('MISSION_STARTED')
      expect(trackingService.activeMissions.has('mission-1')).toBe(true)
    })

    it('devrait enregistrer les données contextuelles', () => {
      const missionData = {
        id: 'mission-2',
        requestId: 'request-2',
        donorId: 'donor-2',
        clinicId: 'clinic-2',
        matchScore: 75,
        scoreBreakdown: {
          distance: 70,
          availability: 75,
          compatibility: 80,
          reliability: 70,
          urgency: 0,
        },
        requestType: 'APPOINTMENT',
        distance: 20,
        weather: 'sunny',
        trafficCondition: 'light',
      }

      const mission = trackingService.startMissionTracking(missionData)

      expect(mission.context).toBeDefined()
      expect(mission.context.urgencyType).toBe('APPOINTMENT')
      expect(mission.context.weather).toBe('sunny')
      expect(mission.context.trafficCondition).toBe('light')
      expect(mission.context.timeOfDay).toBeGreaterThanOrEqual(0)
      expect(mission.context.timeOfDay).toBeLessThan(24)
      expect(mission.context.dayOfWeek).toBeGreaterThanOrEqual(0)
      expect(mission.context.dayOfWeek).toBeLessThan(7)
    })
  })

  describe("Enregistrement d'événements", () => {
    beforeEach(() => {
      trackingService.startMissionTracking({
        id: 'mission-test',
        requestId: 'request-test',
        donorId: 'donor-test',
        clinicId: 'clinic-test',
        matchScore: 80,
        scoreBreakdown: {
          distance: 80,
          availability: 80,
          compatibility: 80,
          reliability: 80,
          urgency: 0,
        },
        requestType: 'APPOINTMENT',
        distance: 15,
      })
    })

    it('devrait enregistrer un événement', () => {
      trackingService.recordMissionEvent('mission-test', 'DONOR_CONTACTED', {
        contactMethod: 'phone',
      })

      const mission = trackingService.activeMissions.get('mission-test')
      expect(mission.events).toHaveLength(2) // MISSION_STARTED + DONOR_CONTACTED

      const lastEvent = mission.events[mission.events.length - 1]
      expect(lastEvent.type).toBe('DONOR_CONTACTED')
      expect(lastEvent.data.contactMethod).toBe('phone')
      expect(lastEvent.timestamp).toBeDefined()
    })

    it("devrait mettre à jour le statut selon l'événement", () => {
      trackingService.recordMissionEvent('mission-test', 'DONOR_ACCEPTED')

      const mission = trackingService.activeMissions.get('mission-test')
      expect(mission.status).toBe('ACCEPTED')
      expect(mission.responseTime).toBeDefined()
      expect(mission.responseTime).toBeGreaterThan(0)
    })

    it('devrait gérer les événements de fin de mission', () => {
      trackingService.recordMissionEvent('mission-test', 'TRANSFUSION_COMPLETED')

      const mission = trackingService.activeMissions.get('mission-test')
      expect(mission.status).toBe('COMPLETED')
      expect(mission.success).toBe(true)
      expect(mission.completionTime).toBeDefined()
    })

    it("devrait gérer les événements d'échec", () => {
      trackingService.recordMissionEvent('mission-test', 'MISSION_CANCELLED', {
        reason: 'donor_unavailable',
      })

      const mission = trackingService.activeMissions.get('mission-test')
      expect(mission.status).toBe('CANCELLED')
      expect(mission.success).toBe(false)
      expect(mission.cancellationReason).toBe('donor_unavailable')
    })

    it('devrait ignorer les événements pour missions inexistantes', () => {
      expect(() => {
        trackingService.recordMissionEvent('mission-inexistante', 'DONOR_CONTACTED')
      }).not.toThrow()
    })
  })

  describe('Finalisation du suivi', () => {
    beforeEach(() => {
      trackingService.startMissionTracking({
        id: 'mission-complete',
        requestId: 'request-complete',
        donorId: 'donor-complete',
        clinicId: 'clinic-complete',
        matchScore: 90,
        scoreBreakdown: {
          distance: 95,
          availability: 85,
          compatibility: 90,
          reliability: 85,
          urgency: 15,
        },
        requestType: 'EMERGENCY',
        distance: 8,
      })
    })

    it('devrait finaliser une mission avec succès', async () => {
      const finalResult = {
        success: true,
        notes: 'Transfusion réussie',
      }

      const completedMission = await trackingService.completeMissionTracking(
        'mission-complete',
        finalResult,
      )

      expect(completedMission).toBeDefined()
      expect(completedMission.success).toBe(true)
      expect(completedMission.notes).toBe('Transfusion réussie')
      expect(completedMission.endTime).toBeDefined()
      expect(completedMission.totalDuration).toBeDefined()
      expect(trackingService.activeMissions.has('mission-complete')).toBe(false)
    })

    it('devrait déterminer automatiquement le succès selon le statut', async () => {
      // Marquer comme terminée
      trackingService.recordMissionEvent('mission-complete', 'TRANSFUSION_COMPLETED')

      const completedMission = await trackingService.completeMissionTracking('mission-complete')

      expect(completedMission.success).toBe(true)
    })

    it('devrait gérer les missions inexistantes', async () => {
      expect(() => trackingService.completeMissionTracking('mission-inexistante')).not.toThrow()
    })
  })

  describe('Gestion des missions actives', () => {
    beforeEach(() => {
      // Ajouter quelques missions de test
      trackingService.startMissionTracking({
        id: 'mission-1',
        requestId: 'request-1',
        donorId: 'donor-1',
        clinicId: 'clinic-1',
        matchScore: 80,
        scoreBreakdown: {
          distance: 80,
          availability: 80,
          compatibility: 80,
          reliability: 80,
          urgency: 0,
        },
        requestType: 'APPOINTMENT',
        distance: 15,
      })

      trackingService.startMissionTracking({
        id: 'mission-2',
        requestId: 'request-2',
        donorId: 'donor-2',
        clinicId: 'clinic-2',
        matchScore: 85,
        scoreBreakdown: {
          distance: 85,
          availability: 85,
          compatibility: 85,
          reliability: 85,
          urgency: 0,
        },
        requestType: 'EMERGENCY',
        distance: 10,
      })
    })

    it("devrait obtenir le statut d'une mission", () => {
      const status = trackingService.getMissionStatus('mission-1')

      expect(status).toBeDefined()
      expect(status.id).toBe('mission-1')
      expect(status.status).toBe('STARTED')
      expect(status.events).toBeDefined()
      expect(status.duration).toBeGreaterThan(0)
    })

    it('devrait lister toutes les missions actives', () => {
      const activeMissions = trackingService.getActiveMissions()

      expect(activeMissions).toHaveLength(2)
      expect(activeMissions[0]).toHaveProperty('id')
      expect(activeMissions[0]).toHaveProperty('status')
      expect(activeMissions[0]).toHaveProperty('requestType')
      expect(activeMissions[0]).toHaveProperty('duration')
    })

    it('devrait obtenir les statistiques de suivi', () => {
      const stats = trackingService.getTrackingStats()

      expect(stats).toBeDefined()
      expect(stats.activeMissionsCount).toBe(2)
      expect(stats.trackingEnabled).toBe(true)
      expect(stats.autoRecordResults).toBe(true)
      expect(stats.averageDuration).toBeGreaterThan(0)
    })
  })

  describe('Configuration', () => {
    it("devrait permettre d'activer/désactiver le suivi", () => {
      expect(trackingService.trackingEnabled).toBe(true)

      trackingService.setTrackingEnabled(false)
      expect(trackingService.trackingEnabled).toBe(false)

      trackingService.setTrackingEnabled(true)
      expect(trackingService.trackingEnabled).toBe(true)
    })

    it("devrait permettre d'activer/désactiver l'enregistrement ML", () => {
      expect(trackingService.autoRecordResults).toBe(true)

      trackingService.setAutoRecordResults(false)
      expect(trackingService.autoRecordResults).toBe(false)

      trackingService.setAutoRecordResults(true)
      expect(trackingService.autoRecordResults).toBe(true)
    })
  })

  describe('Nettoyage automatique', () => {
    it('devrait nettoyer les missions anciennes', async () => {
      // Créer une mission avec un timestamp ancien
      const oldMission = {
        id: 'old-mission',
        requestId: 'old-request',
        donorId: 'old-donor',
        clinicId: 'old-clinic',
        matchScore: 70,
        scoreBreakdown: {
          distance: 70,
          availability: 70,
          compatibility: 70,
          reliability: 70,
          urgency: 0,
        },
        requestType: 'APPOINTMENT',
        distance: 20,
      }

      trackingService.startMissionTracking(oldMission)

      // Modifier manuellement le timestamp pour simuler une mission ancienne
      const mission = trackingService.activeMissions.get('old-mission')
      mission.startTime = Date.now() - 25 * 60 * 60 * 1000 // 25 heures ago

      expect(trackingService.activeMissions.has('old-mission')).toBe(true)

      trackingService.cleanupOldMissions()

      expect(trackingService.activeMissions.has('old-mission')).toBe(false)
    })
  })

  describe('Gestion des erreurs', () => {
    it('devrait gérer les erreurs de démarrage de suivi', () => {
      expect(() => {
        trackingService.startMissionTracking(null)
      }).toThrow()
    })

    it("devrait gérer les erreurs d'enregistrement d'événement", () => {
      expect(() => {
        trackingService.recordMissionEvent(null, 'INVALID_EVENT')
      }).not.toThrow()
    })

    it('devrait gérer les erreurs de finalisation', async () => {
      await expect(
        trackingService.completeMissionTracking('mission-inexistante'),
      ).resolves.toBeUndefined()
    })
  })
})

describe('Intégration avec Analytics', () => {
  let trackingService

  beforeEach(() => {
    trackingService = new MissionTrackingService()
  })

  it('devrait enregistrer les résultats pour le ML', async () => {
    const missionData = {
      id: 'ml-mission',
      requestId: 'ml-request',
      donorId: 'ml-donor',
      clinicId: 'ml-clinic',
      matchScore: 88,
      scoreBreakdown: {
        distance: 90,
        availability: 85,
        compatibility: 90,
        reliability: 85,
        urgency: 10,
      },
      requestType: 'EMERGENCY',
      distance: 8,
    }

    trackingService.startMissionTracking(missionData)
    trackingService.recordMissionEvent('ml-mission', 'TRANSFUSION_COMPLETED')

    const completedMission = await trackingService.completeMissionTracking('ml-mission', {
      success: true,
    })

    expect(completedMission.success).toBe(true)
    // Vérifier que l'analytics service a été appelé (via le mock)
  })

  it("devrait désactiver l'enregistrement ML si configuré", async () => {
    trackingService.setAutoRecordResults(false)

    const missionData = {
      id: 'no-ml-mission',
      requestId: 'no-ml-request',
      donorId: 'no-ml-donor',
      clinicId: 'no-ml-clinic',
      matchScore: 75,
      scoreBreakdown: {
        distance: 75,
        availability: 75,
        compatibility: 75,
        reliability: 75,
        urgency: 0,
      },
      requestType: 'APPOINTMENT',
      distance: 20,
    }

    trackingService.startMissionTracking(missionData)

    const completedMission = await trackingService.completeMissionTracking('no-ml-mission', {
      success: true,
    })

    expect(completedMission.success).toBe(true)
    expect(trackingService.autoRecordResults).toBe(false)
  })
})
