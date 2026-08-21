import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCurrentUser } from 'aws-amplify/auth'
import { Species } from '@/constants/enums'
import { useClinicRequests } from '@/composables/useClinicRequest'

// Regression coverage for fix #3 on branch fix/data-model-risks: the species mapping in
// createNewRequest used to silently fall back to Species.DOG for any unrecognized value
// (`speciesMap[...] || 'DOG'`). In a blood-matching context that silently creates a Request
// for the wrong species, which is a data-integrity risk, not a cosmetic bug. It must now throw
// instead, and the previously-supported variants must keep mapping correctly.
//
// Phase 8, sous-tâche 5 (lot 2/3) : useClinicRequest.js migré sur le client Gen2
// (`aws-amplify/data`, `client.models.Veterinarian.get()`/`client.models.Request.create()`/
// `.list()`) -- mock reconstruit sur `{ data, errors }` par méthode de modèle plutôt que
// `client.graphql({ query, variables })`. Assertions métier (mapping d'espèce, format des
// logs d'erreur, loadError) inchangées.

const vetGetMock = vi.fn()
const requestCreateMock = vi.fn()
const requestListMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Veterinarian: { get: (...args) => vetGetMock(...args) },
      Request: {
        create: (...args) => requestCreateMock(...args),
        list: (...args) => requestListMock(...args),
        update: vi.fn(),
      },
    },
  }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

describe('useClinicRequests > createNewRequest species mapping', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    getCurrentUser.mockResolvedValue({ userId: 'vet-cognito-id' })
    // First call in any createNewRequest flow is always fetchClinicId's Veterinarian.get().
    vetGetMock.mockResolvedValue({ data: { id: 'vet-cognito-id', clinicID: 'clinic-1' }, errors: undefined })
  })

  const baseFormData = {
    bloodGroup: 'DEA 1.1-',
    quantity: '1',
    type: 'appointment',
  }

  it('throws a clear error for an unrecognized species and does not attempt to create the request', async () => {
    const { createNewRequest } = useClinicRequests()

    await expect(
      createNewRequest({ ...baseFormData, species: 'lapin' }),
    ).rejects.toThrow(/Espèce non reconnue/)

    // Only the fetchClinicId lookup should have happened — never Request.create().
    expect(vetGetMock).toHaveBeenCalledTimes(1)
    expect(requestCreateMock).not.toHaveBeenCalled()
  })

  it('throws for an empty/undefined species instead of defaulting to DOG', async () => {
    const { createNewRequest } = useClinicRequests()

    await expect(
      createNewRequest({ ...baseFormData, species: undefined }),
    ).rejects.toThrow(/Espèce non reconnue/)
    expect(vetGetMock).toHaveBeenCalledTimes(1)
    expect(requestCreateMock).not.toHaveBeenCalled()
  })

  it.each([
    ['dog', Species.DOG],
    ['DOG', Species.DOG],
    ['chien', Species.DOG],
    ['Chien', Species.DOG],
    ['cat', Species.CAT],
    ['CAT', Species.CAT],
    ['chat', Species.CAT],
    ['Chat', Species.CAT],
  ])('maps species variant "%s" to %s and proceeds to create the request', async (input, expected) => {
    requestCreateMock.mockResolvedValueOnce({ data: { id: 'req-1', status: 'OPEN' }, errors: undefined })
    requestListMock.mockResolvedValueOnce({ data: [], errors: undefined })

    const { createNewRequest } = useClinicRequests()

    await createNewRequest({ ...baseFormData, species: input })

    expect(vetGetMock).toHaveBeenCalledTimes(1)
    expect(requestCreateMock).toHaveBeenCalledTimes(1)
    expect(requestListMock).toHaveBeenCalledTimes(1)
    const [createInput] = requestCreateMock.mock.calls[0]
    expect(createInput.requiredSpecies).toBe(expected)
  })
})

// Phase 7.6 (R-05, R-17): createNewRequest's catch block used to index `e.errors[0].message`
// as soon as `e.errors` was truthy, without checking it actually had an item — an error shape
// with a present-but-empty `errors` array threw a fresh TypeError from inside the error-logging
// code itself, masking the original GraphQL creation error entirely. R-17 also removed the two
// debug `console.log` calls (with emoji, full input payload) that used to run on every request
// creation — a PII risk in CloudWatch (roadmap Phase -1.C).
describe('useClinicRequests > createNewRequest error logging (R-05, R-17)', () => {
  let consoleErrorSpy
  let consoleLogSpy

  const baseFormData = {
    bloodGroup: 'DEA 1.1-',
    quantity: '1',
    type: 'appointment',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentUser.mockResolvedValue({ userId: 'vet-cognito-id' })
    vetGetMock.mockResolvedValue({ data: { id: 'vet-cognito-id', clinicID: 'clinic-1' }, errors: undefined })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('does not throw a masking TypeError when e.errors is present but empty — the original error still propagates', async () => {
    const graphqlErrorWithEmptyErrors = Object.assign(new Error('création refusée'), {
      errors: [],
    })
    requestCreateMock.mockRejectedValueOnce(graphqlErrorWithEmptyErrors)

    const { createNewRequest } = useClinicRequests()

    await expect(
      createNewRequest({ ...baseFormData, species: 'dog' }),
    ).rejects.toBe(graphqlErrorWithEmptyErrors)

    // Falls back to logging the raw error (the `else` branch), never attempts e.errors[0].
    expect(consoleErrorSpy).toHaveBeenCalledWith(graphqlErrorWithEmptyErrors)
  })

  it('still logs the backend message/errorType when e.errors has at least one entry', async () => {
    const graphqlError = {
      errors: [{ message: 'Espèce invalide côté serveur', errorType: 'ValidationException' }],
    }
    requestCreateMock.mockRejectedValueOnce(graphqlError)

    const { createNewRequest } = useClinicRequests()

    await expect(createNewRequest({ ...baseFormData, species: 'dog' })).rejects.toBe(graphqlError)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '👉 Message Backend :',
      'Espèce invalide côté serveur',
    )
    expect(consoleErrorSpy).toHaveBeenCalledWith("👉 Type d'erreur :", 'ValidationException')
  })

  it('surfaces a GraphQL/@auth failure resolved as `{ data: null, errors }` the same way as a thrown exception', async () => {
    requestCreateMock.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'Not Authorized to access createRequest', errorType: 'Unauthorized' }],
    })

    const { createNewRequest } = useClinicRequests()

    await expect(createNewRequest({ ...baseFormData, species: 'dog' })).rejects.toThrow(
      'Erreur GraphQL createRequest',
    )

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '👉 Message Backend :',
      'Not Authorized to access createRequest',
    )
  })

  it('never calls console.log (debug logs removed) on a successful creation', async () => {
    requestCreateMock.mockResolvedValueOnce({ data: { id: 'req-1', status: 'OPEN' }, errors: undefined })
    requestListMock.mockResolvedValueOnce({ data: [], errors: undefined })

    const { createNewRequest } = useClinicRequests()
    await createNewRequest({ ...baseFormData, species: 'dog' })

    expect(consoleLogSpy).not.toHaveBeenCalled()
  })
})

