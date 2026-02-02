/**
 * Composable pour la gestion des notifications
 * Interface entre les composants Vue et le service de notifications
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { notificationService } from '@/services/notification-service'
import { useMonitoring } from '@/utils/monitoring'

export function useNotifications() {
  const monitoring = useMonitoring()

  // États
  const notifications = ref([])
  const unreadCount = ref(0)
  const isConnected = ref(false)
  const isSending = ref(false)
  const error = ref(null)

  // Subscription WebSocket
  let subscription = null

  /**
   * Envoie une notification
   */
  const sendNotification = async (notificationData) => {
    try {
      isSending.value = true
      error.value = null

      console.log('📤 Envoi notification:', notificationData)

      const result = await notificationService.sendNotification(notificationData)

      console.log('✅ Notification envoyée:', result)
      return result
    } catch (err) {
      error.value = err
      monitoring.recordError(err, { context: 'notification-send' })
      console.error('Erreur envoi notification:', err)
      throw err
    } finally {
      isSending.value = false
    }
  }

  /**
   * Marque une notification comme lue
   */
  const markAsRead = (notificationId) => {
    try {
      notificationService.markAsRead(notificationId)

      // Mettre à jour localement
      const notification = notifications.value.find((n) => n.id === notificationId)
      if (notification && !notification.read) {
        notification.read = true
        notification.readAt = Date.now()
        unreadCount.value = Math.max(0, unreadCount.value - 1)
      }

      console.log(`✅ Notification ${notificationId} marquée comme lue`)
    } catch (err) {
      console.error('Erreur marquage lecture:', err)
    }
  }

  /**
   * Marque une notification comme actionnée
   */
  const markAsActioned = (notificationId) => {
    try {
      notificationService.markAsActioned(notificationId)

      // Mettre à jour localement
      const notification = notifications.value.find((n) => n.id === notificationId)
      if (notification) {
        notification.actioned = true
        notification.actionedAt = Date.now()
        if (!notification.read) {
          notification.read = true
          notification.readAt = Date.now()
          unreadCount.value = Math.max(0, unreadCount.value - 1)
        }
      }

      console.log(`✅ Notification ${notificationId} marquée comme actionnée`)
    } catch (err) {
      console.error('Erreur marquage action:', err)
    }
  }

  /**
   * Marque toutes les notifications comme lues
   */
  const markAllAsRead = () => {
    try {
      notifications.value.forEach((notification) => {
        if (!notification.read) {
          notificationService.markAsRead(notification.id)
          notification.read = true
          notification.readAt = Date.now()
        }
      })

      unreadCount.value = 0
      console.log('✅ Toutes les notifications marquées comme lues')
    } catch (err) {
      console.error('Erreur marquage toutes lues:', err)
    }
  }

  /**
   * Supprime une notification
   */
  const deleteNotification = (notificationId) => {
    try {
      const index = notifications.value.findIndex((n) => n.id === notificationId)
      if (index !== -1) {
        const notification = notifications.value[index]
        if (!notification.read) {
          unreadCount.value = Math.max(0, unreadCount.value - 1)
        }
        notifications.value.splice(index, 1)
      }

      console.log(`✅ Notification ${notificationId} supprimée`)
    } catch (err) {
      console.error('Erreur suppression notification:', err)
    }
  }

  /**
   * Supprime toutes les notifications
   */
  const clearAll = () => {
    try {
      notifications.value = []
      unreadCount.value = 0
      console.log('✅ Toutes les notifications supprimées')
    } catch (err) {
      console.error('Erreur suppression toutes:', err)
    }
  }

  /**
   * Demande la permission pour les notifications push
   */
  const requestPermission = async () => {
    try {
      if (!('Notification' in window)) {
        throw new Error('Notifications non supportées par ce navigateur')
      }

      if (Notification.permission === 'granted') {
        console.log('✅ Permission notifications déjà accordée')
        return true
      }

      if (Notification.permission === 'denied') {
        throw new Error('Permission notifications refusée')
      }

      const permission = await Notification.requestPermission()

      if (permission === 'granted') {
        console.log('✅ Permission notifications accordée')
        return true
      } else {
        throw new Error("Permission notifications refusée par l'utilisateur")
      }
    } catch (err) {
      error.value = err
      console.error('Erreur demande permission:', err)
      throw err
    }
  }

  /**
   * Joue un son de notification
   */
  const playSound = (soundType = 'notification') => {
    try {
      const sounds = {
        emergency: '/sounds/emergency.mp3',
        alert: '/sounds/alert.mp3',
        notification: '/sounds/notification.mp3',
      }

      const soundUrl = sounds[soundType] || sounds.notification
      const audio = new Audio(soundUrl)
      audio.volume = 0.5
      audio.play().catch((err) => {
        console.warn('Impossible de jouer le son:', err)
      })
    } catch (err) {
      console.warn('Erreur lecture son:', err)
    }
  }

  /**
   * Déclenche une vibration
   */
  const vibrate = (pattern = [100]) => {
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate(pattern)
      }
    } catch (err) {
      console.warn('Erreur vibration:', err)
    }
  }

  /**
   * Ajoute une notification reçue
   */
  const addNotification = (notification) => {
    try {
      // Vérifier si la notification existe déjà
      const exists = notifications.value.some((n) => n.id === notification.id)
      if (exists) {
        console.log(`⏭️ Notification ${notification.id} déjà présente`)
        return
      }

      // Ajouter au début de la liste
      notifications.value.unshift({
        ...notification,
        read: false,
        actioned: false,
        receivedAt: Date.now(),
      })

      // Incrémenter le compteur de non lues
      unreadCount.value++

      // Jouer un son selon la priorité
      if (notification.priority === 'CRITICAL') {
        playSound('emergency')
        vibrate([200, 100, 200, 100, 200])
      } else if (notification.priority === 'HIGH') {
        playSound('alert')
        vibrate([200, 100, 200])
      } else {
        playSound('notification')
        vibrate([100])
      }

      console.log(`📬 Nouvelle notification reçue: ${notification.type}`)

      // Limiter le nombre de notifications stockées
      if (notifications.value.length > 100) {
        notifications.value = notifications.value.slice(0, 100)
      }
    } catch (err) {
      console.error('Erreur ajout notification:', err)
    }
  }

  /**
   * Connecte aux notifications temps réel (WebSocket)
   */
  const connect = async (userId) => {
    try {
      console.log('🔌 Connexion aux notifications temps réel...')

      // Importer le client GraphQL
      const { generateClient } = await import('aws-amplify/api')
      const client = generateClient()

      // S'abonner aux notifications
      subscription = client
        .graphql({
          query: `
          subscription OnNotification($userId: ID!) {
            onNotification(userId: $userId) {
              id
              type
              priority
              title
              message
              data
              createdAt
              actionUrl
              actionLabel
            }
          }
        `,
          variables: { userId },
        })
        .subscribe({
          next: ({ data }) => {
            if (data?.onNotification) {
              addNotification(data.onNotification)
            }
          },
          error: (err) => {
            console.error('❌ Erreur subscription:', err)
            isConnected.value = false

            // Tentative de reconnexion après 5 secondes
            setTimeout(() => {
              if (!isConnected.value) {
                connect(userId)
              }
            }, 5000)
          },
        })

      isConnected.value = true
      console.log('✅ Connecté aux notifications temps réel')
    } catch (err) {
      error.value = err
      isConnected.value = false
      console.error('Erreur connexion notifications:', err)
      throw err
    }
  }

  /**
   * Déconnecte des notifications temps réel
   */
  const disconnect = () => {
    try {
      if (subscription) {
        subscription.unsubscribe()
        subscription = null
      }
      isConnected.value = false
      console.log('🔌 Déconnecté des notifications temps réel')
    } catch (err) {
      console.error('Erreur déconnexion:', err)
    }
  }

  /**
   * Obtient les statistiques
   */
  const getStats = () => {
    return notificationService.getStats()
  }

  // Propriétés calculées
  const unreadNotifications = computed(() => notifications.value.filter((n) => !n.read))

  const criticalNotifications = computed(() =>
    notifications.value.filter((n) => n.priority === 'CRITICAL' && !n.read),
  )

  const hasUnread = computed(() => unreadCount.value > 0)

  const hasCritical = computed(() => criticalNotifications.value.length > 0)

  const notificationsByType = computed(() => {
    const grouped = {}
    notifications.value.forEach((notification) => {
      if (!grouped[notification.type]) {
        grouped[notification.type] = []
      }
      grouped[notification.type].push(notification)
    })
    return grouped
  })

  const notificationsByPriority = computed(() => {
    const grouped = {
      CRITICAL: [],
      HIGH: [],
      NORMAL: [],
      LOW: [],
    }
    notifications.value.forEach((notification) => {
      grouped[notification.priority].push(notification)
    })
    return grouped
  })

  // Cleanup lors du démontage
  onUnmounted(() => {
    disconnect()
  })

  return {
    // États
    notifications,
    unreadCount,
    isConnected,
    isSending,
    error,

    // Propriétés calculées
    unreadNotifications,
    criticalNotifications,
    hasUnread,
    hasCritical,
    notificationsByType,
    notificationsByPriority,

    // Actions
    sendNotification,
    markAsRead,
    markAsActioned,
    markAllAsRead,
    deleteNotification,
    clearAll,
    requestPermission,
    playSound,
    vibrate,
    connect,
    disconnect,
    getStats,

    // Service pour usage avancé
    notificationService,
  }
}
