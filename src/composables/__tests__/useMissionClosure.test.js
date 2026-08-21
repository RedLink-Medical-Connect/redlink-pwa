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
//
// Phase 8, sous-tâche 5 (lot 3/3) : mock migré vers le client Gen2 (`aws-amplify/data`,
// `client.models.{Mission,Animal,ClinicOwnerRelation,Clinic}.*`), un mock dédié par méthode de
// modèle plutôt qu'un unique `graphqlMock` discriminé par le texte de la query (même
// convention que useAnimals.js/useClinicDonors.js, lots 1/2). Assertions métier inchangées.

const missionUpdateMock = vi.fn()
const animalUpdateMock = vi.fn()
const relationListMock = vi.fn()
const relationCreateMock = vi.fn()
const clinicGetMock = vi.fn()
const clinicUpdateMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Mission: { update: (...args) => missionUpdateMock(...args) },
      Animal: { update: (...args) => animalUpdateMock(...args) },
      ClinicOwnerRelation: {
        list: (...args) => relationListMock(...args),
        create: (...args) => relationCreateMock(...args),
      },
      Clinic: {
        get: (...args) => clinicGetMock(...args),
        update: (...args) => clinicUpdateMock(...args),
      },
    },
  }),
}))

import { useMissionClosure, resolveClinicOwnerRelationUpsert } from '@/composables/useMissionClosure'
import { MissionStatus } from '@/constants/enums'

const resetAllMocks = () => {
  missionUpdateMock.mockReset()
  animalUpdateMock.mockReset()
  relationListMock.mockReset()
  relationCreateMock.mockReset()
  clinicGetMock.mockReset()
  clinicUpdateMock.mockReset()
}

/**
 * Configure les 6 mocks pour un scénario COMPLETED "réussi" complet : `existingRelations`
 * simule la réponse de `ClinicOwnerRelation.list` pour l'Owner ciblé ; `clinicStats` simule
 * l'état courant de Clinic.transfusionsDone/donorOwnersCount AVANT l'incrément (0/0 par
 * défaut, comme une Clinic fraîchement créée — voir VerifyEmailView.vue).
 */
function mockCompletedFlow(existingRelations, clinicStats = { transfusionsDone: 0, donorOwnersCount: 0 }) {
  missionUpdateMock.mockImplementation(async (input) => ({
    data: { id: input.id, status: input.status },
    errors: undefined,
  }))
  animalUpdateMock.mockImplementation(async (input) => ({
    data: { id: input.id, lastDonationDate: input.lastDonationDate },
    errors: undefined,
  }))
  relationListMock.mockImplementation(async () => ({ data: existingRelations, errors: undefined }))
  relationCreateMock.mockImplementation(async (input) => ({
    data: { id: 'relation-new', ...input },
    errors: undefined,
  }))
  clinicGetMock.mockImplementation(async ({ id }) => ({ data: { id, ...clinicStats }, errors: undefined }))
  clinicUpdateMock.mockImplementation(async (input) => ({ data: { ...input }, errors: undefined }))
}

