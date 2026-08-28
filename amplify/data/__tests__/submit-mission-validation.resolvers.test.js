import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────────────────
// PIPELINE `submitMissionValidation` (double validation de Mission, 2026-08-26) — les 3
// fonctions du resolver AppSync JS, testées ICI pour la première fois.
//
// ÉTENDU LE 2026-08-27 (correctif de sécurité, docs/adr/0018) : le pipeline compte désormais
// 7 fonctions, les 4 premières vérifiant que l'appelant est réellement PARTIE à la Mission
// (Owner de l'Animal / vétérinaire de la clinique émettrice de la Request) AVANT toute
// écriture. Les sections ajoutées en fin de fichier couvrent ces 4 fonctions, isolément et
// dans le pipeline complet ; le harnais existant a été étendu (magasin multi-tables +
// identité de l'appelant) plutôt que dupliqué.
//
// POURQUOI CE FICHIER EXISTE (passe QA, 2026-08-27) : plusieurs commentaires de cette feature
// affirment que la logique de ces resolvers n'est pas testable dans ce dépôt (« runtime
// `APPSYNC_JS`, qu'aucun test de ce repo ne peut exécuter aujourd'hui », en tête de
// `resolve-auto-finalization-outcome.ts` et de `submit-mission-validation-finalize-status.js`).
// C'est vrai du RUNTIME (on ne peut pas exécuter un vrai resolver contre un vrai AppSync sans
// sandbox), mais PAS du code : `request()`/`response()` sont des fonctions JS ordinaires, et
// les deux seuls modules qu'elles importent (`@aws-appsync/utils` et
// `@aws-appsync/utils/dynamodb`) sont, dans le paquet npm installé, des coquilles VIDES —
// vérifié : `lib/index.js` exporte `const util = {}` et `lib/dynamodb-helpers.js` n'exporte
// rien (le paquet ne fournit que des types ; les implémentations vivent dans le runtime AWS).
// Il suffit donc de les doubler avec `vi.mock` pour exercer les décisions du resolver, SANS
// AUCUNE modification des fichiers de production (pas d'extraction de `computeAggregateStatus`
// vers un module séparé, qui aurait été le seul autre chemin envisagé — et qui aurait risqué
// de casser le runtime `APPSYNC_JS`, lequel n'autorise aucun import local dans un resolver).
//
// CE QUE CE FICHIER PROUVE ET QUE RIEN D'AUTRE NE PROUVAIT :
// - la matrice de réconciliation elle-même (CONFIRMED+CONFIRMED -> COMPLETED, etc.) : elle
//   n'existait jusqu'ici que dupliquée, en version « un seul côté a répondu », dans le module
//   pur de la Lambda (`resolve-auto-finalization-outcome.ts`) ;
// - le routage de rôle par `ctx.identity.groups` (jamais par un argument client) ;
// - les deux conditions DynamoDB (write-once par côté + garde anti-upsert `id attributeExists`,
//   condition optimiste sur `status`) ;
// - le SCÉNARIO BOUT-EN-BOUT « double confirmation live » : les deux appels successifs, dans
//   les deux ordres, joués contre un magasin en mémoire qui applique réellement les conditions
//   (voir `runSubmitMissionValidation` plus bas).
//
// CE QUE CE FICHIER NE PROUVE PAS (limites honnêtes, à ne pas surestimer) :
// - la sérialisation réelle des payloads `ddb.update`/`ddb.get` (marshalling DynamoDB) ;
// - la sémantique exacte de `ReturnValues` d'AppSync (l'en-tête de
//   `submit-mission-validation-write-side.js` documente qu'elle n'est pas vérifiable
//   localement — c'est précisément pourquoi la fonction 2/3 fait une lecture EXPLICITE) ;
// - le câblage `.handler([...])` en pipeline (couvert, lui, par le pin-test de SDL dans
//   `resource.transform.test.ts`).
// Le magasin en mémoire ci-dessous est un MODÈLE de DynamoDB, pas DynamoDB : il n'implémente
// que les deux formes de condition réellement utilisées par ces resolvers.

const NOW = '2026-08-26T10:00:00.000Z'

vi.mock('@aws-appsync/utils/dynamodb', () => ({
  // Les helpers renvoient normalement un payload marshallé ; ici on conserve les arguments
  // tels quels, ce qui est exactement ce que le test doit inspecter (la DÉCISION du resolver :
  // quelle clé, quelle condition, quels champs écrits).
  update: (input) => ({ operation: 'UpdateItem', ...input }),
  get: (input) => ({ operation: 'GetItem', ...input }),
}))

// Sentinelle d'`runtime.earlyReturn()` : côté AppSync, l'appel interrompt la fonction SANS
// appeler la source de données ni son `response()`, et le pipeline continue avec la valeur
// passée en argument (`Runtime.earlyReturn`, `@aws-appsync/utils/lib/index.d.ts`). Une
// exception dédiée est le modèle le plus proche côté test — le harnais la reconnaît et
// enchaîne sur la fonction suivante (voir `runSubmitMissionValidation`).
class EarlyReturn extends Error {
  constructor(value) {
    super('earlyReturn')
    this.value = value
  }
}

vi.mock('@aws-appsync/utils', () => ({
  util: {
    // `util.error()` interrompt la résolution côté AppSync ; une exception porteuse de
    // `errorType` en est le modèle le plus proche côté test.
    error: (message, errorType, data) => {
      const error = new Error(message)
      error.errorType = errorType
      error.data = data
      throw error
    },
    time: { nowISO8601: () => NOW },
  },
  runtime: {
    earlyReturn: (value) => {
      throw new EarlyReturn(value)
    },
  },
}))

