/**
 * Service de notifications multi-canal pour RedLink
 * Gère l'envoi de notifications via WebSocket, Push, SMS et Email
 */

import { useMonitoring } from '@/utils/monitoring'

class NotificationService {
  constructor(options = {}) {
    this.monitoring = useMonitoring()

    // Configuration
    this.channels = {
      websocket: options.websocket !== false,
      push: options.push !== false,
      sms: options.sms !== false,
      email: options.email !== false,
    }

    // Priorités de notification
    this.priorities = {
      CRITICAL: {
        channels: ['websocket', 'push', 'sms'],
        escalationDelay: 300000, // 5 minutes
        sound: 'emergency',
        vibration: [200, 100, 200, 100, 200],
        retryAttempts: 3,
      },
      HIGH: {
        channels: ['websocket', 'push'],
        escalationDelay: 900000, // 15 minutes
        sound: 'alert',
        vibration: [200, 100, 200],
        retryAttempts: 2,
      },
      NORMAL: {
        channels: ['websocket'],
        escalationDelay: null,
        sound: 'notification',
        vibration: [100],
        retryAttempts: 1,
      },
      LOW: {
        channels: ['websocket'],
        escalationDelay: null,
        sound: null,
        vibration: null,
        retryAttempts: 1,
      },
    }

    // Types de notifications
    this.notificationTypes = {
      NEW_MATCH: 'NEW_MATCH',
      DONOR_ACCEPTED: 'DONOR_ACCEPTED',
      DONOR_DECLINED: 'DONOR_DECLINED',
      DONOR_EN_ROUTE: 'DONOR_EN_ROUTE',
      DONOR_ARRIVED: 'DONOR_ARRIVED',
      TRANSFUSION_STARTED: 'TRANSFUSION_STARTED',
      TRANSFUSION_COMPLETED: 'TRANSFUSION_COMPLETED',
      MISSION_CANCELLED: 'MISSION_CANCELLED',
      EMERGENCY_ALERT: 'EMERGENCY_ALERT',
      REMINDER: 'REMINDER',
      SYSTEM_ALERT: 'SYSTEM_ALERT',
    }

    // Cache des notifications envoyées
    this.sentNotifications = new Map()

    // Queue d'escalade
    this.escalationQueue = new Map()

    // Préférences utilisateur par défaut
    this.defaultPreferences = {
      channels: {
        websocket: true,
        push: true,
        sms: true,
        email: true,
      },
      schedule: {
        quietHours: {
          enabled: false,
          start: '22:00',
          end: '07:00',
          exceptEmergency: true,
        },
        daysOff: [],
      },
      filters: {
        minPriority: 'NORMAL',
        types: Object.values(this.notificationTypes),
        maxDistance: null,
      },
      sounds: {
        enabled: true,
        emergency: 'siren',
        alert: 'bell',
        notification: 'chime',
      },
    }

    console.log('🔔 Service de notifications initialisé')
  }

  /**
   * Envoie une notification multi-canal
   */
  async sendNotification(notificationData) {
    try {
      const notification = this.prepareNotification(notificationData)

      console.log(`🔔 Envoi notification: ${notification.type} (${notification.priority})`)

      // Vérifier les préférences utilisateur
      const userPreferences = await this.getUserPreferences(notification.userId)

      if (!this.shouldSendNotification(notification, userPreferences)) {
        console.log(`⏭️ Notification ignorée selon préférences utilisateur`)
        return { sent: false, reason: 'USER_PREFERENCES' }
      }

      // Déterminer les canaux à utiliser
      const channels = this.getChannelsForPriority(notification.priority, userPreferences)

      // Envoyer sur tous les canaux appropriés
      const results = await Promise.allSettled(
        channels.map((channel) => this.sendToChannel(channel, notification, userPreferences)),
      )

      // Enregistrer la notification envoyée
      this.recordSentNotification(notification, results)

      // Planifier l'escalade si nécessaire
      if (notification.priority === 'CRITICAL' || notification.priority === 'HIGH') {
        this.scheduleEscalation(notification, userPreferences)
      }

      // Métriques
      this.monitoring.recordMetric('Notification.Sent', 1, 'Count', {
        Type: notification.type,
        Priority: notification.priority,
        Channels: channels.length,
      })

      console.log(`✅ Notification envoyée sur ${channels.length} canaux`)

      return {
        sent: true,
        notificationId: notification.id,
        channels: results.map((r, i) => ({
          channel: channels[i],
          success: r.status === 'fulfilled',
          error: r.status === 'rejected' ? r.reason : null,
        })),
      }
    } catch (error) {
      console.error('❌ Erreur envoi notification:', error)
      this.monitoring.recordError(error, { context: 'notification-send' })
      throw error
    }
  }

