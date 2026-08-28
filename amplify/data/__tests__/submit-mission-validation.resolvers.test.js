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
// Date CIVILE correspondante dans le fuseau de référence métier (`Europe/Paris`), telle que
// `util.time.nowFormatted('yyyy-MM-dd', 'Europe/Paris')` la renverrait côté AppSync — voir la
// fonction 8/8 (`submit-mission-validation-record-donation-date.js`) et son en-tête pour pourquoi
// le fuseau est explicite et pourquoi ce n'est PAS `Intl` qui est utilisé.
const TODAY_IN_PARIS = '2026-08-26'
// Chaque appel de `util.time.nowFormatted` est enregistré ici : le harnais doit pouvoir prouver
// que le resolver demande bien un format `AWSDate` ET un fuseau explicite — un resolver qui
// renverrait la date UTC daterait un don de la veille entre 00h et 02h heure de Paris (même bug
// de frontière que celui trouvé en QA sur la Phase 2.1, côté navigateur).
const nowFormattedCalls = []

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
    time: {
      nowISO8601: () => NOW,
      // Surcharge `nowFormatted(formatString, timezone)` de `TimeUtils`
      // (`node_modules/@aws-appsync/utils/lib/time-utils.d.ts`) : « Returns a string of the
      // current timestamp for a timezone using the specified format and timezone ». Le double ici
      // ne réimplémente PAS le formatage (ce serait tester le runtime AWS, pas le resolver) — il
      // enregistre les arguments et renvoie la date attendue.
      nowFormatted: (formatString, timezone) => {
        nowFormattedCalls.push({ formatString, timezone })
        return TODAY_IN_PARIS
      },
    },
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
import * as recordDonationDate from '../resolvers/submit-mission-validation-record-donation-date'

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
//
// ÉTENDU LE 2026-08-28 (docs/adr/0019) : une 8e fonction termine le pipeline
// (`record-donation-date`, source `Animal`) — elle écrit `Animal.lastDonationDate` quand la 7e
// vient d'écrire `COMPLETED`, quel que soit le côté qui a voté en second. C'est le seul endroit
// du système qui peut le faire quand c'est l'OWNER qui finalise (il n'a que `[read]` sur ce
// champ, ADR-0003).
const PIPELINE = [
  { fn: resolveParties, table: 'missions' },
  { fn: verifyOwnerParty, table: 'animals' },
  { fn: loadVetClinic, table: 'veterinarians' },
  { fn: verifyClinicParty, table: 'requests' },
  { fn: writeSide, table: 'missions' },
  { fn: readMission, table: 'missions' },
  { fn: finalizeStatus, table: 'missions' },
  { fn: recordDonationDate, table: 'animals' },
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
  nowFormattedCalls.length = 0
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
  // `stash.missionStatus` : rangé par la fonction 1/8 en production (docs/adr/0020), donc TOUJOURS
  // présent quand cette fonction s'exécute. Les appels directs ci-dessous le fournissent avec un
  // statut NON terminal — sans quoi la garde "Mission déjà finalisée" refuserait le vote
  // (fail-closed), ce que le describe dédié plus bas vérifie explicitement.
  const writeCtx = ({ args, identity, missionStatus = 'PENDING_ARRIVAL' }) => ({
    args,
    identity,
    stash: { missionStatus },
  })

  it('Veterinarians : écrit clinicValidationOutcome/clinicValidatedAt, jamais les champs Owner', () => {
    const payload = writeSide.request(
      writeCtx({
        args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
        identity: { groups: ['Veterinarians'] },
      }),
    )

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
    const payload = writeSide.request(
      writeCtx({
        args: { missionId: 'mission-1', outcome: 'DENIED' },
        identity: { groups: ['Owners'] },
      }),
    )

    expect(payload.update).toEqual({
      ownerValidationOutcome: 'DENIED',
      ownerValidatedAt: NOW,
    })
    expect(payload.update).not.toHaveProperty('clinicValidationOutcome')
  })

  // LE point de sécurité de cette fonction : un Owner ne doit jamais pouvoir se faire passer
  // pour un vétérinaire en glissant un argument dans la mutation.
  it("le rôle vient EXCLUSIVEMENT de ctx.identity.groups : un argument 'role'/'raterRole' forgé par le client n'a aucun effet", () => {
    const payload = writeSide.request(
      writeCtx({
        args: {
          missionId: 'mission-1',
          outcome: 'CONFIRMED',
          role: 'Veterinarians',
          raterRole: 'CLINIC',
          groups: ['Veterinarians'],
        },
        identity: { groups: ['Owners'] },
      }),
    )

    expect(payload.update).toHaveProperty('ownerValidationOutcome')
    expect(payload.update).not.toHaveProperty('clinicValidationOutcome')
  })

  it('un appelant membre des DEUX groupes est traité comme Veterinarian (ordre de test explicite du resolver)', () => {
    const payload = writeSide.request(
      writeCtx({
        args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
        identity: { groups: ['Owners', 'Veterinarians'] },
      }),
    )

    expect(payload.update).toHaveProperty('clinicValidationOutcome')
  })

  it.each([[[]], [['Admins']], [null], [undefined]])(
    'appelant hors Veterinarians/Owners (%s) : Unauthorized, aucune écriture',
    (groups) => {
      expect(() =>
        writeSide.request(
          writeCtx({
            args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
            identity: groups === undefined ? undefined : { groups },
          }),
        ),
      ).toThrow(/Unauthorized|non reconnu/)
    },
  )

  it.each(['PENDING', 'COMPLETED', 'confirmed', '', null, undefined])(
    'outcome invalide (%s) : InvalidOutcome AVANT toute écriture — PENDING inclus (état initial, pas une soumission)',
    (outcome) => {
      let thrown
      try {
        writeSide.request(
          writeCtx({
            args: { missionId: 'mission-1', outcome },
            identity: { groups: ['Owners'] },
          }),
        )
      } catch (error) {
        thrown = error
      }

      expect(thrown?.errorType).toBe('InvalidOutcome')
    },
  )

  it('write-once PAR CÔTÉ : la condition porte sur l’ABSENCE du champ outcome de CE côté, et sur l’existence de la Mission (anti-upsert)', () => {
    const vetPayload = writeSide.request(
      writeCtx({
        args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
        identity: { groups: ['Veterinarians'] },
      }),
    )
    const ownerPayload = writeSide.request(
      writeCtx({
        args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
        identity: { groups: ['Owners'] },
      }),
    )

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
    const withReason = writeSide.request(
      writeCtx({
        args: { missionId: 'mission-1', outcome: 'DENIED', disputeReason: 'Animal non présenté' },
        identity: { groups: ['Owners'] },
      }),
    )
    const withoutReason = writeSide.request(
      writeCtx({
        args: { missionId: 'mission-1', outcome: 'DENIED', disputeReason: '' },
        identity: { groups: ['Owners'] },
      }),
    )

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

  // ───────────────────────────────────────────────────────────────────────────────────────
  // GARDE "MISSION DÉJÀ FINALISÉE" (2026-08-28, docs/adr/0020 — finding ÉLEVÉ de revue Lead Dev)
  //
  // Le write-once par côté ne protégeait QUE le champ d'outcome de l'appelant. La Lambda
  // planifiée écrivant `COMPLETED_AUTO`/`DISPUTED` SANS renseigner l'outcome du côté silencieux
  // (ADR-0016 §2), ce côté restait éternellement libre d'écrire — un vote tardif écrasait alors
  // la finalisation automatique, redatait `Animal.lastDonationDate` et pouvait faire
  // double-compter `Clinic.transfusionsDone` côté vétérinaire.
  // ───────────────────────────────────────────────────────────────────────────────────────
  describe('garde sur le statut COURANT de la Mission (docs/adr/0020)', () => {
    // Contexte construit ICI plutôt que via `writeCtx` : ce describe doit pouvoir passer un
    // `missionStatus` littéralement `undefined`/`null`/`''` (cas fail-closed), qu'une valeur par
    // défaut de paramètre masquerait silencieusement.
    const submitWith = (missionStatus, groups = ['Owners']) => {
      let thrown
      let payload
      try {
        payload = writeSide.request({
          args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
          identity: { groups },
          stash: { missionStatus },
        })
      } catch (error) {
        thrown = error
      }
      return { thrown, payload }
    }

    it.each(['COMPLETED', 'COMPLETED_AUTO', 'NO_SHOW', 'DISPUTED', 'CANCELLED'])(
      'statut terminal %s : MISSION_ALREADY_FINALIZED, et AUCUN payload d’écriture produit',
      (missionStatus) => {
        const { thrown, payload } = submitWith(missionStatus)

        expect(thrown?.errorType).toBe('MISSION_ALREADY_FINALIZED')
        expect(payload).toBeUndefined()
      },
    )

    it('le rejet vaut pour les DEUX côtés (le vétérinaire qui vote tard n’a pas plus de droits que l’Owner)', () => {
      expect(submitWith('COMPLETED_AUTO', ['Veterinarians']).thrown?.errorType).toBe(
        'MISSION_ALREADY_FINALIZED',
      )
      expect(submitWith('COMPLETED_AUTO', ['Owners']).thrown?.errorType).toBe(
        'MISSION_ALREADY_FINALIZED',
      )
    })

    // Le code doit rester DISTINCT d'`ALREADY_VALIDATED` : c'est ce qui permettra à l'UI de dire
    // « cette mission a déjà été clôturée » plutôt que « vous avez déjà répondu » (message faux
    // pour un côté qui n'a JAMAIS pu répondre). Verrouillé aussi côté front
    // (`useOwnerMissions.js`, `mapSubmitDonationValidationError`).
    it('le code d’erreur n’est PAS ALREADY_VALIDATED (les deux cas ne se racontent pas pareil côté utilisateur)', () => {
      const { thrown } = submitWith('COMPLETED_AUTO')

      expect(thrown?.errorType).not.toBe('ALREADY_VALIDATED')
      expect(thrown?.message).toContain('déjà clôturée')
    })

    it.each(['ACCEPTED', 'PENDING_ARRIVAL', 'EN_ROUTE', 'ARRIVED', 'PENDING_VALIDATION'])(
      'statut NON terminal %s : le vote passe normalement (aucune régression du chemin nominal)',
      (missionStatus) => {
        const { thrown, payload } = submitWith(missionStatus)

        expect(thrown).toBeUndefined()
        expect(payload.update).toHaveProperty('ownerValidationOutcome', 'CONFIRMED')
      },
    )

    // Exhaustivité : les 10 valeurs de `MissionStatus` (`amplify/data/resource.ts`, enum pin-testé
    // dans `resource.transform.test.ts`) sont couvertes par l'un des deux `it.each` ci-dessus.
    // Une 11e valeur ajoutée au schéma sans décision explicite ici casserait le pin d'enum, qui
    // renvoie vers ce test.
    it('les 10 valeurs de MissionStatus sont classées explicitement (aucun statut non tranché)', () => {
      const terminal = ['COMPLETED', 'COMPLETED_AUTO', 'NO_SHOW', 'DISPUTED', 'CANCELLED']
      const nonTerminal = ['ACCEPTED', 'PENDING_ARRIVAL', 'EN_ROUTE', 'ARRIVED', 'PENDING_VALIDATION']

      expect(new Set([...terminal, ...nonTerminal]).size).toBe(10)
      terminal.forEach((status) =>
        expect(submitWith(status).thrown?.errorType).toBe('MISSION_ALREADY_FINALIZED'),
      )
      nonTerminal.forEach((status) => expect(submitWith(status).thrown).toBeUndefined())
    })

    // FAIL-CLOSED : le statut ne peut pas être relu ici (une fonction de pipeline n'émet qu'un
    // seul appel vers sa source, et c'est l'écriture). Si la fonction 1/8 ne l'a pas rangé
    // (pipeline réordonné, Mission corrompue sans `status`), refuser bruyamment vaut mieux que
    // rouvrir la garde en silence.
    it.each([undefined, null, ''])(
      'statut absent du stash (%s) : refus fail-closed, jamais un laissez-passer',
      (missionStatus) => {
        expect(submitWith(missionStatus).thrown?.errorType).toBe('MISSION_ALREADY_FINALIZED')
      },
    )

    it('stash entièrement absent (contexte dégradé) : refus, et surtout aucune exception de lecture sur undefined', () => {
      let thrown
      try {
        writeSide.request({
          args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
          identity: { groups: ['Owners'] },
        })
      } catch (error) {
        thrown = error
      }

      expect(thrown?.errorType).toBe('MISSION_ALREADY_FINALIZED')
    })

    // Précédence : une soumission malformée reste `InvalidOutcome` même sur une Mission finalisée
    // (l'ordre des gardes de `request()` est un contrat observable, pin-testé ici).
    it('un outcome invalide sur une Mission finalisée reste InvalidOutcome (précédence inchangée)', () => {
      let thrown
      try {
        writeSide.request(
          writeCtx({
            args: { missionId: 'mission-1', outcome: 'PENDING' },
            identity: { groups: ['Owners'] },
            missionStatus: 'COMPLETED_AUTO',
          }),
        )
      } catch (error) {
        thrown = error
      }

      expect(thrown?.errorType).toBe('InvalidOutcome')
    })
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
  // `stash: {}` : toujours présent côté AppSync (le resolver de tête généré par le framework y
  // écrit lui-même `awsAppsyncApiId`, `@aws-amplify/backend-data/lib/assets/
  // js_resolver_handler.js`). Requis depuis le 2026-08-28 : cette fonction y range le statut
  // qu'elle écrit, pour la fonction 8/8 (docs/adr/0019).
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
      stash: {},
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
      stash: {},
    })

    expect(payload.condition).toEqual({ status: { eq: 'PENDING_VALIDATION' } })
    expect(payload.key).toEqual({ id: 'mission-1' })
  })

  it('response() : une condition non satisfaite N’EST PAS une erreur pour l’appelant — l’état lu par la fonction 2/3 est renvoyé', () => {
    const previous = { id: 'mission-1', status: 'PENDING_VALIDATION' }
    // Le stash porte le statut CALCULÉ par `request()` : il doit être neutralisé quand l'écriture
    // n'a finalement pas eu lieu, sinon la fonction 8/8 daterait un don sur la foi d'un
    // `COMPLETED` écrit par l'AUTRE pipeline (qui, lui, fait déjà cette écriture).
    const ctx = {
      error: { type: 'DynamoDB:ConditionalCheckFailedException', message: 'failed' },
      prev: { result: previous },
      stash: { finalMissionStatus: 'COMPLETED' },
    }

    expect(finalizeStatus.response(ctx)).toEqual(previous)
    expect(ctx.stash.finalMissionStatus).toBeNull()
  })

  it('response() : une autre erreur est bien remontée', () => {
    expect(() =>
      finalizeStatus.response({
        error: { type: 'DynamoDB:ThrottlingException', message: 'boom' },
        prev: { result: {} },
        stash: {},
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
        stash: { missionStatus: 'PENDING_ARRIVAL' },
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

  // docs/adr/0020 : le statut COURANT est rangé ICI (lecture `consistentRead` déjà faite) et
  // consommé par la fonction 5/8. Cette fonction ne rejette JAMAIS sur ce critère — le faire
  // avant les vérifications d'identité (2/8 à 4/8) transformerait la mutation en oracle d'état
  // de Mission pour n'importe quel authentifié, exactement ce qu'ADR-0018 refuse pour
  // l'existence.
  it.each(['PENDING_ARRIVAL', 'COMPLETED_AUTO', 'DISPUTED'])(
    'response() : range le statut courant (%s) dans le stash SANS jamais rejeter lui-même',
    (status) => {
      const ctx = baseCtx()
      ctx.result = buildMission({ status })

      expect(() => resolveParties.response(ctx)).not.toThrow()
      expect(ctx.stash.missionStatus).toBe(status)
    },
  )

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

// ─────────────────────────────────────────────────────────────────────────────────────────
// FONCTION 8/8 — `Animal.lastDonationDate` sur un COMPLETED réel (2026-08-28, docs/adr/0019)
//
// Ce que ces tests verrouillent, et que rien ne verrouillait : quand c'est le vote de l'OWNER
// qui fait passer la Mission en COMPLETED, `Animal.lastDonationDate` n'était JAMAIS écrit —
// l'Owner n'a que `[read]` sur ce champ (`ownerReadOnlyVetReadUpdate`, ADR-0003), donc aucun
// code client de son côté ne pouvait le porter. La Frequency Rule (CONTEXT.md) n'était donc
// jamais réarmée sur ce chemin : un animal réellement prélevé restait immédiatement rééligible.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('submit-mission-validation-record-donation-date (8/8) — écriture isolée', () => {
  const completedCtx = (overrides = {}) => ({
    args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
    identity: { groups: ['Owners'], sub: OWNER_SUB },
    prev: { result: buildMission({ status: 'COMPLETED' }) },
    stash: {
      callerRole: 'OWNER',
      missionAnimalID: 'animal-1',
      missionRequestID: 'request-1',
      finalMissionStatus: 'COMPLETED',
    },
    ...overrides,
  })

  it('écrit lastDonationDate sur l’Animal de la Mission (id venu du stash, JAMAIS d’un argument client)', () => {
    const payload = recordDonationDate.request(completedCtx())

    expect(payload.operation).toBe('UpdateItem')
    expect(payload.key).toEqual({ id: 'animal-1' })
    expect(payload.update.lastDonationDate).toBe(TODAY_IN_PARIS)
  })

  // LE point de correction de cette fonction : un resolver tourne côté serveur (horloge UTC), pas
  // dans le navigateur du vétérinaire. Sans fuseau explicite, une validation soumise entre 00h et
  // 02h heure de Paris daterait le don de la veille et raccourcirait la Frequency Rule d'un jour.
  it('la date vient de util.time.nowFormatted au format AWSDate ET dans un fuseau EXPLICITE (jamais la date UTC implicite)', () => {
    recordDonationDate.request(completedCtx())

    expect(nowFormattedCalls).toEqual([{ formatString: 'yyyy-MM-dd', timezone: 'Europe/Paris' }])
  })

  it('garde anti-upsert : la condition exige l’existence de l’Animal (sinon UpdateItem créerait un Animal partiel)', () => {
    expect(recordDonationDate.request(completedCtx()).condition).toEqual({
      id: { attributeExists: true },
    })
  })

  it('n’écrit QUE lastDonationDate/updatedAt — aucun autre champ d’Animal n’est touché', () => {
    expect(Object.keys(recordDonationDate.request(completedCtx()).update).sort()).toEqual([
      'lastDonationDate',
      'updatedAt',
    ])
  })

  it.each(['PENDING_VALIDATION', 'NO_SHOW', 'DISPUTED', 'COMPLETED_AUTO', null, undefined, ''])(
    'statut final %s : earlyReturn, AUCUNE écriture ni lecture sur la table Animal',
    (finalMissionStatus) => {
      const ctx = completedCtx()
      ctx.stash.finalMissionStatus = finalMissionStatus

      expect(() => recordDonationDate.request(ctx)).toThrow(EarlyReturn)
      expect(nowFormattedCalls).toEqual([])
    },
  )

  // `finalMissionStatus` vaut `null` quand la condition optimiste de la fonction 7/8 a échoué :
  // le statut a été écrit par l'AUTRE pipeline, dont la propre 8/8 porte l'écriture. Sans ce
  // no-op, les deux pipelines écriraient la date.
  it('condition optimiste de la 7/8 non satisfaite (finalMissionStatus remis à null) : no-op', () => {
    const ctx = completedCtx()
    ctx.stash.finalMissionStatus = null

    expect(() => recordDonationDate.request(ctx)).toThrow(EarlyReturn)
  })

  it('Mission sans animalID dans le stash (inatteignable via la 1/8, défense en profondeur) : no-op, jamais une clé undefined', () => {
    const ctx = completedCtx()
    ctx.stash.missionAnimalID = undefined

    expect(() => recordDonationDate.request(ctx)).toThrow(EarlyReturn)
  })

  // Cette fonction est la DERNIÈRE du pipeline : sa valeur de retour EST celle de la mutation,
  // typée `Mission`. Renvoyer `ctx.result` (l'Animal) casserait `data.status`, lu juste après par
  // `useOwnerMissions`/`useMissionClosure`.
  it('response() renvoie la MISSION (ctx.prev.result), jamais l’Animal écrit', () => {
    const ctx = completedCtx()
    ctx.result = { id: 'animal-1', lastDonationDate: TODAY_IN_PARIS }

    expect(recordDonationDate.response(ctx)).toEqual(buildMission({ status: 'COMPLETED' }))
  })

  // Décision documentée (ADR-0019 §3) : best-effort, PAS critique. Le vote de l'appelant est déjà
  // écrit (write-once) et la Mission déjà COMPLETED — lui remonter une erreur non actionnable
  // ferait en plus sauter, côté client, l'upsert `ClinicOwnerRelation` (les deux composables
  // passent leurs `errors` à `throwIfGraphqlError`, qui lève).
  it.each([
    ['Animal inexistant (condition non satisfaite)', 'DynamoDB:ConditionalCheckFailedException'],
    ['échec dur (throttle, incident)', 'DynamoDB:ThrottlingException'],
  ])('response() : %s est avalé — la Mission est quand même renvoyée à l’appelant', (_label, type) => {
    const ctx = completedCtx()
    ctx.error = { type, message: 'boom' }

    expect(recordDonationDate.response(ctx)).toEqual(buildMission({ status: 'COMPLETED' }))
  })
})

describe('submitMissionValidation — Frequency Rule réarmée, pipeline COMPLET (8 fonctions)', () => {
  const lastDonationDateOf = (animalId) => world.animals.get(animalId)?.lastDonationDate

  // LE bug que cette sous-tâche ferme : dans le flux nominal (le vétérinaire clôture d'abord
  // depuis RequestsView.vue), c'est le vote de l'OWNER qui finalise — et lui ne peut pas écrire
  // ce champ.
  it('l’OWNER vote en second : la Mission passe COMPLETED et lastDonationDate EST écrit (le seul chemin qui pouvait le porter)', () => {
    runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
      sub: VET_SUB,
    })
    expect(lastDonationDateOf('animal-1')).toBeUndefined()

    const ownerSide = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Owners'],
      sub: OWNER_SUB,
    })

    expect(ownerSide.errors).toBeUndefined()
    expect(ownerSide.data.status).toBe('COMPLETED')
    expect(lastDonationDateOf('animal-1')).toBe(TODAY_IN_PARIS)
  })

  it('le VÉTÉRINAIRE vote en second : même écriture serveur (le pipeline ne dépend pas du côté qui finalise)', () => {
    runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Owners'],
      sub: OWNER_SUB,
    })
    const clinicSide = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
      sub: VET_SUB,
    })

    expect(clinicSide.data.status).toBe('COMPLETED')
    expect(lastDonationDateOf('animal-1')).toBe(TODAY_IN_PARIS)
  })

  it('un seul côté a voté (PENDING_VALIDATION) : rien n’est écrit — un don n’est pas encore confirmé', () => {
    const first = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
      sub: VET_SUB,
    })

    expect(first.data.status).toBe('PENDING_VALIDATION')
    expect(lastDonationDateOf('animal-1')).toBeUndefined()
  })

  it.each([
    ['NO_SHOW (les deux infirment)', 'DENIED', 'DENIED', 'NO_SHOW'],
    ['DISPUTED (désaccord, clinique CONFIRMED)', 'CONFIRMED', 'DENIED', 'DISPUTED'],
    ['DISPUTED (désaccord, Owner CONFIRMED)', 'DENIED', 'CONFIRMED', 'DISPUTED'],
  ])(
    '%s : lastDonationDate n’est JAMAIS écrit (ni un no-show ni un litige n’est un don réalisé)',
    (_label, clinicOutcome, ownerOutcome, expectedStatus) => {
      runSubmitMissionValidation(store, {
        args: { missionId: 'mission-1', outcome: clinicOutcome },
        groups: ['Veterinarians'],
        sub: VET_SUB,
      })
      const second = runSubmitMissionValidation(store, {
        args: { missionId: 'mission-1', outcome: ownerOutcome },
        groups: ['Owners'],
        sub: OWNER_SUB,
      })

      expect(second.data.status).toBe(expectedStatus)
      expect(lastDonationDateOf('animal-1')).toBeUndefined()
    },
  )

  it('l’Animal d’une AUTRE Mission n’est jamais touché (la clé vient bien de la Mission validée)', () => {
    store.set('mission-2', buildMission({ id: 'mission-2', animalID: 'animal-2' }))

    runSubmitMissionValidation(store, {
      args: { missionId: 'mission-2', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
      sub: VET_SUB,
    })
    runSubmitMissionValidation(store, {
      args: { missionId: 'mission-2', outcome: 'CONFIRMED' },
      groups: ['Owners'],
      sub: OTHER_OWNER_SUB,
    })

    expect(lastDonationDateOf('animal-2')).toBe(TODAY_IN_PARIS)
    expect(lastDonationDateOf('animal-1')).toBeUndefined()
  })

  // Best-effort + garde anti-upsert éprouvés ensemble sur le pipeline réel : l'Animal disparaît
  // entre les deux votes (cas rare mais possible — un Owner peut supprimer son animal).
  it('Animal supprimé entre les deux votes : AUCUN Animal fantôme créé, et l’appelant voit quand même sa validation réussir', () => {
    runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Owners'],
      sub: OWNER_SUB,
    })
    world.animals.delete('animal-1')

    const clinicSide = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
      sub: VET_SUB,
    })

    expect(clinicSide.errors).toBeUndefined()
    expect(clinicSide.data.status).toBe('COMPLETED')
    expect(store.get('mission-1').status).toBe('COMPLETED')
    expect(world.animals.has('animal-1')).toBe(false)
  })

  // Cohérence des deux fonctions qui parlent du statut final : la 8/8 ne redérive PAS la matrice,
  // elle lit le stash posé par la 7/8 — ce test échouerait si l'une des deux était modifiée seule.
  // (Voir aussi le dernier describe du fichier : un vote TARDIF ne doit plus atteindre la 8/8 du
  // tout, docs/adr/0020.)
  it('le stash finalMissionStatus reflète exactement le statut écrit dans la table Mission', () => {
    const ctx = {
      args: { missionId: 'mission-1' },
      prev: {
        result: {
          id: 'mission-1',
          status: 'PENDING_VALIDATION',
          clinicValidationOutcome: 'CONFIRMED',
          ownerValidationOutcome: 'CONFIRMED',
        },
      },
      stash: {},
    }

    const payload = finalizeStatus.request(ctx)

    expect(payload.update.status).toBe('COMPLETED')
    expect(ctx.stash.finalMissionStatus).toBe('COMPLETED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// VOTE TARDIF SUR UNE MISSION DÉJÀ FINALISÉE — pipeline COMPLET (2026-08-28, docs/adr/0020)
//
// Scénario réel, pas théorique : la Lambda planifiée `mission-validation-auto-finalizer`
// finalise en `COMPLETED_AUTO`/`DISPUTED` une Mission dont un seul côté a répondu, SANS jamais
// renseigner l'outcome du côté silencieux (délibéré, ADR-0016 §2 — ne pas falsifier une réponse
// qui n'a pas eu lieu). La condition write-once de la fonction 5/8 portant UNIQUEMENT sur ce
// champ d'outcome, ce côté restait libre d'écrire indéfiniment : son vote, arrivé des semaines
// plus tard, écrasait la trace de la finalisation automatique.
// ─────────────────────────────────────────────────────────────────────────────────────────
describe('submitMissionValidation — vote TARDIF sur une Mission déjà finalisée', () => {
  const lastDonationDateOf = (animalId) => world.animals.get(animalId)?.lastDonationDate

  /** État exact laissé par la Lambda planifiée : statut terminal + UN SEUL outcome renseigné. */
  const autoFinalizedByLambda = (status, respondedSide) => {
    store.set(
      'mission-1',
      buildMission({
        status,
        ...(respondedSide === 'CLINIC'
          ? { clinicValidationOutcome: 'CONFIRMED', clinicValidatedAt: NOW }
          : { ownerValidationOutcome: 'CONFIRMED', ownerValidatedAt: NOW }),
      }),
    )
  }

  it('COMPLETED_AUTO : le vote tardif de l’OWNER est refusé (MISSION_ALREADY_FINALIZED), la Mission est INTACTE', () => {
    autoFinalizedByLambda('COMPLETED_AUTO', 'CLINIC')
    const before = { ...store.get('mission-1') }

    const late = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Owners'],
      sub: OWNER_SUB,
    })

    expect(late.errors[0].errorType).toBe('MISSION_ALREADY_FINALIZED')
    // La trace de la finalisation automatique survit : statut, et côté silencieux toujours vide.
    expect(store.get('mission-1')).toEqual(before)
    expect(store.get('mission-1').status).toBe('COMPLETED_AUTO')
    expect(store.get('mission-1').ownerValidationOutcome).toBeUndefined()
  })

  it('COMPLETED_AUTO : le vote tardif du VÉTÉRINAIRE est refusé aussi — c’est LUI qui provoquait le double incrément de Clinic.transfusionsDone', () => {
    // Côté vétérinaire, un `COMPLETED` renvoyé par la mutation redéclenche
    // `applyVeterinarianCompletionSideEffects` (useMissionClosure.js) alors que la Lambda a déjà
    // fait ces écritures de son côté (ADR-0016 §4). Le refus est ce qui ferme ce double comptage.
    autoFinalizedByLambda('COMPLETED_AUTO', 'OWNER')

    const late = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
      sub: VET_SUB,
    })

    expect(late.errors[0].errorType).toBe('MISSION_ALREADY_FINALIZED')
    // `data` nul : aucun statut `COMPLETED` ne peut revenir au composable, donc aucune écriture
    // secondaire côté client.
    expect(late.data).toBeNull()
    expect(store.get('mission-1').clinicValidationOutcome).toBeUndefined()
  })

  it('DISPUTED (produit par la même Lambda) : refusé, la trace du litige n’est jamais réécrite', () => {
    autoFinalizedByLambda('DISPUTED', 'CLINIC')

    const late = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'DENIED', disputeReason: 'trop tard' },
      groups: ['Owners'],
      sub: OWNER_SUB,
    })

    expect(late.errors[0].errorType).toBe('MISSION_ALREADY_FINALIZED')
    expect(store.get('mission-1').status).toBe('DISPUTED')
    expect(store.get('mission-1').ownerDisputeReason).toBeUndefined()
  })

  it('la Frequency Rule n’est PAS redatée par un vote tardif (la fonction 8/8 n’est jamais atteinte)', () => {
    // C'était la conséquence la plus grave : `Animal.lastDonationDate` réécrit à la date du vote
    // TARDIF, décalant d'autant la prochaine éligibilité d'un animal prélevé bien avant.
    autoFinalizedByLambda('COMPLETED_AUTO', 'CLINIC')
    world.animals.set('animal-1', {
      id: 'animal-1',
      ownerID: OWNER_SUB,
      lastDonationDate: '2026-08-01',
    })

    runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Owners'],
      sub: OWNER_SUB,
    })

    expect(lastDonationDateOf('animal-1')).toBe('2026-08-01')
    expect(nowFormattedCalls).toEqual([])
  })

  it.each(['COMPLETED', 'NO_SHOW', 'CANCELLED'])(
    'statut terminal %s (hors Lambda) : refusé de la même façon, aucun cas particulier',
    (status) => {
      store.set('mission-1', buildMission({ status }))

      const late = runSubmitMissionValidation(store, {
        args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
        groups: ['Owners'],
        sub: OWNER_SUB,
      })

      expect(late.errors[0].errorType).toBe('MISSION_ALREADY_FINALIZED')
      expect(store.get('mission-1').status).toBe(status)
    },
  )

  // Non-régression : la garde ne doit PAS gêner le second vote légitime, qui arrive précisément
  // sur une Mission en `PENDING_VALIDATION` (statut non terminal).
  it('le SECOND vote légitime (PENDING_VALIDATION) passe toujours — la garde ne bloque que le terminal', () => {
    runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
      sub: VET_SUB,
    })
    expect(store.get('mission-1').status).toBe('PENDING_VALIDATION')

    const second = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Owners'],
      sub: OWNER_SUB,
    })

    expect(second.errors).toBeUndefined()
    expect(second.data.status).toBe('COMPLETED')
  })

  // Écart de comportement observable ASSUMÉ (docs/adr/0020 §4) : un troisième appel du MÊME côté
  // sur une Mission désormais terminale renvoie `MISSION_ALREADY_FINALIZED` et non plus
  // `ALREADY_VALIDATED` — la garde de statut précède la condition write-once. Les deux disent
  // « c'est fini », le nouveau est plus précis.
  it('re-vote du même côté APRÈS finalisation : MISSION_ALREADY_FINALIZED (et non plus ALREADY_VALIDATED)', () => {
    runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Veterinarians'],
      sub: VET_SUB,
    })
    runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'CONFIRMED' },
      groups: ['Owners'],
      sub: OWNER_SUB,
    })

    const third = runSubmitMissionValidation(store, {
      args: { missionId: 'mission-1', outcome: 'DENIED' },
      groups: ['Veterinarians'],
      sub: VET_SUB,
    })

    expect(third.errors[0].errorType).toBe('MISSION_ALREADY_FINALIZED')
    // Tant que la Mission n'est PAS terminale, c'est bien `ALREADY_VALIDATED` qui répond (le
    // write-once par côté reste la garde de ce cas-là) — cf. le describe bout-en-bout plus haut.
  })
})