describe('useMissionClosure.closeMission', () => {
  beforeEach(resetAllMocks)

  afterEach(() => {
    vi.useRealTimers()
  })

  it('COMPLETED : met à jour Mission.status ET Animal.lastDonationDate, dans cet ordre, avec la date du jour au format AWSDate exact (YYYY-MM-DD), puis upserte la ClinicOwnerRelation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T21:47:33.123Z'))

    // Owner déjà lié à cette clinique exacte : pas de création, la lecture
    // ClinicOwnerRelation.list a quand même bien lieu — voir les tests dédiés
    // ClinicOwnerRelation plus bas pour les scénarios de création.
    mockCompletedFlow([{ clinicID: 'clinic-1', isPrimaryClinic: true }])

    const { closeMission, isClosing } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    expect(missionUpdateMock).toHaveBeenCalledTimes(1)
    expect(missionUpdateMock).toHaveBeenCalledWith({ id: 'mission-1', status: 'COMPLETED' })

    expect(animalUpdateMock).toHaveBeenCalledTimes(1)
    const animalInput = animalUpdateMock.mock.calls[0][0]
    expect(animalInput).toEqual({ id: 'animal-1', lastDonationDate: '2026-08-14' })
    // Format AWSDate strict : pas d'heure, pas de suffixe 'Z'/timezone.
    expect(animalInput.lastDonationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    expect(relationListMock).toHaveBeenCalledTimes(1)
    expect(relationListMock).toHaveBeenCalledWith({ filter: { ownerID: { eq: 'owner-1' } } })
    expect(relationCreateMock).not.toHaveBeenCalled()

    // Phase 6.7 : incrément des indicateurs, toujours tenté sur COMPLETED.
    expect(clinicGetMock).toHaveBeenCalledTimes(1)
    expect(clinicUpdateMock).toHaveBeenCalledTimes(1)

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
    // `lastDonationDate` refléter CE jour-là (2026-08-15), pas la veille.
    const originalTZ = process.env.TZ
    process.env.TZ = 'Europe/Paris'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T22:30:00.000Z'))

    try {
      missionUpdateMock.mockImplementation(async (input) => ({
        data: { id: input.id, status: input.status },
        errors: undefined,
      }))
      animalUpdateMock.mockImplementation(async (input) => ({
        data: { id: input.id, lastDonationDate: input.lastDonationDate },
        errors: undefined,
      }))

      // Pas de clinicID/ownerID : upsertClinicOwnerRelation/incrementClinicStats no-opent
      // avant tout appel réseau les concernant (voir describe dédié plus bas) — inutile de
      // mocker relationListMock/clinicGetMock ici.
      const { closeMission } = useMissionClosure()
      await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)

      // Test de non-régression pour le bug de fuseau trouvé en QA sur cette sous-tâche :
      // useMissionClosure.js calculait `today` via `new Date().toISOString().slice(0, 10)`
      // (jour UTC, '2026-08-14' ici) au lieu du jour civil local du vétérinaire ('2026-08-15').
      // Corrigé par `todayAsAWSDate()` (accesseurs de date locaux) — ce test verrouille le
      // comportement local désormais correct.
      const animalInput = animalUpdateMock.mock.calls[0][0]
      expect(animalInput.lastDonationDate).toBe('2026-08-15')
    } finally {
      process.env.TZ = originalTZ
    }
  })

  it("NO_SHOW : met à jour Mission.status uniquement, n'appelle jamais la mutation Animal ni ClinicOwnerRelation (même clinicID/ownerID fournis)", async () => {
    missionUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, status: input.status },
      errors: undefined,
    }))

    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW, 'clinic-1', 'owner-1')

    expect(missionUpdateMock).toHaveBeenCalledTimes(1)
    expect(missionUpdateMock).toHaveBeenCalledWith({ id: 'mission-1', status: 'NO_SHOW' })
    // NO_SHOW ne doit déclencher NI l'écriture Animal NI l'upsert ClinicOwnerRelation, quand
    // bien même clinicID/ownerID sont fournis à closeMission ci-dessus.
    expect(animalUpdateMock).not.toHaveBeenCalled()
    expect(relationListMock).not.toHaveBeenCalled()
    expect(clinicGetMock).not.toHaveBeenCalled()
  })

  it.each(['ACCEPTED', 'PENDING_ARRIVAL', 'CANCELLED', 'completed', '', null, undefined])(
    'outcome invalide (%s) : throw INVALID_OUTCOME avant tout appel GraphQL, ne coerce/ne défaulte jamais silencieusement',
    async (badOutcome) => {
      const { closeMission, isClosing } = useMissionClosure()

      await expect(closeMission('mission-1', 'animal-1', badOutcome)).rejects.toThrow(
        'INVALID_OUTCOME',
      )

      expect(missionUpdateMock).not.toHaveBeenCalled()
      expect(isClosing.value).toBe(false)
    },
  )

  it('isClosing : true pendant la clôture, false après succès', async () => {
    let isClosingDuringCall = null
    missionUpdateMock.mockImplementation(async () => {
      isClosingDuringCall = isClosing.value
      return { data: { id: 'mission-1', status: 'NO_SHOW' }, errors: undefined }
    })

    const { closeMission, isClosing } = useMissionClosure()
    expect(isClosing.value).toBe(false)

    await closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW)

    expect(isClosingDuringCall).toBe(true)
    expect(isClosing.value).toBe(false)
  })

  it('isClosing repasse à false même en cas d\'échec réseau/@auth sur la mutation Mission, et propage l\'erreur', async () => {
    const networkError = new Error('Network error')
    missionUpdateMock.mockRejectedValue(networkError)

    const { closeMission, isClosing } = useMissionClosure()

    await expect(closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)).rejects.toThrow(
      'Network error',
    )

    expect(isClosing.value).toBe(false)
  })

  it("propage l'erreur et repasse isClosing à false si la mutation Mission réussit mais la mutation Animal échoue (COMPLETED)", async () => {
    const animalError = new Error('Animal update failed')
    missionUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, status: input.status },
      errors: undefined,
    }))
    animalUpdateMock.mockRejectedValue(animalError)

    const { closeMission, isClosing } = useMissionClosure()

    await expect(closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)).rejects.toThrow(
      'Animal update failed',
    )

    expect(missionUpdateMock).toHaveBeenCalledTimes(1)
    expect(animalUpdateMock).toHaveBeenCalledTimes(1)
    // L'échec de la mutation Animal interrompt le flux avant tout appel ClinicOwnerRelation.
    expect(relationListMock).not.toHaveBeenCalled()
    expect(isClosing.value).toBe(false)
  })

  it('logue une erreur contextuelle en français avant de la propager', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    missionUpdateMock.mockRejectedValue(new Error('boom'))

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
    missionUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, status: input.status },
      errors: undefined,
    }))

    const { closeMission } = useMissionClosure()

    await expect(closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW)).resolves.toBeUndefined()
    await expect(closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW)).resolves.toBeUndefined()

    expect(missionUpdateMock).toHaveBeenCalledTimes(2)
  })
})

