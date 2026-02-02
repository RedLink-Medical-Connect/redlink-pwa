/**
 * Service de notifications d'urgence avec escalade automatique
 * Gère les notifications critiques avec fallback multi-niveau
 */

import { notificationService } from './notification-service'
import { useMonitoring } from '@/utils/monitoring'

class EmergencyNotificationService {
  constructor() {
    this.monitoring = useMonitoring()

    // Configuration d'escalade par niveau d'urgence
    this.escalationLevels = {
      CRITICAL: {
        level1: { delay: 0, channels: ['websocket', 'push'], sound: 'emergency-siren' },
        level2: { delay: 300000, channels: ['sms'], sound: 'emergency-siren' }, // 5min
        level3: { delay: 600000, channels: ['email'], sound: 'emergency-siren' }, // 10min
        level4: { delay: 900000, channels: ['admin-alert'], sound: 'emergency-siren' }, // 15min
        level5: { delay: 1200000, channels: ['fallback-donors'], sound: 'emergency-siren' }, // 20min
      },
      URGENT: {
        level1: { delay: 0, channels: ['websocket', 'push'], sound: 'urgent-alarm' },
        level2: { delay: 600000, channels: ['sms'], sound: 'urgent-alarm' }, // 10min
        level3: { delay: 1200000, channels: ['email'], sound: 'urgent-alarm' }, // 20min
        level4: { delay: 1800000, channels: ['admin-alert'], sound: 'urgent-alarm' }, // 30min
      },
      HIGH: {
        level1: { delay: 0, channels: ['websocket', 'push'], sound: 'alert' },
        level2: { delay: 900000, channels: ['sms'], sound: 'alert' }, // 15min
        level3: { delay: 1800000, channels: ['email'], sound: 'alert' }, // 30min
      },
    }

    // Statuts de mission simplifiés
    this.missionStatuses = {
      PENDING: 'En attente',
      DONOR_FOUND: 'Donneur trouvé',
      DONOR_CONFIRMED: 'Donneur confirmé',
      EN_ROUTE: 'En route',
      ARRIVED: 'Arrivé',
      IN_PROGRESS: 'En cours',
      COMPLETED: 'Terminé',
      CANCELLED: 'Annulé',
    }

    // Queue d'escalade active
    this.activeEscalations = new Map()

    // Accusés de réception en attente
    this.pendingAcknowledgments = new Map()

    console.log("🚨 Service de notifications d'urgence initialisé")
  }

  /**
   * Envoie une notification d'urgence avec escalade automatique
   */
  async sendEmergencyNotification(emergencyData) {
    try {
      const emergency = this.prepareEmergencyNotification(emergencyData)

      console.log(`🚨 Notification d'urgence: ${emergency.urgencyLevel} - ${emergency.title}`)

      // Démarrer l'escalade
      await this.startEscalation(emergency)

      // Enregistrer pour suivi
      this.activeEscalations.set(emergency.id, {
        emergency,
        startedAt: Date.now(),
        currentLevel: 1,
        acknowledged: false,
        escalationTimeouts: [],
      })

      // Métriques
      this.monitoring.recordMetric('Emergency.Notification.Sent', 1, 'Count', {
        UrgencyLevel: emergency.urgencyLevel,
        Type: emergency.type,
      })

      return {
        sent: true,
        emergencyId: emergency.id,
        escalationStarted: true,
      }
    } catch (error) {
      console.error("❌ Erreur notification d'urgence:", error)
      this.monitoring.recordError(error, { context: 'emergency-notification' })
      throw error
    }
  }

  /**
   * Prépare une notification d'urgence
   */
  prepareEmergencyNotification(data) {
    const emergency = {
      id: data.id || this.generateEmergencyId(),
      type: data.type || 'EMERGENCY_ALERT',
      urgencyLevel: data.urgencyLevel || 'CRITICAL',
      title: data.title,
      message: data.message,
      missionId: data.missionId,
      clinicId: data.clinicId,
      animalType: data.animalType,
      bloodType: data.bloodType,
      location: data.location,
      contactInfo: data.contactInfo,
      estimatedTime: data.estimatedTime,
      createdAt: Date.now(),
      expiresAt: data.expiresAt || Date.now() + 4 * 60 * 60 * 1000, // 4h par défaut
      requiresAcknowledgment: data.requiresAcknowledgment !== false,
      targetUsers: data.targetUsers || [],
      fallbackUsers: data.fallbackUsers || [],
    }

    return emergency
  }

