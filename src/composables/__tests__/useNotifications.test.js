import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Système de notifications (badge + email), 2026-09-17 -- même convention de mock que
// `useClinicVerification.test.js` (mock dédié par méthode plutôt qu'un unique `graphqlMock`).
// `startAutoRefresh`/`stopAutoRefresh` ne sont PAS testés ici (setInterval/visibilitychange,
// même périmètre non testé que leur modèle `useMatchingRequests.js`) -- portée : ce que
// `fetchNotifications`/`markAsRead`/`unreadCount` font réellement.

const listMock = vi.fn()
const updateMock = vi.fn()

vi.mock('@/services/bff-graphql-client', () => ({
  generateClient: () => ({
    models: {
      Notification: {
        list: (...args) => listMock(...args),
        update: (...args) => updateMock(...args),
      },
    },
  }),
}))

import { useNotifications } from '@/composables/useNotifications'

const notif = (overrides = {}) => ({
  id: 'n-1',
  type: 'CLINIC_VERIFIED',
  titleKey: 'notifications.types.CLINIC_VERIFIED.title',
  bodyKey: null,
  data: { clinicName: 'Clinique Alfort' },
  link: 'dashboard',
  read: false,
  createdAt: '2026-09-17T10:00:00.000Z',
  ...overrides,
})

describe('useNotifications', () => {
  beforeEach(() => {
    listMock.mockReset()
    updateMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetchNotifications charge et trie par createdAt décroissant (la plus récente en premier)', async () => {
    listMock.mockResolvedValue({
      data: [
        notif({ id: 'old', createdAt: '2026-09-15T10:00:00.000Z' }),
        notif({ id: 'new', createdAt: '2026-09-17T10:00:00.000Z' }),
      ],
      errors: undefined,
    })

    const { notifications, fetchNotifications } = useNotifications()
    await fetchNotifications()

    expect(notifications.value.map((n) => n.id)).toEqual(['new', 'old'])
    expect(listMock).toHaveBeenCalledWith({
      selectionSet: ['id', 'type', 'titleKey', 'bodyKey', 'data', 'link', 'read', 'createdAt'],
    })
  })

  it('unreadCount compte uniquement les notifications non lues', async () => {
    listMock.mockResolvedValue({
      data: [notif({ id: 'a', read: false }), notif({ id: 'b', read: true }), notif({ id: 'c', read: false })],
      errors: undefined,
    })

    const { unreadCount, fetchNotifications } = useNotifications()
    await fetchNotifications()

    expect(unreadCount.value).toBe(2)
  })

  it('fetchNotifications explicite (non silencieux) pilote isLoading/loadError', async () => {
    listMock.mockResolvedValue({ data: [], errors: undefined })

    const { isLoading, loadError, fetchNotifications } = useNotifications()
    const promise = fetchNotifications()
    expect(isLoading.value).toBe(true)
    await promise

    expect(isLoading.value).toBe(false)
    expect(loadError.value).toBe(false)
  })

  it('fetchNotifications silencieux (polling) ne touche jamais isLoading/loadError, même en échec', async () => {
    listMock.mockRejectedValue(new Error('boom'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { isLoading, loadError, fetchNotifications } = useNotifications()
    await fetchNotifications({ silent: true })

    expect(isLoading.value).toBe(false)
    expect(loadError.value).toBe(false)
    consoleErrorSpy.mockRestore()
  })

  it('un échec explicite pose loadError = true', async () => {
    listMock.mockRejectedValue(new Error('boom'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { loadError, fetchNotifications } = useNotifications()
    await fetchNotifications()

    expect(loadError.value).toBe(true)
    consoleErrorSpy.mockRestore()
  })

  it('markAsRead met à jour l’état local de façon optimiste ET appelle client.models.Notification.update()', async () => {
    listMock.mockResolvedValue({ data: [notif({ id: 'n-1', read: false })], errors: undefined })
    updateMock.mockResolvedValue({ data: { id: 'n-1', read: true }, errors: undefined })

    const { notifications, fetchNotifications, markAsRead } = useNotifications()
    await fetchNotifications()
    await markAsRead('n-1')

    expect(notifications.value[0].read).toBe(true)
    expect(updateMock).toHaveBeenCalledWith({ id: 'n-1', read: true })
  })

  it("markAsRead : un échec réseau est loggé mais NE REVIENT PAS sur l'état local optimiste (best-effort)", async () => {
    listMock.mockResolvedValue({ data: [notif({ id: 'n-1', read: false })], errors: undefined })
    updateMock.mockRejectedValue(new Error('boom'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { notifications, fetchNotifications, markAsRead } = useNotifications()
    await fetchNotifications()
    await markAsRead('n-1')

    expect(notifications.value[0].read).toBe(true)
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})