  /**
   * Prépare les données de notification
   */
  prepareNotification(data) {
    const notification = {
      id: data.id || this.generateNotificationId(),
      userId: data.userId,
      type: data.type,
      priority: data.priority || this.determinePriority(data.type),
      title: data.title,
      message: data.message,
      data: data.data || {},
      createdAt: Date.now(),
      expiresAt: data.expiresAt || Date.now() + 24 * 60 * 60 * 1000, // 24h par défaut
      actionUrl: data.actionUrl,
      actionLabel: data.actionLabel,
    }

    return notification
  }

  /**
   * Détermine la priorité selon le type de notification
   */
  determinePriority(type) {
    const priorityMap = {
      EMERGENCY_ALERT: 'CRITICAL',
      NEW_MATCH: 'HIGH',
      DONOR_ACCEPTED: 'HIGH',
      DONOR_EN_ROUTE: 'NORMAL',
      DONOR_ARRIVED: 'HIGH',
      TRANSFUSION_COMPLETED: 'NORMAL',
      MISSION_CANCELLED: 'NORMAL',
      REMINDER: 'LOW',
      SYSTEM_ALERT: 'NORMAL',
    }

    return priorityMap[type] || 'NORMAL'
  }

  /**
   * Vérifie si la notification doit être envoyée selon les préférences
   */
  shouldSendNotification(notification, preferences) {
    // Vérifier le type de notification
    if (!preferences.filters.types.includes(notification.type)) {
      return false
    }

    // Vérifier la priorité minimale
    const priorityLevels = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL']
    const notifPriorityIndex = priorityLevels.indexOf(notification.priority)
    const minPriorityIndex = priorityLevels.indexOf(preferences.filters.minPriority)

    if (notifPriorityIndex < minPriorityIndex) {
      return false
    }

    // Vérifier les heures silencieuses
    if (preferences.schedule.quietHours.enabled) {
      const now = new Date()
      const currentHour = now.getHours()
      const currentMinute = now.getMinutes()
      const currentTime = currentHour * 60 + currentMinute

      const [startHour, startMinute] = preferences.schedule.quietHours.start.split(':').map(Number)
      const [endHour, endMinute] = preferences.schedule.quietHours.end.split(':').map(Number)
      const startTime = startHour * 60 + startMinute
      const endTime = endHour * 60 + endMinute

      const isQuietHours =
        startTime <= endTime
          ? currentTime >= startTime && currentTime < endTime
          : currentTime >= startTime || currentTime < endTime

      if (
        isQuietHours &&
        !(preferences.schedule.quietHours.exceptEmergency && notification.priority === 'CRITICAL')
      ) {
        return false
      }
    }

    // Vérifier les jours off
    const dayOfWeek = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ][new Date().getDay()]
    if (preferences.schedule.daysOff.includes(dayOfWeek) && notification.priority !== 'CRITICAL') {
      return false
    }

