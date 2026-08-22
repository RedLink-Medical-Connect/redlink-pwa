import { describe, it, expect, vi, beforeEach } from 'vitest'

// Sous-tâche Phase 7.2 (R-03, seul point encore classé Bloquant de la Phase 7) :
// `removeAvailability` avalait son erreur au lieu de la relancer (contrairement à
// `addAvailability`, qui la relance déjà) — un Owner qui échoue à retirer un créneau
// (réseau, `@auth`, etc.) ne voyait jamais que ça avait échoué. Ce fichier couvre :
// - succès et échec de `removeAvailability` (l'échec doit bien relancer/propager) ;
// - le tri des créneaux par `dayOfWeek` fait par `fetchAvailabilities`, cas particulier
//   dimanche = 0 (voir l'implémentation : `dayA = a.dayOfWeek === 0 ? 7 : a.dayOfWeek`,
//   donc dimanche est traité comme le 7e jour et doit apparaître EN DERNIER, pas en
//   premier comme le donnerait un tri numérique naïf sur `dayOfWeek` brut).
//
// Phase 8, sous-tâche 5 (lot 1/3) : mock migré vers le client Gen2 (`aws-amplify/data`,
// `client.models.OwnerAvailability.*`) -- un mock dédié par méthode plutôt qu'un unique
// `graphqlMock` discriminé par le texte de la query. Les assertions métier restent les
// mêmes qu'avant la migration (succès/échec de `removeAvailability`, compteur best-effort
// de `addAvailabilityForDays`, tri de `fetchAvailabilities`).

const availabilityListMock = vi.fn()
const availabilityCreateMock = vi.fn()
const availabilityDeleteMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      OwnerAvailability: {
        list: (...args) => availabilityListMock(...args),
        create: (...args) => availabilityCreateMock(...args),
        delete: (...args) => availabilityDeleteMock(...args),
      },
    },
  }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ userId: 'owner-1' })),
}))

import { useOwnerAvailability } from '@/composables/useOwnerAvailability'

const resetAllMocks = () => {
  availabilityListMock.mockReset()
  availabilityCreateMock.mockReset()
  availabilityDeleteMock.mockReset()
}

describe('useOwnerAvailability.removeAvailability', () => {
  beforeEach(resetAllMocks)

  it('supprime le créneau visé de availabilities.value en cas de succès', async () => {
    availabilityDeleteMock.mockImplementation(async ({ id }) => {
      expect(id).toBe('slot-1')
      return { data: { id: 'slot-1' }, errors: undefined }
    })

    const { availabilities, removeAvailability } = useOwnerAvailability()
    availabilities.value = [
      { id: 'slot-1', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
      { id: 'slot-2', dayOfWeek: 2, startTime: '11:00', endTime: '12:00' },
    ]

    await removeAvailability('slot-1')

    expect(availabilities.value.map((a) => a.id)).toEqual(['slot-2'])
    expect(availabilityDeleteMock).toHaveBeenCalledTimes(1)
  })

  it('relance (propage) l’erreur en cas d’échec réseau/exception JS, sans modifier availabilities.value (correction R-03)', async () => {
    const authError = new Error('Not Authorized to access deleteOwnerAvailability on type OwnerAvailability')
    availabilityDeleteMock.mockRejectedValue(authError)

    const { availabilities, removeAvailability } = useOwnerAvailability()
    availabilities.value = [{ id: 'slot-1', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }]

    await expect(removeAvailability('slot-1')).rejects.toBe(authError)

    // Avant la correction R-03, l'erreur était avalée : le composant appelant ne
    // pouvait jamais afficher d'échec à l'utilisateur.
    expect(availabilities.value.map((a) => a.id)).toEqual(['slot-1'])
  })

  it('relance (propage) une erreur GraphQL/@auth résolue par le client Gen2 (pas de exception JS), sans modifier availabilities.value', async () => {
    availabilityDeleteMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access deleteOwnerAvailability' }],
    })

    const { availabilities, removeAvailability } = useOwnerAvailability()
    availabilities.value = [{ id: 'slot-1', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }]

    await expect(removeAvailability('slot-1')).rejects.toThrow()
    expect(availabilities.value.map((a) => a.id)).toEqual(['slot-1'])
  })
})

