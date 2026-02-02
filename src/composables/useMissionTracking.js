/**
 * Composable pour le suivi des missions
 * Interface entre les composants Vue et le service de suivi
 */

import { ref, computed } from 'vue'
import { missionTrackingService } from '@/services/mission-tracking-service'
import { useMonitoring } from '@/utils/monitoring'

export function useMissionTracking() {
  const monitoring = useMonitoring()

  // États
  const activeMissions = ref([])
  const isTracking = ref(false)
  const error = ref(null)

  /**
   * Démarre le suivi d'une nouvelle mission
   */
  const startTracking = async (missionData) => {
    try {
      isTracking.value = true
      error.value = null

      console.log('🎯 Démarrage suivi mission:', missionData.id)

      const mission = missionTrackingService.startMissionTracking(missionData)

      // Mettre à jour la liste des missions actives
      await refreshActiveMissions()

      console.log('✅ Suivi démarré avec succès')
      return mission
    } catch (err) {
      error.value = err
      monitoring.recordError(err, { context: 'mission-tracking-start' })
      console.error('Erreur démarrage suivi:', err)
      throw err
    } finally {
      isTracking.value = false
    }
  }

  /**
   * Enregistre un événement pour une mission
   */
  const recordEvent = async (missionId, eventType, eventData = {}) => {
    try {
      console.log(`📝 Enregistrement événement: ${eventType} pour mission ${missionId}`)

      missionTrackingService.recordMissionEvent(missionId, eventType, eventData)

      // Mettre à jour la liste
      await refreshActiveMissions()

      console.log('✅ Événement enregistré')
    } catch (err) {
      error.value = err
      monitoring.recordError(err, { context: 'mission-event-recording' })
      console.error('Erreur enregistrement événement:', err)
      throw err
    }
  }

  /**
   * Termine le suivi d'une mission
   */
  const completeTracking = async (missionId, finalResult = {}) => {
    try {
      isTracking.value = true
      error.value = null

      console.log('🏁 Finalisation suivi mission:', missionId)

      const completedMission = await missionTrackingService.completeMissionTracking(
        missionId,
        finalResult,
      )

      // Mettre à jour la liste
      await refreshActiveMissions()

      console.log('✅ Suivi finalisé avec succès')
      return completedMission
    } catch (err) {
      error.value = err
      monitoring.recordError(err, { context: 'mission-tracking-complete' })
      console.error('Erreur finalisation suivi:', err)
      throw err
    } finally {
      isTracking.value = false
    }
  }

  /**
   * Obtient le statut d'une mission
   */
  const getMissionStatus = (missionId) => {
    try {
      return missionTrackingService.getMissionStatus(missionId)
    } catch (err) {
      console.error('Erreur récupération statut mission:', err)
      return null
    }
  }

  /**
   * Actualise la liste des missions actives
   */
  const refreshActiveMissions = async () => {
    try {
      activeMissions.value = missionTrackingService.getActiveMissions()
    } catch (err) {
      console.error('Erreur actualisation missions actives:', err)
    }
  }

  /**
   * Obtient les statistiques de suivi
   */
  const getTrackingStats = () => {
    try {
      return missionTrackingService.getTrackingStats()
    } catch (err) {
      console.error('Erreur récupération stats suivi:', err)
      return null
    }
  }

  /**
   * Active/désactive le suivi
   */
  const setTrackingEnabled = (enabled) => {
    try {
      missionTrackingService.setTrackingEnabled(enabled)
    } catch (err) {
      console.error('Erreur configuration suivi:', err)
    }
  }

  /**
   * Active/désactive l'enregistrement ML automatique
   */
  const setAutoRecordResults = (enabled) => {
    try {
      missionTrackingService.setAutoRecordResults(enabled)
    } catch (err) {
      console.error('Erreur configuration ML:', err)
    }
  }

  // Événements de mission prédéfinis pour faciliter l'usage
  const missionEvents = {
    // Événements de contact
    DONOR_CONTACTED: 'DONOR_CONTACTED',
    DONOR_ACCEPTED: 'DONOR_ACCEPTED',
    DONOR_DECLINED: 'DONOR_DECLINED',

    // Événements de déplacement
    DONOR_EN_ROUTE: 'DONOR_EN_ROUTE',
    DONOR_ARRIVED: 'DONOR_ARRIVED',

    // Événements de transfusion
    TRANSFUSION_STARTED: 'TRANSFUSION_STARTED',
    TRANSFUSION_COMPLETED: 'TRANSFUSION_COMPLETED',

    // Événements de fin
    MISSION_CANCELLED: 'MISSION_CANCELLED',
    MISSION_FAILED: 'MISSION_FAILED',
  }

  /**
   * Méthodes de convenance pour les événements courants
   */
  const markDonorContacted = (missionId, contactMethod = 'phone') => {
    return recordEvent(missionId, missionEvents.DONOR_CONTACTED, { contactMethod })
  }

  const markDonorAccepted = (missionId, estimatedArrival = null) => {
    return recordEvent(missionId, missionEvents.DONOR_ACCEPTED, { estimatedArrival })
  }

  const markDonorDeclined = (missionId, reason = 'unavailable') => {
    return recordEvent(missionId, missionEvents.DONOR_DECLINED, { reason })
  }

  const markDonorEnRoute = (missionId, estimatedArrival = null) => {
    return recordEvent(missionId, missionEvents.DONOR_EN_ROUTE, { estimatedArrival })
  }

  const markDonorArrived = (missionId) => {
    return recordEvent(missionId, missionEvents.DONOR_ARRIVED, { arrivedAt: Date.now() })
  }

  const markTransfusionStarted = (missionId, bloodType = null, quantity = null) => {
    return recordEvent(missionId, missionEvents.TRANSFUSION_STARTED, { bloodType, quantity })
  }

  const markTransfusionCompleted = (missionId, success = true, notes = '') => {
    return recordEvent(missionId, missionEvents.TRANSFUSION_COMPLETED, { success, notes })
  }

  const markMissionCancelled = (missionId, reason = 'unknown') => {
    return recordEvent(missionId, missionEvents.MISSION_CANCELLED, { reason })
  }

  const markMissionFailed = (missionId, reason = 'unknown') => {
    return recordEvent(missionId, missionEvents.MISSION_FAILED, { reason })
  }

  // Propriétés calculées
  const hasActiveMissions = computed(() => activeMissions.value.length > 0)

  const missionsByStatus = computed(() => {
    const grouped = {}
    activeMissions.value.forEach((mission) => {
      if (!grouped[mission.status]) {
        grouped[mission.status] = []
      }
      grouped[mission.status].push(mission)
    })
    return grouped
  })

  const averageMissionDuration = computed(() => {
    if (activeMissions.value.length === 0) return 0
    const totalDuration = activeMissions.value.reduce((sum, mission) => sum + mission.duration, 0)
    return totalDuration / activeMissions.value.length
  })

  const oldestMission = computed(() => {
    if (activeMissions.value.length === 0) return null
    return activeMissions.value.reduce((oldest, mission) =>
      mission.startTime < oldest.startTime ? mission : oldest,
    )
  })

  // Initialisation
  refreshActiveMissions()

  return {
    // États
    activeMissions,
    isTracking,
    error,

    // Propriétés calculées
    hasActiveMissions,
    missionsByStatus,
    averageMissionDuration,
    oldestMission,

    // Actions principales
    startTracking,
    recordEvent,
    completeTracking,
    getMissionStatus,
    refreshActiveMissions,
    getTrackingStats,
    setTrackingEnabled,
    setAutoRecordResults,

    // Événements prédéfinis
    missionEvents,

    // Méthodes de convenance
    markDonorContacted,
    markDonorAccepted,
    markDonorDeclined,
    markDonorEnRoute,
    markDonorArrived,
    markTransfusionStarted,
    markTransfusionCompleted,
    markMissionCancelled,
    markMissionFailed,

    // Service pour usage avancé
    missionTrackingService,
  }
}
