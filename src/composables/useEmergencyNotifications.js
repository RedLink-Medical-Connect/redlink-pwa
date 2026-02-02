/**
 * Composable pour la gestion des notifications d'urgence
 * Interface Vue.js pour le service de notifications d'urgence
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { emergencyNotificationService } from '@/services/emergency-notification-service'
import { useNotifications } from './useNotifications'
import { useMonitoring } from '@/utils/monitoring'

export function useEmergencyNotifications() {
  const monitoring = useMonitoring()
  const { connect, disconnect, isConnected } = useNotifications()

  // États
  const activeEmergencies = ref([])
  const currentEmergency = ref(null)
  const isEmergencyVisible = ref(false)
  const emergencyStats = ref({})
  const isProcessing = ref(false)
  const error = ref(null)

  // Subscription pour les urgences
  let emergencySubscription = null

  /**
   * Envoie une notification d'urgence
   */
  const sendEmergencyNotification = async (emergencyData) => {
    try {
      isProcessing.value = true
      error.value = null

      console.log("🚨 Envoi notification d'urgence:", emergencyData)

      const result = await emergencyNotificationService.sendEmergencyNotification(emergencyData)

      console.log("✅ Notification d'urgence envoyée:", result)

      // Mettre à jour les statistiques
      updateEmergencyStats()

      return result
    } catch (err) {
      error.value = err
      monitoring.recordError(err, { context: 'emergency-notification-send' })
      console.error("Erreur envoi notification d'urgence:", err)
      throw err
    } finally {
      isProcessing.value = false
    }
  }

  /**
   * Accuse réception d'une urgence
   */
  const acknowledgeEmergency = async (emergencyId, acknowledgmentType = 'READ') => {
    try {
      console.log(`✅ Accusé de réception urgence ${emergencyId}`)

      const success = emergencyNotificationService.acknowledgeEmergency(
        emergencyId,
        'current-user', // TODO: récupérer l'ID utilisateur réel
        acknowledgmentType,
      )

      if (success) {
        // Masquer l'urgence actuelle si c'est celle-ci
        if (currentEmergency.value?.id === emergencyId) {
          hideCurrentEmergency()
        }

        // Mettre à jour les statistiques
        updateEmergencyStats()
      }

      return success
    } catch (err) {
      error.value = err
      console.error('Erreur accusé de réception:', err)
      throw err
    }
  }

  /**
   * Met à jour le statut d'une mission d'urgence
   */
  const updateMissionStatus = async (missionId, newStatus) => {
    try {
      console.log(`📋 Mise à jour statut mission ${missionId}: ${newStatus}`)

      await emergencyNotificationService.updateMissionStatus(
        missionId,
        newStatus,
        'current-user', // TODO: récupérer l'ID utilisateur réel
      )

      // Mettre à jour les statistiques
      updateEmergencyStats()

      return true
    } catch (err) {
      error.value = err
      console.error('Erreur mise à jour statut mission:', err)
      throw err
    }
  }

  /**
   * Affiche une notification d'urgence plein écran
   */
  const showEmergencyNotification = (notification) => {
    try {
      console.log("🚨 Affichage notification d'urgence plein écran:", notification)

      currentEmergency.value = notification
      isEmergencyVisible.value = true

      // Ajouter à la liste des urgences actives si pas déjà présente
      const exists = activeEmergencies.value.some((e) => e.id === notification.id)
      if (!exists) {
        activeEmergencies.value.unshift({
          ...notification,
          displayedAt: Date.now(),
        })
      }

      // Métriques
      monitoring.recordMetric('Emergency.Notification.Displayed', 1, 'Count', {
        EmergencyId: notification.id,
        UrgencyLevel: notification.data?.urgencyLevel || 'UNKNOWN',
      })
    } catch (err) {
      console.error('Erreur affichage urgence:', err)
    }
  }

  /**
   * Masque l'urgence actuelle
   */
  const hideCurrentEmergency = () => {
    currentEmergency.value = null
    isEmergencyVisible.value = false
  }

  /**
   * Gère l'acceptation d'une mission d'urgence
   */
  const handleEmergencyAccept = async (notification) => {
    try {
      console.log("✅ Acceptation mission d'urgence:", notification.id)

      // Accuser réception avec type ACCEPTED
      await acknowledgeEmergency(notification.data?.emergencyId || notification.id, 'ACCEPTED')

      // Mettre à jour le statut de la mission
      if (notification.data?.missionId) {
        await updateMissionStatus(notification.data.missionId, 'DONOR_CONFIRMED')
      }

      // Masquer l'urgence
      hideCurrentEmergency()

      // Métriques
      monitoring.recordMetric('Emergency.Mission.Accepted', 1, 'Count', {
        EmergencyId: notification.id,
        MissionId: notification.data?.missionId,
      })

      return true
    } catch (err) {
      console.error("Erreur acceptation mission d'urgence:", err)
      throw err
    }
  }

  /**
   * Gère le refus d'une mission d'urgence
   */
  const handleEmergencyDecline = async (notification) => {
    try {
      console.log("❌ Refus mission d'urgence:", notification.id)

      // Accuser réception avec type DECLINED
      await acknowledgeEmergency(notification.data?.emergencyId || notification.id, 'DECLINED')

      // Masquer l'urgence
      hideCurrentEmergency()

      // Métriques
      monitoring.recordMetric('Emergency.Mission.Declined', 1, 'Count', {
        EmergencyId: notification.id,
        MissionId: notification.data?.missionId,
      })

      return true
    } catch (err) {
      console.error("Erreur refus mission d'urgence:", err)
      throw err
    }
  }

  /**
   * Met à jour les statistiques d'urgence
   */
  const updateEmergencyStats = () => {
    try {
      emergencyStats.value = emergencyNotificationService.getEmergencyStats()
    } catch (err) {
      console.error('Erreur mise à jour statistiques urgence:', err)
    }
  }

  /**
   * Connecte aux notifications d'urgence temps réel
   */
  const connectToEmergencyNotifications = async (userId) => {
    try {
      console.log("🔌 Connexion aux notifications d'urgence temps réel...")

      // Utiliser la connexion WebSocket existante
      await connect(userId)

      // Écouter spécifiquement les notifications d'urgence
      // TODO: Implémenter l'écoute spécialisée des urgences

      console.log("✅ Connecté aux notifications d'urgence")
    } catch (err) {
      error.value = err
      console.error("Erreur connexion notifications d'urgence:", err)
      throw err
    }
  }

  /**
   * Déconnecte des notifications d'urgence
   */
  const disconnectFromEmergencyNotifications = () => {
    try {
      if (emergencySubscription) {
        emergencySubscription.unsubscribe()
        emergencySubscription = null
      }

      disconnect()
      console.log("🔌 Déconnecté des notifications d'urgence")
    } catch (err) {
      console.error("Erreur déconnexion notifications d'urgence:", err)
    }
  }

  /**
   * Nettoie les urgences expirées
   */
  const cleanupExpiredEmergencies = () => {
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 heures

    activeEmergencies.value = activeEmergencies.value.filter((emergency) => {
      const age = now - (emergency.createdAt || emergency.displayedAt)
      return age < maxAge
    })
  }

  /**
   * Obtient les urgences par niveau de priorité
   */
  const getEmergenciesByUrgency = (urgencyLevel) => {
    return activeEmergencies.value.filter(
      (emergency) => emergency.data?.urgencyLevel === urgencyLevel,
    )
  }

  // Propriétés calculées
  const hasCriticalEmergencies = computed(() =>
    activeEmergencies.value.some((e) => e.data?.urgencyLevel === 'CRITICAL'),
  )

  const hasUrgentEmergencies = computed(() =>
    activeEmergencies.value.some((e) => e.data?.urgencyLevel === 'URGENT'),
  )

  const totalActiveEmergencies = computed(() => activeEmergencies.value.length)

  const criticalEmergencies = computed(() => getEmergenciesByUrgency('CRITICAL'))

  const urgentEmergencies = computed(() => getEmergenciesByUrgency('URGENT'))

  const highEmergencies = computed(() => getEmergenciesByUrgency('HIGH'))

  const averageResponseTime = computed(() => emergencyStats.value.averageResponseTime || 0)

  // Nettoyage automatique toutes les heures
  let cleanupInterval = null

  // Lifecycle
  onMounted(() => {
    // Mettre à jour les statistiques initiales
    updateEmergencyStats()

    // Démarrer le nettoyage automatique
    cleanupInterval = setInterval(cleanupExpiredEmergencies, 60 * 60 * 1000) // 1 heure
  })

  onUnmounted(() => {
    disconnectFromEmergencyNotifications()

    if (cleanupInterval) {
      clearInterval(cleanupInterval)
    }
  })

  return {
    // États
    activeEmergencies,
    currentEmergency,
    isEmergencyVisible,
    emergencyStats,
    isProcessing,
    error,
    isConnected,

    // Propriétés calculées
    hasCriticalEmergencies,
    hasUrgentEmergencies,
    totalActiveEmergencies,
    criticalEmergencies,
    urgentEmergencies,
    highEmergencies,
    averageResponseTime,

    // Actions
    sendEmergencyNotification,
    acknowledgeEmergency,
    updateMissionStatus,
    showEmergencyNotification,
    hideCurrentEmergency,
    handleEmergencyAccept,
    handleEmergencyDecline,
    connectToEmergencyNotifications,
    disconnectFromEmergencyNotifications,
    updateEmergencyStats,
    getEmergenciesByUrgency,
    cleanupExpiredEmergencies,

    // Service pour usage avancé
    emergencyNotificationService,
  }
}
