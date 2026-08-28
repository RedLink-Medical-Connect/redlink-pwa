import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────────────────────────────────
// DOUBLE VALIDATION DE MISSION — TEST D'INTÉGRATION ENTRE SOUS-TÂCHES (passe QA, 2026-08-27)
//
// Tous les tests existants de cette feature sont cloisonnés par sous-tâche : les composables
// (étape 4/5) sont testés contre un mock de `submitMissionValidation` qui RENVOIE un statut
// décidé par le test lui-même, et le resolver (étape 1/5) n'était testé nulle part. Résultat :
// aucun test ne confronte les deux bouts. Une inversion de la table de traduction
// `MissionStatus -> MissionValidationOutcome` (`useMissionClosure.js`), ou une divergence de
// vocabulaire entre le front et le resolver, passerait tous les tests unitaires existants.
//
// Ce fichier ferme ce trou : il branche les VRAIS composables sur les VRAIES fonctions du
// resolver AppSync JS (`amplify/data/resolvers/submit-mission-validation-*.js`), jouées contre
// un magasin en mémoire qui applique réellement les conditions DynamoDB. Ce n'est pas un test
// réseau (impossible ici : pas de sandbox AppSync) mais un test de bout en bout du CODE : les
// deux appels successifs des deux côtés traversent la même chaîne de décision qu'en production,
// à l'exception du transport et du moteur DynamoDB réels.
//
// Voir `amplify/data/__tests__/submit-mission-validation.resolvers.test.js` pour le détail du
// harnais (et pourquoi ces resolvers SONT testables, contrairement à ce qu'affirment plusieurs
// commentaires de la feature).

const NOW = '2026-08-26T10:00:00.000Z'

vi.mock('@aws-appsync/utils/dynamodb', () => ({
  update: (input) => ({ operation: 'UpdateItem', ...input }),
  get: (input) => ({ operation: 'GetItem', ...input }),
}))

vi.mock('@aws-appsync/utils', () => ({
  util: {
    error: (message, errorType, data) => {
      const error = new Error(message)
      error.errorType = errorType
      error.data = data
      throw error
    },
    time: { nowISO8601: () => NOW },
  },
}))

const submitMissionValidationMock = vi.fn()
const animalUpdateMock = vi.fn()
const relationListMock = vi.fn()
const relationCreateMock = vi.fn()
const clinicGetMock = vi.fn()
const clinicUpdateMock = vi.fn()
const missionUpdateMock = vi.fn()
// Lecture de contexte du côté Owner (correctif QA du 2026-08-27) : `Mission` ne porte pas de
// `clinicID`, il est résolu via `Mission.request.clinicID` — exactement ce que fait déjà la
// Lambda de finalisation automatique (ADR-0016 §5) faute d'un `clinicID` fourni par un appelant.
const missionGetMock = vi.fn()
const ratingCreateMock = vi.fn()
const veterinarianGetMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Mission: {
        update: (...args) => missionUpdateMock(...args),
        get: (...args) => missionGetMock(...args),
      },
      Animal: { update: (...args) => animalUpdateMock(...args) },
      ClinicOwnerRelation: {
        list: (...args) => relationListMock(...args),
        create: (...args) => relationCreateMock(...args),
      },
      Clinic: {
        get: (...args) => clinicGetMock(...args),
        update: (...args) => clinicUpdateMock(...args),
      },
      // Exposé exprès : c'est ce qui permet d'affirmer qu'AUCUN chemin de validation ne
      // déclenche une notation en chaîne (exigence CdC « la notation ne bloque jamais »).
      Rating: { create: (...args) => ratingCreateMock(...args) },
      Veterinarian: { get: (...args) => veterinarianGetMock(...args) },
    },
    mutations: {
      submitMissionValidation: (...args) => submitMissionValidationMock(...args),
    },
  }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ userId: 'owner-1' })),
}))

import { useMissionClosure } from '@/composables/useMissionClosure'
import { useOwnerMissions } from '@/composables/useOwnerMissions'
import { useRatings } from '@/composables/useRatings'
import {
  MissionStatus,
  MissionValidationOutcome,
  RatingParticipantRole,
} from '@/constants/enums'
import * as writeSide from '../../../amplify/data/resolvers/submit-mission-validation-write-side'
import * as readMission from '../../../amplify/data/resolvers/submit-mission-validation-read-mission'
import * as finalizeStatus from '../../../amplify/data/resolvers/submit-mission-validation-finalize-status'
import { resolveAutoFinalizationOutcome } from '../../../amplify/functions/mission-validation-auto-finalizer/resolve-auto-finalization-outcome'

