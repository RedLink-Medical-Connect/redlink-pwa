import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression coverage for bug #3 fixed on this branch (commit 82c8d44):
// DashboardView.vue's handleAccept used to call
// `acceptMission(request.id, request.matchingAnimal.id)` — two separate
// arguments — while useOwnerMissions().acceptMission's actual signature is
// `acceptMission(request)`, a single Request-shaped object it reads
// `request.id` / `request.requiredSpecies` / `request.requestType` from. The
// fix changed the call site to `acceptMission(request)`.
//
// These tests exercise acceptMission() directly with a Request object shaped
// exactly like what useMatchingRequests.searchMatches() attaches to
// `matches.value` (see useMatchingRequests.test.js) and what DashboardView
// now passes at the fixed call site.

const graphqlMock = vi.fn()

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ userId: 'owner-1' })),
}))

import { useOwnerMissions } from '@/composables/useOwnerMissions'

// A Request object as produced by searchMatches(): includes the extra
// `matchingAnimal`/`distanceKM` fields the matching engine attaches, exactly
// like what DashboardView.vue's `req` (now passed whole to acceptMission) carries.
const buildMatchedRequest = (overrides = {}) => ({
  id: 'request-1',
  requiredSpecies: 'DOG',
  requiredBloodGroup: 'DEA 1.1-',
  requestType: 'EMERGENCY',
  status: 'OPEN',
  clinicID: 'clinic-1',
  clinic: { id: 'clinic-1', name: 'Clinique du Centre', latitude: 48.85, longitude: 2.35 },
  distanceKM: 2.3,
  matchingAnimal: { id: 'animal-1', name: 'Rex', species: 'DOG', bloodGroup: 'DEA 1.1-' },
  ...overrides,
})

describe('useOwnerMissions.acceptMission', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it("accepte l'objet Request complet passé par DashboardView (id, requiredSpecies, requestType) et crée la Mission", async () => {
    graphqlMock.mockImplementation(async ({ query, variables }) => {
      if (query.includes('ListMyAnimals')) {
        return {
          data: { listAnimals: { items: [{ id: 'animal-1', name: 'Rex', species: 'DOG', bloodGroup: 'DEA 1.1-' }] } },
        }
      }
      if (query.includes('CreateMission')) {
        expect(variables.input).toMatchObject({
          requestID: 'request-1',
          animalID: 'animal-1',
          status: 'PENDING_ARRIVAL', // requestType EMERGENCY
        })
        return { data: { createMission: { id: 'mission-1', status: 'PENDING_ARRIVAL' } } }
      }
      if (query.includes('LinkRequestToMission')) {
        expect(variables).toMatchObject({ id: 'request-1', activeMissionID: 'mission-1' })
        return { data: { updateRequest: { id: 'request-1', status: 'IN_PROGRESS', activeMissionID: 'mission-1' } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { acceptMission } = useOwnerMissions()
    const request = buildMatchedRequest()

    const donorName = await acceptMission(request)

    expect(donorName).toBe('Rex')
    // Les 3 appels attendus ont bien eu lieu (liste des animaux, création de la
    // Mission, puis liaison Request -> Mission).
    expect(graphqlMock).toHaveBeenCalledTimes(3)
  })

  it('utilise le statut ACCEPTED (et non PENDING_ARRIVAL) pour une Request de type APPOINTMENT', async () => {
    graphqlMock.mockImplementation(async ({ query, variables }) => {
      if (query.includes('ListMyAnimals')) {
        return { data: { listAnimals: { items: [{ id: 'animal-1', species: 'DOG', bloodGroup: 'DEA 1.1-' }] } } }
      }
      if (query.includes('CreateMission')) {
        expect(variables.input.status).toBe('ACCEPTED')
        return { data: { createMission: { id: 'mission-1', status: 'ACCEPTED' } } }
      }
      if (query.includes('LinkRequestToMission')) {
        return { data: { updateRequest: { id: 'request-1', status: 'IN_PROGRESS', activeMissionID: 'mission-1' } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { acceptMission } = useOwnerMissions()
    await acceptMission(buildMatchedRequest({ requestType: 'APPOINTMENT' }))
  })

  // BUG PRE-EXISTANT (hors scope de ce diff, non introduit ni corrigé par 82c8d44) :
  // searchMatches()/isBloodCompatible traite requiredBloodGroup === 'UNKNOWN' comme
  // "n'importe quel animal de la bonne espèce est compatible" (geolocation-service.js),
  // donc une Request UNKNOWN apparaît légitimement dans matches.value avec un
  // matchingAnimal attaché. Mais acceptMission() ici cherche le candidat par égalité
  // stricte `a.bloodGroup === request.requiredBloodGroup`, donc `bloodGroup === 'UNKNOWN'`
  // — un Animal Validated Donor n'a jamais de groupe UNKNOWN (cf. CONTEXT.md), donc ce
  // test échoue systématiquement. Résultat : une Request "peu importe le groupe" que
  // l'Owner a vue comme un Match acceptable est rejetée (NO_MATCHING_ANIMAL) au moment
  // d'accepter. Documenté ici plutôt que corrigé silencieusement — à traiter dans un
  // sous-tâche dédiée (probablement en réutilisant isBloodCompatible ici aussi).
  it('[BUG CONNU] rejette à tort une Request requiredBloodGroup=UNKNOWN alors que searchMatches la considère comme un Match valide', async () => {
    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('ListMyAnimals')) {
        return {
          data: {
            listAnimals: {
              items: [{ id: 'animal-1', name: 'Rex', species: 'DOG', bloodGroup: 'DEA 1.1-' }],
            },
          },
        }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { acceptMission } = useOwnerMissions()
    const request = buildMatchedRequest({ requiredBloodGroup: 'UNKNOWN' })

    // Comportement ACTUEL (bug) : rejette malgré un Animal de la bonne espèce.
    // Si cette assertion se met à échouer, c'est que le bug a été corrigé —
    // remplacer par une assertion de succès et retirer ce commentaire.
    await expect(acceptMission(request)).rejects.toThrow('NO_MATCHING_ANIMAL')
  })

  it("rejette si aucun animal de l'Owner ne correspond à l'espèce/groupe demandés (protège contre un appel avec un objet Request mal formé)", async () => {
    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('ListMyAnimals')) {
        return { data: { listAnimals: { items: [{ id: 'animal-2', species: 'CAT', bloodGroup: 'A' }] } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { acceptMission } = useOwnerMissions()

    await expect(acceptMission(buildMatchedRequest())).rejects.toThrow('NO_MATCHING_ANIMAL')
    // On ne doit pas essayer de créer une Mission sans donneur valide.
    expect(graphqlMock).toHaveBeenCalledTimes(1)
  })
})