  /**
   * Démarre l'escalade automatique
   */
  async startEscalation(emergency) {
    const escalationConfig = this.escalationLevels[emergency.urgencyLevel]

    if (!escalationConfig) {
      console.warn(`⚠️ Niveau d'urgence inconnu: ${emergency.urgencyLevel}`)
      return
    }

    const escalationData = this.activeEscalations.get(emergency.id) || {
      emergency,
      startedAt: Date.now(),
      currentLevel: 1,
      acknowledged: false,
      escalationTimeouts: [],
    }

    // Planifier tous les niveaux d'escalade
    Object.entries(escalationConfig).forEach(([levelKey, levelConfig]) => {
      const levelNumber = parseInt(levelKey.replace('level', ''))

      const timeout = setTimeout(async () => {
        await this.executeEscalationLevel(emergency.id, levelNumber, levelConfig)
      }, levelConfig.delay)

      escalationData.escalationTimeouts.push(timeout)
    })

    this.activeEscalations.set(emergency.id, escalationData)

    console.log(
      `⏰ Escalade planifiée pour urgence ${emergency.id} sur ${Object.keys(escalationConfig).length} niveaux`,
    )
  }

  /**
   * Exécute un niveau d'escalade
   */
  async executeEscalationLevel(emergencyId, level, levelConfig) {
    try {
      const escalationData = this.activeEscalations.get(emergencyId)

      if (!escalationData) {
        console.log(`⏭️ Escalade ${emergencyId} déjà terminée`)
        return
      }

      if (escalationData.acknowledged) {
        console.log(`✅ Escalade ${emergencyId} annulée - accusé de réception reçu`)
        return
      }

      const { emergency } = escalationData
      escalationData.currentLevel = level

      console.log(`🚨 Exécution escalade niveau ${level} pour urgence ${emergencyId}`)

      // Envoyer sur les canaux du niveau
      for (const channel of levelConfig.channels) {
        await this.sendToEmergencyChannel(channel, emergency, levelConfig)
      }

      // Métriques
      this.monitoring.recordMetric('Emergency.Escalation.Level', level, 'Count', {
        EmergencyId: emergencyId,
        UrgencyLevel: emergency.urgencyLevel,
      })

      // Si c'est le dernier niveau, marquer comme critique
      const maxLevel = Object.keys(this.escalationLevels[emergency.urgencyLevel]).length
      if (level === maxLevel) {
        console.log(`🔴 Escalade maximale atteinte pour urgence ${emergencyId}`)
        await this.handleMaxEscalationReached(emergency)
      }
    } catch (error) {
      console.error(`❌ Erreur escalade niveau ${level}:`, error)
      this.monitoring.recordError(error, { context: 'escalation-level', level })
    }
  }

  /**
   * Envoie sur un canal d'urgence spécialisé
   */
  async sendToEmergencyChannel(channel, emergency, levelConfig) {
    try {
      switch (channel) {
        case 'websocket':
        case 'push':
        case 'sms':
        case 'email':
          // Utiliser le service de notifications standard avec priorité CRITICAL
          await notificationService.sendNotification({
            userId: emergency.targetUsers[0] || 'broadcast',
            type: 'EMERGENCY_ALERT',
            priority: 'CRITICAL',
            title: `🚨 URGENCE - ${emergency.title}`,
            message: emergency.message,
            data: {
              emergencyId: emergency.id,
              urgencyLevel: emergency.urgencyLevel,
              missionId: emergency.missionId,
              sound: levelConfig.sound,
              requiresAcknowledgment: emergency.requiresAcknowledgment,
            },
          })
          break

        case 'admin-alert':
          await this.sendAdminAlert(emergency)
          break

        case 'fallback-donors':
          await this.notifyFallbackDonors(emergency)
          break

        default:
          console.warn(`⚠️ Canal d'urgence inconnu: ${channel}`)
      }
    } catch (error) {
      console.error(`❌ Erreur envoi canal ${channel}:`, error)
      throw error
    }
  }

