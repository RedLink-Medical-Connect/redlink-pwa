import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Phase 2.1 (ADR-0003) / 3.1 : useMissionClosure() expose closeMission(missionId, animalId,
// outcome, clinicID, ownerID) — logique + mutations uniquement, aucun câblage UI dans la
// sous-tâche 2.1 (câblé depuis dans RequestsView.vue).
//
// - Toujours : Mission.status -> outcome (closeMissionSimple).
// - Seulement si outcome === COMPLETED :
//   - Animal.lastDonationDate -> aujourd'hui, format AWSDate (YYYY-MM-DD), via
//     updateAnimalLastDonationDateSimple.
//   - Upsert best-effort d'une ClinicOwnerRelation(clinicID, ownerID) — voir
//     resolveClinicOwnerRelationUpsert (fonction pure) plus bas pour la logique de décision,
//     et le bloc "closeMission — upsert ClinicOwnerRelation (Phase 3.1)" pour le câblage
//     bout-en-bout (requête clinicOwnerRelationsByOwnerID puis, si besoin,
//     createClinicOwnerRelationSimple).
// - NO_SHOW ne touche jamais Animal, ni ClinicOwnerRelation.
// - outcome invalide -> throw INVALID_OUTCOME avant tout appel GraphQL.

const graphqlMock = vi.fn()

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}))

import { useMissionClosure, resolveClinicOwnerRelationUpsert } from '@/composables/useMissionClosure'
import { MissionStatus } from '@/constants/enums'

/**
 * Mock GraphQL réutilisé par les tests de cette sous-tâche : gère les 6 mutations/queries
 * que closeMission() peut appeler sur COMPLETED (CloseMission, UpdateAnimalLastDonationDate,
 * ClinicOwnerRelationsByOwnerID, CreateClinicOwnerRelation, GetClinic, UpdateClinicStats —
 * ces deux derniers pour l'incrément des indicateurs, Phase 6.7). `existingRelations` simule
 * la réponse de clinicOwnerRelationsByOwnerID pour l'Owner ciblé ; `clinicStats` simule l'état
 * courant de Clinic.transfusionsDone/donorOwnersCount AVANT l'incrément (0/0 par défaut, comme
 * une Clinic fraîchement créée — voir VerifyEmailView.vue).
 */
function mockGraphqlForCompletedFlow(
  existingRelations,
  calls = [],
  clinicStats = { transfusionsDone: 0, donorOwnersCount: 0 },
) {
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
    if (query.includes('ClinicOwnerRelationsByOwnerID')) {
      return { data: { clinicOwnerRelationsByOwnerID: { items: existingRelations } } }
    }
    if (query.includes('CreateClinicOwnerRelation')) {
      return { data: { createClinicOwnerRelation: { id: 'relation-new', ...variables.input } } }
    }
    if (query.includes('GetClinic')) {
      return { data: { getClinic: { id: variables.id, ...clinicStats } } }
    }
    if (query.includes('UpdateClinicStats')) {
      return {
        data: {
          updateClinic: {
            id: variables.input.id,
            transfusionsDone: variables.input.transfusionsDone,
            donorOwnersCount: variables.input.donorOwnersCount,
          },
        },
      }
    }
    throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
  })
  return calls
}

