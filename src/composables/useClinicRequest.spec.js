import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { Species } from '@/constants/enums'
import { useClinicRequests } from '@/composables/useClinicRequest'

// Regression coverage for fix #3 on branch fix/data-model-risks: the species mapping in
// createNewRequest used to silently fall back to Species.DOG for any unrecognized value
// (`speciesMap[...] || 'DOG'`). In a blood-matching context that silently creates a Request
// for the wrong species, which is a data-integrity risk, not a cosmetic bug. It must now throw
// instead, and the previously-supported variants must keep mapping correctly.

vi.mock('aws-amplify/api', () => ({
  generateClient: vi.fn(),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

describe('useClinicRequests > createNewRequest species mapping', () => {
  let mockGraphql

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGraphql = vi.fn()
    generateClient.mockReturnValue({ graphql: mockGraphql })
    getCurrentUser.mockResolvedValue({ userId: 'vet-cognito-id' })
    // First call in any createNewRequest flow is always fetchClinicId's getVeterinarian query.
    mockGraphql.mockResolvedValueOnce({
      data: { getVeterinarian: { clinicID: 'clinic-1' } },
    })
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

    // Only the fetchClinicId lookup should have happened — never the createRequestSimple call.
    expect(mockGraphql).toHaveBeenCalledTimes(1)
  })

  it('throws for an empty/undefined species instead of defaulting to DOG', async () => {
    const { createNewRequest } = useClinicRequests()

    await expect(
      createNewRequest({ ...baseFormData, species: undefined }),
    ).rejects.toThrow(/Espèce non reconnue/)
    expect(mockGraphql).toHaveBeenCalledTimes(1)
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
    // 2nd call: createRequestSimple. 3rd call: the fetchRequests() refresh createNewRequest
    // triggers internally after a successful create.
    mockGraphql.mockResolvedValueOnce({ data: { createRequest: { id: 'req-1' } } })
    mockGraphql.mockResolvedValueOnce({ data: { listRequests: { items: [] } } })

    const { createNewRequest } = useClinicRequests()

    await createNewRequest({ ...baseFormData, species: input })

    expect(mockGraphql).toHaveBeenCalledTimes(3)
    const [, createCall] = mockGraphql.mock.calls
    expect(createCall[0].variables.input.requiredSpecies).toBe(expected)
  })
})

// Phase 7.6 (R-05, R-17): createNewRequest's catch block used to index `e.errors[0].message`
// as soon as `e.errors` was truthy, without checking it actually had an item — an error shape
// with a present-but-empty `errors` array threw a fresh TypeError from inside the error-logging
// code itself, masking the original GraphQL creation error entirely. R-17 also removed the two
// debug `console.log` calls (with emoji, full input payload) that used to run on every request
// creation — a PII risk in CloudWatch (roadmap Phase -1.C).
describe('useClinicRequests > createNewRequest error logging (R-05, R-17)', () => {
  let mockGraphql
  let consoleErrorSpy
  let consoleLogSpy

  const baseFormData = {
    bloodGroup: 'DEA 1.1-',
    quantity: '1',
    type: 'appointment',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGraphql = vi.fn()
    generateClient.mockReturnValue({ graphql: mockGraphql })
    getCurrentUser.mockResolvedValue({ userId: 'vet-cognito-id' })
    mockGraphql.mockResolvedValueOnce({
      data: { getVeterinarian: { clinicID: 'clinic-1' } },
    })
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
    mockGraphql.mockRejectedValueOnce(graphqlErrorWithEmptyErrors)

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
    mockGraphql.mockRejectedValueOnce(graphqlError)

    const { createNewRequest } = useClinicRequests()

    await expect(createNewRequest({ ...baseFormData, species: 'dog' })).rejects.toBe(graphqlError)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '👉 Message Backend :',
      'Espèce invalide côté serveur',
    )
    expect(consoleErrorSpy).toHaveBeenCalledWith("👉 Type d'erreur :", 'ValidationException')
  })

  it('never calls console.log (debug logs removed) on a successful creation', async () => {
    mockGraphql.mockResolvedValueOnce({ data: { createRequest: { id: 'req-1' } } })
    mockGraphql.mockResolvedValueOnce({ data: { listRequests: { items: [] } } })

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
  let mockGraphql

  beforeEach(() => {
    vi.clearAllMocks()
    mockGraphql = vi.fn()
    generateClient.mockReturnValue({ graphql: mockGraphql })
    getCurrentUser.mockResolvedValue({ userId: 'vet-cognito-id' })
  })

  it('sets loadError to true when the listRequestsByClinic call fails after resolving clinicId', async () => {
    mockGraphql.mockResolvedValueOnce({
      data: { getVeterinarian: { clinicID: 'clinic-1' } },
    })
    mockGraphql.mockRejectedValueOnce(new Error('network down'))

    const { fetchRequests, loadError } = useClinicRequests()
    expect(loadError.value).toBe(false)

    await fetchRequests()

    expect(loadError.value).toBe(true)
  })

  it('resets loadError to false at the start of the next successful fetch', async () => {
    mockGraphql.mockResolvedValueOnce({
      data: { getVeterinarian: { clinicID: 'clinic-1' } },
    })
    mockGraphql.mockRejectedValueOnce(new Error('network down'))

    const { fetchRequests, loadError } = useClinicRequests()
    await fetchRequests()
    expect(loadError.value).toBe(true)

    // clinicId is memoized on the composable instance (fetchClinicId()), so the retry only
    // issues the listRequestsByClinic call, not a second getVeterinarian lookup.
    mockGraphql.mockResolvedValueOnce({ data: { listRequests: { items: [] } } })
    await fetchRequests()

    expect(loadError.value).toBe(false)
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
  let mockGraphql
  let consoleErrorSpy

  beforeEach(() => {
    vi.clearAllMocks()
    mockGraphql = vi.fn()
    generateClient.mockReturnValue({ graphql: mockGraphql })
    getCurrentUser.mockResolvedValue({ userId: 'vet-cognito-id' })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('sets loadError to true (and does not just show an empty list) when getVeterinarian itself fails', async () => {
    mockGraphql.mockRejectedValueOnce(new Error('réseau : timeout'))

    const { fetchRequests, requests, loadError } = useClinicRequests()

    await fetchRequests()

    expect(loadError.value).toBe(true)
    // Only the failed getVeterinarian lookup was attempted — listRequestsByClinic never
    // runs without a resolved clinicId.
    expect(mockGraphql).toHaveBeenCalledTimes(1)
    expect(requests.value).toEqual([])
  })

  it('keeps loadError false (legitimate "no clinic yet" case) when getVeterinarian succeeds but the Veterinarian has no clinicID', async () => {
    mockGraphql.mockResolvedValueOnce({
      data: { getVeterinarian: { clinicID: null } },
    })

    const { fetchRequests, requests, loadError } = useClinicRequests()

    await fetchRequests()

    expect(loadError.value).toBe(false)
    expect(requests.value).toEqual([])
    // No listRequestsByClinic call either — this is the same "no clinic" short-circuit as
    // before, just no longer confused with a real error.
    expect(mockGraphql).toHaveBeenCalledTimes(1)
  })

  it('keeps loadError false when getVeterinarian resolves to no Veterinarian record at all', async () => {
    mockGraphql.mockResolvedValueOnce({ data: { getVeterinarian: null } })

    const { fetchRequests, loadError } = useClinicRequests()

    await fetchRequests()

    expect(loadError.value).toBe(false)
  })
})