describe('useOwnerAvailability.addAvailabilityForDays', () => {
  beforeEach(resetAllMocks)

  it('crée un créneau par jour et ne rafraîchit la liste qu’une seule fois (succès total)', async () => {
    let createCalls = 0
    availabilityCreateMock.mockImplementation(async () => {
      createCalls += 1
      return { data: { id: `slot-${createCalls}` }, errors: undefined }
    })
    availabilityListMock.mockResolvedValue({ data: [], errors: undefined })

    const { addAvailabilityForDays } = useOwnerAvailability()
    const result = await addAvailabilityForDays([1, 2, 3, 4, 5], '08:00', '12:00')

    expect(createCalls).toBe(5)
    expect(result).toEqual({ succeeded: 5, failed: 0, total: 5 })
    expect(availabilityListMock).toHaveBeenCalledTimes(1)
  })

  it("n'annule pas les jours qui réussissent quand un autre jour échoue (best-effort par jour)", async () => {
    availabilityCreateMock.mockImplementation(async (input) => {
      if (input.dayOfWeek === 6) {
        throw new Error('Not Authorized to access createOwnerAvailability')
      }
      return { data: { id: 'slot-ok' }, errors: undefined }
    })
    availabilityListMock.mockResolvedValue({ data: [], errors: undefined })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { addAvailabilityForDays } = useOwnerAvailability()
    const result = await addAvailabilityForDays([6, 0], '09:00', '18:00')

    expect(result).toEqual({ succeeded: 1, failed: 1, total: 2 })
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)

    consoleErrorSpy.mockRestore()
  })

  it("compte comme un échec un jour dont la création renvoie une erreur GraphQL/@auth résolue (pas une exception JS)", async () => {
    availabilityCreateMock.mockImplementation(async (input) => {
      if (input.dayOfWeek === 6) {
        return { data: null, errors: [{ message: 'Not Authorized to access createOwnerAvailability' }] }
      }
      return { data: { id: 'slot-ok' }, errors: undefined }
    })
    availabilityListMock.mockResolvedValue({ data: [], errors: undefined })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { addAvailabilityForDays } = useOwnerAvailability()
    const result = await addAvailabilityForDays([6, 0], '09:00', '18:00')

    // Sans la synthèse d'exception sur `errors` (voir useOwnerAvailability.js),
    // Promise.allSettled résoudrait ce jour en 'fulfilled' malgré l'échec @auth.
    expect(result).toEqual({ succeeded: 1, failed: 1, total: 2 })
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)

    consoleErrorSpy.mockRestore()
  })

  it("relance (propage) l'erreur si getCurrentUser() échoue, sans appeler la mutation de création", async () => {
    const { getCurrentUser } = await import('aws-amplify/auth')
    getCurrentUser.mockRejectedValueOnce(new Error('session expirée'))

    const { addAvailabilityForDays } = useOwnerAvailability()

    await expect(addAvailabilityForDays([1], '09:00', '12:00')).rejects.toThrow('session expirée')
    expect(availabilityCreateMock).not.toHaveBeenCalled()
  })
})

describe('useOwnerAvailability.fetchAvailabilities (tri par dayOfWeek)', () => {
  beforeEach(resetAllMocks)

  it('trie les créneaux du lundi (1) au samedi (6), et place dimanche (0) en dernier (tri numérique, pas lexicographique)', async () => {
    const items = [
      { id: 'wed', dayOfWeek: 3, startTime: '09:00', endTime: '10:00' },
      { id: 'sun', dayOfWeek: 0, startTime: '09:00', endTime: '10:00' },
      { id: 'mon', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
      { id: 'sat', dayOfWeek: 6, startTime: '09:00', endTime: '10:00' },
    ]
    availabilityListMock.mockImplementation(async ({ filter }) => {
      expect(filter).toEqual({ ownerID: { eq: 'owner-1' } })
      return { data: items, errors: undefined }
    })

    const { availabilities, fetchAvailabilities } = useOwnerAvailability()
    await fetchAvailabilities()

    // Un tri lexicographique naïf sur dayOfWeek en chaîne placerait "0" avant "1" mais
    // aussi, plus subtilement, casserait un ordre à deux chiffres (absent ici, dayOfWeek
    // reste 0-6) : ce qu'on vérifie surtout ici est le traitement spécial de dimanche
    // (0 -> 7 en interne), qui le pousse en dernière position plutôt qu'en première.
    expect(availabilities.value.map((a) => a.id)).toEqual(['mon', 'wed', 'sat', 'sun'])
  })
})
