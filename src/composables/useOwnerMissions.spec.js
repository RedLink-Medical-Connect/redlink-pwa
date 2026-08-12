import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateClient } from 'aws-amplify/api'
import { useOwnerMissions } from '@/composables/useOwnerMissions'

// Regression coverage for fix #2 on branch fix/data-model-risks: schema.graphql's Request
// @auth rule was missing "update" on the private (Owner) rule, so linkRequestToMission (called
// from acceptMission as the last step of accepting a Mission) would 403 for an Owner. The @auth
// rule itself isn't exercisable from Vitest against a mock client — that's covered by the
// schema diff review — but this test proves the composable's call path: it issues the
// updateRequest-backed linkRequestToMission mutation with authMode: 'userPool' (the Owner's own
// session, not a group-elevated call), with no client-side gate/role-check that would itself
// block an Owner from reaching it.

vi.mock('aws-amplify/api', () => ({
  generateClient: vi.fn(),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: 'owner-cognito-id' }),
}))

describe('useOwnerMissions > acceptMission', () => {
  let mockGraphql

  beforeEach(() => {
    vi.clearAllMocks()
    mockGraphql = vi.fn()
    generateClient.mockReturnValue({ graphql: mockGraphql })
  })

  const request = {
    id: 'request-1',
    requiredSpecies: 'DOG',
    requiredBloodGroup: 'DEA 1.1-',
    requestType: 'APPOINTMENT',
  }

  const matchingAnimal = { id: 'animal-1', name: 'Rex', species: 'DOG', bloodGroup: 'DEA 1.1-' }

  it('calls linkRequestToMission (updateRequest under the hood) as the Owner via authMode userPool, with no client-side gate blocking it', async () => {
    mockGraphql
      .mockResolvedValueOnce({ data: { listAnimals: { items: [matchingAnimal] } } }) // listMyAnimalsSimple
      .mockResolvedValueOnce({ data: { createMission: { id: 'mission-1' } } }) // createMissionSimple
      .mockResolvedValueOnce({ data: { updateRequest: { id: 'request-1', status: 'IN_PROGRESS' } } }) // linkRequestToMission

    const { acceptMission } = useOwnerMissions()
    const donorName = await acceptMission(request)

    expect(donorName).toBe('Rex')
    expect(mockGraphql).toHaveBeenCalledTimes(3)

    const linkCall = mockGraphql.mock.calls[2][0]
    expect(linkCall.query).toContain('LinkRequestToMission')
    expect(linkCall.query).toContain('updateRequest')
    expect(linkCall.query).toContain('IN_PROGRESS')
    expect(linkCall.variables).toEqual({ id: 'request-1', activeMissionID: 'mission-1' })
    // This is the Owner's own authenticated session — not a group-elevated/admin call — which is
    // exactly the case the restored "update" @auth rule on the private/Owner rule exists for.
    expect(linkCall.authMode).toBe('userPool')
  })

  it('propagates (does not swallow) an auth failure from linkRequestToMission, so a missing @auth rule would surface as a thrown error, not a silently-lost accept', async () => {
    const authError = new Error('Not Authorized to access updateRequest on type Request')
    mockGraphql
      .mockResolvedValueOnce({ data: { listAnimals: { items: [matchingAnimal] } } })
      .mockResolvedValueOnce({ data: { createMission: { id: 'mission-1' } } })
      .mockRejectedValueOnce(authError)

    const { acceptMission, isAccepting } = useOwnerMissions()

    await expect(acceptMission(request)).rejects.toThrow(
      'Not Authorized to access updateRequest on type Request',
    )
    expect(isAccepting.value).toBe(false)
  })

  it('throws before attempting any mutation when the Owner has no matching animal', async () => {
    mockGraphql.mockResolvedValueOnce({ data: { listAnimals: { items: [] } } })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission(request)).rejects.toThrow('NO_MATCHING_ANIMAL')
    expect(mockGraphql).toHaveBeenCalledTimes(1)
  })
})
