import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase 6.6 : useClinicRequests() gagne cancelRequest() (transition Request.status ->
// RequestStatus.CANCELLED, distincte de closeRequest() -> RequestStatus.CLOSED) et des
// refs de loading dédiées (isClosing/isCancelling) consommées par la dialog de
// confirmation partagée dans RequestsView.vue. Ce fichier ne couvre QUE closeRequest()/
// cancelRequest() — fetchRequests()/createNewRequest() ne sont pas touchées par cette
// sous-tâche et n'ont pas de couverture préexistante à préserver (voir useClinicRequest.spec.js).
//
// Phase 8, sous-tâche 5 (lot 2/3) : useClinicRequest.js migré sur le client Gen2
// (`aws-amplify/data`, `client.models.Request.update()`) -- mock reconstruit sur
// `{ data, errors }` plutôt que `client.graphql({ query, variables })`. Assertions
// métier inchangées.

const requestUpdateMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Veterinarian: { get: vi.fn() },
      Request: {
        create: vi.fn(),
        list: vi.fn(),
        update: (...args) => requestUpdateMock(...args),
      },
    },
  }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(),
}))

// useClinicRequests() appelle useRouter() inconditionnellement (utilisé par
// createNewRequest, jamais exercée ici) — même stub que useMatchingRequests.test.js pour
// pouvoir instancier le composable hors d'un routeur monté.
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

import { useClinicRequests } from '@/composables/useClinicRequest'
import { RequestStatus } from '@/constants/enums'

describe('useClinicRequests.closeRequest', () => {
  beforeEach(() => {
    requestUpdateMock.mockReset()
  })

  it('transitionne vers RequestStatus.CLOSED via Request.update()', async () => {
    requestUpdateMock.mockResolvedValue({ data: { id: 'req-1', status: 'CLOSED' }, errors: undefined })

    const { closeRequest } = useClinicRequests()
    await closeRequest('req-1')

    expect(requestUpdateMock).toHaveBeenCalledWith({ id: 'req-1', status: 'CLOSED' })
  })

  it('met à jour uniquement la Request ciblée dans requests.value, sans toucher les autres', async () => {
    requestUpdateMock.mockResolvedValue({ data: { id: 'req-1', status: 'CLOSED' }, errors: undefined })

    const { closeRequest, requests } = useClinicRequests()
    requests.value = [
      { id: 'req-1', status: RequestStatus.OPEN },
      { id: 'req-2', status: RequestStatus.OPEN },
    ]

    await closeRequest('req-1')

    expect(requests.value.find((r) => r.id === 'req-1').status).toBe('CLOSED')
    expect(requests.value.find((r) => r.id === 'req-2').status).toBe(RequestStatus.OPEN)
  })

  it('isClosing passe à true pendant l’appel puis à false, y compris en cas d’échec', async () => {
    let resolveUpdate
    requestUpdateMock.mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve
      }),
    )

    const { closeRequest, isClosing } = useClinicRequests()
    expect(isClosing.value).toBe(false)

    const promise = closeRequest('req-1')
    expect(isClosing.value).toBe(true)
    resolveUpdate({ data: { id: 'req-1', status: 'CLOSED' }, errors: undefined })
    await promise

    expect(isClosing.value).toBe(false)
  })

  it("propage l'erreur et logue un message français contextuel, sans muter requests.value", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    requestUpdateMock.mockRejectedValue(new Error('network down'))

    const { closeRequest, requests, isClosing } = useClinicRequests()
    requests.value = [{ id: 'req-1', status: RequestStatus.OPEN }]

    await expect(closeRequest('req-1')).rejects.toThrow('network down')

    expect(requests.value[0].status).toBe(RequestStatus.OPEN)
    expect(isClosing.value).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('fermeture'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it("propage une erreur GraphQL/@auth résolue en `{ data: null, errors }` (pas juste une exception JS)", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    requestUpdateMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access updateRequest' }],
    })

    const { closeRequest, requests } = useClinicRequests()
    requests.value = [{ id: 'req-1', status: RequestStatus.OPEN }]

    await expect(closeRequest('req-1')).rejects.toThrow('Erreur GraphQL updateRequest')

    expect(requests.value[0].status).toBe(RequestStatus.OPEN)

    consoleErrorSpy.mockRestore()
  })
})

describe('useClinicRequests.cancelRequest', () => {
  beforeEach(() => {
    requestUpdateMock.mockReset()
  })

  it('transitionne vers RequestStatus.CANCELLED (enum, pas un littéral) via Request.update()', async () => {
    requestUpdateMock.mockResolvedValue({
      data: { id: 'req-1', status: 'CANCELLED' },
      errors: undefined,
    })

    const { cancelRequest } = useClinicRequests()
    await cancelRequest('req-1')

    expect(requestUpdateMock).toHaveBeenCalledWith({ id: 'req-1', status: RequestStatus.CANCELLED })
  })

  it('est bien distincte de closeRequest() : même Request, deux appels différents produisent deux statuts cibles différents', async () => {
    requestUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, status: input.status },
      errors: undefined,
    }))

    const { closeRequest, cancelRequest, requests } = useClinicRequests()
    requests.value = [{ id: 'req-1', status: RequestStatus.OPEN }]
    await closeRequest('req-1')
    expect(requests.value[0].status).toBe('CLOSED')

    requests.value = [{ id: 'req-2', status: RequestStatus.OPEN }]
    await cancelRequest('req-2')
    expect(requests.value[0].status).toBe(RequestStatus.CANCELLED)
  })

  it('met à jour uniquement la Request ciblée dans requests.value, sans toucher les autres', async () => {
    requestUpdateMock.mockResolvedValue({
      data: { id: 'req-1', status: 'CANCELLED' },
      errors: undefined,
    })

    const { cancelRequest, requests } = useClinicRequests()
    requests.value = [
      { id: 'req-1', status: RequestStatus.OPEN },
      { id: 'req-2', status: RequestStatus.OPEN },
    ]

    await cancelRequest('req-1')

    expect(requests.value.find((r) => r.id === 'req-1').status).toBe(RequestStatus.CANCELLED)
    expect(requests.value.find((r) => r.id === 'req-2').status).toBe(RequestStatus.OPEN)
  })

  it('isCancelling passe à true pendant l’appel puis à false, y compris en cas d’échec', async () => {
    let resolveUpdate
    requestUpdateMock.mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve
      }),
    )

    const { cancelRequest, isCancelling } = useClinicRequests()
    expect(isCancelling.value).toBe(false)

    const promise = cancelRequest('req-1')
    expect(isCancelling.value).toBe(true)
    resolveUpdate({ data: { id: 'req-1', status: 'CANCELLED' }, errors: undefined })
    await promise

    expect(isCancelling.value).toBe(false)
  })

  it("propage l'erreur et logue un message français contextuel, sans muter requests.value", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    requestUpdateMock.mockRejectedValue(new Error('network down'))

    const { cancelRequest, requests, isCancelling } = useClinicRequests()
    requests.value = [{ id: 'req-1', status: RequestStatus.OPEN }]

    await expect(cancelRequest('req-1')).rejects.toThrow('network down')

    expect(requests.value[0].status).toBe(RequestStatus.OPEN)
    expect(isCancelling.value).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('annulation'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })
})