// ─────────────────────────────────────────────────────────────────────────────────────────
// « Serveur » : magasin en mémoire + pipeline resolver réel
// ─────────────────────────────────────────────────────────────────────────────────────────

let store
/** Groupes Cognito de la session courante — c'est ce que le resolver lit (jamais un argument). */
let currentGroups = []

function applyUpdate(payload) {
  const item = store.get(payload.key.id)
  const conditionsHold = Object.entries(payload.condition ?? {}).every(([field, rule]) => {
    const present = item !== undefined && item[field] !== undefined && item[field] !== null
    if (Object.prototype.hasOwnProperty.call(rule, 'attributeExists')) {
      return present === rule.attributeExists
    }
    return present && item[field] === rule.eq
  })

  if (!conditionsHold) {
    return {
      error: {
        type: 'DynamoDB:ConditionalCheckFailedException',
        message: 'The conditional request failed',
      },
    }
  }

  const next = { ...(item ?? { id: payload.key.id }), ...payload.update }
  store.set(payload.key.id, next)
  return { result: { ...next } }
}

/** Rejoue le pipeline `submitMissionValidation` (3 fonctions) comme le ferait AppSync. */
const fakeSubmitMissionValidation = async (args) => {
  const ctx = { args, identity: { groups: currentGroups }, prev: {} }

  try {
    for (const fn of [writeSide, readMission, finalizeStatus]) {
      const payload = fn.request(ctx)
      const outcome =
        payload.operation === 'GetItem'
          ? { result: store.has(payload.key.id) ? { ...store.get(payload.key.id) } : null }
          : applyUpdate(payload)

      ctx.result = outcome.result
      ctx.error = outcome.error
      ctx.prev = { result: fn.response(ctx) }
      ctx.error = undefined
    }
    return { data: ctx.prev.result, errors: undefined }
  } catch (error) {
    // Le client Gen2 ne LÈVE PAS sur une erreur GraphQL : il résout `{ data, errors }`
    // (CLAUDE.md) — c'est ce comportement précis que les composables doivent traverser.
    return { data: null, errors: [{ errorType: error.errorType, message: error.message }] }
  }
}

const asVeterinarian = () => {
  currentGroups = ['Veterinarians']
}
const asOwner = () => {
  currentGroups = ['Owners']
}

const secondaryWriteCalls = () => ({
  animal: animalUpdateMock.mock.calls.length,
  relationList: relationListMock.mock.calls.length,
  relationCreate: relationCreateMock.mock.calls.length,
  clinicGet: clinicGetMock.mock.calls.length,
  clinicUpdate: clinicUpdateMock.mock.calls.length,
})

