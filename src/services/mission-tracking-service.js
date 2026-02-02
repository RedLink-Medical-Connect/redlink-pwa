/**
 * Service de suivi des missions pour l'analytics et l'historique
 * Gère l'enregistrement automatique des résultats de mission pour le ML
 */

import { analyticsService } from '@/services/analytics-service'
import { useMonitoring } from '@/utils/monitoring'
import { useCachedGraphQL } from '@/composables/useCachedGraphQL'

class MissionTrackingService {
  constructor() {
    this.monitoring = useMonitoring()
    this.graphql = useCachedGraphQL()

    // Cache des missions en cours de suivi
    this.activeMissions = new Map()

    // Configuration
    this.trackingEnabled = true
    this.autoRecordResults = true

    console.log('🎯 Service de suivi des missions initialisé')
  }

  /**
   * Démarre le suivi d'une nouvelle mission
   */
  startMissionTracking(missionData) {
    try {
      const mission = {
        id: missionData.id,
        requestId: missionData.requestId,
        donorId: missionData.donorId,
        clinicId: missionData.clinicId,
        matchScore: missionData.matchScore,
        scoreBreakdown: missionData.scoreBreakdown,
        requestType: missionData.requestType,
        distance: missionData.distance,
        duration: missionData.duration,
        startTime: Date.now(),
        status: 'STARTED',
        events: [],
        context: {
          timeOfDay: new Date().getHours(),
          dayOfWeek: new Date().getDay(),
          urgencyType: missionData.requestType,
          weather: missionData.weather,
          trafficCondition: missionData.trafficCondition,
        },
      }

      this.activeMissions.set(missionData.id, mission)

      // Enregistrer l'événement de démarrage
      this.recordMissionEvent(missionData.id, 'MISSION_STARTED', {
        matchScore: missionData.matchScore,
        scoreBreakdown: missionData.scoreBreakdown,
      })

      console.log(`🎯 Suivi démarré pour mission ${missionData.id}`)

      // Métriques
      this.monitoring.recordMetric('MissionTracking.Started', 1, 'Count', {
        RequestType: missionData.requestType,
      })

      return mission
    } catch (error) {
      console.error('❌ Erreur démarrage suivi mission:', error)
      this.monitoring.recordError(error, { context: 'mission-tracking-start' })
      throw error
    }
  }

  /**
   * Enregistre un événement dans le suivi d'une mission
   */
  recordMissionEvent(missionId, eventType, eventData = {}) {
    try {
      const mission = this.activeMissions.get(missionId)
      if (!mission) {
        console.warn(`⚠️ Mission ${missionId} non trouvée pour événement ${eventType}`)
        return
      }

      const event = {
        type: eventType,
        timestamp: Date.now(),
        data: eventData,
      }

      mission.events.push(event)
      mission.lastUpdate = Date.now()

      // Mettre à jour le statut selon l'événement
      this.updateMissionStatus(mission, eventType, eventData)

      console.log(`📝 Événement enregistré: ${eventType} pour mission ${missionId}`)

      // Métriques
      this.monitoring.recordMetric('MissionTracking.Event', 1, 'Count', {
        EventType: eventType,
        MissionId: missionId,
      })
    } catch (error) {
      console.error('❌ Erreur enregistrement événement mission:', error)
      this.monitoring.recordError(error, { context: 'mission-event-recording' })
    }
  }

  /**
   * Met à jour le statut d'une mission selon l'événement
   */
  updateMissionStatus(mission, eventType, eventData) {
    const statusMap = {
      MISSION_STARTED: 'STARTED',
      DONOR_CONTACTED: 'CONTACTED',
      DONOR_ACCEPTED: 'ACCEPTED',
      DONOR_DECLINED: 'DECLINED',
      DONOR_EN_ROUTE: 'EN_ROUTE',
      DONOR_ARRIVED: 'ARRIVED',
      TRANSFUSION_STARTED: 'IN_PROGRESS',
      TRANSFUSION_COMPLETED: 'COMPLETED',
      MISSION_CANCELLED: 'CANCELLED',
      MISSION_FAILED: 'FAILED',
    }

    const newStatus = statusMap[eventType]
    if (newStatus) {
      mission.status = newStatus
      mission.statusUpdatedAt = Date.now()
    }

    // Enregistrer des métriques spécifiques
    if (eventType === 'DONOR_ACCEPTED') {
      mission.responseTime = (Date.now() - mission.startTime) / (1000 * 60) // minutes
    }

    if (eventType === 'TRANSFUSION_COMPLETED') {
      mission.completionTime = (Date.now() - mission.startTime) / (1000 * 60) // minutes
      mission.success = true
    }

    if (['MISSION_CANCELLED', 'MISSION_FAILED', 'DONOR_DECLINED'].includes(eventType)) {
      mission.success = false
      mission.cancellationReason = eventData.reason || eventType
    }
  }

  /**
   * Termine le suivi d'une mission et enregistre le résultat pour le ML
   */
  async completeMissionTracking(missionId, finalResult = {}) {
    try {
      const mission = this.activeMissions.get(missionId)
      if (!mission) {
        console.warn(`⚠️ Mission ${missionId} non trouvée pour finalisation`)
        return
      }

      // Finaliser les données de la mission
      mission.endTime = Date.now()
      mission.totalDuration = (mission.endTime - mission.startTime) / (1000 * 60) // minutes

      // Déterminer le succès si pas encore défini
      if (mission.success === undefined) {
        mission.success = mission.status === 'COMPLETED'
      }

      // Enrichir avec les données finales
      Object.assign(mission, finalResult)

      // Enregistrer pour l'analytics ML si activé
      if (this.autoRecordResults) {
        await this.recordForAnalytics(mission)
      }

      // Sauvegarder en base de données
      await this.saveMissionHistory(mission)

      // Nettoyer le cache
      this.activeMissions.delete(missionId)

      console.log(`✅ Suivi terminé pour mission ${missionId} - Succès: ${mission.success}`)

      // Métriques finales
      this.monitoring.recordMetric('MissionTracking.Completed', 1, 'Count', {
        Success: mission.success,
        RequestType: mission.requestType,
        Duration: mission.totalDuration,
      })

      return mission
    } catch (error) {
      console.error('❌ Erreur finalisation suivi mission:', error)
      this.monitoring.recordError(error, { context: 'mission-tracking-complete' })
      throw error
    }
  }