import * as resolveParties from '../resolvers/submit-mission-validation-resolve-parties'
import * as verifyOwnerParty from '../resolvers/submit-mission-validation-verify-owner-party'
import * as loadVetClinic from '../resolvers/submit-mission-validation-load-vet-clinic'
import * as verifyClinicParty from '../resolvers/submit-mission-validation-verify-clinic-party'
import * as writeSide from '../resolvers/submit-mission-validation-write-side'
import * as readMission from '../resolvers/submit-mission-validation-read-mission'
import * as finalizeStatus from '../resolvers/submit-mission-validation-finalize-status'

// ─────────────────────────────────────────────────────────────────────────────────────────
// Magasin en mémoire + exécuteur de pipeline
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Applique un payload `ddb.update` à un magasin en mémoire, en respectant les DEUX formes de
 * condition utilisées par ce pipeline (et aucune autre) :
 * - `{ champ: { attributeExists: true|false } }` (fonction 1/3)
 * - `{ status: { eq: valeur } }` (fonction 3/3)
 * Les sous-conditions d'un même objet sont ANDées, comme côté AppSync.
 *
 * @returns `{ result }` (l'item entier après écriture, équivalent `ReturnValues: ALL_NEW`) ou
 *   `{ error }` avec le type exact qu'AppSync remonte sur condition non satisfaite.
 */
function applyUpdate(store, payload) {
  const item = store.get(payload.key.id)
  const conditionsHold = Object.entries(payload.condition ?? {}).every(([field, rule]) => {
    const present = item !== undefined && item[field] !== undefined && item[field] !== null
    if (Object.prototype.hasOwnProperty.call(rule, 'attributeExists')) {
      return present === rule.attributeExists
    }
    if (Object.prototype.hasOwnProperty.call(rule, 'eq')) {
      return present && item[field] === rule.eq
    }
    throw new Error(`Condition non modélisée par ce harnais de test : ${JSON.stringify(rule)}`)
  })

  if (!conditionsHold) {
    return {
      error: {
        type: 'DynamoDB:ConditionalCheckFailedException',
        message: 'The conditional request failed',
      },
    }
  }

  // Sans condition d'existence satisfaite, DynamoDB ferait un upsert ; le harnais le reproduit
  // pour que le test anti-upsert de la fonction 1/3 ait un vrai pouvoir de détection.
  const next = { ...(item ?? { id: payload.key.id }), ...payload.update }
  store.set(payload.key.id, next)
  return { result: { ...next } }
}

function applyGet(store, payload) {
  const item = store.get(payload.key.id)
  return { result: item ? { ...item } : null }
}

// Les 7 fonctions du pipeline, dans l'ordre RÉEL de `amplify/data/resource.ts`, avec la table
// que chacune interroge — c'est le point clé du correctif du 2026-08-27 : les 4 premières
// fonctions ciblent des sources de données DIFFÉRENTES (`Animal`/`Veterinarian`/`Request`), une
// fonction AppSync ne pouvant en interroger qu'une. L'ordre et les sources sont par ailleurs
// pin-testés sur le schéma compilé (`resource.transform.test.ts`, `schema.transform()
// .jsFunctions`) : si les deux divergent un jour, ce harnais ne modélise plus la production.
const PIPELINE = [
  { fn: resolveParties, table: 'missions' },
  { fn: verifyOwnerParty, table: 'animals' },
  { fn: loadVetClinic, table: 'veterinarians' },
  { fn: verifyClinicParty, table: 'requests' },
  { fn: writeSide, table: 'missions' },
  { fn: readMission, table: 'missions' },
  { fn: finalizeStatus, table: 'missions' },
]

const OWNER_SUB = 'owner-sub-1'
const VET_SUB = 'vet-sub-1'
const OTHER_OWNER_SUB = 'owner-sub-2'
const OTHER_VET_SUB = 'vet-sub-2'
const CLINIC_ID = 'clinic-1'
const OTHER_CLINIC_ID = 'clinic-2'

/**
 * Rejoue le pipeline complet (fonctions 1 -> 7) contre `store` (table `Mission`) et `world`
 * (tables `Animal`/`Veterinarian`/`Request`, voir `beforeEach`), en respectant le contrat du
 * runtime `APPSYNC_JS` : `request()` produit un payload, la source de données est invoquée,
 * puis `response(ctx)` est appelée avec `ctx.result`/`ctx.error` et sa valeur de retour devient
 * le `ctx.prev.result` de la fonction suivante. `runtime.earlyReturn()` (branche de rôle non
 * concernée) saute la source de données ET le `response()`, et propage sa valeur en `prev`.
 *
 * `sub` par défaut : l'identité LÉGITIME du rôle demandé (le vrai Owner de `animal-1` ou un
 * vétérinaire de la clinique de `request-1`) — sans quoi tous les tests antérieurs au correctif
 * du 2026-08-27 échoueraient pour une raison sans rapport avec ce qu'ils vérifient.
 *
 * @returns `{ data }` (forme d'une réponse GraphQL réussie) ou `{ errors: [...] }`.
 */
function runSubmitMissionValidation(store, { args, groups, sub }) {
  const tables = {
    missions: store,
    animals: world.animals,
    veterinarians: world.veterinarians,
    requests: world.requests,
  }
  const callerSub = sub || ((groups || []).includes('Veterinarians') ? VET_SUB : OWNER_SUB)
  const ctx = { args, identity: { groups, sub: callerSub }, prev: {}, stash: {} }

  try {
    for (const step of PIPELINE) {
      let payload
      try {
        payload = step.fn.request(ctx)
      } catch (error) {
        if (error instanceof EarlyReturn) {
          ctx.prev = { result: error.value }
          continue
        }
        throw error
      }

      const table = tables[step.table]
      const outcome =
        payload.operation === 'GetItem' ? applyGet(table, payload) : applyUpdate(table, payload)

      ctx.result = outcome.result
      ctx.error = outcome.error
      ctx.prev = { result: step.fn.response(ctx) }
      ctx.error = undefined
    }
    return { data: ctx.prev.result, errors: undefined }
  } catch (error) {
    return {
      data: null,
      errors: [{ errorType: error.errorType, message: error.message }],
    }
  }
}

const buildMission = (overrides = {}) => ({
  id: 'mission-1',
  status: 'PENDING_ARRIVAL',
  animalID: 'animal-1',
  requestID: 'request-1',
  ...overrides,
})

let store
let world

beforeEach(() => {
  store = new Map()
  store.set('mission-1', buildMission())

  // Le reste du monde autour de `mission-1` : son Animal appartient à OWNER_SUB, sa Request
  // appartient à CLINIC_ID, et deux vétérinaires existent — l'un dans cette clinique, l'autre
  // dans une clinique tierce (le cas d'attaque le plus réaliste, cf. docs/adr/0018 : tout
  // vétérinaire authentifié peut déjà LISTER toutes les Missions du système).
  world = {
    animals: new Map([
      ['animal-1', { id: 'animal-1', ownerID: OWNER_SUB }],
      ['animal-2', { id: 'animal-2', ownerID: OTHER_OWNER_SUB }],
    ]),
    requests: new Map([
      ['request-1', { id: 'request-1', clinicID: CLINIC_ID }],
      ['request-2', { id: 'request-2', clinicID: OTHER_CLINIC_ID }],
    ]),
    veterinarians: new Map([
      [VET_SUB, { id: VET_SUB, clinicID: CLINIC_ID }],
      [OTHER_VET_SUB, { id: OTHER_VET_SUB, clinicID: OTHER_CLINIC_ID }],
    ]),
  }
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// Fonction 1/3 — écriture du côté appelant
// ─────────────────────────────────────────────────────────────────────────────────────────
describe('submit-mission-validation-write-side (5/7, ex-1/3) — rôle, valeurs, conditions', () => {
  it('Veterinarians : écrit clinicValidationOutcome/clinicValidatedAt, jamais les champs Owner', () => {
    const payload = writeSide.request({
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      identity: { groups: ['Veterinarians'] },
    })

    expect(payload.key).toEqual({ id: 'mission-1' })
    expect(payload.update).toEqual({
      clinicValidationOutcome: 'CONFIRMED',
      clinicValidatedAt: NOW,
    })
    expect(payload.update).not.toHaveProperty('ownerValidationOutcome')
    // Jamais `status` : le statut agrégé est la seule affaire de la fonction 3/3.
    expect(payload.update).not.toHaveProperty('status')
  })

  it('Owners : écrit ownerValidationOutcome/ownerValidatedAt, jamais les champs Clinic', () => {
    const payload = writeSide.request({
      args: { missionId: 'mission-1', outcome: 'DENIED' },
      identity: { groups: ['Owners'] },
    })

    expect(payload.update).toEqual({
      ownerValidationOutcome: 'DENIED',
      ownerValidatedAt: NOW,
    })
    expect(payload.update).not.toHaveProperty('clinicValidationOutcome')
  })

  // LE point de sécurité de cette fonction : un Owner ne doit jamais pouvoir se faire passer
  // pour un vétérinaire en glissant un argument dans la mutation.
  it("le rôle vient EXCLUSIVEMENT de ctx.identity.groups : un argument 'role'/'raterRole' forgé par le client n'a aucun effet", () => {
    const payload = writeSide.request({
      args: {
        missionId: 'mission-1',
        outcome: 'CONFIRMED',
        role: 'Veterinarians',
        raterRole: 'CLINIC',
        groups: ['Veterinarians'],
      },
      identity: { groups: ['Owners'] },
    })

    expect(payload.update).toHaveProperty('ownerValidationOutcome')
    expect(payload.update).not.toHaveProperty('clinicValidationOutcome')
  })

  it('un appelant membre des DEUX groupes est traité comme Veterinarian (ordre de test explicite du resolver)', () => {
    const payload = writeSide.request({
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      identity: { groups: ['Owners', 'Veterinarians'] },
    })

    expect(payload.update).toHaveProperty('clinicValidationOutcome')
  })

  it.each([[[]], [['Admins']], [null], [undefined]])(
    'appelant hors Veterinarians/Owners (%s) : Unauthorized, aucune écriture',
    (groups) => {
      expect(() =>
        writeSide.request({
          args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
          identity: groups === undefined ? undefined : { groups },
        }),
      ).toThrow(/Unauthorized|non reconnu/)
    },
  )

  it.each(['PENDING', 'COMPLETED', 'confirmed', '', null, undefined])(
    'outcome invalide (%s) : InvalidOutcome AVANT toute écriture — PENDING inclus (état initial, pas une soumission)',
    (outcome) => {
      let thrown
      try {
        writeSide.request({
          args: { missionId: 'mission-1', outcome },
          identity: { groups: ['Owners'] },
        })
      } catch (error) {
        thrown = error
      }

      expect(thrown?.errorType).toBe('InvalidOutcome')
    },
  )

  it('write-once PAR CÔTÉ : la condition porte sur l’ABSENCE du champ outcome de CE côté, et sur l’existence de la Mission (anti-upsert)', () => {
    const vetPayload = writeSide.request({
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      identity: { groups: ['Veterinarians'] },
    })
    const ownerPayload = writeSide.request({
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      identity: { groups: ['Owners'] },
    })

    expect(vetPayload.condition).toEqual({
      id: { attributeExists: true },
      clinicValidationOutcome: { attributeExists: false },
    })
    expect(ownerPayload.condition).toEqual({
      id: { attributeExists: true },
      ownerValidationOutcome: { attributeExists: false },
    })
  })

  it('disputeReason : transmis seulement s’il est fourni et non vide, jamais fabriqué', () => {
    const withReason = writeSide.request({
      args: { missionId: 'mission-1', outcome: 'DENIED', disputeReason: 'Animal non présenté' },
      identity: { groups: ['Owners'] },
    })
    const withoutReason = writeSide.request({
      args: { missionId: 'mission-1', outcome: 'DENIED', disputeReason: '' },
      identity: { groups: ['Owners'] },
    })

    expect(withReason.update.ownerDisputeReason).toBe('Animal non présenté')
    expect(withoutReason.update).not.toHaveProperty('ownerDisputeReason')
  })

  it('response() : une condition non satisfaite devient ALREADY_VALIDATED (code lu par useOwnerMissions.isAlreadyValidatedError)', () => {
    let thrown
    try {
      writeSide.response({
        error: { type: 'DynamoDB:ConditionalCheckFailedException', message: 'failed' },
        result: null,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown?.errorType).toBe('ALREADY_VALIDATED')
  })

  it('response() : toute AUTRE erreur conserve son type d’origine (jamais travestie en ALREADY_VALIDATED)', () => {
    let thrown
    try {
      writeSide.response({ error: { type: 'DynamoDB:ThrottlingException', message: 'slow down' } })
    } catch (error) {
      thrown = error
    }

    expect(thrown?.errorType).toBe('DynamoDB:ThrottlingException')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// Fonction 2/3 — lecture fraîche
// ─────────────────────────────────────────────────────────────────────────────────────────
describe('submit-mission-validation-read-mission (6/7, ex-2/3)', () => {
  // Correctif ÉLEVÉ du graphql-schema-reviewer : sans lecture fortement cohérente, la fonction
  // 3/3 peut calculer le statut agrégé sur une réplique périmée — de façon PERMANENTE, la
  // fonction 1/3 étant write-once.
  it('lit la Mission par sa clé primaire en consistentRead (obligatoire, pas une option de confort)', () => {
    const payload = readMission.request({ args: { missionId: 'mission-1' } })

    expect(payload).toMatchObject({ key: { id: 'mission-1' }, consistentRead: true })
  })

  it('response() propage l’item lu tel quel, et relaie une erreur sans la masquer', () => {
    expect(readMission.response({ result: { id: 'mission-1' } })).toEqual({ id: 'mission-1' })
    expect(() =>
      readMission.response({ error: { type: 'DynamoDB:ThrottlingException', message: 'boom' } }),
    ).toThrow('boom')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// Fonction 3/3 — LA matrice de réconciliation
// ─────────────────────────────────────────────────────────────────────────────────────────
describe('submit-mission-validation-finalize-status (7/7, ex-3/3) — matrice de réconciliation', () => {
  const statusFor = (clinicOutcome, ownerOutcome) =>
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

  it.each([
    ['CONFIRMED', 'CONFIRMED', 'COMPLETED'],
    ['DENIED', 'DENIED', 'NO_SHOW'],
    ['CONFIRMED', 'DENIED', 'DISPUTED'],
    ['DENIED', 'CONFIRMED', 'DISPUTED'],
  ])('clinic=%s + owner=%s -> %s', (clinicOutcome, ownerOutcome, expected) => {
    expect(statusFor(clinicOutcome, ownerOutcome)).toBe(expected)
  })

  it.each([undefined, null, '', 'PENDING', 'CONFIRMEDD'])(
    'un seul côté décidé (l’autre = %s) -> PENDING_VALIDATION',
    (undecided) => {
      expect(statusFor('CONFIRMED', undecided)).toBe('PENDING_VALIDATION')
      expect(statusFor(undecided, 'DENIED')).toBe('PENDING_VALIDATION')
    },
  )

  it('aucun côté décidé -> PENDING_VALIDATION (jamais une finalisation à partir de rien)', () => {
    expect(statusFor(undefined, undefined)).toBe('PENDING_VALIDATION')
  })

  // Frontière entre l'étape 1/5 (ce resolver) et l'étape 2/5 (Lambda planifiée) : COMPLETED_AUTO
  // appartient EXCLUSIVEMENT à la Lambda. S'il pouvait sortir d'ici, `useMissionClosure` ne
  // ferait jamais ses 3 écritures secondaires (il teste `COMPLETED` STRICT) et un don réel
  // resterait sans effet.
  it('n’écrit JAMAIS COMPLETED_AUTO : ce statut appartient à la seule Lambda de finalisation automatique', () => {
    const allCombinations = [undefined, null, 'PENDING', 'CONFIRMED', 'DENIED'].flatMap((clinic) =>
      [undefined, null, 'PENDING', 'CONFIRMED', 'DENIED'].map((owner) => statusFor(clinic, owner)),
    )

    expect(allCombinations).not.toContain('COMPLETED_AUTO')
    expect(new Set(allCombinations)).toEqual(
      new Set(['PENDING_VALIDATION', 'COMPLETED', 'NO_SHOW', 'DISPUTED']),
    )
  })

  it('condition optimiste : l’écriture est conditionnée au statut LU par la fonction 2/3', () => {
    const payload = finalizeStatus.request({
      args: { missionId: 'mission-1' },
      prev: { result: { id: 'mission-1', status: 'PENDING_VALIDATION' } },
    })

    expect(payload.condition).toEqual({ status: { eq: 'PENDING_VALIDATION' } })
    expect(payload.key).toEqual({ id: 'mission-1' })
  })

  it('response() : une condition non satisfaite N’EST PAS une erreur pour l’appelant — l’état lu par la fonction 2/3 est renvoyé', () => {
    const previous = { id: 'mission-1', status: 'PENDING_VALIDATION' }

    const result = finalizeStatus.response({
      error: { type: 'DynamoDB:ConditionalCheckFailedException', message: 'failed' },
      prev: { result: previous },
    })

    expect(result).toEqual(previous)
  })

  it('response() : une autre erreur est bien remontée', () => {
    expect(() =>
      finalizeStatus.response({
        error: { type: 'DynamoDB:ThrottlingException', message: 'boom' },
        prev: { result: {} },
      }),
    ).toThrow('boom')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// SCÉNARIO BOUT-EN-BOUT : les DEUX appels successifs, dans les deux ordres
// ─────────────────────────────────────────────────────────────────────────────────────────
describe('submitMissionValidation — double validation jouée de bout en bout (2 appels, magasin partagé)', () => {
  const vet = (outcome, args = {}) => ({
    args: { missionId: 'mission-1', outcome, ...args },
    groups: ['Veterinarians'],
  })
  const owner = (outcome, args = {}) => ({
    args: { missionId: 'mission-1', outcome, ...args },
    groups: ['Owners'],
  })

  it('clinique PUIS propriétaire, tous deux CONFIRMED : PENDING_VALIDATION au 1er appel, COMPLETED au 2e', () => {
    const first = runSubmitMissionValidation(store, vet('CONFIRMED'))
    expect(first.data.status).toBe('PENDING_VALIDATION')
    expect(store.get('mission-1')).toMatchObject({
      status: 'PENDING_VALIDATION',
      clinicValidationOutcome: 'CONFIRMED',
      clinicValidatedAt: NOW,
    })
    // Le côté silencieux n'est JAMAIS pré-rempli (sinon il ne pourrait plus jamais voter).
    expect(store.get('mission-1').ownerValidationOutcome).toBeUndefined()

    const second = runSubmitMissionValidation(store, owner('CONFIRMED'))
    expect(second.data.status).toBe('COMPLETED')
    expect(store.get('mission-1')).toMatchObject({
      status: 'COMPLETED',
      clinicValidationOutcome: 'CONFIRMED',
      ownerValidationOutcome: 'CONFIRMED',
    })
  })

  it('propriétaire PUIS clinique (ordre inverse) : même issue COMPLETED — la matrice est symétrique', () => {
    expect(runSubmitMissionValidation(store, owner('CONFIRMED')).data.status).toBe(
      'PENDING_VALIDATION',
    )
    expect(runSubmitMissionValidation(store, vet('CONFIRMED')).data.status).toBe('COMPLETED')
  })

  it('les deux côtés infirment le don -> NO_SHOW ; désaccord -> DISPUTED, avec le motif de l’Owner conservé', () => {
    runSubmitMissionValidation(store, vet('DENIED'))
    expect(runSubmitMissionValidation(store, owner('DENIED')).data.status).toBe('NO_SHOW')

    const other = new Map([['mission-2', buildMission({ id: 'mission-2' })]])
    runSubmitMissionValidation(other, {
      args: { missionId: 'mission-2', outcome: 'DENIED', disputeReason: 'Jamais convoqué' },
      groups: ['Owners'],
    })
    const disputed = runSubmitMissionValidation(other, {
      args: { missionId: 'mission-2', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
    })

    expect(disputed.data.status).toBe('DISPUTED')
    expect(other.get('mission-2').ownerDisputeReason).toBe('Jamais convoqué')
  })

  it('second vote du MÊME côté : ALREADY_VALIDATED, et AUCUNE modification du magasin (pas de flip-flop possible)', () => {
    runSubmitMissionValidation(store, vet('CONFIRMED'))
    const snapshot = { ...store.get('mission-1') }

    const retry = runSubmitMissionValidation(store, vet('DENIED'))

    expect(retry.errors[0].errorType).toBe('ALREADY_VALIDATED')
    expect(store.get('mission-1')).toEqual(snapshot)
  })

  // Garde anti-upsert de la fonction d'écriture : sans `id: { attributeExists: true }`, un
  // missionId inexistant satisferait `attributeExists: false` et `UpdateItem` CRÉERAIT une
  // Mission partielle (vraie corruption de données, pas juste un message imprécis).
  //
  // Le CODE d'erreur a changé le 2026-08-27 (`ALREADY_VALIDATED` -> `Forbidden`) : la
  // vérification d'identité rejette désormais AVANT d'atteindre la fonction d'écriture, et ne
  // distingue jamais « Mission introuvable » de « pas votre Mission » (sinon la mutation
  // deviendrait un oracle d'existence). La garantie qui compte ici — aucune Mission fantôme —
  // est INCHANGÉE, et la garde anti-upsert reste en place en défense en profondeur.
  it('missionId inexistant : erreur, et surtout AUCUNE Mission fantôme créée dans la table', () => {
    const result = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-inconnue', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
    })

    expect(result.errors[0].errorType).toBe('Forbidden')
    expect(store.has('mission-inconnue')).toBe(false)
    expect(store.size).toBe(1)
  })

  it('deux Missions distinctes n’interfèrent pas (la clé de la condition est bien celle de l’argument)', () => {
    store.set('mission-2', buildMission({ id: 'mission-2' }))

    runSubmitMissionValidation(store, vet('CONFIRMED'))
    runSubmitMissionValidation(store, {
      args: { missionId: 'mission-2', outcome: 'DENIED' },
      groups: ['Veterinarians'],
    })

    expect(store.get('mission-1').clinicValidationOutcome).toBe('CONFIRMED')
    expect(store.get('mission-2').clinicValidationOutcome).toBe('DENIED')
    expect(store.get('mission-2').status).toBe('PENDING_VALIDATION')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// VÉRIFICATION D'IDENTITÉ (fonctions 1/7 à 4/7, ajoutées le 2026-08-27 — docs/adr/0018)
//
// Ce que ces tests verrouillent, et que RIEN ne verrouillait avant : `submitMissionValidation`
// bypasse l'intégralité du système `@auth` de `Mission` (mutation custom sur la table managée,
// ADR-0011 §3.2). Sa seule garde était l'appartenance à un groupe Cognito — n'importe quel
// Owner ou vétérinaire authentifié pouvait donc voter sur la Mission d'un tiers, et comme
// l'écriture est write-once PAR CÔTÉ, priver DÉFINITIVEMENT la vraie partie de son vote.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('submit-mission-validation-resolve-parties (1/7) — rôle de l’appelant + parties de la Mission', () => {
  const baseCtx = (overrides = {}) => ({
    args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
    identity: { groups: ['Owners'], sub: OWNER_SUB },
    prev: {},
    stash: {},
    ...overrides,
  })

  it('lit la Mission par sa clé primaire en consistentRead (un faux « introuvable » refuserait un vote légitime, sans rattrapage)', () => {
    const ctx = baseCtx()
    const payload = resolveParties.request(ctx)

    expect(payload).toMatchObject({ key: { id: 'mission-1' }, consistentRead: true })
    expect(payload.operation).toBe('GetItem')
  })

  it('range le rôle dans ctx.stash (espace SERVEUR) et jamais dans une valeur influençable par le client', () => {
    const vetCtx = baseCtx({ identity: { groups: ['Veterinarians'], sub: VET_SUB } })
    resolveParties.request(vetCtx)
    expect(vetCtx.stash.callerRole).toBe('CLINIC')

    const ownerCtx = baseCtx()
    resolveParties.request(ownerCtx)
    expect(ownerCtx.stash.callerRole).toBe('OWNER')
  })

  // LE point de cohérence du correctif : si cette fonction et la fonction d'écriture (5/7)
  // classaient différemment un appelant membre des DEUX groupes, on vérifierait un côté et on
  // écrirait l'autre — c'est-à-dire exactement le trou que ce correctif ferme.
  it('appelant membre des DEUX groupes : classé CLINIC, comme la fonction d’écriture le classe Veterinarian', () => {
    const ctx = baseCtx({ identity: { groups: ['Owners', 'Veterinarians'], sub: VET_SUB } })
    resolveParties.request(ctx)

    expect(ctx.stash.callerRole).toBe('CLINIC')
    expect(
      writeSide.request({
        args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
        identity: { groups: ['Owners', 'Veterinarians'] },
      }).update,
    ).toHaveProperty('clinicValidationOutcome')
  })

  it.each([[[]], [['Admins']], [null]])(
    'appelant hors Veterinarians/Owners (%s) : Unauthorized AVANT toute lecture',
    (groups) => {
      let thrown
      try {
        resolveParties.request(baseCtx({ identity: { groups, sub: OWNER_SUB } }))
      } catch (error) {
        thrown = error
      }
      expect(thrown?.errorType).toBe('Unauthorized')
    },
  )

  it('identité sans `sub` : Forbidden (aucune identité vérifiable, fail-closed)', () => {
    let thrown
    try {
      resolveParties.request(baseCtx({ identity: { groups: ['Owners'] } }))
    } catch (error) {
      thrown = error
    }
    expect(thrown?.errorType).toBe('Forbidden')
  })

  it('response() : stash animalID/requestID depuis la Mission lue, et propage la Mission', () => {
    const ctx = baseCtx()
    ctx.result = buildMission()

    expect(resolveParties.response(ctx)).toEqual(buildMission())
    expect(ctx.stash.missionAnimalID).toBe('animal-1')
    expect(ctx.stash.missionRequestID).toBe('request-1')
  })

  it.each([
    ['Mission introuvable', null],
    ['Mission sans animalID', { id: 'mission-1', requestID: 'request-1' }],
    ['Mission sans requestID', { id: 'mission-1', animalID: 'animal-1' }],
  ])('response() : %s -> Forbidden (fail-closed, jamais « on laisse passer »)', (_label, result) => {
    const ctx = baseCtx()
    ctx.result = result

    let thrown
    try {
      resolveParties.response(ctx)
    } catch (error) {
      thrown = error
    }
    expect(thrown?.errorType).toBe('Forbidden')
  })

  it('response() : une erreur DynamoDB conserve son type d’origine (jamais travestie en Forbidden)', () => {
    const ctx = baseCtx()
    ctx.error = { type: 'DynamoDB:ThrottlingException', message: 'slow down' }

    let thrown
    try {
      resolveParties.response(ctx)
    } catch (error) {
      thrown = error
    }
    expect(thrown?.errorType).toBe('DynamoDB:ThrottlingException')
  })
})

describe('submit-mission-validation-verify-owner-party (2/7) — Animal.ownerID === identity.sub', () => {
  const ownerCtx = (overrides = {}) => ({
    args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
    identity: { sub: OWNER_SUB },
    prev: { result: buildMission() },
    stash: { callerRole: 'OWNER', missionAnimalID: 'animal-1', missionRequestID: 'request-1' },
    ...overrides,
  })

  it('lit l’Animal de la Mission (id venu du stash, JAMAIS d’un argument client)', () => {
    const payload = verifyOwnerParty.request(ownerCtx())

    expect(payload).toMatchObject({ key: { id: 'animal-1' }, consistentRead: true })
  })

  it('no-op côté clinique : earlyReturn, aucune lecture de la table Animal', () => {
    const ctx = ownerCtx({ stash: { callerRole: 'CLINIC' } })

    expect(() => verifyOwnerParty.request(ctx)).toThrow(EarlyReturn)
  })

  it('le vrai propriétaire passe : le contexte d’entrée est propagé tel quel', () => {
    const ctx = ownerCtx()
    ctx.result = { id: 'animal-1', ownerID: OWNER_SUB }

    expect(verifyOwnerParty.response(ctx)).toEqual(buildMission())
  })

  it.each([
    ['un AUTRE Owner authentifié', { id: 'animal-1', ownerID: OTHER_OWNER_SUB }],
    ['Animal introuvable', null],
    ['Animal sans ownerID', { id: 'animal-1' }],
  ])('%s -> Forbidden', (_label, animal) => {
    const ctx = ownerCtx()
    ctx.result = animal

    let thrown
    try {
      verifyOwnerParty.response(ctx)
    } catch (error) {
      thrown = error
    }
    expect(thrown?.errorType).toBe('Forbidden')
  })
})

describe('submit-mission-validation-load-vet-clinic (3/7) — clinicID du vétérinaire appelant', () => {
  const vetCtx = (overrides = {}) => ({
    args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
    identity: { sub: VET_SUB },
    prev: { result: buildMission() },
    stash: { callerRole: 'CLINIC', missionAnimalID: 'animal-1', missionRequestID: 'request-1' },
    ...overrides,
  })

  it('lit le Veterinarian par ctx.identity.sub (convention id = Cognito sub de ce dépôt)', () => {
    expect(loadVetClinic.request(vetCtx())).toMatchObject({
      key: { id: VET_SUB },
      consistentRead: true,
    })
  })

  it('no-op côté Owner : earlyReturn, aucune lecture de la table Veterinarian', () => {
    expect(() => loadVetClinic.request(vetCtx({ stash: { callerRole: 'OWNER' } }))).toThrow(
      EarlyReturn,
    )
  })

  it('stash le clinicID du vétérinaire pour la comparaison de la fonction 4/7', () => {
    const ctx = vetCtx()
    ctx.result = { id: VET_SUB, clinicID: CLINIC_ID }

    expect(loadVetClinic.response(ctx)).toEqual(buildMission())
    expect(ctx.stash.callerClinicID).toBe(CLINIC_ID)
  })

  it.each([
    ['membre du groupe Veterinarians SANS profil Veterinarian (inscription interrompue, R-25)', null],
    ['profil Veterinarian sans clinicID', { id: VET_SUB }],
  ])('%s -> Forbidden', (_label, veterinarian) => {
    const ctx = vetCtx()
    ctx.result = veterinarian

    let thrown
    try {
      loadVetClinic.response(ctx)
    } catch (error) {
      thrown = error
    }
    expect(thrown?.errorType).toBe('Forbidden')
    expect(ctx.stash.callerClinicID).toBeUndefined()
  })
})

describe('submit-mission-validation-verify-clinic-party (4/7) — Request.clinicID === clinique de l’appelant', () => {
  const vetCtx = (overrides = {}) => ({
    args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
    identity: { sub: VET_SUB },
    prev: { result: buildMission() },
    stash: {
      callerRole: 'CLINIC',
      missionAnimalID: 'animal-1',
      missionRequestID: 'request-1',
      callerClinicID: CLINIC_ID,
    },
    ...overrides,
  })

  it('lit la Request de la Mission (id venu du stash, JAMAIS d’un argument client — sinon un vétérinaire ferait vérifier une Request de SA clinique tout en écrivant sur la Mission d’une autre)', () => {
    expect(verifyClinicParty.request(vetCtx())).toMatchObject({
      key: { id: 'request-1' },
      consistentRead: true,
    })
  })

  it('no-op côté Owner : earlyReturn, aucune lecture de la table Request', () => {
    expect(() => verifyClinicParty.request(vetCtx({ stash: { callerRole: 'OWNER' } }))).toThrow(
      EarlyReturn,
    )
  })

  it('vétérinaire de la clinique émettrice : passe, contexte propagé tel quel', () => {
    const ctx = vetCtx()
    ctx.result = { id: 'request-1', clinicID: CLINIC_ID }

    expect(verifyClinicParty.response(ctx)).toEqual(buildMission())
  })

  it.each([
    ['vétérinaire d’une AUTRE clinique', { id: 'request-1', clinicID: OTHER_CLINIC_ID }, CLINIC_ID],
    ['Request introuvable', null, CLINIC_ID],
    ['Request sans clinicID', { id: 'request-1' }, CLINIC_ID],
    // Garde-fou de dernier recours : sans elle, deux `undefined` se compareraient égaux.
    ['clinique de l’appelant absente du stash', { id: 'request-1' }, undefined],
  ])('%s -> Forbidden', (_label, request, callerClinicID) => {
    const ctx = vetCtx()
    ctx.stash.callerClinicID = callerClinicID
    ctx.result = request

    let thrown
    try {
      verifyClinicParty.response(ctx)
    } catch (error) {
      thrown = error
    }
    expect(thrown?.errorType).toBe('Forbidden')
  })
})

describe('submitMissionValidation — vérification d’identité jouée sur le pipeline COMPLET (7 fonctions)', () => {
  const snapshotOf = (missionId) => ({ ...store.get(missionId) })

  it('la vraie partie de CHAQUE côté valide normalement (non-régression du chemin nominal)', () => {
    const clinicSide = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
      sub: VET_SUB,
    })
    expect(clinicSide.errors).toBeUndefined()
    expect(clinicSide.data.status).toBe('PENDING_VALIDATION')

    const ownerSide = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Owners'],
      sub: OWNER_SUB,
    })
    expect(ownerSide.errors).toBeUndefined()
    expect(ownerSide.data.status).toBe('COMPLETED')
  })

  // L'attaque décrite par docs/adr/0018 : `Request.list({ selectionSet: ['mission.id'] })` est
  // ouverte à TOUT authentifié, donc l'attaquant n'a même pas à deviner un UUID.
  it('un AUTRE Owner authentifié ne peut plus voter sur la Mission d’autrui — et n’écrit RIEN', () => {
    const before = snapshotOf('mission-1')

    const result = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'DENIED', disputeReason: 'sabotage' },
      groups: ['Owners'],
      sub: OTHER_OWNER_SUB,
    })

    expect(result.errors[0].errorType).toBe('Forbidden')
    expect(store.get('mission-1')).toEqual(before)
    expect(store.get('mission-1').ownerValidationOutcome).toBeUndefined()
  })

  // Idem côté vétérinaire : `Mission.list()` est ouverte à tout le groupe `Veterinarians`, sans
  // notion de « ma clinique » — c'est justement ce que cette vérification vient compenser.
  it('un vétérinaire d’une AUTRE clinique ne peut plus voter — et n’écrit RIEN', () => {
    const before = snapshotOf('mission-1')

    const result = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'DENIED' },
      groups: ['Veterinarians'],
      sub: OTHER_VET_SUB,
    })

    expect(result.errors[0].errorType).toBe('Forbidden')
    expect(store.get('mission-1')).toEqual(before)
    expect(store.get('mission-1').clinicValidationOutcome).toBeUndefined()
  })

  // LA garantie qui motive tout le correctif : le rejet doit précéder l'écriture write-once,
  // sinon la vraie partie perd son vote pour toujours.
  it('après un vote illégitime rejeté, la VRAIE partie peut toujours voter (aucun côté verrouillé au passage)', () => {
    runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'DENIED' },
      groups: ['Owners'],
      sub: OTHER_OWNER_SUB,
    })
    runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'DENIED' },
      groups: ['Veterinarians'],
      sub: OTHER_VET_SUB,
    })

    const owner = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Owners'],
      sub: OWNER_SUB,
    })
    const vet = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
      sub: VET_SUB,
    })

    expect(owner.errors).toBeUndefined()
    expect(vet.errors).toBeUndefined()
    expect(store.get('mission-1')).toMatchObject({
      status: 'COMPLETED',
      ownerValidationOutcome: 'CONFIRMED',
      clinicValidationOutcome: 'CONFIRMED',
    })
  })

  it('un vétérinaire membre du groupe mais SANS profil Veterinarian est rejeté sans rien écrire', () => {
    const before = snapshotOf('mission-1')

    const result = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
      sub: 'vet-sans-profil',
    })

    expect(result.errors[0].errorType).toBe('Forbidden')
    expect(store.get('mission-1')).toEqual(before)
  })

  it('une Mission dont la Request appartient à une autre clinique n’est validable que par CETTE clinique', () => {
    store.set('mission-2', buildMission({ id: 'mission-2', requestID: 'request-2' }))

    const wrongClinic = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-2', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
      sub: VET_SUB,
    })
    const rightClinic = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-2', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
      sub: OTHER_VET_SUB,
    })

    expect(wrongClinic.errors[0].errorType).toBe('Forbidden')
    expect(rightClinic.errors).toBeUndefined()
    expect(store.get('mission-2').clinicValidationOutcome).toBe('CONFIRMED')
  })

  it('une Mission portant l’Animal d’un autre Owner n’est validable que par CET Owner', () => {
    store.set('mission-2', buildMission({ id: 'mission-2', animalID: 'animal-2' }))

    const wrongOwner = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-2', outcome: 'CONFIRMED' },
      groups: ['Owners'],
      sub: OWNER_SUB,
    })
    const rightOwner = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-2', outcome: 'CONFIRMED' },
      groups: ['Owners'],
      sub: OTHER_OWNER_SUB,
    })

    expect(wrongOwner.errors[0].errorType).toBe('Forbidden')
    expect(rightOwner.errors).toBeUndefined()
    expect(store.get('mission-2').ownerValidationOutcome).toBe('CONFIRMED')
  })

  it('un appelant hors des deux groupes est rejeté (Unauthorized) sans aucune écriture', () => {
    const before = snapshotOf('mission-1')

    const result = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Admins'],
      sub: 'admin-sub-1',
    })

    expect(result.errors[0].errorType).toBe('Unauthorized')
    expect(store.get('mission-1')).toEqual(before)
  })

  it('le message d’erreur ne distingue jamais « Mission introuvable » de « pas votre Mission » (pas d’oracle d’existence)', () => {
    const unknownMission = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-inconnue', outcome: 'CONFIRMED' },
      groups: ['Owners'],
      sub: OWNER_SUB,
    })
    const notMyMission = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Owners'],
      sub: OTHER_OWNER_SUB,
    })

    expect(unknownMission.errors[0]).toEqual(notMyMission.errors[0])
    // `isAlreadyValidatedError` (useOwnerMissions.js) reconnaît un message contenant « déjà
    // soumis sa validation » : ce rejet ne doit surtout pas être confondu avec ce cas-là.
    expect(notMyMission.errors[0].message).not.toContain('déjà soumis sa validation')
  })
})