  /**
   * Envoie une alerte aux administrateurs
   */
  async sendAdminAlert(emergency) {
    try {
      console.log(`👨‍💼 Alerte administrateur pour urgence ${emergency.id}`)

      // Notification aux administrateurs système
      await notificationService.sendNotification({
        userId: 'admin-broadcast',
        type: 'ADMIN_EMERGENCY_ALERT',
        priority: 'CRITICAL',
        title: `🔴 ESCALADE MAXIMALE - ${emergency.title}`,
        message: `Urgence ${emergency.urgencyLevel} non résolue après escalade automatique. Intervention manuelle requise.`,
        data: {
          emergencyId: emergency.id,
          urgencyLevel: emergency.urgencyLevel,
          missionId: emergency.missionId,
          escalationLevel: 'ADMIN',
          sound: 'emergency-siren',
        },
      })

      // Log système critique
      console.error(
        `🔴 ALERTE CRITIQUE: Urgence ${emergency.id} nécessite intervention administrative`,
      )

      // Métriques critiques
      this.monitoring.recordMetric('Emergency.Admin.Alert', 1, 'Count', {
        EmergencyId: emergency.id,
        UrgencyLevel: emergency.urgencyLevel,
      })
    } catch (error) {
      console.error('❌ Erreur alerte admin:', error)
      throw error
    }
  }

  /**
   * Notifie les donneurs de fallback
   */
  async notifyFallbackDonors(emergency) {
    try {
      console.log(`🔄 Notification donneurs de fallback pour urgence ${emergency.id}`)

      if (!emergency.fallbackUsers || emergency.fallbackUsers.length === 0) {
        console.warn(`⚠️ Aucun donneur de fallback disponible pour urgence ${emergency.id}`)
        return
      }

      // Notifier tous les donneurs de fallback
      for (const userId of emergency.fallbackUsers) {
        await notificationService.sendNotification({
          userId,
          type: 'FALLBACK_EMERGENCY_ALERT',
          priority: 'CRITICAL',
          title: `🆘 URGENCE - Donneurs de secours requis`,
          message: `Aucun donneur principal disponible. Votre aide est cruciale pour sauver une vie.`,
          data: {
            emergencyId: emergency.id,
            urgencyLevel: emergency.urgencyLevel,
            missionId: emergency.missionId,
            isFallback: true,
            sound: 'emergency-siren',
          },
        })
      }

      console.log(`📢 ${emergency.fallbackUsers.length} donneurs de fallback notifiés`)
    } catch (error) {
      console.error('❌ Erreur notification fallback:', error)
      throw error
    }
  }

  /**
   * Gère l'escalade maximale atteinte
   */
  async handleMaxEscalationReached(emergency) {
    try {
      console.log(`🔴 Escalade maximale atteinte pour urgence ${emergency.id}`)

      // Marquer comme critique dans le système
      const escalationData = this.activeEscalations.get(emergency.id)
      if (escalationData) {
        escalationData.maxEscalationReached = true
        escalationData.maxEscalationAt = Date.now()
      }

      // Notification système critique
      await notificationService.sendNotification({
        userId: 'system-broadcast',
        type: 'SYSTEM_CRITICAL_ALERT',
        priority: 'CRITICAL',
        title: `🔴 SYSTÈME CRITIQUE - Urgence non résolue`,
        message: `L'urgence ${emergency.id} a atteint l'escalade maximale sans résolution. Intervention immédiate requise.`,
        data: {
          emergencyId: emergency.id,
          urgencyLevel: emergency.urgencyLevel,
          escalationLevel: 'MAX',
          requiresImmediateAction: true,
        },
      })

      // Métriques critiques
      this.monitoring.recordMetric('Emergency.Max.Escalation', 1, 'Count', {
        EmergencyId: emergency.id,
        UrgencyLevel: emergency.urgencyLevel,
      })
    } catch (error) {
      console.error('❌ Erreur gestion escalade maximale:', error)
    }
  }

  /**
   * Accuse réception d'une notification d'urgence
   */
  acknowledgeEmergency(emergencyId, userId, acknowledgmentType = 'READ') {
    try {
      const escalationData = this.activeEscalations.get(emergencyId)

      if (!escalationData) {
        console.warn(`⚠️ Urgence ${emergencyId} non trouvée pour accusé de réception`)
        return false
      }

      if (escalationData.acknowledged) {
        console.log(`✅ Urgence ${emergencyId} déjà accusée réception`)
        return true
      }

      // Marquer comme accusée réception
      escalationData.acknowledged = true
      escalationData.acknowledgedBy = userId
      escalationData.acknowledgedAt = Date.now()
      escalationData.acknowledgmentType = acknowledgmentType

      // Annuler tous les timeouts d'escalade
      escalationData.escalationTimeouts.forEach((timeout) => clearTimeout(timeout))
      escalationData.escalationTimeouts = []

      console.log(
        `✅ Accusé de réception urgence ${emergencyId} par ${userId} (${acknowledgmentType})`,
      )

      // Métriques
      this.monitoring.recordMetric('Emergency.Acknowledged', 1, 'Count', {
        EmergencyId: emergencyId,
        AcknowledgmentType: acknowledgmentType,
        ResponseTime: Date.now() - escalationData.startedAt,
      })

      return true
    } catch (error) {
      console.error('❌ Erreur accusé de réception:', error)
      return false
    }
  }