  /**
   * Enregistre les résultats pour l'analytics ML
   */
  async recordForAnalytics(mission) {
    try {
      const analyticsData = {
        id: mission.id,
        matchScore: mission.matchScore,
        scoreBreakdown: mission.scoreBreakdown,
        success: mission.success,
        responseTime: mission.responseTime || 0,
        completionTime: mission.completionTime || mission.totalDuration || 0,
        cancellationReason: mission.cancellationReason,
        requestType: mission.requestType,
        distance: mission.distance,
        duration: mission.duration,
        createdAt: new Date(mission.startTime).toISOString(),
        context: mission.context,
      }

      analyticsService.recordMissionOutcome(analyticsData)

      console.log(`📊 Données enregistrées pour ML: mission ${mission.id}`)
    } catch (error) {
      console.error('❌ Erreur enregistrement analytics:', error)
      this.monitoring.recordError(error, { context: 'analytics-recording' })
    }
  }

  /**
   * Sauvegarde l'historique de la mission en base
   */
  async saveMissionHistory(mission) {
    try {
      const { mutate } = this.graphql

      const historyData = {
        missionId: mission.id,
        requestId: mission.requestId,
        donorId: mission.donorId,
        clinicId: mission.clinicId,
        matchScore: mission.matchScore,
        scoreBreakdown: JSON.stringify(mission.scoreBreakdown),
        success: mission.success,
        status: mission.status,
        responseTime: mission.responseTime,
        completionTime: mission.completionTime,
        totalDuration: mission.totalDuration,
        cancellationReason: mission.cancellationReason,
        events: JSON.stringify(mission.events),
        context: JSON.stringify(mission.context),
        startTime: new Date(mission.startTime).toISOString(),
        endTime: new Date(mission.endTime).toISOString(),
      }

      await mutate({
        mutation: `
          mutation CreateMissionHistory($input: CreateMissionHistoryInput!) {
            createMissionHistory(input: $input) {
              id
              missionId
              success
              createdAt
            }
          }
        `,
        variables: {
          input: historyData,
        },
        authMode: 'userPool',
      })

      console.log(`💾 Historique sauvegardé pour mission ${mission.id}`)
    } catch (error) {
      console.error('❌ Erreur sauvegarde historique:', error)
      // Ne pas faire échouer le processus principal
    }
  }

  /**
   * Obtient le statut d'une mission en cours
   */
  getMissionStatus(missionId) {
    const mission = this.activeMissions.get(missionId)
    if (!mission) return null

    return {
      id: mission.id,
      status: mission.status,
      events: mission.events,
      duration: Date.now() - mission.startTime,
      lastUpdate: mission.lastUpdate,
    }
  }

  /**
   * Liste toutes les missions en cours de suivi
   */
  getActiveMissions() {
    return Array.from(this.activeMissions.values()).map((mission) => ({
      id: mission.id,
      status: mission.status,
      requestType: mission.requestType,
      startTime: mission.startTime,
      duration: Date.now() - mission.startTime,
      eventsCount: mission.events.length,
    }))
  }

  /**
   * Nettoie les missions anciennes (plus de 24h)
   */
  cleanupOldMissions() {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    let cleanedCount = 0

    for (const [missionId, mission] of this.activeMissions.entries()) {
      if (mission.startTime < oneDayAgo) {
        // Finaliser automatiquement les missions anciennes
        this.completeMissionTracking(missionId, {
          success: false,
          cancellationReason: 'TIMEOUT_CLEANUP',
        })
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 ${cleanedCount} missions anciennes nettoyées`)
    }
  }

  /**
   * Obtient les statistiques du service
   */
  getTrackingStats() {
    const activeMissions = this.getActiveMissions()

    return {
      activeMissionsCount: activeMissions.length,
      trackingEnabled: this.trackingEnabled,
      autoRecordResults: this.autoRecordResults,
      oldestMission:
        activeMissions.length > 0 ? Math.min(...activeMissions.map((m) => m.startTime)) : null,
      averageDuration:
        activeMissions.length > 0
          ? activeMissions.reduce((sum, m) => sum + m.duration, 0) / activeMissions.length
          : 0,
    }
  }

  /**
   * Active/désactive le suivi
   */
  setTrackingEnabled(enabled) {
    this.trackingEnabled = enabled
    console.log(`🎯 Suivi des missions ${enabled ? 'activé' : 'désactivé'}`)
  }

  /**
   * Active/désactive l'enregistrement automatique pour le ML
   */
  setAutoRecordResults(enabled) {
    this.autoRecordResults = enabled
    console.log(`📊 Enregistrement ML automatique ${enabled ? 'activé' : 'désactivé'}`)
  }
}

// Instance globale
const missionTrackingService = new MissionTrackingService()

// Nettoyage automatique toutes les heures
setInterval(
  () => {
    missionTrackingService.cleanupOldMissions()
  },
  60 * 60 * 1000,
)

export { missionTrackingService }
export default MissionTrackingService