beforeEach(() => {
  vi.clearAllMocks()
  store = new Map([
    [
      'mission-1',
      { id: 'mission-1', status: 'PENDING_ARRIVAL', animalID: 'animal-1', requestID: 'request-1' },
    ],
  ])
  currentGroups = []

  submitMissionValidationMock.mockImplementation(fakeSubmitMissionValidation)
  // Résolution `Mission.request.clinicID` côté Owner : la Mission du magasin appartient bien à
  // `request-1`, elle-même rattachée à `clinic-1` (cohérent avec le `clinicID` que
  // RequestsView.vue passe à `closeMission` dans ces mêmes tests).
  missionGetMock.mockResolvedValue({
    data: { request: { clinicID: 'clinic-1' } },
    errors: undefined,
  })
  animalUpdateMock.mockResolvedValue({ data: { id: 'animal-1' }, errors: undefined })
  relationListMock.mockResolvedValue({ data: [], errors: undefined })
  relationCreateMock.mockResolvedValue({ data: { id: 'relation-1' }, errors: undefined })
  clinicGetMock.mockResolvedValue({
    data: { id: 'clinic-1', transfusionsDone: 2, donorOwnersCount: 1 },
    errors: undefined,
  })
  clinicUpdateMock.mockResolvedValue({ data: { id: 'clinic-1' }, errors: undefined })
  ratingCreateMock.mockResolvedValue({ data: { missionID: 'mission-1' }, errors: undefined })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// SCÉNARIO 1 — double confirmation « live », les deux ordres
// ─────────────────────────────────────────────────────────────────────────────────────────
describe('double validation bout-en-bout : composable Owner + composable Clinic sur le VRAI resolver', () => {
  it('Owner CONFIRME puis Clinic CONFIRME : PENDING_VALIDATION puis COMPLETED, et les 3 écritures secondaires partent une seule fois (au 2e appel)', async () => {
    const { submitDonationValidation } = useOwnerMissions()
    const { closeMission } = useMissionClosure()

    asOwner()
    const afterOwner = await submitDonationValidation(
      'mission-1',
      MissionValidationOutcome.CONFIRMED,
    )
    expect(afterOwner).toBe(MissionStatus.PENDING_VALIDATION)
    expect(secondaryWriteCalls()).toMatchObject({ animal: 0, clinicUpdate: 0 })

    asVeterinarian()
    const afterClinic = await closeMission(
      'mission-1',
      'animal-1',
      MissionStatus.COMPLETED,
      'clinic-1',
      'owner-1',
    )

    expect(afterClinic).toBe(MissionStatus.COMPLETED)
    expect(store.get('mission-1')).toMatchObject({
      status: 'COMPLETED',
      ownerValidationOutcome: 'CONFIRMED',
      clinicValidationOutcome: 'CONFIRMED',
    })
    expect(secondaryWriteCalls()).toEqual({
      animal: 1,
      relationList: 1,
      relationCreate: 1,
      clinicGet: 1,
      clinicUpdate: 1,
    })
    expect(clinicUpdateMock).toHaveBeenCalledWith({
      id: 'clinic-1',
      transfusionsDone: 3,
      donorOwnersCount: 2,
    })
  })

  // ⚠️ CE TEST DOCUMENTAIT UN BUG RÉEL (passe QA du 2026-08-27), CORRIGÉ DEPUIS — il vérifie
  // désormais le comportement CORRIGÉ, et verrouille explicitement ce qui reste ouvert.
  //
  // Dans CET ordre (le vétérinaire clôture en premier, ce qui est le flux nominal de
  // RequestsView.vue), la Mission atteint COMPLETED sur l'appel de l'OWNER —
  // `submitDonationValidation` ne déclenchait alors AUCUNE écriture secondaire : annuaire
  // donneurs vide et Frequency Rule non réarmée pour un don pourtant confirmé des deux côtés.
  // Le JSDoc annonçait que « la Lambda planifiée ou la prochaine action côté clinique » les
  // porterait : les deux affirmations étaient fausses (voir l'assertion sur la Lambda en fin de
  // test, et le write-once qui empêche la clinique de revoter).
  //
  // Correctif (front-only, `mission-completion-side-effects.js`) : le côté Owner émet la seule
  // des trois écritures qu'il a le droit d'émettre — l'upsert `ClinicOwnerRelation`, sa propre
  // ligne (`{allow: owner, ownerField: "ownerID"}`, ADR-0009). `Animal.lastDonationDate` et les
  // compteurs `Clinic` restent réservés aux `Veterinarians` par le schéma : ce test verrouille
  // AUSSI le fait qu'ils ne soient pas tentés, et donc le résidu à fermer côté SERVEUR.
  //
  // ⚠️ Limite de ce harnais, à ne pas surinterpréter : le magasin en mémoire ne rejoue que les
  // conditions DynamoDB du resolver, PAS le système `@auth` d'AppSync — il ne peut donc ni
  // prouver que l'upsert Owner passe réellement en production, ni qu'une écriture `Animal`
  // échouerait. Ces deux points viennent du SDL compilé (`schema.transform().schema`), lu lors
  // du correctif.
  it('Clinic CONFIRME puis Owner CONFIRME : la Mission atteint COMPLETED et l’annuaire donneurs est peuplé par le vote de l’OWNER (les 2 écritures réservées aux Veterinarians restent, elles, non émises)', async () => {
    const { closeMission } = useMissionClosure()
    const { submitDonationValidation } = useOwnerMissions()

    asVeterinarian()
    const afterClinic = await closeMission(
      'mission-1',
      'animal-1',
      MissionStatus.COMPLETED,
      'clinic-1',
      'owner-1',
    )
    expect(afterClinic).toBe(MissionStatus.PENDING_VALIDATION)
    // Rien ne part tant que le second vote n'est pas arrivé.
    expect(secondaryWriteCalls()).toEqual({
      animal: 0,
      relationList: 0,
      relationCreate: 0,
      clinicGet: 0,
      clinicUpdate: 0,
    })

    asOwner()
    const afterOwner = await submitDonationValidation(
      'mission-1',
      MissionValidationOutcome.CONFIRMED,
    )

    expect(afterOwner).toBe(MissionStatus.COMPLETED)
    expect(store.get('mission-1').status).toBe('COMPLETED')

    expect(secondaryWriteCalls()).toEqual({
      // ✅ corrigé : l'annuaire donneurs de la clinique est bien peuplé, quel que soit le côté
      // qui a voté en second (c'était le coeur du bug).
      relationList: 1,
      relationCreate: 1,
      // ❌ toujours 0, et c'est structurel : `Animal.lastDonationDate` (ADR-0003) et les
      // compteurs `Clinic` ne sont pas écrivables par un Owner. RÉSIDU OUVERT — la Frequency
      // Rule n'est pas réarmée sur ce chemin ; sa fermeture demande un chemin serveur (le
      // resolver au moment où il finalise en COMPLETED, ou une Lambda sur flux DynamoDB).
      animal: 0,
      clinicGet: 0,
      clinicUpdate: 0,
    })
    expect(relationCreateMock).toHaveBeenCalledWith({
      clinicID: 'clinic-1',
      ownerID: 'owner-1',
      isPrimaryClinic: true,
    })

    // Et la Lambda de finalisation automatique ne rattrapera pas le résidu : elle ne lit que les
    // Missions restées en PENDING_VALIDATION, et refuserait de toute façon de trancher une
    // Mission dont les DEUX côtés ont répondu. C'est la raison pour laquelle le résidu ne peut
    // PAS être considéré comme « déjà couvert ailleurs ».
    expect(
      resolveAutoFinalizationOutcome(store.get('mission-1'), {
        nowMs: Date.parse(NOW) + 365 * 24 * 60 * 60 * 1000,
        timeoutDays: 7,
      }),
    ).toEqual({ kind: 'SKIP', reason: 'BOTH_SIDES_RESPONDED' })
  })

  it('un don COMPLETED ne crée jamais DEUX ClinicOwnerRelation ni ne double-compte les indicateurs, quel que soit l’ordre des votes', async () => {
    // Garde-fou de non-régression du correctif : les deux côtés partagent désormais le même
    // module d'écritures secondaires, et seul le côté qui a effectivement finalisé la Mission
    // (le SECOND votant) les déclenche — jamais les deux.
    const { closeMission } = useMissionClosure()
    const { submitDonationValidation } = useOwnerMissions()

    asOwner()
    await submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED)
    asVeterinarian()
    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    expect(relationCreateMock).toHaveBeenCalledTimes(1)
    expect(clinicUpdateMock).toHaveBeenCalledTimes(1)
    expect(animalUpdateMock).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// SCÉNARIO 1 bis — anti-inversion, vérifié à travers la VRAIE matrice
// ─────────────────────────────────────────────────────────────────────────────────────────
describe('anti-inversion COMPLETED->CONFIRMED / NO_SHOW->DENIED, prouvée par le statut FINAL en base', () => {
  // Les tests existants de `useMissionClosure` vérifient l'argument envoyé (`outcome:
  // 'CONFIRMED'`) contre un mock ; si la table ÉTAIT inversée et que le test l'était aussi,
  // rien ne le verrait. Ici c'est la vraie matrice du resolver qui tranche : une inversion
  // produirait NO_SHOW là où on attend COMPLETED.
  it('les deux parties déclarent que le don a eu lieu -> la Mission finit COMPLETED (jamais NO_SHOW)', async () => {
    const { closeMission } = useMissionClosure()
    const { submitDonationValidation } = useOwnerMissions()

    asOwner()
    await submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED)
    asVeterinarian()
    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    expect(store.get('mission-1').status).toBe(MissionStatus.COMPLETED)
    expect(store.get('mission-1').clinicValidationOutcome).toBe(MissionValidationOutcome.CONFIRMED)
  })

  it('les deux parties déclarent que le don n’a PAS eu lieu -> NO_SHOW, et aucune écriture secondaire', async () => {
    const { closeMission } = useMissionClosure()
    const { submitDonationValidation } = useOwnerMissions()

    asOwner()
    await submitDonationValidation('mission-1', MissionValidationOutcome.DENIED, 'Jamais convoqué')
    asVeterinarian()
    const finalStatus = await closeMission(
      'mission-1',
      'animal-1',
      MissionStatus.NO_SHOW,
      'clinic-1',
      'owner-1',
    )

    expect(finalStatus).toBe(MissionStatus.NO_SHOW)
    expect(store.get('mission-1')).toMatchObject({
      status: 'NO_SHOW',
      clinicValidationOutcome: 'DENIED',
      ownerValidationOutcome: 'DENIED',
      ownerDisputeReason: 'Jamais convoqué',
    })
    expect(secondaryWriteCalls()).toMatchObject({ animal: 0, clinicUpdate: 0 })
  })

  it('désaccord (clinique COMPLETED / propriétaire DENIED) -> DISPUTED, et aucune écriture secondaire', async () => {
    const { closeMission } = useMissionClosure()
    const { submitDonationValidation } = useOwnerMissions()

    asOwner()
    await submitDonationValidation('mission-1', MissionValidationOutcome.DENIED)
    asVeterinarian()
    const finalStatus = await closeMission(
      'mission-1',
      'animal-1',
      MissionStatus.COMPLETED,
      'clinic-1',
      'owner-1',
    )

    expect(finalStatus).toBe(MissionStatus.DISPUTED)
    expect(secondaryWriteCalls()).toMatchObject({ animal: 0, clinicUpdate: 0 })
  })

  it('le vétérinaire ne peut pas écrire le côté Owner, ni l’Owner le côté clinique (rôle lu côté serveur)', async () => {
    const { closeMission } = useMissionClosure()

    asVeterinarian()
    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    expect(store.get('mission-1').clinicValidationOutcome).toBe('CONFIRMED')
    expect(store.get('mission-1').ownerValidationOutcome).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// Write-once par côté, traversé par les deux composables
// ─────────────────────────────────────────────────────────────────────────────────────────
describe('write-once par côté : la garde serveur remonte correctement dans les deux composables', () => {
  it('closeMission appelée deux fois : la 2e échoue avec ALREADY_VALIDATED, et le vote initial reste intact', async () => {
    const { closeMission } = useMissionClosure()
    asVeterinarian()

    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')
    const error = await closeMission(
      'mission-1',
      'animal-1',
      MissionStatus.NO_SHOW,
      'clinic-1',
      'owner-1',
    ).catch((e) => e)

    expect(error.errors[0].errorType).toBe('ALREADY_VALIDATED')
    expect(store.get('mission-1').clinicValidationOutcome).toBe('CONFIRMED')
  })

  it('submitDonationValidation appelée deux fois : la 2e lève Error("ALREADY_VALIDATED") normalisée', async () => {
    const { submitDonationValidation } = useOwnerMissions()
    asOwner()

    await submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED)

    await expect(
      submitDonationValidation('mission-1', MissionValidationOutcome.DENIED),
    ).rejects.toThrow('ALREADY_VALIDATED')
    expect(store.get('mission-1').ownerValidationOutcome).toBe('CONFIRMED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// SCÉNARIO 3 — la notation n'est JAMAIS enchaînée automatiquement
// ─────────────────────────────────────────────────────────────────────────────────────────
describe('notation : jamais déclenchée en chaîne par la validation (exigence CdC « ne bloque jamais »)', () => {
  it('aucun parcours de validation (Owner ou Clinic, jusqu’à COMPLETED) ne crée de Rating', async () => {
    const { closeMission } = useMissionClosure()
    const { submitDonationValidation } = useOwnerMissions()

    asOwner()
    await submitDonationValidation('mission-1', MissionValidationOutcome.CONFIRMED)
    asVeterinarian()
    await closeMission('mission-1', 'animal-1', MissionStatus.COMPLETED, 'clinic-1', 'owner-1')

    expect(ratingCreateMock).not.toHaveBeenCalled()
    expect(veterinarianGetMock).not.toHaveBeenCalled()
  })

  // Preuve STRUCTURELLE, en complément : même un futur enchaînement conditionnel (qui
  // n'apparaîtrait pas dans le test comportemental ci-dessus) exigerait de référencer la
  // notation depuis l'un de ces deux composables.
  it('ni useMissionClosure.js ni useOwnerMissions.js ne référencent la notation', () => {
    const sourceOf = (relativePath) =>
      readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

    for (const file of ['../useMissionClosure.js', '../useOwnerMissions.js']) {
      const source = sourceOf(file)
      // (les commentaires citent `useRatings`/`Rating` : on cherche des APPELS, pas des mots)
      expect(source).not.toMatch(/useRatings\s*\(/)
      expect(source).not.toMatch(/models\.Rating\b/)
      expect(source).not.toMatch(/submitRating\s*\(/)
    }
  })

  it('useRatings.submitRating reste appelable indépendamment, après coup, sans passer par la validation', async () => {
    veterinarianGetMock.mockResolvedValue({ data: { clinicID: 'clinic-1' }, errors: undefined })
    const { submitRating } = useRatings()

    await submitRating({
      missionId: 'mission-1',
      targetRole: RatingParticipantRole.OWNER,
      targetID: 'owner-1',
      stars: 5,
    })

    expect(ratingCreateMock).toHaveBeenCalledTimes(1)
    expect(submitMissionValidationMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// SCÉNARIO 2 — accord de vocabulaire entre les TROIS runtimes
// ─────────────────────────────────────────────────────────────────────────────────────────
describe('accord de vocabulaire front (enums) / resolver AppSync / Lambda planifiée', () => {
  const statusFromResolver = (clinicOutcome, ownerOutcome) =>
    finalizeStatus.request({
      args: { missionId: 'mission-1' },
      prev: {
        result: {
          id: 'mission-1',
          status: 'PENDING_ARRIVAL',
          clinicValidationOutcome: clinicOutcome,
          ownerValidationOutcome: ownerOutcome,
        },
      },
    }).update.status

  // Le maillon exact de la chaîne : le resolver ÉCRIT cette chaîne, la Lambda l'INTERROGE sur
  // le GSI, le front la FILTRE dans `awaitingValidationMissions`. Trois littéraux distincts
  // dans trois runtimes, sans aucun module partagé — confrontés ici.
  it('PENDING_VALIDATION est la MÊME chaîne côté resolver et côté enum front', () => {
    expect(statusFromResolver('CONFIRMED', undefined)).toBe(MissionStatus.PENDING_VALIDATION)
  })

  it('tous les statuts que le resolver peut écrire existent dans MissionStatus (front)', () => {
    const produced = new Set(
      [undefined, 'PENDING', 'CONFIRMED', 'DENIED'].flatMap((clinic) =>
        [undefined, 'PENDING', 'CONFIRMED', 'DENIED'].map((owner) =>
          statusFromResolver(clinic, owner),
        ),
      ),
    )

    for (const status of produced) {
      expect(Object.values(MissionStatus)).toContain(status)
    }
  })

  it('tous les statuts que la Lambda peut écrire existent dans MissionStatus, et sont DISJOINTS de ceux du resolver', () => {
    const lambdaStatuses = ['CONFIRMED', 'DENIED'].map((outcome) => {
      const decision = resolveAutoFinalizationOutcome(
        { clinicValidationOutcome: outcome, clinicValidatedAt: NOW },
        { nowMs: Date.parse(NOW) + 30 * 24 * 60 * 60 * 1000, timeoutDays: 7 },
      )
      return decision.kind === 'FINALIZE' ? decision.finalStatus : null
    })

    expect(lambdaStatuses).toEqual([MissionStatus.COMPLETED_AUTO, MissionStatus.DISPUTED])
    // COMPLETED_AUTO n'appartient qu'à la Lambda : c'est ce qui permet à `closeMission` de
    // tester `COMPLETED` STRICT sans compter un don deux fois (ADR-0016 §4).
    expect(statusFromResolver('CONFIRMED', 'CONFIRMED')).not.toBe(MissionStatus.COMPLETED_AUTO)
  })

  it('les deux valeurs de MissionValidationOutcome acceptées par le resolver sont exactement celles de l’enum front', () => {
    const accepted = [MissionValidationOutcome.CONFIRMED, MissionValidationOutcome.DENIED]

    for (const outcome of accepted) {
      expect(() =>
        writeSide.request({
          args: { missionId: 'mission-1', outcome },
          identity: { groups: ['Owners'] },
        }),
      ).not.toThrow()
    }
    // 'PENDING' est bien dans l'enum front (état initial) mais refusé comme SOUMISSION.
    expect(() =>
      writeSide.request({
        args: { missionId: 'mission-1', outcome: MissionValidationOutcome.PENDING },
        identity: { groups: ['Owners'] },
      }),
    ).toThrow()
  })
})
