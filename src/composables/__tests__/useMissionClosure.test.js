import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Phase 2.1 (ADR-0003) / 3.1 : useMissionClosure() expose closeMission(missionId, animalId,
// outcome, clinicID, ownerID) — logique + mutations uniquement, aucun câblage UI dans la
// sous-tâche 2.1 (câblé depuis dans RequestsView.vue).
//
// - Toujours : soumission de la validation du côté vétérinaire (depuis l'étape 4/5 de la double
//   validation ; auparavant une écriture directe de Mission.status).
// - Seulement si la Mission atteint RÉELLEMENT COMPLETED :
//   - Animal.lastDonationDate -> aujourd'hui, format AWSDate (YYYY-MM-DD), via
//     updateAnimalLastDonationDateSimple.
//   - Upsert best-effort d'une ClinicOwnerRelation(clinicID, ownerID) — voir
//     resolveClinicOwnerRelationUpsert (fonction pure, testée séparément dans
//     src/services/__tests__/clinic-owner-relation-service.test.js depuis son extraction
//     vers ce service, demande produit 2026-08-23) pour la logique de décision, et le bloc
//     "closeMission — upsert ClinicOwnerRelation (Phase 3.1)" pour le câblage bout-en-bout
//     (requête clinicOwnerRelationsByOwnerID puis, si besoin, createClinicOwnerRelationSimple).
// - NO_SHOW ne touche jamais Animal, ni ClinicOwnerRelation.
// - outcome invalide -> throw INVALID_OUTCOME avant tout appel GraphQL.
//
// Phase 8, sous-tâche 5 (lot 3/3) : mock migré vers le client Gen2 (`aws-amplify/data`,
// `client.models.{Mission,Animal,ClinicOwnerRelation,Clinic}.*`), un mock dédié par méthode de
// modèle plutôt qu'un unique `graphqlMock` discriminé par le texte de la query (même
// convention que useAnimals.js/useClinicDonors.js, lots 1/2). Assertions métier inchangées.
//
// Double validation de Mission (2026-08-26, étape 4/5) — DEUX changements de comportement que
// ce fichier verrouille désormais :
// 1. L'écriture du statut passe par `client.mutations.submitMissionValidation` et plus par
//    `client.models.Mission.update({ status })` (fermé côté @auth, étape 1/5). Le mock de
//    `Mission.update` est conservé exprès, pour pouvoir prouver qu'il n'est PLUS appelé.
// 2. Les 3 écritures secondaires ne dépendent plus de l'`outcome` demandé par le vétérinaire
//    mais du statut RÉELLEMENT retourné par le serveur — d'où `mockCompletedFlow(...,
//    { finalStatus })` ci-dessous, et le bloc de tests dédié "statut retourné".
// Le test le plus important du fichier est celui du MAPPING COMPLETED->CONFIRMED /
// NO_SHOW->DENIED : une inversion y serait silencieuse et catastrophique (confirmer un don qui
// n'a pas eu lieu).

const missionUpdateMock = vi.fn()
const submitMissionValidationMock = vi.fn()
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
    mutations: {
      submitMissionValidation: (...args) => submitMissionValidationMock(...args),
    },
  }),
}))

import { useMissionClosure } from '@/composables/useMissionClosure'
import { MissionStatus, MissionValidationOutcome } from '@/constants/enums'

const resetAllMocks = () => {
  missionUpdateMock.mockReset()
  submitMissionValidationMock.mockReset()
  animalUpdateMock.mockReset()
  relationListMock.mockReset()
  relationCreateMock.mockReset()
  clinicGetMock.mockReset()
  clinicUpdateMock.mockReset()
}

/**
 * Cas nominal du serveur pour les tests qui ne s'intéressent PAS au statut agrégé : l'autre côté
 * (l'Owner) a déjà voté dans le même sens, donc la Mission est finalisée immédiatement — le
 * statut renvoyé est la conséquence directe du vote soumis (CONFIRMED -> COMPLETED,
 * DENIED -> NO_SHOW, matrice de submit-mission-validation-finalize-status.js). C'est ce qui
 * reproduit le comportement d'AVANT la double validation, et permet aux tests historiques de ce
 * fichier de continuer à exercer les mêmes chemins.
 */