// Phase 3.3: `loadError` added to `fetchRequests()` — same convention documented in
// CLAUDE.md and already covered for useClinicDonors.js/useAnimalValidation.js. Consumed
// by useClinicHistory.js (HistoryView.vue), purely additive to RequestsView.vue (which
// doesn't destructure it, see git diff for this branch).
describe('useClinicRequests > fetchRequests loadError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentUser.mockResolvedValue({ userId: 'vet-cognito-id' })
  })

  it('sets loadError to true when the Request.list() call fails after resolving clinicId', async () => {
    vetGetMock.mockResolvedValueOnce({ data: { id: 'vet-cognito-id', clinicID: 'clinic-1' }, errors: undefined })
    requestListMock.mockRejectedValueOnce(new Error('network down'))

    const { fetchRequests, loadError } = useClinicRequests()
    expect(loadError.value).toBe(false)

    await fetchRequests()

    expect(loadError.value).toBe(true)
  })

  it('resets loadError to false at the start of the next successful fetch', async () => {
    vetGetMock.mockResolvedValueOnce({ data: { id: 'vet-cognito-id', clinicID: 'clinic-1' }, errors: undefined })
    requestListMock.mockRejectedValueOnce(new Error('network down'))

    const { fetchRequests, loadError } = useClinicRequests()
    await fetchRequests()
    expect(loadError.value).toBe(true)

    // clinicId is memoized on the composable instance (fetchClinicId()), so the retry only
    // issues the Request.list() call, not a second Veterinarian.get() lookup.
    requestListMock.mockResolvedValueOnce({ data: [], errors: undefined })
    await fetchRequests()

    expect(loadError.value).toBe(false)
    expect(vetGetMock).toHaveBeenCalledTimes(1)
  })
})

// Phase 7.6 (R-12): fetchClinicId() used to swallow every failure into a bare
// `console.error` + `return null`, so fetchRequests() could never tell apart a real failure
// to resolve the clinic context (network/@auth/getCurrentUser) from the legitimate "this
// Veterinarian genuinely has no clinicID yet" case — both surfaced identically as an empty
// list with loadError left at false. fetchClinicId() no longer catches its own errors (same
// pattern as fetchClinicContext() in useClinicDonors.js): a thrown error now propagates
// straight into fetchRequests()'s own try/catch, which is the one that sets loadError.
describe('useClinicRequests > fetchRequests / fetchClinicId error vs. "no clinic" distinction (R-12)', () => {
  let consoleErrorSpy

  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentUser.mockResolvedValue({ userId: 'vet-cognito-id' })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('sets loadError to true (and does not just show an empty list) when Veterinarian.get() itself fails', async () => {
    vetGetMock.mockRejectedValueOnce(new Error('réseau : timeout'))

    const { fetchRequests, requests, loadError } = useClinicRequests()

    await fetchRequests()

    expect(loadError.value).toBe(true)
    // Only the failed Veterinarian.get() lookup was attempted — Request.list() never runs
    // without a resolved clinicId.
    expect(requestListMock).not.toHaveBeenCalled()
    expect(requests.value).toEqual([])
  })

  it('keeps loadError false (legitimate "no clinic yet" case) when Veterinarian.get() succeeds but the Veterinarian has no clinicID', async () => {
    vetGetMock.mockResolvedValueOnce({ data: { id: 'vet-cognito-id', clinicID: null }, errors: undefined })

    const { fetchRequests, requests, loadError } = useClinicRequests()

    await fetchRequests()

    expect(loadError.value).toBe(false)
    expect(requests.value).toEqual([])
    // No Request.list() call either — this is the same "no clinic" short-circuit as
    // before, just no longer confused with a real error.
    expect(requestListMock).not.toHaveBeenCalled()
  })

  it('keeps loadError false when Veterinarian.get() resolves to no Veterinarian record at all', async () => {
    vetGetMock.mockResolvedValueOnce({ data: null, errors: undefined })

    const { fetchRequests, loadError } = useClinicRequests()

    await fetchRequests()

    expect(loadError.value).toBe(false)
  })
})
