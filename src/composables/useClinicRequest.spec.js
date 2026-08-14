import { describe, it, expect, vi, beforeEach } from 'vitest'
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
