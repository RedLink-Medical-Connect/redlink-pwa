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
      // BUG CONNU (signalé en QA, pas corrigé dans cette suite) : useMissionClosure.js calcule
      // `today` via `new Date().toISOString().slice(0, 10)`, qui renvoie le jour UTC — ici
      // '2026-08-14' — au lieu du jour civil local du vétérinaire ('2026-08-15'). Ce test échoue
      // donc actuellement contre l'implémentation ; c'est intentionnel (voir rapport QA), pas un
      // test à assouplir. Correctif attendu : dériver `today` via des accesseurs de date locaux
      // (`getFullYear()`/`getMonth()`/`getDate()`, zero-paddés) plutôt que `toISOString()`.
      expect(animalCall.variables.input.lastDonationDate).toBe('2026-08-15')
    } finally {
      process.env.TZ = originalTZ
    }
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
