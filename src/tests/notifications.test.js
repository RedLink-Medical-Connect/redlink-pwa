/**
 * Tests pour le système de notifications
 * Version stable et optimisée - Sprint 3.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

// Mocks globaux
vi.mock('@/composables/useAuth', () => ({
  useAuth: () => ({ user: { value: { id: 'user-123' } } }),
}))

vi.mock('@/utils/monitoring', () => ({
  useMonitoring: () => ({
    recordMetric: vi.fn(),
    recordError: vi.fn(),
  }),
}))

// Mock des APIs du navigateur
Object.defineProperty(window, 'Notification', {
  value: class MockNotification {
    constructor(title, options) {
      this.title = title
      this.options = options
    }
    static permission = 'granted'
    static requestPermission = vi.fn().mockResolvedValue('granted')
    close = vi.fn()
  },
  writable: true,
})

Object.defineProperty(navigator, 'vibrate', {
  value: vi.fn(),
  writable: true,
})

global.Audio = vi.fn().mockImplementation(function (src) {
  return {
    play: vi.fn().mockResolvedValue(),
    volume: 0.5,
    src,
  }
})

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  statusText: 'OK',
})

describe('NotificationService - Tests Finaux', () => {
  let NotificationService

  beforeEach(async () => {
    vi.clearAllMocks()
    const module = await import('@/services/notification-service')
    NotificationService = module.default
  })

  it('devrait créer une instance du service', () => {
    const service = new NotificationService()
    expect(service).toBeDefined()
    expect(service.channels).toBeDefined()
    expect(service.priorities).toBeDefined()
    expect(service.notificationTypes).toBeDefined()
  })

  it('devrait déterminer la priorité correctement', () => {
    const service = new NotificationService()

    expect(service.determinePriority('EMERGENCY_ALERT')).toBe('CRITICAL')
    expect(service.determinePriority('NEW_MATCH')).toBe('HIGH')
    expect(service.determinePriority('DONOR_EN_ROUTE')).toBe('NORMAL')
    expect(service.determinePriority('REMINDER')).toBe('LOW')
    expect(service.determinePriority('UNKNOWN_TYPE')).toBe('NORMAL')
  })

  it('devrait préparer une notification correctement', () => {
    const service = new NotificationService()

    const data = {
      userId: 'user-123',
      type: 'NEW_MATCH',
      title: 'Test',
      message: 'Message de test',
    }

    const notification = service.prepareNotification(data)

    expect(notification.userId).toBe('user-123')
    expect(notification.type).toBe('NEW_MATCH')
    expect(notification.priority).toBe('HIGH')
    expect(notification.title).toBe('Test')
    expect(notification.message).toBe('Message de test')
    expect(notification.id).toBeDefined()
    expect(notification.createdAt).toBeDefined()
  })

  it('devrait respecter les préférences utilisateur basiques', () => {
    const service = new NotificationService()

    const preferences = {
      channels: { websocket: true, push: false },
      schedule: {
        quietHours: { enabled: false },
        daysOff: [],
      },
      filters: {
        minPriority: 'HIGH',
        types: ['NEW_MATCH'],
      },
    }

    // Test notification acceptée
    const shouldSend = service.shouldSendNotification(
      { type: 'NEW_MATCH', priority: 'HIGH' },
      preferences,
    )
    expect(shouldSend).toBe(true)

    // Test notification refusée (priorité trop faible)
    const shouldNotSend = service.shouldSendNotification(
      { type: 'REMINDER', priority: 'LOW' },
      preferences,
    )
    expect(shouldNotSend).toBe(false)
  })

  it('devrait obtenir les canaux selon la priorité', () => {
    const service = new NotificationService()

    const preferences = {
      channels: { websocket: true, push: true, sms: false, email: true },
    }

    const criticalChannels = service.getChannelsForPriority('CRITICAL', preferences)
    expect(criticalChannels).toContain('websocket')
    expect(criticalChannels).toContain('push')
    expect(criticalChannels).not.toContain('sms') // Désactivé dans les préférences

    const normalChannels = service.getChannelsForPriority('NORMAL', preferences)
    expect(normalChannels).toEqual(['websocket'])
  })

  it('devrait marquer une notification comme lue', () => {
    const service = new NotificationService()

    // Simuler une notification envoyée
    const notificationId = 'test-123'
    service.sentNotifications.set(notificationId, {
      notification: { id: notificationId },
      read: false,
    })

    service.markAsRead(notificationId)

    const sentData = service.sentNotifications.get(notificationId)
    expect(sentData.read).toBe(true)
    expect(sentData.readAt).toBeDefined()
  })

  it('devrait obtenir les statistiques du service', () => {
    const service = new NotificationService()

    const stats = service.getStats()

    expect(stats).toHaveProperty('sentNotificationsCount')
    expect(stats).toHaveProperty('escalationQueueSize')
    expect(stats).toHaveProperty('unreadCount')
    expect(stats).toHaveProperty('channels')
  })
})

describe('NotificationBadge Component - Tests Finaux', () => {
  let NotificationBadge

  beforeEach(async () => {
    const module = await import('@/components/notifications/NotificationBadge.vue')
    NotificationBadge = module.default
  })

  it('devrait afficher le bon nombre', () => {
    const wrapper = mount(NotificationBadge, {
      props: { count: 5 },
    })

    expect(wrapper.text()).toBe('5')
    expect(wrapper.find('.badge').exists()).toBe(true)
  })

  it('devrait afficher 99+ pour les nombres élevés', () => {
    const wrapper = mount(NotificationBadge, {
      props: { count: 150, maxCount: 99 },
    })

    expect(wrapper.text()).toBe('99+')
  })

  it("ne devrait pas s'afficher si count = 0 et showZero = false", () => {
    const wrapper = mount(NotificationBadge, {
      props: { count: 0, showZero: false },
    })

    expect(wrapper.find('.notification-badge').exists()).toBe(false)
  })

  it('devrait appliquer la bonne classe de sévérité', () => {
    const wrapper = mount(NotificationBadge, {
      props: { count: 3, severity: 'danger' },
    })

    expect(wrapper.find('.badge-danger').exists()).toBe(true)
  })

  it('devrait afficher un point si dot = true', () => {
    const wrapper = mount(NotificationBadge, {
      props: { count: 1, dot: true },
    })

    expect(wrapper.find('.badge-dot').exists()).toBe(true)
    expect(wrapper.text()).toBe('')
  })

  it('devrait gérer les différentes positions', () => {
    const wrapper = mount(NotificationBadge, {
      props: { count: 1, position: 'top-right' },
    })

    expect(wrapper.find('.badge-top-right').exists()).toBe(true)
  })
})

describe('NotificationItem Component - Tests Finaux', () => {
  let NotificationItem

  const mockNotification = {
    id: 'notif-123',
    type: 'NEW_MATCH',
    priority: 'HIGH',
    title: 'Nouveau donneur',
    message: 'Un donneur compatible a été trouvé',
    createdAt: Date.now() - 300000, // 5 minutes ago
    read: false,
    actioned: false,
  }

  beforeEach(async () => {
    const module = await import('@/components/notifications/NotificationItem.vue')
    NotificationItem = module.default
  })

  it('devrait afficher les informations de la notification', () => {
    const wrapper = mount(NotificationItem, {
      props: { notification: mockNotification },
      global: {
        stubs: {
          Button: true,
          Tag: true,
          Menu: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Nouveau donneur')
    expect(wrapper.text()).toContain('Un donneur compatible a été trouvé')
    expect(wrapper.find('.notification-unread').exists()).toBe(true)
  })

  it("devrait émettre l'événement read au clic", async () => {
    const wrapper = mount(NotificationItem, {
      props: { notification: mockNotification },
      global: {
        stubs: {
          Button: true,
          Tag: true,
          Menu: true,
        },
      },
    })

    await wrapper.trigger('click')

    expect(wrapper.emitted('read')).toBeTruthy()
    expect(wrapper.emitted('read')[0][0]).toEqual(mockNotification)
  })

  it('devrait afficher la bonne icône selon le type', () => {
    const wrapper = mount(NotificationItem, {
      props: {
        notification: {
          ...mockNotification,
          type: 'DONOR_ACCEPTED',
        },
      },
      global: {
        stubs: {
          Button: true,
          Tag: true,
          Menu: true,
        },
      },
    })

    expect(wrapper.find('.pi-check-circle').exists()).toBe(true)
  })
})

describe("Tests d'intégration simplifiés", () => {
  it('devrait créer et utiliser le service de notifications', async () => {
    const { notificationService } = await import('@/services/notification-service')

    expect(notificationService).toBeDefined()
    expect(typeof notificationService.sendNotification).toBe('function')
    expect(typeof notificationService.markAsRead).toBe('function')

    const stats = notificationService.getStats()
    expect(stats).toHaveProperty('sentNotificationsCount')
  })

  it('devrait gérer les priorités de notification', async () => {
    const { notificationService } = await import('@/services/notification-service')

    expect(notificationService.determinePriority('EMERGENCY_ALERT')).toBe('CRITICAL')
    expect(notificationService.determinePriority('NEW_MATCH')).toBe('HIGH')

    const notification = notificationService.prepareNotification({
      userId: 'test',
      type: 'NEW_MATCH',
      title: 'Test',
      message: 'Test message',
    })

    expect(notification.priority).toBe('HIGH')
  })

  it('devrait valider la structure des composants', async () => {
    const [BadgeModule, ItemModule] = await Promise.all([
      import('@/components/notifications/NotificationBadge.vue'),
      import('@/components/notifications/NotificationItem.vue'),
    ])

    expect(BadgeModule.default).toBeDefined()
    expect(ItemModule.default).toBeDefined()

    // Test de montage basique
    const badgeWrapper = mount(BadgeModule.default, {
      props: { count: 1 },
    })

    expect(badgeWrapper.exists()).toBe(true)
  })
})