const mockBothSidesAgree = () => {
  submitMissionValidationMock.mockImplementation(async (input) => ({
    data: {
      id: input.missionId,
      status:
        input.outcome === MissionValidationOutcome.CONFIRMED
          ? MissionStatus.COMPLETED
          : MissionStatus.NO_SHOW,
    },
    errors: undefined,
  }))
}

/**
 * Mocks des 3 écritures secondaires en succès (Animal / ClinicOwnerRelation / Clinic), sans
 * toucher au mock de la mutation de validation — utile aux tests centrés sur ce qui est SOUMIS
 * plutôt que sur ce qui est retourné.
 */
function mockSecondaryWritesOk(
  existingRelations = [],
  clinicStats = { transfusionsDone: 0, donorOwnersCount: 0 },
) {
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

/**
 * Configure les mocks pour un scénario "les deux côtés ont confirmé" complet (statut final
 * COMPLETED, sauf `finalStatus` explicite) : `existingRelations` simule la réponse de
 * `ClinicOwnerRelation.list` pour l'Owner ciblé ; `clinicStats` simule l'état courant de
 * Clinic.transfusionsDone/donorOwnersCount AVANT l'incrément (0/0 par défaut, comme une Clinic
 * fraîchement créée — voir VerifyEmailView.vue).
 */
function mockCompletedFlow(
  existingRelations,
  clinicStats = { transfusionsDone: 0, donorOwnersCount: 0 },
  finalStatus = MissionStatus.COMPLETED,
) {
  submitMissionValidationMock.mockImplementation(async (input) => ({
    data: { id: input.missionId, status: finalStatus },
    errors: undefined,
  }))
  mockSecondaryWritesOk(existingRelations, clinicStats)
}

describe('useMissionClosure.closeMission', () => {
  beforeEach(resetAllMocks)

  afterEach(() => {
    vi.useRealTimers()
  })

  it('COMPLETED : soumet la validation vétérinaire ET met à jour Animal.lastDonationDate, dans cet ordre, avec la date du jour au format AWSDate exact (YYYY-MM-DD), puis upserte la ClinicOwnerRelation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T21:47:33.123Z'))

    // Owner déjà lié à cette clinique exacte : pas de création, la lecture
    // ClinicOwnerRelation.list a quand même bien lieu — voir les tests dédiés
    // ClinicOwnerRelation plus bas pour les scénarios de création.
    mockCompletedFlow([{ clinicID: 'clinic-1', isPrimaryClinic: true }])

    const { closeMission, isClosing } = useMissionClosure()

    const finalStatus = await closeMission(
      'mission-1',
      'animal-1',
      MissionStatus.COMPLETED,
      'clinic-1',
      'owner-1',
    )

    expect(submitMissionValidationMock).toHaveBeenCalledTimes(1)
    expect(submitMissionValidationMock).toHaveBeenCalledWith({
      missionId: 'mission-1',
      outcome: 'CONFIRMED',
    })
    expect(finalStatus).toBe('COMPLETED')

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
      mockBothSidesAgree()
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

  it("NO_SHOW : soumet la validation vétérinaire uniquement, n'appelle jamais la mutation Animal ni ClinicOwnerRelation (même clinicID/ownerID fournis)", async () => {
    mockBothSidesAgree()

    const { closeMission } = useMissionClosure()

    const finalStatus = await closeMission(
      'mission-1',
      'animal-1',
      MissionStatus.NO_SHOW,
      'clinic-1',
      'owner-1',
    )

    expect(submitMissionValidationMock).toHaveBeenCalledTimes(1)
    expect(submitMissionValidationMock).toHaveBeenCalledWith({
      missionId: 'mission-1',
      outcome: 'DENIED',
    })
    expect(finalStatus).toBe('NO_SHOW')
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

      expect(submitMissionValidationMock).not.toHaveBeenCalled()
      expect(isClosing.value).toBe(false)
    },
  )

  it('isClosing : true pendant la clôture, false après succès', async () => {
    let isClosingDuringCall = null
    submitMissionValidationMock.mockImplementation(async () => {
      isClosingDuringCall = isClosing.value
      return { data: { id: 'mission-1', status: 'NO_SHOW' }, errors: undefined }
    })

    const { closeMission, isClosing } = useMissionClosure()
    expect(isClosing.value).toBe(false)

    await closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW)

    expect(isClosingDuringCall).toBe(true)
    expect(isClosing.value).toBe(false)
  })

  it('isClosing repasse à false même en cas d\'échec réseau/@auth sur submitMissionValidation, et propage l\'erreur', async () => {
    const networkError = new Error('Network error')
    submitMissionValidationMock.mockRejectedValue(networkError)

    const { closeMission, isClosing } = useMissionClosure()

    await expect(closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)).rejects.toThrow(
      'Network error',
    )

    expect(isClosing.value).toBe(false)
  })

  it("propage l'erreur et repasse isClosing à false si submitMissionValidation réussit mais la mutation Animal échoue (COMPLETED)", async () => {
    const animalError = new Error('Animal update failed')
    mockBothSidesAgree()
    animalUpdateMock.mockRejectedValue(animalError)

    const { closeMission, isClosing } = useMissionClosure()

    await expect(closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)).rejects.toThrow(
      'Animal update failed',
    )

    expect(submitMissionValidationMock).toHaveBeenCalledTimes(1)
    expect(animalUpdateMock).toHaveBeenCalledTimes(1)
    // L'échec de la mutation Animal interrompt le flux avant tout appel ClinicOwnerRelation.
    expect(relationListMock).not.toHaveBeenCalled()
    expect(isClosing.value).toBe(false)
  })

  it('logue une erreur contextuelle en français avant de la propager', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    submitMissionValidationMock.mockRejectedValue(new Error('boom'))

    const { closeMission } = useMissionClosure()

    await expect(closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW)).rejects.toThrow()

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('clôture'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it("re-clôture d'une Mission déjà validée de ce côté : closeMission ne vérifie toujours PAS le statut courant avant d'appeler — c'est désormais le SERVEUR qui refuse (ALREADY_VALIDATED), et l'erreur est relayée telle quelle, sans mapping de code", async () => {
    // Contrat historique (Phase 2.1) : la garde contre une re-clôture accidentelle (double clic)
    // était portée UNIQUEMENT par l'UI (boutons affichés seulement pour ACCEPTED/
    // PENDING_ARRIVAL), ce composable ne vérifiait rien et une seconde écriture passait
    // silencieusement.
    //
    // Depuis la double validation (étape 4/5), ce composable ne vérifie toujours rien de
    // lui-même — mais le resolver est write-once PAR CÔTÉ (condition DynamoDB
    // `clinicValidationOutcome: { attributeExists: false }`,
    // submit-mission-validation-write-side.js) : le second appel échoue côté serveur avec
    // l'errorType `ALREADY_VALIDATED`. `closeMission` n'a délibérément PAS de mapping de code
    // d'erreur (contrairement à `submitDonationValidation`, useOwnerMissions.js) — RequestsView.vue
    // affiche un message générique, voir son commentaire. Ce test verrouille ce contrat :
    // l'erreur remonte, elle n'est ni avalée ni renommée.
    mockBothSidesAgree()

    const { closeMission } = useMissionClosure()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW)).resolves.toBe(
      'NO_SHOW',
    )

    submitMissionValidationMock.mockResolvedValue({
      data: null,
      errors: [
        {
          errorType: 'ALREADY_VALIDATED',
          message: 'Ce côté a déjà soumis sa validation pour cette Mission.',
        },
      ],
    })

    const error = await closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW).catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error.errors[0].errorType).toBe('ALREADY_VALIDATED')

    expect(submitMissionValidationMock).toHaveBeenCalledTimes(2)
    consoleErrorSpy.mockRestore()
  })

  it("n'écrit JAMAIS Mission.status via la mutation générée (client.models.Mission.update) — cette voie est fermée côté @auth depuis l'étape 1/5, la mutation custom est la seule", async () => {
    // Régression directe : si quelqu'un réintroduisait `client.models.Mission.update({ id,
    // status })` ici (par exemple en « simplifiant » le composable), l'appel échouerait en
    // production au niveau @auth (`missionStatusFieldAuth` retire `update` aux Veterinarians)
    // et court-circuiterait surtout toute la double validation.
    mockCompletedFlow([{ clinicID: 'clinic-1', isPrimaryClinic: true }])

    const { closeMission } = useMissionClosure()
    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')
    await closeMission('mission-2', 'animal-2', MissionStatus.NO_SHOW, 'clinic-1', 'owner-1')

    expect(missionUpdateMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// LE bloc le plus important de ce fichier : la traduction MissionStatus -> MissionValidationOutcome.
// Une inversion (COMPLETED -> DENIED) serait SILENCIEUSE en production et confirmerait le
// NON-don d'un animal réellement prélevé (Frequency Rule jamais réarmée, litige fabriqué).
describe('useMissionClosure — mapping COMPLETED->CONFIRMED / NO_SHOW->DENIED (anti-inversion)', () => {
  beforeEach(() => {
    resetAllMocks()
    // Les écritures secondaires ne sont pas le sujet de ce bloc, mais elles s'exécutent sur un
    // statut final COMPLETED : mockées en succès pour qu'elles ne parasitent pas l'assertion.
    mockSecondaryWritesOk()
  })

  it.each([
    [MissionStatus.COMPLETED, MissionValidationOutcome.CONFIRMED],
    [MissionStatus.NO_SHOW, MissionValidationOutcome.DENIED],
  ])('closeMission(%s) soumet outcome=%s', async (outcome, expectedValidationOutcome) => {
    mockBothSidesAgree()

    const { closeMission } = useMissionClosure()
    await closeMission('mission-1', 'animal-1', outcome, 'clinic-1', 'owner-1')

    expect(submitMissionValidationMock).toHaveBeenCalledTimes(1)
    expect(submitMissionValidationMock.mock.calls[0][0].outcome).toBe(expectedValidationOutcome)
  })

  it("COMPLETED ne soumet JAMAIS DENIED, et NO_SHOW ne soumet JAMAIS CONFIRMED (assertion négative explicite : une table inversée passerait les assertions positives d'un test mal écrit)", async () => {
    mockBothSidesAgree()
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')
    expect(submitMissionValidationMock.mock.calls[0][0].outcome).not.toBe(
      MissionValidationOutcome.DENIED,
    )

    await closeMission('mission-2', 'animal-2', MissionStatus.NO_SHOW, 'clinic-1', 'owner-1')
    expect(submitMissionValidationMock.mock.calls[1][0].outcome).not.toBe(
      MissionValidationOutcome.CONFIRMED,
    )
  })

  it("ne soumet jamais 'PENDING' ni un MissionStatus brut : la valeur envoyée appartient toujours à MissionValidationOutcome", async () => {
    mockBothSidesAgree()
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')
    await closeMission('mission-2', 'animal-2', MissionStatus.NO_SHOW, 'clinic-1', 'owner-1')

    const submitted = submitMissionValidationMock.mock.calls.map((call) => call[0].outcome)
    expect(submitted).toEqual(['CONFIRMED', 'DENIED'])
    submitted.forEach((value) => {
      expect(value).not.toBe(MissionValidationOutcome.PENDING)
      expect([MissionValidationOutcome.CONFIRMED, MissionValidationOutcome.DENIED]).toContain(value)
    })
  })

  it("n'envoie jamais de disputeReason (champ réservé au côté Owner) ni aucun autre argument", async () => {
    mockBothSidesAgree()
    const { closeMission } = useMissionClosure()

    await closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW, 'clinic-1', 'owner-1')

    expect(Object.keys(submitMissionValidationMock.mock.calls[0][0]).sort()).toEqual([
      'missionId',
      'outcome',
    ])
  })
})

// Second changement de comportement de cette sous-tâche : les 3 écritures secondaires suivent
// désormais le statut RETOURNÉ, jamais l'outcome demandé.
describe('useMissionClosure — écritures secondaires conditionnées au statut RETOURNÉ par le serveur', () => {
  beforeEach(resetAllMocks)

  it("PENDING_VALIDATION (le propriétaire n'a pas encore répondu) : AUCUNE des 3 écritures secondaires, alors même que le vétérinaire a clôturé en COMPLETED — c'est le coeur de la double validation", async () => {
    mockCompletedFlow([], { transfusionsDone: 0, donorOwnersCount: 0 }, MissionStatus.PENDING_VALIDATION)

    const { closeMission } = useMissionClosure()
    const finalStatus = await closeMission(
      'mission-1',
      'animal-1',
      MissionStatus.COMPLETED,
      'clinic-1',
      'owner-1',
    )

    expect(finalStatus).toBe('PENDING_VALIDATION')
    // Le vote a bien été soumis...
    expect(submitMissionValidationMock).toHaveBeenCalledTimes(1)
    // ...mais rien d'autre : la Frequency Rule n'est PAS réarmée, l'annuaire n'est PAS peuplé,
    // les compteurs de la clinique ne bougent PAS tant que l'Owner n'a pas confirmé.
    expect(animalUpdateMock).not.toHaveBeenCalled()
    expect(relationListMock).not.toHaveBeenCalled()
    expect(relationCreateMock).not.toHaveBeenCalled()
    expect(clinicGetMock).not.toHaveBeenCalled()
    expect(clinicUpdateMock).not.toHaveBeenCalled()
  })

  it('DISPUTED (les deux côtés ont répondu, en désaccord) : aucune écriture secondaire', async () => {
    mockCompletedFlow([], { transfusionsDone: 0, donorOwnersCount: 0 }, MissionStatus.DISPUTED)

    const { closeMission } = useMissionClosure()
    const finalStatus = await closeMission(
      'mission-1',
      'animal-1',
      MissionStatus.COMPLETED,
      'clinic-1',
      'owner-1',
    )

    expect(finalStatus).toBe('DISPUTED')
    expect(animalUpdateMock).not.toHaveBeenCalled()
    expect(relationListMock).not.toHaveBeenCalled()
    expect(clinicGetMock).not.toHaveBeenCalled()
  })

  it("COMPLETED_AUTO : aucune écriture secondaire non plus — c'est la Lambda de finalisation automatique qui les porte de son côté (ADR-0016 §4), les refaire ici compterait le don deux fois", async () => {
    mockCompletedFlow([], { transfusionsDone: 0, donorOwnersCount: 0 }, MissionStatus.COMPLETED_AUTO)

    const { closeMission } = useMissionClosure()
    const finalStatus = await closeMission(
      'mission-1',
      'animal-1',
      MissionStatus.COMPLETED,
      'clinic-1',
      'owner-1',
    )

    expect(finalStatus).toBe('COMPLETED_AUTO')
    expect(animalUpdateMock).not.toHaveBeenCalled()
    expect(clinicGetMock).not.toHaveBeenCalled()
  })

  it("NO_SHOW final (les deux côtés ont infirmé le don) : aucune écriture secondaire", async () => {
    mockCompletedFlow([], { transfusionsDone: 0, donorOwnersCount: 0 }, MissionStatus.NO_SHOW)

    const { closeMission } = useMissionClosure()
    const finalStatus = await closeMission(
      'mission-1',
      'animal-1',
      MissionStatus.NO_SHOW,
      'clinic-1',
      'owner-1',
    )

    expect(finalStatus).toBe('NO_SHOW')
    expect(animalUpdateMock).not.toHaveBeenCalled()
    expect(relationListMock).not.toHaveBeenCalled()
  })

  it("COMPLETED atteint alors que le vétérinaire a soumis NO_SHOW n'existe pas côté serveur, mais si la mutation le renvoyait, les écritures suivraient le statut RETOURNÉ (et non l'outcome demandé) — verrouille l'absence de repli sur `outcome`", async () => {
    mockCompletedFlow([], { transfusionsDone: 0, donorOwnersCount: 0 }, MissionStatus.COMPLETED)

    const { closeMission } = useMissionClosure()
    await closeMission('mission-1', 'animal-1', MissionStatus.NO_SHOW, 'clinic-1', 'owner-1')

    expect(submitMissionValidationMock.mock.calls[0][0].outcome).toBe('DENIED')
    expect(animalUpdateMock).toHaveBeenCalledTimes(1)
  })

  it('réponse sans data exploitable (défensif) : retourne null et ne déclenche aucune écriture secondaire', async () => {
    submitMissionValidationMock.mockResolvedValue({ data: null, errors: undefined })

    const { closeMission } = useMissionClosure()
    const finalStatus = await closeMission(
      'mission-1',
      'animal-1',
      MissionStatus.COMPLETED,
      'clinic-1',
      'owner-1',
    )

    expect(finalStatus).toBeNull()
    expect(animalUpdateMock).not.toHaveBeenCalled()
    expect(clinicGetMock).not.toHaveBeenCalled()
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
    ).resolves.toBe(MissionStatus.COMPLETED)

    expect(relationListMock).toHaveBeenCalledTimes(1)
    expect(relationCreateMock).not.toHaveBeenCalled()
  })

  it("l'échec de l'upsert ClinicOwnerRelation ne fait PAS échouer closeMission (best-effort) — Mission/Animal déjà écrits avec succès à ce stade", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockBothSidesAgree()
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
    ).resolves.toBe(MissionStatus.COMPLETED)

    expect(isClosing.value).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ClinicOwnerRelation'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it("l'échec de CreateClinicOwnerRelation lui-même (pas seulement de la query précédente) ne fait PAS échouer closeMission (best-effort) — chemin de code distinct du test 'ClinicOwnerRelationsByOwnerID throttled' ci-dessus, qui ne couvrait que l'échec de la QUERY", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockBothSidesAgree()
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
    ).resolves.toBe(MissionStatus.COMPLETED)

    expect(isClosing.value).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ClinicOwnerRelation'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it('clinicID/ownerID manquants (appelant non migré vers le nouveau contrat) : no-op silencieux, ne bloque pas closeMission, log une erreur contextuelle', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockBothSidesAgree()
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, lastDonationDate: input.lastDonationDate },
      errors: undefined,
    }))

    const { closeMission } = useMissionClosure()

    // Pas de clinicID/ownerID passés — même contrat que le reste du fichier avant cette
    // sous-tâche (closeMission(missionId, animalId, outcome)).
    await expect(closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)).resolves.toBe(MissionStatus.COMPLETED)

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
    mockBothSidesAgree()
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
    ).resolves.toBe(MissionStatus.COMPLETED)

    expect(isClosing.value).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('indicateurs clinique'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it("échec de UpdateClinicStats (écriture des compteurs) ne fait PAS échouer closeMission (best-effort)", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockBothSidesAgree()
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
    ).resolves.toBe(MissionStatus.COMPLETED)

    expect(isClosing.value).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('indicateurs clinique'),
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it('clinicID manquant (appelant non migré) : aucun appel GetClinic/UpdateClinicStats, no-op silencieux + log, ne bloque pas closeMission', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockBothSidesAgree()
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { id: input.id, lastDonationDate: input.lastDonationDate },
      errors: undefined,
    }))

    const { closeMission } = useMissionClosure()

    // Pas de clinicID/ownerID : upsertClinicOwnerRelation ET incrementClinicStats no-opent
    // tous les deux avant le moindre appel GraphQL les concernant.
    await expect(closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED)).resolves.toBe(MissionStatus.COMPLETED)

    expect(clinicGetMock).not.toHaveBeenCalled()
    expect(clinicUpdateMock).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('indicateurs clinique'))

    consoleErrorSpy.mockRestore()
  })
})