  /**
   * Met à jour le statut d'une mission d'urgence
   */
  async updateMissionStatus(missionId, newStatus, userId) {
    try {
      console.log(`📋 Mise à jour statut mission ${missionId}: ${newStatus}`)

      // Trouver l'urgence associée à cette mission
      const emergencyData = Array.from(this.activeEscalations.values()).find(
        (data) => data.emergency.missionId === missionId,
      )

      if (emergencyData) {
        const { emergency } = emergencyData

        // Notifier le changement de statut
        await notificationService.sendNotification({
          userId: emergency.targetUsers[0] || 'broadcast',
          type: 'MISSION_STATUS_UPDATE',
          priority: 'HIGH',
          title: `📋 Statut mission: ${this.missionStatuses[newStatus]}`,
          message: `La mission d'urgence ${missionId} est maintenant: ${this.missionStatuses[newStatus]}`,
          data: {
            missionId,
            newStatus,
            statusLabel: this.missionStatuses[newStatus],
            emergencyId: emergency.id,
            updatedBy: userId,
          },
        })

        // Si la mission est terminée, nettoyer l'escalade
        if (['COMPLETED', 'CANCELLED'].includes(newStatus)) {
          this.cleanupEscalation(emergency.id)
        }
      }

      // Métriques
      this.monitoring.recordMetric('Mission.Status.Updated', 1, 'Count', {
        MissionId: missionId,
        NewStatus: newStatus,
      })

      return true
    } catch (error) {
      console.error('❌ Erreur mise à jour statut mission:', error)
      throw error
    }
  }

  /**
   * Nettoie une escalade terminée
   */
  cleanupEscalation(emergencyId) {
    try {
      const escalationData = this.activeEscalations.get(emergencyId)

      if (escalationData) {
        // Annuler tous les timeouts restants
        escalationData.escalationTimeouts.forEach((timeout) => clearTimeout(timeout))

        // Supprimer de la queue active
        this.activeEscalations.delete(emergencyId)

        console.log(`🧹 Escalade ${emergencyId} nettoyée`)
      }
    } catch (error) {
      console.error('❌ Erreur nettoyage escalade:', error)
    }
  }

  /**
   * Obtient les statistiques des urgences
   */
  getEmergencyStats() {
    const activeCount = this.activeEscalations.size
    const acknowledgedCount = Array.from(this.activeEscalations.values()).filter(
      (data) => data.acknowledged,
    ).length
    const maxEscalationCount = Array.from(this.activeEscalations.values()).filter(
      (data) => data.maxEscalationReached,
    ).length

    return {
      activeEmergencies: activeCount,
      acknowledgedEmergencies: acknowledgedCount,
      maxEscalationEmergencies: maxEscalationCount,
      pendingEmergencies: activeCount - acknowledgedCount,
      averageResponseTime: this.calculateAverageResponseTime(),
    }
  }

  /**
   * Calcule le temps de réponse moyen
   */
  calculateAverageResponseTime() {
    const acknowledgedEmergencies = Array.from(this.activeEscalations.values()).filter(
      (data) => data.acknowledged && data.acknowledgedAt,
    )

    if (acknowledgedEmergencies.length === 0) return 0

    const totalResponseTime = acknowledgedEmergencies.reduce((sum, data) => {
      return sum + (data.acknowledgedAt - data.startedAt)
    }, 0)

    return Math.round(totalResponseTime / acknowledgedEmergencies.length)
  }

  /**
   * Génère un ID unique pour une urgence
   */
  generateEmergencyId() {
    return `emergency_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}

// Instance globale
const emergencyNotificationService = new EmergencyNotificationService()

export { emergencyNotificationService }
export default EmergencyNotificationService