describe('useMissionClosure — upsert ClinicOwnerRelation (Phase 3.1, COMPLETED uniquement)', () => {
  beforeEach(resetAllMocks)

  it('Owner sans relation existante (première clinique jamais liée pour cet Owner) : crée la ClinicOwnerRelation avec isPrimaryClinic: true', async () => {
    mockCompletedFlow([])
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    expect(relationCreateMock).toHaveBeenCalledTimes(1)
    expect(relationCreateMock).toHaveBeenCalledWith({
      clinicID: 'clinic-1',
      ownerID: 'owner-1',
      isPrimaryClinic: true,
    })
  })

  it('Owner déjà lié à une AUTRE clinique : crée une nouvelle ClinicOwnerRelation avec isPrimaryClinic: false', async () => {
    mockCompletedFlow([{ clinicID: 'clinic-OTHER', isPrimaryClinic: true }])
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    expect(relationCreateMock).toHaveBeenCalledTimes(1)
    expect(relationCreateMock).toHaveBeenCalledWith({
      clinicID: 'clinic-1',
      ownerID: 'owner-1',
      isPrimaryClinic: false,
    })
  })

  it("Owner déjà lié à CETTE clinique exacte : aucune nouvelle mutation ClinicOwnerRelation n'est appelée (no-op, pas juste \"ne plante pas\")", async () => {
    mockCompletedFlow([{ clinicID: 'clinic-1', isPrimaryClinic: true }])
    const { closeMission } = useMissionClosure()

    await expect(
      closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1'),
    ).resolves.toBeUndefined()

    expect(relationListMock).toHaveBeenCalledTimes(1)
    expect(relationCreateMock).not.toHaveBeenCalled()
  })

  it("l'échec de l'upsert ClinicOwnerRelation ne fait PAS échouer closeMission (best-effort) — Mission/Animal déjà écrits avec succès à ce stade", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    missionUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, status: input.status },
      errors: undefined,
    }))
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, lastDonationDate: input.lastDonationDate },
      errors: undefined,
    }))
    relationListMock.mockRejectedValue(new Error('DynamoDB throttled'))
    clinicGetMock.mockImplementation(async ({ id }) => ({
      data: { id, transfusionsDone: 0, donorOwnersCount: 0 },
      errors: undefined,
    }))
    clinicUpdateMock.mockImplementation(async (input) => ({ data: { ...input }, errors: undefined }))

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
    missionUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, status: input.status },
      errors: undefined,
    }))
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, lastDonationDate: input.lastDonationDate },
      errors: undefined,
    }))
    // Owner sans relation existante : force le passage par ClinicOwnerRelation.create()
    // plutôt que le no-op, pour bien exercer l'échec de LA MUTATION elle-même.
    relationListMock.mockResolvedValue({ data: [], errors: undefined })
    relationCreateMock.mockRejectedValue(new Error('ConditionalCheckFailedException'))
    clinicGetMock.mockImplementation(async ({ id }) => ({
      data: { id, transfusionsDone: 0, donorOwnersCount: 0 },
      errors: undefined,
    }))
    clinicUpdateMock.mockImplementation(async (input) => ({ data: { ...input }, errors: undefined }))

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
    missionUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, status: input.status },
      errors: undefined,
    }))
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, lastDonationDate: input.lastDonationDate },
      errors: undefined,
    }))

    const { closeMission } = useMissionClosure()

    // Pas de clinicID/ownerID passés — même contrat que le reste du fichier avant cette
    // sous-tâche (closeMission(missionId, animalId, outcome)).
    await expect(closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)).resolves.toBeUndefined()

    expect(relationListMock).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('ClinicOwnerRelation'))

    consoleErrorSpy.mockRestore()
  })
})

