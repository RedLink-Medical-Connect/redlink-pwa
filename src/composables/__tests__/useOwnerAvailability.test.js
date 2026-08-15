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

const graphqlMock = vi.fn()

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ userId: 'owner-1' })),
}))

import { useOwnerAvailability } from '@/composables/useOwnerAvailability'

describe('useOwnerAvailability.removeAvailability', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it('supprime le créneau visé de availabilities.value en cas de succès', async () => {
    graphqlMock.mockImplementation(async ({ query, variables }) => {
      expect(query).toContain('DeleteOwnerAvailability')
      expect(variables).toEqual({ input: { id: 'slot-1' } })
      return { data: { deleteOwnerAvailability: { id: 'slot-1' } } }
    })

    const { availabilities, removeAvailability } = useOwnerAvailability()
    availabilities.value = [
      { id: 'slot-1', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
      { id: 'slot-2', dayOfWeek: 2, startTime: '11:00', endTime: '12:00' },
    ]

    await removeAvailability('slot-1')

    expect(availabilities.value.map((a) => a.id)).toEqual(['slot-2'])
    expect(graphqlMock).toHaveBeenCalledTimes(1)
  })

  it('relance (propage) l’erreur en cas d’échec, sans modifier availabilities.value (correction R-03)', async () => {
    const authError = new Error('Not Authorized to access deleteOwnerAvailability on type OwnerAvailability')
    graphqlMock.mockImplementation(async () => {
      throw authError
    })

    const { availabilities, removeAvailability } = useOwnerAvailability()
    availabilities.value = [{ id: 'slot-1', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }]

    await expect(removeAvailability('slot-1')).rejects.toBe(authError)

    // Avant la correction R-03, l'erreur était avalée : le composant appelant ne
    // pouvait jamais afficher d'échec à l'utilisateur.
    expect(availabilities.value.map((a) => a.id)).toEqual(['slot-1'])
  })
})

describe('useOwnerAvailability.fetchAvailabilities (tri par dayOfWeek)', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it('trie les créneaux du lundi (1) au samedi (6), et place dimanche (0) en dernier (tri numérique, pas lexicographique)', async () => {
    const items = [
      { id: 'wed', dayOfWeek: 3, startTime: '09:00', endTime: '10:00' },
      { id: 'sun', dayOfWeek: 0, startTime: '09:00', endTime: '10:00' },
      { id: 'mon', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
      { id: 'sat', dayOfWeek: 6, startTime: '09:00', endTime: '10:00' },
    ]
    graphqlMock.mockImplementation(async ({ query, variables }) => {
      expect(query).toContain('ListMyAvailabilities')
      expect(variables).toEqual({ filter: { ownerID: { eq: 'owner-1' } } })
      return { data: { listOwnerAvailabilities: { items } } }
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
