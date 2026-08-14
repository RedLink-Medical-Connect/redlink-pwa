import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { RequestStatus, MissionStatus } from '@/constants/enums'
import {
  useClinicHistory,
  deriveHistoryEvents,
  HistoryEventType,
} from '@/composables/useClinicHistory'

// Phase 3.3: HistoryView.vue's real activity feed. `deriveHistoryEvents` is the pure,
// framework-free seam (event-derivation rules for a single Request) — tested in isolation
// below without any GraphQL/composable involved. `useClinicHistory` itself is tested
// through its reuse of `useClinicRequest.js` (mocked at the aws-amplify boundary, same
// convention as useClinicRequest.spec.js).

vi.mock('aws-amplify/api', () => ({
  generateClient: vi.fn(),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

describe('deriveHistoryEvents', () => {
  const baseRequest = {
    id: 'req-1',
    requiredSpecies: 'DOG',
    requiredBloodGroup: 'DEA 1.1-',
    status: RequestStatus.OPEN,
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z',
    mission: null,
  }

  it('produces a single REQUEST_CREATED event for a Request with no Mission (not closed)', () => {
    const events = deriveHistoryEvents(baseRequest)

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(HistoryEventType.REQUEST_CREATED)
    expect(events[0].timestamp).toBe(baseRequest.createdAt)
  })

  it('does not add a REQUEST_CLOSED event for a Request with no Mission that is still IN_PROGRESS', () => {
    const events = deriveHistoryEvents({ ...baseRequest, status: RequestStatus.IN_PROGRESS })

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(HistoryEventType.REQUEST_CREATED)
  })

  it('produces REQUEST_CREATED + MISSION_ACCEPTED for an accepted-but-not-closed Mission', () => {
    const request = {
      ...baseRequest,
      mission: {
        id: 'mission-1',
        status: MissionStatus.ACCEPTED,
        createdAt: '2026-01-02T10:00:00.000Z',
        updatedAt: '2026-01-02T10:00:00.000Z',
        animal: { name: 'Rex' },
      },
    }

    const events = deriveHistoryEvents(request)

    expect(events).toHaveLength(2)
    expect(events.map((e) => e.type)).toEqual([
      HistoryEventType.REQUEST_CREATED,
      HistoryEventType.MISSION_ACCEPTED,
    ])
    expect(events[1].timestamp).toBe(request.mission.createdAt)
    expect(events[1].donorName).toBe('Rex')
  })

  it('produces exactly 2 events for an IN_PROGRESS Request with a Mission still PENDING_ARRIVAL (not yet closed)', () => {
    // Guards against a premature MISSION_COMPLETED/MISSION_NO_SHOW/REQUEST_CLOSED event
    // appearing before the Mission actually closes. Also exercises PENDING_ARRIVAL, the
    // other non-closed MissionStatus (the earlier "accepted-but-not-closed" test only
    // covers ACCEPTED), and request.status === IN_PROGRESS explicitly — deriveHistoryEvents
    // never reads request.status once a Mission exists, so this pins that down too.
    const request = {
      ...baseRequest,
      status: RequestStatus.IN_PROGRESS,
      mission: {
        id: 'mission-2',
        status: MissionStatus.PENDING_ARRIVAL,
        createdAt: '2026-01-02T10:00:00.000Z',
        updatedAt: '2026-01-02T10:00:00.000Z',
        animal: { name: 'Milo' },
      },
    }

    const events = deriveHistoryEvents(request)

    expect(events).toHaveLength(2)
    expect(events.map((e) => e.type)).toEqual([
      HistoryEventType.REQUEST_CREATED,
      HistoryEventType.MISSION_ACCEPTED,
    ])
    expect(events[1].timestamp).toBe(request.mission.createdAt)
  })

  it('produces 3 events (REQUEST_CREATED + MISSION_ACCEPTED + MISSION_COMPLETED) for a COMPLETED Mission', () => {
    const request = {
      ...baseRequest,
      mission: {
        id: 'mission-1',
        status: MissionStatus.COMPLETED,
        createdAt: '2026-01-02T10:00:00.000Z',
        updatedAt: '2026-01-03T10:00:00.000Z',
        animal: { name: 'Rex' },
      },
    }

    const events = deriveHistoryEvents(request)

    expect(events).toHaveLength(3)
    expect(events.map((e) => e.type)).toEqual([
      HistoryEventType.REQUEST_CREATED,
      HistoryEventType.MISSION_ACCEPTED,
      HistoryEventType.MISSION_COMPLETED,
    ])
    // mission.updatedAt is used as the closure timestamp (documented assumption in
    // useClinicHistory.js: no dedicated closedAt field on Mission).
    expect(events[2].timestamp).toBe(request.mission.updatedAt)
  })

  it('produces 3 events (REQUEST_CREATED + MISSION_ACCEPTED + MISSION_NO_SHOW) for a NO_SHOW Mission', () => {
    const request = {
      ...baseRequest,
      mission: {
        id: 'mission-1',
        status: MissionStatus.NO_SHOW,
        createdAt: '2026-01-02T10:00:00.000Z',
        updatedAt: '2026-01-03T10:00:00.000Z',
        animal: { name: 'Rex' },
      },
    }

    const events = deriveHistoryEvents(request)

    expect(events).toHaveLength(3)
    expect(events[2].type).toBe(HistoryEventType.MISSION_NO_SHOW)
    expect(events[2].timestamp).toBe(request.mission.updatedAt)
  })

  it('produces REQUEST_CREATED + REQUEST_CLOSED (2 events, not 1) for a Request closed without ever getting a Mission', () => {
    // Decision documented above deriveHistoryEvents in useClinicHistory.js: REQUEST_CREATED
    // is unconditional, so a Request closed without a Mission keeps BOTH its creation event
    // and gets a REQUEST_CLOSED event, rather than losing its creation from the feed. This
    // also keeps the event count consistent with the other branches (1 / 2 / 3 events as the
    // Request's lifecycle progresses further).
    const request = {
      ...baseRequest,
      status: RequestStatus.CLOSED,
      updatedAt: '2026-01-05T10:00:00.000Z',
    }

    const events = deriveHistoryEvents(request)

    expect(events).toHaveLength(2)
    expect(events.map((e) => e.type)).toEqual([
      HistoryEventType.REQUEST_CREATED,
      HistoryEventType.REQUEST_CLOSED,
    ])
    expect(events[0].timestamp).toBe(request.createdAt)
    expect(events[1].timestamp).toBe(request.updatedAt)
  })
})

describe('useClinicHistory > historyEvents', () => {
  let mockGraphql

  beforeEach(() => {
    vi.clearAllMocks()
    mockGraphql = vi.fn()
    generateClient.mockReturnValue({ graphql: mockGraphql })
    getCurrentUser.mockResolvedValue({ userId: 'vet-cognito-id' })
  })

  it('flattens and sorts the full event list newest-first across a mixed batch of requests', async () => {
    mockGraphql.mockResolvedValueOnce({
      data: { getVeterinarian: { clinicID: 'clinic-1' } },
    })
    mockGraphql.mockResolvedValueOnce({
      data: {
        listRequests: {
          items: [
            {
              id: 'req-old',
              requiredSpecies: 'DOG',
              requiredBloodGroup: 'DEA 1.1-',
              status: RequestStatus.CLOSED,
              createdAt: '2026-01-01T08:00:00.000Z',
              updatedAt: '2026-01-01T09:00:00.000Z',
              mission: null,
            },
            {
              id: 'req-new',
              requiredSpecies: 'CAT',
              requiredBloodGroup: 'A',
              status: RequestStatus.IN_PROGRESS,
              createdAt: '2026-01-10T08:00:00.000Z',
              updatedAt: '2026-01-10T08:00:00.000Z',
              mission: {
                id: 'mission-new',
                status: MissionStatus.ACCEPTED,
                createdAt: '2026-01-10T09:00:00.000Z',
                updatedAt: '2026-01-10T09:00:00.000Z',
                animal: { name: 'Mimi' },
              },
            },
          ],
        },
      },
    })

    const { historyEvents, fetchRequests } = useClinicHistory()
    await fetchRequests()

    expect(historyEvents.value.map((e) => e.timestamp)).toEqual([
      '2026-01-10T09:00:00.000Z', // req-new MISSION_ACCEPTED
      '2026-01-10T08:00:00.000Z', // req-new REQUEST_CREATED
      '2026-01-01T09:00:00.000Z', // req-old REQUEST_CLOSED
      '2026-01-01T08:00:00.000Z', // req-old REQUEST_CREATED
    ])
  })

  it('sorts a genuinely interleaved 3-request batch, not just a reversal of insertion order', async () => {
    mockGraphql.mockResolvedValueOnce({
      data: { getVeterinarian: { clinicID: 'clinic-1' } },
    })
    mockGraphql.mockResolvedValueOnce({
      data: {
        listRequests: {
          items: [
            {
              id: 'req-A',
              requiredSpecies: 'DOG',
              requiredBloodGroup: 'DEA 1.1-',
              status: RequestStatus.OPEN,
              createdAt: '2026-01-01T10:00:00.000Z',
              updatedAt: '2026-01-01T10:00:00.000Z',
              mission: null,
            },
            {
              id: 'req-B',
              requiredSpecies: 'CAT',
              requiredBloodGroup: 'A',
              status: RequestStatus.IN_PROGRESS,
              createdAt: '2026-01-03T10:00:00.000Z',
              updatedAt: '2026-01-03T10:00:00.000Z',
              mission: {
                id: 'mission-B',
                status: MissionStatus.ACCEPTED,
                createdAt: '2026-01-03T11:00:00.000Z',
                updatedAt: '2026-01-03T11:00:00.000Z',
                animal: { name: 'Nova' },
              },
            },
            {
              id: 'req-C',
              requiredSpecies: 'DOG',
              requiredBloodGroup: 'Dal',
              status: RequestStatus.CLOSED,
              createdAt: '2026-01-02T10:00:00.000Z',
              updatedAt: '2026-01-04T10:00:00.000Z',
              mission: null,
            },
          ],
        },
      },
    })

    const { historyEvents, fetchRequests } = useClinicHistory()
    await fetchRequests()

    // Insertion order is [A, B, C] (flatMap yields A-created, B-created, B-accepted,
    // C-created, C-closed). Req-C's own two events end up split apart in the sorted
    // output below (C-closed first, C-created fourth) — genuinely interleaved with req-B's
    // events, not a batch whose events already happened to be in the right order, nor a
    // simple reversal of insertion order (which would put req-C's two events adjacent).
    expect(historyEvents.value.map((e) => e.timestamp)).toEqual([
      '2026-01-04T10:00:00.000Z', // req-C REQUEST_CLOSED
      '2026-01-03T11:00:00.000Z', // req-B MISSION_ACCEPTED
      '2026-01-03T10:00:00.000Z', // req-B REQUEST_CREATED
      '2026-01-02T10:00:00.000Z', // req-C REQUEST_CREATED
      '2026-01-01T10:00:00.000Z', // req-A REQUEST_CREATED
    ])
  })

  it('propagates loadError from the underlying useClinicRequest fetch failure', async () => {
    mockGraphql.mockResolvedValueOnce({
      data: { getVeterinarian: { clinicID: 'clinic-1' } },
    })
    mockGraphql.mockRejectedValueOnce(new Error('network down'))

    const { loadError, fetchRequests } = useClinicHistory()
    expect(loadError.value).toBe(false)

    await fetchRequests()

    expect(loadError.value).toBe(true)
  })
})
