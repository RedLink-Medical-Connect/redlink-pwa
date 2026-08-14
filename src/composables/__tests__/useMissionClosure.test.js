import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Phase 2.1 (ADR-0003) : useMissionClosure() expose closeMission(missionId, animalId,
// outcome) — logique + mutations uniquement, aucun câblage UI dans cette sous-tâche.
//
// - Toujours : Mission.status -> outcome (closeMissionSimple).
// - Seulement si outcome === COMPLETED : Animal.lastDonationDate -> aujourd'hui, format
//   AWSDate (YYYY-MM-DD), via updateAnimalLastDonationDateSimple.
// - NO_SHOW ne touche jamais Animal.
// - outcome invalide -> throw INVALID_OUTCOME avant tout appel GraphQL.

const graphqlMock = vi.fn()

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}))

import { useMissionClosure } from '@/composables/useMissionClosure'
import { MissionStatus } from '@/constants/enums'

describe('useMissionClosure.closeMission', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('COMPLETED : met à jour Mission.status ET Animal.lastDonationDate, dans cet ordre, avec la date du jour au format AWSDate exact (YYYY-MM-DD)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T21:47:33.123Z'))

    const calls = []
    graphqlMock.mockImplementation(async ({ query, variables }) => {
      calls.push({ query, variables })
      if (query.includes('CloseMission')) {
        return { data: { updateMission: { id: variables.input.id, status: variables.input.status } } }
      }
      if (query.includes('UpdateAnimalLastDonationDate')) {
        return {
          data: {
            updateAnimal: { id: variables.input.id, lastDonationDate: variables.input.lastDonationDate },
          },
        }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { closeMission, isClosing } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)

    expect(graphqlMock).toHaveBeenCalledTimes(2)

    expect(calls[0].query).toContain('CloseMission')
    expect(calls[0].variables).toEqual({
      input: { id: 'mission-1', status: 'COMPLETED' },
    })

    expect(calls[1].query).toContain('UpdateAnimalLastDonationDate')
    expect(calls[1].variables).toEqual({
      input: { id: 'animal-1', lastDonationDate: '2026-08-14' },
    })
    // Format AWSDate strict : pas d'heure, pas de suffixe 'Z'/timezone.
    expect(calls[1].variables.input.lastDonationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    expect(isClosing.value).toBe(false)
  })

  it("NO_SHOW : met à jour Mission.status uniquement, n'appelle jamais la mutation Animal", async () => {
    graphqlMock.mockImplementation(async ({ query, variables }) => {
      if (query.includes('CloseMission')) {
        return { data: { updateMission: { id: variables.input.id, status: variables.input.status } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW)

    expect(graphqlMock).toHaveBeenCalledTimes(1)
    expect(graphqlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { input: { id: 'mission-1', status: 'NO_SHOW' } },
      }),
    )
  })

  it.each(['ACCEPTED', 'PENDING_ARRIVAL', 'CANCELLED', 'completed', '', null, undefined])(
    'outcome invalide (%s) : throw INVALID_OUTCOME avant tout appel GraphQL, ne coerce/ne défaulte jamais silencieusement',
    async (badOutcome) => {
      const { closeMission, isClosing } = useMissionClosure()

      await expect(closeMission('mission-1', 'animal-1', badOutcome)).rejects.toThrow(
        'INVALID_OUTCOME',
      )

      expect(graphqlMock).not.toHaveBeenCalled()
      expect(isClosing.value).toBe(false)
    },
  )

  it('isClosing : true pendant la clôture, false après succès', async () => {
    let isClosingDuringCall = null
    graphqlMock.mockImplementation(async () => {
      isClosingDuringCall = isClosing.value
      return { data: { updateMission: { id: 'mission-1', status: 'NO_SHOW' } } }
    })

    const { closeMission, isClosing } = useMissionClosure()
    expect(isClosing.value).toBe(false)

    await closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW)

    expect(isClosingDuringCall).toBe(true)
    expect(isClosing.value).toBe(false)
  })

  it('isClosing repasse à false même en cas d\'échec réseau/@auth sur la mutation Mission, et propage l\'erreur', async () => {
    const networkError = new Error('Network error')
    graphqlMock.mockRejectedValue(networkError)

    const { closeMission, isClosing } = useMissionClosure()

    await expect(closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)).rejects.toThrow(
      'Network error',
    )

    expect(isClosing.value).toBe(false)
  })

  it("propage l'erreur et repasse isClosing à false si la mutation Mission réussit mais la mutation Animal échoue (COMPLETED)", async () => {
    const animalError = new Error('Animal update failed')
    graphqlMock.mockImplementation(async ({ query, variables }) => {
      if (query.includes('CloseMission')) {
        return { data: { updateMission: { id: variables.input.id, status: variables.input.status } } }
      }
      if (query.includes('UpdateAnimalLastDonationDate')) {
        throw animalError
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { closeMission, isClosing } = useMissionClosure()

    await expect(closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)).rejects.toThrow(
      'Animal update failed',
    )

    expect(graphqlMock).toHaveBeenCalledTimes(2)
    expect(isClosing.value).toBe(false)
  })

  it('logue une erreur contextuelle en français avant de la propager', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    graphqlMock.mockRejectedValue(new Error('boom'))

    const { closeMission } = useMissionClosure()

    await expect(closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW)).rejects.toThrow()

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('clôture'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })
})