describe('useMissionClosure — incrément des indicateurs Clinic (Phase 6.7, CdC §2.4, COMPLETED uniquement)', () => {
  beforeEach(resetAllMocks)

  it("nouveau propriétaire donneur (relation ClinicOwnerRelation créée) : transfusionsDone ET donorOwnersCount sont tous les deux incrémentés de 1", async () => {
    mockCompletedFlow([], { transfusionsDone: 4, donorOwnersCount: 2 })
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    expect(clinicUpdateMock).toHaveBeenCalledWith({
      id: 'clinic-1',
      transfusionsDone: 5,
      donorOwnersCount: 3,
    })
  })

  it("propriétaire donneur déjà connu de cette clinique (pas de nouvelle relation) : transfusionsDone incrémenté, donorOwnersCount INCHANGÉ — ne compte pas deux fois le même propriétaire", async () => {
    mockCompletedFlow([{ clinicID: 'clinic-1', isPrimaryClinic: true }], {
      transfusionsDone: 4,
      donorOwnersCount: 2,
    })
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    expect(clinicUpdateMock).toHaveBeenCalledWith({
      id: 'clinic-1',
      transfusionsDone: 5,
      donorOwnersCount: 2,
    })
  })

  it('Clinic fraîchement créée (compteurs à 0, comme fixé par VerifyEmailView.vue à l\'inscription) : part bien de 0, pas de NaN/undefined', async () => {
    mockCompletedFlow([], { transfusionsDone: 0, donorOwnersCount: 0 })
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    expect(clinicUpdateMock).toHaveBeenCalledWith({
      id: 'clinic-1',
      transfusionsDone: 1,
      donorOwnersCount: 1,
    })
  })

  it('compteurs null/absents côté serveur (défensif, ne devrait pas arriver mais schema.graphql les déclare Int nullable) : traités comme 0, pas de NaN', async () => {
    mockCompletedFlow([{ clinicID: 'clinic-1', isPrimaryClinic: true }], {
      transfusionsDone: null,
      donorOwnersCount: null,
    })
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    expect(clinicUpdateMock).toHaveBeenCalledWith({
      id: 'clinic-1',
      transfusionsDone: 1,
      donorOwnersCount: 0,
    })
  })

  it("échec de GetClinic (lecture des compteurs) ne fait PAS échouer closeMission (best-effort) — Mission/Animal déjà écrits avec succès à ce stade", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    missionUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, status: input.status },
      errors: undefined,
    }))
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, lastDonationDate: input.lastDonationDate },
      errors: undefined,
    }))
    relationListMock.mockResolvedValue({
      data: [{ clinicID: 'clinic-1', isPrimaryClinic: true }],
      errors: undefined,
    })
    clinicGetMock.mockRejectedValue(new Error('DynamoDB throttled'))

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
    missionUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, status: input.status },
      errors: undefined,
    }))
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, lastDonationDate: input.lastDonationDate },
      errors: undefined,
    }))
    relationListMock.mockResolvedValue({
      data: [{ clinicID: 'clinic-1', isPrimaryClinic: true }],
      errors: undefined,
    })
    clinicGetMock.mockResolvedValue({
      data: { id: 'clinic-1', transfusionsDone: 0, donorOwnersCount: 0 },
      errors: undefined,
    })
    clinicUpdateMock.mockRejectedValue(new Error('ConditionalCheckFailedException'))

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
    missionUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, status: input.status },
      errors: undefined,
    }))
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, lastDonationDate: input.lastDonationDate },
      errors: undefined,
    }))

    const { closeMission } = useMissionClosure()

    // Pas de clinicID/ownerID : upsertClinicOwnerRelation ET incrementClinicStats no-opent
    // tous les deux avant le moindre appel GraphQL les concernant.
    await expect(closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)).resolves.toBeUndefined()

    expect(clinicGetMock).not.toHaveBeenCalled()
    expect(clinicUpdateMock).not.toHaveBeenCalled()
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