describe('useMissionClosure.closeMission', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('COMPLETED : met à jour Mission.status ET Animal.lastDonationDate, dans cet ordre, avec la date du jour au format AWSDate exact (YYYY-MM-DD), puis upserte la ClinicOwnerRelation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T21:47:33.123Z'))

    // Owner déjà lié à cette clinique exacte : pas de création, la 3e requête (le check
    // clinicOwnerRelationsByOwnerID) a quand même bien lieu — voir les tests dédiés
    // ClinicOwnerRelation plus bas pour les scénarios de création.
    const calls = mockGraphqlForCompletedFlow([{ clinicID: 'clinic-1', isPrimaryClinic: true }])

    const { closeMission, isClosing } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    // 5 = CloseMission, UpdateAnimalLastDonationDate, ClinicOwnerRelationsByOwnerID (no-op,
    // Owner déjà lié à cette clinique), GetClinic, UpdateClinicStats (Phase 6.7).
    expect(graphqlMock).toHaveBeenCalledTimes(5)

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

    expect(calls[2].query).toContain('ClinicOwnerRelationsByOwnerID')
    expect(calls[2].variables).toEqual({ ownerID: 'owner-1' })

    expect(isClosing.value).toBe(false)
  })

  it("COMPLETED — piège de fuseau horaire : la date envoyée doit être celle du jour civil LOCAL (Europe/Paris) au moment de la clôture, pas celle du jour UTC", async () => {
    // Ce repo/cette CI tourne en Europe/Paris (confirmé : `timedatectl` sur cette machine), et
    // le composable s'exécute de toute façon toujours dans le navigateur LOCAL du vétérinaire,
    // jamais en UTC — donc ce piège est réel en prod, indépendamment du fuseau de la machine qui
    // fait tourner les tests. On fixe explicitement `process.env.TZ` ici pour que ce test reste
    // déterministe même si un futur environnement CI tourne en UTC par défaut.
    //
    // 2026-08-14T22:30:00Z UTC == 2026-08-15T00:30:00 heure locale Europe/Paris (CEST, UTC+2 en
    // août) : 00h30 passé minuit LOCAL, mais encore 22h30 la VEILLE en UTC. C'est le piège
    // classique de `toISOString()` (toujours en UTC) utilisé pour dériver "aujourd'hui" — un
    // vétérinaire qui clôture une Mission juste après minuit chez lui doit voir
    // `lastDonationDate` refléter CE jour-là (2026-08-15), pas la veille. Scénario réaliste pour
    // Redlink : les dons de sang d'urgence n'attendent pas que l'heure locale et l'heure UTC
    // s'accordent sur le jour civil (la fenêtre de risque est 22h-24h UTC en été, 23h-24h UTC en
    // hiver — pas un cas exotique une fois par an, une fenêtre quotidienne).
    const originalTZ = process.env.TZ
    process.env.TZ = 'Europe/Paris'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T22:30:00.000Z'))

    try {
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

      const { closeMission } = useMissionClosure()
      await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)

      const animalCall = calls.find((c) => c.query.includes('UpdateAnimalLastDonationDate'))
      // Test de non-régression pour le bug de fuseau trouvé en QA sur cette sous-tâche :
      // useMissionClosure.js calculait `today` via `new Date().toISOString().slice(0, 10)`
      // (jour UTC, '2026-08-14' ici) au lieu du jour civil local du vétérinaire ('2026-08-15').
      // Corrigé par `todayAsAWSDate()` (accesseurs de date locaux, `getFullYear()`/
      // `getMonth()`/`getDate()`, zero-paddés) — ce test verrouille le comportement local
      // désormais correct, il ne documente plus un échec attendu.
      expect(animalCall.variables.input.lastDonationDate).toBe('2026-08-15')
    } finally {
      process.env.TZ = originalTZ
    }
  })

  it("NO_SHOW : met à jour Mission.status uniquement, n'appelle jamais la mutation Animal ni ClinicOwnerRelation (même clinicID/ownerID fournis)", async () => {
    graphqlMock.mockImplementation(async ({ query, variables }) => {
      if (query.includes('CloseMission')) {
        return { data: { updateMission: { id: variables.input.id, status: variables.input.status } } }
      }
      // Toute requête ClinicOwnerRelation (ou Animal) ici ferait échouer le test — NO_SHOW ne
      // doit déclencher NI l'écriture Animal NI l'upsert ClinicOwnerRelation, quand bien même
      // clinicID/ownerID sont fournis à closeMission ci-dessous (contrairement à COMPLETED, où
      // ils déclenchent l'upsert).
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW, 'clinic-1', 'owner-1')

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

  it("re-clôture d'une Mission déjà COMPLETED/NO_SHOW : closeMission ne vérifie PAS le statut courant avant d'écrire — pas de garde composable/atomique (contrairement à acceptMission/ADR-0001), et ce n'est délibérément PAS un bug à corriger ici", async () => {
    // Contrat documenté dans useMissionClosure.js : la garde contre une re-clôture accidentelle
    // (ex. double clic avant que l'UI ne se rafraîchisse) est portée par l'UI (bouton affiché
    // seulement pour ACCEPTED/PENDING_ARRIVAL, Phase 2.2 — hors périmètre ici), pas par ce
    // composable. Vérifié comme sound côté schéma (pas juste supposé) : `Mission` n'a aucune
    // ConditionExpression sur `status` (Mutation.updateMission.req.vtl, compilé via
    // `amplify api gql-compile` pour cette review — la seule condition posée est
    // `attributeExists: id`) et le groupe Veterinarians a `isAuthorizedOnAllFields: true` sur
    // `updateMission` (Mutation.updateMission.auth.1.res.vtl) — aucune contrainte serveur à
    // violer par une réécriture du même statut. Voir le pendant schéma de ce test dans
    // schema.test.js. Ce test documente ce contrat explicitement plutôt que de le laisser
    // implicite : closeMission() réussit silencieusement même appelé deux fois de suite avec le
    // même outcome.
    graphqlMock.mockImplementation(async ({ query, variables }) => {
      if (query.includes('CloseMission')) {
        return { data: { updateMission: { id: variables.input.id, status: variables.input.status } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { closeMission } = useMissionClosure()

    await expect(closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW)).resolves.toBeUndefined()
    await expect(closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW)).resolves.toBeUndefined()

    expect(graphqlMock).toHaveBeenCalledTimes(2)
  })
})

describe('useMissionClosure — upsert ClinicOwnerRelation (Phase 3.1, COMPLETED uniquement)', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it('Owner sans relation existante (première clinique jamais liée pour cet Owner) : crée la ClinicOwnerRelation avec isPrimaryClinic: true', async () => {
    const calls = mockGraphqlForCompletedFlow([])
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    const createCall = calls.find((c) => c.query.includes('CreateClinicOwnerRelation'))
    expect(createCall).toBeDefined()
    expect(createCall.variables).toEqual({
      input: { clinicID: 'clinic-1', ownerID: 'owner-1', isPrimaryClinic: true },
    })
    // 6 = les 4 précédentes (CloseMission, UpdateAnimalLastDonationDate,
    // ClinicOwnerRelationsByOwnerID, CreateClinicOwnerRelation) + GetClinic +
    // UpdateClinicStats (Phase 6.7).
    expect(graphqlMock).toHaveBeenCalledTimes(6)
  })

  it('Owner déjà lié à une AUTRE clinique : crée une nouvelle ClinicOwnerRelation avec isPrimaryClinic: false', async () => {
    const calls = mockGraphqlForCompletedFlow([{ clinicID: 'clinic-OTHER', isPrimaryClinic: true }])
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    const createCall = calls.find((c) => c.query.includes('CreateClinicOwnerRelation'))
    expect(createCall).toBeDefined()
    expect(createCall.variables).toEqual({
      input: { clinicID: 'clinic-1', ownerID: 'owner-1', isPrimaryClinic: false },
    })
    expect(graphqlMock).toHaveBeenCalledTimes(6)
  })

  it("Owner déjà lié à CETTE clinique exacte : aucune nouvelle mutation ClinicOwnerRelation n'est appelée (no-op, pas juste \"ne plante pas\")", async () => {
    mockGraphqlForCompletedFlow([{ clinicID: 'clinic-1', isPrimaryClinic: true }])
    const { closeMission } = useMissionClosure()

    await expect(
      closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1'),
    ).resolves.toBeUndefined()

    // 5 appels : CloseMission, UpdateAnimalLastDonationDate, le check
    // ClinicOwnerRelationsByOwnerID lui-même (jamais CreateClinicOwnerRelation), puis
    // GetClinic + UpdateClinicStats (Phase 6.7, toujours appelés sur COMPLETED). On vérifie
    // le COMPTE exact d'appels, pas juste l'absence d'exception.
    expect(graphqlMock).toHaveBeenCalledTimes(5)
    expect(graphqlMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.stringContaining('CreateClinicOwnerRelation') }),
    )
  })

  it("l'échec de l'upsert ClinicOwnerRelation ne fait PAS échouer closeMission (best-effort) — Mission/Animal déjà écrits avec succès à ce stade", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    graphqlMock.mockImplementation(async ({ query, variables }) => {
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
      if (query.includes('ClinicOwnerRelationsByOwnerID')) {
        throw new Error('DynamoDB throttled')
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { closeMission, isClosing } = useMissionClosure()

    await expect(
      closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1'),
    ).resolves.toBeUndefined()

    expect(isClosing.value).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ClinicOwnerRelation'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it("l'échec de CreateClinicOwnerRelation lui-même (pas seulement de la query précédente) ne fait PAS échouer closeMission (best-effort) — chemin de code distinct du test 'ClinicOwnerRelationsByOwnerID throttled' ci-dessus, qui ne couvrait que l'échec de la QUERY", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    graphqlMock.mockImplementation(async ({ query, variables }) => {
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
      if (query.includes('ClinicOwnerRelationsByOwnerID')) {
        // Owner sans relation existante : force le passage par CreateClinicOwnerRelation
        // plutôt que le no-op, pour bien exercer l'échec de LA MUTATION elle-même.
        return { data: { clinicOwnerRelationsByOwnerID: { items: [] } } }
      }
      if (query.includes('CreateClinicOwnerRelation')) {
        throw new Error('ConditionalCheckFailedException')
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { closeMission, isClosing } = useMissionClosure()

    await expect(
      closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1'),
    ).resolves.toBeUndefined()

    expect(isClosing.value).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ClinicOwnerRelation'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it('clinicID/ownerID manquants (appelant non migré vers le nouveau contrat) : no-op silencieux, ne bloque pas closeMission, log une erreur contextuelle', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    graphqlMock.mockImplementation(async ({ query, variables }) => {
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

    const { closeMission } = useMissionClosure()

    // Pas de clinicID/ownerID passés — même contrat que le reste du fichier avant cette
    // sous-tâche (closeMission(missionId, animalId, outcome)).
    await expect(closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)).resolves.toBeUndefined()

    expect(graphqlMock).toHaveBeenCalledTimes(2)
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('ClinicOwnerRelation'))

    consoleErrorSpy.mockRestore()
  })
})

describe('useMissionClosure — incrément des indicateurs Clinic (Phase 6.7, CdC §2.4, COMPLETED uniquement)', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it("nouveau propriétaire donneur (relation ClinicOwnerRelation créée) : transfusionsDone ET donorOwnersCount sont tous les deux incrémentés de 1", async () => {
    const calls = mockGraphqlForCompletedFlow([], [], { transfusionsDone: 4, donorOwnersCount: 2 })
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    const updateCall = calls.find((c) => c.query.includes('UpdateClinicStats'))
    expect(updateCall).toBeDefined()
    expect(updateCall.variables).toEqual({
      input: { id: 'clinic-1', transfusionsDone: 5, donorOwnersCount: 3 },
    })
  })

  it("propriétaire donneur déjà connu de cette clinique (pas de nouvelle relation) : transfusionsDone incrémenté, donorOwnersCount INCHANGÉ — ne compte pas deux fois le même propriétaire", async () => {
    const calls = mockGraphqlForCompletedFlow(
      [{ clinicID: 'clinic-1', isPrimaryClinic: true }],
      [],
      { transfusionsDone: 4, donorOwnersCount: 2 },
    )
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    const updateCall = calls.find((c) => c.query.includes('UpdateClinicStats'))
    expect(updateCall).toBeDefined()
    expect(updateCall.variables).toEqual({
      input: { id: 'clinic-1', transfusionsDone: 5, donorOwnersCount: 2 },
    })
  })

  it('Clinic fraîchement créée (compteurs à 0, comme fixé par VerifyEmailView.vue à l\'inscription) : part bien de 0, pas de NaN/undefined', async () => {
    const calls = mockGraphqlForCompletedFlow([], [], { transfusionsDone: 0, donorOwnersCount: 0 })
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    const updateCall = calls.find((c) => c.query.includes('UpdateClinicStats'))
    expect(updateCall.variables).toEqual({
      input: { id: 'clinic-1', transfusionsDone: 1, donorOwnersCount: 1 },
    })
  })

  it('compteurs null/absents côté serveur (défensif, ne devrait pas arriver mais schema.graphql les déclare Int nullable) : traités comme 0, pas de NaN', async () => {
    const calls = mockGraphqlForCompletedFlow(
      [{ clinicID: 'clinic-1', isPrimaryClinic: true }],
      [],
      { transfusionsDone: null, donorOwnersCount: null },
    )
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    const updateCall = calls.find((c) => c.query.includes('UpdateClinicStats'))
    expect(updateCall.variables).toEqual({
      input: { id: 'clinic-1', transfusionsDone: 1, donorOwnersCount: 0 },
    })
  })

  it("échec de GetClinic (lecture des compteurs) ne fait PAS échouer closeMission (best-effort) — Mission/Animal déjà écrits avec succès à ce stade", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    graphqlMock.mockImplementation(async ({ query, variables }) => {
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
      if (query.includes('ClinicOwnerRelationsByOwnerID')) {
        return { data: { clinicOwnerRelationsByOwnerID: { items: [{ clinicID: 'clinic-1', isPrimaryClinic: true }] } } }
      }
      if (query.includes('GetClinic')) {
        throw new Error('DynamoDB throttled')
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { closeMission, isClosing } = useMissionClosure()

    await expect(
      closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1'),
    ).resolves.toBeUndefined()

    expect(isClosing.value).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('indicateurs clinique'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it("échec de UpdateClinicStats (écriture des compteurs) ne fait PAS échouer closeMission (best-effort)", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    graphqlMock.mockImplementation(async ({ query, variables }) => {
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
      if (query.includes('ClinicOwnerRelationsByOwnerID')) {
        return { data: { clinicOwnerRelationsByOwnerID: { items: [{ clinicID: 'clinic-1', isPrimaryClinic: true }] } } }
      }
      if (query.includes('GetClinic')) {
        return { data: { getClinic: { id: variables.id, transfusionsDone: 0, donorOwnersCount: 0 } } }
      }
      if (query.includes('UpdateClinicStats')) {
        throw new Error('ConditionalCheckFailedException')
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { closeMission, isClosing } = useMissionClosure()

    await expect(
      closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1'),
    ).resolves.toBeUndefined()

    expect(isClosing.value).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('indicateurs clinique'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it('clinicID manquant (appelant non migré) : aucun appel GetClinic/UpdateClinicStats, no-op silencieux + log, ne bloque pas closeMission', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    graphqlMock.mockImplementation(async ({ query, variables }) => {
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

    const { closeMission } = useMissionClosure()

    // Pas de clinicID/ownerID : upsertClinicOwnerRelation ET incrementClinicStats no-opent
    // tous les deux avant le moindre appel GraphQL les concernant.
    await expect(closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)).resolves.toBeUndefined()

    expect(graphqlMock).toHaveBeenCalledTimes(2)
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('indicateurs clinique'))

    consoleErrorSpy.mockRestore()
  })
})

describe('resolveClinicOwnerRelationUpsert (fonction pure, testable sans mock GraphQL)', () => {
  it('retourne null si une relation existe déjà pour ce clinicID exact', () => {
    const result = resolveClinicOwnerRelationUpsert(
      [
        { clinicID: 'clinic-1', isPrimaryClinic: true },
        { clinicID: 'clinic-2', isPrimaryClinic: false },
      ],
      'clinic-1',
    )
    expect(result).toBeNull()
  })

  it('retourne isPrimaryClinic: true si existingRelations est vide (toute première relation de cet Owner)', () => {
    const result = resolveClinicOwnerRelationUpsert([], 'clinic-1')
    expect(result).toEqual({ clinicID: 'clinic-1', isPrimaryClinic: true })
  })

  it("retourne isPrimaryClinic: false si l'Owner a déjà au moins une relation, mais avec une AUTRE clinique", () => {
    const result = resolveClinicOwnerRelationUpsert(
      [{ clinicID: 'clinic-OTHER', isPrimaryClinic: true }],
      'clinic-1',
    )
    expect(result).toEqual({ clinicID: 'clinic-1', isPrimaryClinic: false })
  })

  it("retourne null même quand l'Owner a une relation à CETTE clinique MÉLANGÉE avec des relations à d'autres cliniques (le check du clinicID exact doit court-circuiter, peu importe le reste du tableau, quelle que soit sa position — ici testé en 1ère ET en dernière position)", () => {
    const clinicFirst = resolveClinicOwnerRelationUpsert(
      [
        { clinicID: 'clinic-1', isPrimaryClinic: true },
        { clinicID: 'clinic-OTHER-A', isPrimaryClinic: false },
        { clinicID: 'clinic-OTHER-B', isPrimaryClinic: false },
      ],
      'clinic-1',
    )
    expect(clinicFirst).toBeNull()

    const clinicLast = resolveClinicOwnerRelationUpsert(
      [
        { clinicID: 'clinic-OTHER-A', isPrimaryClinic: true },
        { clinicID: 'clinic-OTHER-B', isPrimaryClinic: false },
        { clinicID: 'clinic-1', isPrimaryClinic: false },
      ],
      'clinic-1',
    )
    expect(clinicLast).toBeNull()
  })
})