    return true
  }

  /**
   * Détermine les canaux à utiliser selon la priorité
   */
  getChannelsForPriority(priority, preferences) {
    const priorityConfig = this.priorities[priority]
    const availableChannels = priorityConfig.channels.filter(
      (channel) => this.channels[channel] && preferences.channels[channel],
    )

    return availableChannels
  }

  /**
   * Envoie une notification sur un canal spécifique
   */
  async sendToChannel(channel, notification, preferences) {
    try {
      console.log(`📤 Envoi sur canal: ${channel}`)

      switch (channel) {
        case 'websocket':
          return await this.sendWebSocketNotification(notification)
        case 'push':
          return await this.sendPushNotification(notification, preferences)
        case 'sms':
          return await this.sendSMSNotification(notification)
        case 'email':
          return await this.sendEmailNotification(notification)
        default:
          throw new Error(`Canal inconnu: ${channel}`)
      }
    } catch (error) {
      console.error(`❌ Erreur envoi sur ${channel}:`, error)
      this.monitoring.recordError(error, { context: `notification-${channel}` })
      throw error
    }
  }

  /**
   * Envoie une notification WebSocket (via AppSync)
   */
  async sendWebSocketNotification(notification) {
    try {
      // Utiliser AppSync pour publier la notification
      const { mutate } = await import('@/composables/useCachedGraphQL')
      const graphql = mutate()

      await graphql.mutate({
        mutation: `
          mutation PublishNotification($input: PublishNotificationInput!) {
            publishNotification(input: $input) {
              id
              success
            }
          }
        `,
        variables: {
          input: {
            userId: notification.userId,
            type: notification.type,
            priority: notification.priority,
            title: notification.title,
            message: notification.message,
            data: JSON.stringify(notification.data),
            createdAt: new Date(notification.createdAt).toISOString(),
          },
        },
        authMode: 'userPool',
      })

      console.log(`✅ Notification WebSocket envoyée`)
      return { channel: 'websocket', success: true }
    } catch (error) {
      console.error('❌ Erreur WebSocket:', error)
      throw error
    }
  }

  /**
   * Envoie une notification Push
   */
  async sendPushNotification(notification, preferences) {
    try {
      // Vérifier si les notifications push sont supportées
      if (!('Notification' in window)) {
        throw new Error('Notifications push non supportées')
      }

      // Vérifier la permission
      if (Notification.permission !== 'granted') {
        throw new Error('Permission notifications non accordée')
      }

      // Créer la notification push
      const pushNotification = new Notification(notification.title, {
        body: notification.message,
        icon: '/icon-192x192.png',
        badge: '/badge-72x72.png',
        tag: notification.id,
        data: notification.data,
        requireInteraction: notification.priority === 'CRITICAL',
        silent: !preferences.sounds.enabled,
        vibrate: this.priorities[notification.priority].vibration,
      })

      // Gérer les clics
      pushNotification.onclick = () => {
        window.focus()
        if (notification.actionUrl) {
          window.location.href = notification.actionUrl
        }
        pushNotification.close()
      }

      console.log(`✅ Notification Push envoyée`)
      return { channel: 'push', success: true }
    } catch (error) {
      console.error('❌ Erreur Push:', error)
      throw error
    }
  }

  /**
   * Envoie une notification SMS (via AWS SNS)
   */
  async sendSMSNotification(notification) {
    try {
      // Appeler l'API Lambda pour envoyer le SMS via SNS
      const response = await fetch('/api/notifications/sms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: notification.userId,
          message: `${notification.title}: ${notification.message}`,
          priority: notification.priority,
        }),
      })

      if (!response.ok) {
        throw new Error(`Erreur SMS: ${response.statusText}`)
      }

      console.log(`✅ Notification SMS envoyée`)
      return { channel: 'sms', success: true }
    } catch (error) {
      console.error('❌ Erreur SMS:', error)
      throw error
    }
  }

  /**
   * Envoie une notification Email (via AWS SES)
   */
  async sendEmailNotification(notification) {
    try {
      // Appeler l'API Lambda pour envoyer l'email via SES
      const response = await fetch('/api/notifications/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: notification.userId,
          subject: notification.title,
          body: notification.message,
          priority: notification.priority,
          actionUrl: notification.actionUrl,
          actionLabel: notification.actionLabel,
        }),
      })

      if (!response.ok) {
        throw new Error(`Erreur Email: ${response.statusText}`)
      }

      console.log(`✅ Notification Email envoyée`)
      return { channel: 'email', success: true }
    } catch (error) {
      console.error('❌ Erreur Email:', error)
      throw error
    }
  }

  /**
   * Enregistre une notification envoyée
   */
  recordSentNotification(notification, results) {
    this.sentNotifications.set(notification.id, {
      notification,
      results,
      sentAt: Date.now(),
      read: false,
      actioned: false,
    })

    // Nettoyer les anciennes notifications (>7 jours)
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    for (const [id, data] of this.sentNotifications.entries()) {
      if (data.sentAt < sevenDaysAgo) {
        this.sentNotifications.delete(id)
      }
    }
  }

  /**
   * Planifie l'escalade d'une notification
   */
  scheduleEscalation(notification, preferences) {
    const priorityConfig = this.priorities[notification.priority]

    if (!priorityConfig.escalationDelay) {
      return
    }

    const escalationTimeout = setTimeout(() => {
      this.handleEscalation(notification, preferences)
    }, priorityConfig.escalationDelay)

    this.escalationQueue.set(notification.id, {
      notification,
      timeout: escalationTimeout,
      scheduledAt: Date.now(),
    })

    console.log(
      `⏰ Escalade planifiée pour notification ${notification.id} dans ${priorityConfig.escalationDelay}ms`,
    )
  }

  /**
   * Gère l'escalade d'une notification non lue
   */
  async handleEscalation(notification, preferences) {
    try {
      const sentData = this.sentNotifications.get(notification.id)

      // Vérifier si la notification a été lue
      if (sentData && sentData.read) {
        console.log(`✅ Notification ${notification.id} déjà lue, escalade annulée`)
        this.escalationQueue.delete(notification.id)
        return
      }

      console.log(`🚨 Escalade de la notification ${notification.id}`)

      // Envoyer sur les canaux de fallback
      const fallbackChannels = ['sms', 'email'].filter(
        (channel) => this.channels[channel] && preferences.channels[channel],
      )

      for (const channel of fallbackChannels) {
        try {
          await this.sendToChannel(channel, notification, preferences)
        } catch (error) {
          console.error(`Erreur escalade sur ${channel}:`, error)
        }
      }

      // Métriques
      this.monitoring.recordMetric('Notification.Escalated', 1, 'Count', {
        Type: notification.type,
        Priority: notification.priority,
      })

      this.escalationQueue.delete(notification.id)
    } catch (error) {
      console.error('❌ Erreur escalade:', error)
      this.monitoring.recordError(error, { context: 'notification-escalation' })
    }
  }

  /**
   * Marque une notification comme lue
   */
  markAsRead(notificationId) {
    const sentData = this.sentNotifications.get(notificationId)
    if (sentData) {
      sentData.read = true
      sentData.readAt = Date.now()

      // Annuler l'escalade si planifiée
      const escalation = this.escalationQueue.get(notificationId)
      if (escalation) {
        clearTimeout(escalation.timeout)
        this.escalationQueue.delete(notificationId)
        console.log(`✅ Escalade annulée pour notification ${notificationId}`)
      }
    }
  }

  /**
   * Marque une notification comme actionnée
   */
  markAsActioned(notificationId) {
    const sentData = this.sentNotifications.get(notificationId)
    if (sentData) {
      sentData.actioned = true
      sentData.actionedAt = Date.now()
      this.markAsRead(notificationId)
    }
  }

  /**
   * Récupère les préférences utilisateur
   */
  async getUserPreferences(userId) {
    try {
      // Récupérer depuis la base de données
      const { query } = await import('@/composables/useCachedGraphQL')
      const graphql = query()

      const { data } = await graphql.query({
        query: `
          query GetUserPreferences($userId: ID!) {
            getUser(id: $userId) {
              notificationPreferences
            }
          }
        `,
        variables: { userId },
        authMode: 'userPool',
        useCache: true,
      })

      if (data?.getUser?.notificationPreferences) {
        return JSON.parse(data.getUser.notificationPreferences)
      }

      return this.defaultPreferences
    } catch (error) {
      console.error('Erreur récupération préférences:', error)
      return this.defaultPreferences
    }
  }

  /**
   * Génère un ID unique pour une notification
   */
  generateNotificationId() {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Obtient les statistiques du service
   */
  getStats() {
    return {
      sentNotificationsCount: this.sentNotifications.size,
      escalationQueueSize: this.escalationQueue.size,
      unreadCount: Array.from(this.sentNotifications.values()).filter((d) => !d.read).length,
      channels: this.channels,
    }
  }
}

// Instance globale
const notificationService = new NotificationService()

export { notificationService }
export default NotificationService
