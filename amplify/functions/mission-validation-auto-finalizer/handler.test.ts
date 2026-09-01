// @vitest-environment node
//
// Environnement `node` explicite (le défaut du repo est `jsdom`, posé pour les tests front) :
// ce fichier teste un handler Lambda, qui ne s'exécute jamais dans un navigateur. Le SDK AWS est
// entièrement mocké ci-dessous, aucun appel réseau n'est possible.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Context } from 'aws-lambda'
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { handler } from './handler'

/**
 * Test du HANDLER de la Lambda `mission-validation-auto-finalizer` (étape 2/5).
 *
 * TROU DE COUVERTURE COMBLÉ (passe QA, 2026-08-27) : seul le module pur voisin
 * (`resolve-auto-finalization-outcome.test.ts`) était testé — c'est-à-dire la DÉCISION, jamais
 * l'ÉCRITURE. L'étape 3/5 a pourtant établi qu'un handler de ce type est testable
 * (`rating-aggregation/handler.test.ts`, même technique de doublure du SDK) ; l'asymétrie
 * laissait sans filet le seul code de cette feature qui écrit un statut TERMINAL sur une donnée
 * médicale, plus 3 écritures secondaires à effet réel (Frequency Rule, annuaire, compteurs).
 *
 * Ce que ce fichier prouve et que le module pur ne peut pas :
 * - la valeur EXACTE interrogée sur le GSI (`PENDING_VALIDATION`) — la frontière entre l'étape
 *   1/5 (le resolver qui POSE ce statut) et cette Lambda (qui le LIT) ;
 * - qu'un `SKIP` ne produit AUCUNE écriture, en particulier `BOTH_SIDES_RESPONDED` (résidu
 *   documenté, que la Lambda ne doit surtout pas « réparer » en silence) ;
 * - que seul `status`/`updatedAt` est écrit — jamais un outcome fabriqué pour le côté
 *   silencieux ;
 * - que `DISPUTED` ne déclenche aucune écriture secondaire, contrairement à `COMPLETED_AUTO` ;
 * - qu'un échec de CONDITION n'est pas compté comme une erreur, mais qu'une vraie erreur fait
 *   échouer l'invocation en FIN de parcours (après avoir traité les autres Missions).
 *
 * Le SDK est mocké au niveau MODULE (`vi.mock`) : le handler instancie son client au chargement
 * du module, il n'y a pas d'injection de dépendance à exploiter — même contrainte et même
 * réponse que `rating-aggregation/handler.test.ts`.
 */

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
  ConditionalCheckFailedException: class ConditionalCheckFailedException extends Error {
    constructor() {
      super('The conditional request failed')
      this.name = 'ConditionalCheckFailedException'
    }
  },
}))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: sendMock }) },
  QueryCommand: class {
    readonly commandName = 'Query'
    constructor(readonly input: Record<string, unknown>) {}
  },
  UpdateCommand: class {
    readonly commandName = 'Update'
    constructor(readonly input: Record<string, unknown>) {}
  },
  GetCommand: class {
    readonly commandName = 'Get'
    constructor(readonly input: Record<string, unknown>) {}
  },
  PutCommand: class {
    readonly commandName = 'Put'
    constructor(readonly input: Record<string, unknown>) {}
  },
  ScanCommand: class {
    readonly commandName = 'Scan'
    constructor(readonly input: Record<string, unknown>) {}
  },
}))

const MISSION_TABLE = 'Mission-test-table'
const MISSION_INDEX = 'missionsByStatus'
const ANIMAL_TABLE = 'Animal-test-table'
const REQUEST_TABLE = 'Request-test-table'
const RELATION_TABLE = 'ClinicOwnerRelation-test-table'
const CLINIC_TABLE = 'Clinic-test-table'

const DAY_MS = 24 * 60 * 60 * 1000
const VALIDATED_AT = '2026-08-01T09:00:00.000Z'
const VALIDATED_AT_MS = Date.parse(VALIDATED_AT)

type SentCommand = { commandName: string; input: Record<string, any> }

/** Le handler est typé `Handler<...>` (3 arguments) — contexte/callback factices ici. */
const invoke = async () => (await handler({}, {} as Context, () => {})) as any

/** Réponses successives de `send()` : une par commande envoyée, dans l'ordre. */
const respondWith = (...responses: unknown[]) => {
  for (const response of responses) {
    sendMock.mockImplementationOnce(() =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
    )
  }
}

const sentCommands = (): SentCommand[] => sendMock.mock.calls.map(([command]) => command)
const commandsOfKind = (kind: string) =>
  sentCommands().filter((command) => command.commandName === kind)

const missionPage = (...Items: Record<string, unknown>[]) => ({ Items })

const pendingMission = (overrides: Record<string, unknown> = {}) => ({
  id: 'mission-1',
  status: 'PENDING_VALIDATION',
  animalID: 'animal-1',
  requestID: 'request-1',
  clinicValidationOutcome: 'CONFIRMED',
  clinicValidatedAt: VALIDATED_AT,
  ...overrides,
})

const conditionalCheckFailed = () =>
  new ConditionalCheckFailedException({ $metadata: {}, message: 'The conditional request failed' })

beforeEach(() => {
  sendMock.mockReset()
  vi.useFakeTimers()
  // Bien au-delà de l'échéance (7 jours) pour toutes les Missions construites ci-dessus.
  vi.setSystemTime(new Date(VALIDATED_AT_MS + 30 * DAY_MS))
  vi.stubEnv('MISSION_VALIDATION_TIMEOUT_DAYS', '7')
  vi.stubEnv('MISSION_TABLE_NAME', MISSION_TABLE)
  vi.stubEnv('MISSION_STATUS_INDEX_NAME', MISSION_INDEX)
  vi.stubEnv('ANIMAL_TABLE_NAME', ANIMAL_TABLE)
  vi.stubEnv('REQUEST_TABLE_NAME', REQUEST_TABLE)
  vi.stubEnv('CLINIC_OWNER_RELATION_TABLE_NAME', RELATION_TABLE)
  vi.stubEnv('CLINIC_TABLE_NAME', CLINIC_TABLE)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('mission-validation-auto-finalizer — lecture des Missions en attente', () => {
  // FRONTIÈRE ENTRE SOUS-TÂCHES : le resolver (étape 1/5) écrit littéralement
  // 'PENDING_VALIDATION' dans `Mission.status` ; cette Lambda (étape 2/5) interroge le GSI avec
  // cette même chaîne. Une divergence d'un caractère entre les deux ne casserait AUCUN test
  // unitaire de sous-tâche prise isolément — la Lambda ne trouverait simplement plus jamais
  // rien, en silence. Pinné ici, en miroir du test de matrice côté resolver
  // (`amplify/data/__tests__/submit-mission-validation.resolvers.test.js`).
  it('interroge le GSI missionsByStatus sur la valeur EXACTE PENDING_VALIDATION, jamais un Scan de table', async () => {
    respondWith(missionPage())

    await invoke()

    const [query] = sentCommands()
    expect(query.commandName).toBe('Query')
    expect(query.input.TableName).toBe(MISSION_TABLE)
    expect(query.input.IndexName).toBe(MISSION_INDEX)
    expect(query.input.ExpressionAttributeValues).toEqual({ ':status': 'PENDING_VALIDATION' })
    expect(commandsOfKind('Scan')).toHaveLength(0)
  })

  it('suit la pagination du Query (une exécution ne s’arrête pas à la 1re page)', async () => {
    respondWith(
      { Items: [], LastEvaluatedKey: { id: 'mission-0' } },
      missionPage(),
    )

    const summary = await invoke()

    expect(commandsOfKind('Query')).toHaveLength(2)
    expect(sentCommands()[1].input.ExclusiveStartKey).toEqual({ id: 'mission-0' })
    expect(summary.pendingValidationScanned).toBe(0)
  })
})

describe('mission-validation-auto-finalizer — cas SKIP : aucune écriture', () => {
  // Résidu documenté (en tête de `submit-mission-validation-write-side.js` et ADR-0016 §6) :
  // une Mission dont les DEUX côtés ont répondu mais restée en PENDING_VALIDATION est une
  // anomalie que cette Lambda n'a PAS le droit de trancher (le vrai calcul aurait pu donner
  // COMPLETED/NO_SHOW, deux statuts qu'elle ne peut pas écrire). Ce test verrouille le
  // « ne rien faire » : ni écriture de statut, ni écriture secondaire.
  it('BOTH_SIDES_RESPONDED : ne « répare » RIEN — zéro commande après le Query, invocation en succès', async () => {
    respondWith(
      missionPage(
        pendingMission({
          ownerValidationOutcome: 'DENIED',
          ownerValidatedAt: VALIDATED_AT,
        }),
      ),
    )

    const summary = await invoke()

    expect(sentCommands()).toHaveLength(1)
    expect(summary).toMatchObject({
      pendingValidationScanned: 1,
      inconsistent: 1,
      completedAuto: 0,
      disputed: 0,
      failures: 0,
    })
  })

  it('NO_SIDE_RESPONDED : aucune écriture (jamais une double auto-confirmation à partir de rien)', async () => {
    respondWith(
      missionPage(
        pendingMission({ clinicValidationOutcome: undefined, clinicValidatedAt: undefined }),
      ),
    )

    const summary = await invoke()

    expect(sentCommands()).toHaveLength(1)
    expect(summary.inconsistent).toBe(1)
  })

  it('échéance non atteinte : aucune écriture, et ce n’est PAS compté comme une anomalie', async () => {
    vi.setSystemTime(new Date(VALIDATED_AT_MS + 3 * DAY_MS))
    respondWith(missionPage(pendingMission()))

    const summary = await invoke()

    expect(sentCommands()).toHaveLength(1)
    expect(summary).toMatchObject({ notDueYet: 1, inconsistent: 0, failures: 0 })
  })
})

describe('mission-validation-auto-finalizer — finalisation COMPLETED_AUTO', () => {
  /** Query + Update(status) + Update(Animal) + Get(Animal) + Get(Request) + Scan + Put + Update(Clinic). */
  const respondWithFullCompletedAutoFlow = () =>
    respondWith(
      missionPage(pendingMission()),
      {}, // Update Mission.status
      {}, // Update Animal.lastDonationDate
      { Item: { ownerID: 'owner-1' } }, // Get Animal.ownerID
      { Item: { clinicID: 'clinic-1' } }, // Get Request.clinicID
      { Items: [] }, // Scan ClinicOwnerRelation
      {}, // Put ClinicOwnerRelation
      {}, // Update Clinic (compteurs)
    )

  it('écrit le statut sous condition status = PENDING_VALIDATION, et RIEN d’autre que status/updatedAt', async () => {
    respondWithFullCompletedAutoFlow()

    const summary = await invoke()

    const statusUpdate = commandsOfKind('Update')[0]
    expect(statusUpdate.input.TableName).toBe(MISSION_TABLE)
    expect(statusUpdate.input.Key).toEqual({ id: 'mission-1' })
    expect(statusUpdate.input.ConditionExpression).toBe('#status = :pendingValidation')
    expect(statusUpdate.input.ExpressionAttributeValues).toMatchObject({
      ':finalStatus': 'COMPLETED_AUTO',
      ':pendingValidation': 'PENDING_VALIDATION',
    })
    // Le côté silencieux n'est JAMAIS falsifié : aucune trace de validation fabriquée, sinon la
    // fonction 1/3 du resolver (write-once sur `attributeExists: false`) le bloquerait à jamais.
    expect(statusUpdate.input.UpdateExpression).not.toMatch(/ValidationOutcome|ValidatedAt/)
    expect(JSON.stringify(statusUpdate.input.ExpressionAttributeValues)).not.toContain('CONFIRMED')
    expect(summary).toMatchObject({ completedAuto: 1, disputed: 0, failures: 0 })
  })

  it('enchaîne les 3 écritures secondaires (Frequency Rule, annuaire, compteurs) dans le bon ordre et sur les bonnes tables', async () => {
    respondWithFullCompletedAutoFlow()

    await invoke()

    const commands = sentCommands()
    expect(commands.map((command) => command.commandName)).toEqual([
      'Query',
      'Update',
      'Update',
      'Get',
      'Get',
      'Scan',
      'Put',
      'Update',
    ])

    const animalUpdate = commands[2]
    expect(animalUpdate.input.TableName).toBe(ANIMAL_TABLE)
    expect(animalUpdate.input.Key).toEqual({ id: 'animal-1' })
    // Date au format AWSDate strict, fuseau de la clinique (pas la date UTC de la Lambda).
    expect(animalUpdate.input.ExpressionAttributeValues[':today']).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(animalUpdate.input.ConditionExpression).toBe('attribute_exists(id)')

    const relationPut = commands[6]
    expect(relationPut.input.TableName).toBe(RELATION_TABLE)
    expect(relationPut.input.Item).toMatchObject({
      clinicID: 'clinic-1',
      ownerID: 'owner-1',
      isPrimaryClinic: true,
      __typename: 'ClinicOwnerRelation',
    })

    const clinicUpdate = commands[7]
    expect(clinicUpdate.input.TableName).toBe(CLINIC_TABLE)
    expect(clinicUpdate.input.Key).toEqual({ id: 'clinic-1' })
    expect(clinicUpdate.input.ExpressionAttributeValues).toMatchObject({ ':donorIncrement': 1 })
    expect(clinicUpdate.input.UpdateExpression).toContain('if_not_exists(transfusionsDone, :zero)')
  })

  it('propriétaire déjà rattaché à cette clinique : pas de nouvelle relation, et donorOwnersCount N’est PAS incrémenté', async () => {
    respondWith(
      missionPage(pendingMission()),
      {},
      {},
      { Item: { ownerID: 'owner-1' } },
      { Item: { clinicID: 'clinic-1' } },
      { Items: [{ clinicID: 'clinic-1' }] },
      {}, // Update Clinic (pas de Put : la relation existe déjà)
    )

    await invoke()

    expect(commandsOfKind('Put')).toHaveLength(0)
    const clinicUpdate = commandsOfKind('Update').at(-1)!
    expect(clinicUpdate.input.ExpressionAttributeValues).toMatchObject({
      ':one': 1,
      ':donorIncrement': 0,
    })
  })

  it('un échec d’écriture secondaire est best-effort : les suivantes s’exécutent, mais l’invocation échoue en FIN de parcours', async () => {
    respondWith(
      missionPage(pendingMission()),
      {},
      new Error('DynamoDB throttled'), // Animal.lastDonationDate
      { Item: { ownerID: 'owner-1' } },
      { Item: { clinicID: 'clinic-1' } },
      { Items: [] },
      {},
      {},
    )

    await expect(invoke()).rejects.toThrow(/1 écriture\(s\) en échec/)
    // L'échec n'a PAS interrompu la suite : annuaire et compteurs ont bien été écrits.
    expect(commandsOfKind('Put')).toHaveLength(1)
    expect(commandsOfKind('Update')).toHaveLength(3)
  })
})

describe('mission-validation-auto-finalizer — DISPUTED et concurrence', () => {
  it('DISPUTED (le côté qui a répondu a infirmé le don) : statut écrit, AUCUNE écriture secondaire — un litige n’est pas un don réalisé', async () => {
    respondWith(missionPage(pendingMission({ clinicValidationOutcome: 'DENIED' })), {})

    const summary = await invoke()

    const commands = sentCommands()
    expect(commands).toHaveLength(2)
    expect(commands[1].input.ExpressionAttributeValues).toMatchObject({
      ':finalStatus': 'DISPUTED',
    })
    expect(summary).toMatchObject({ disputed: 1, completedAuto: 0, failures: 0 })
  })

  it('condition non satisfaite (Mission finalisée entre-temps par un vrai submitMissionValidation) : cas NORMAL, aucune écriture secondaire, aucune erreur', async () => {
    respondWith(missionPage(pendingMission()), conditionalCheckFailed())

    const summary = await invoke()

    expect(sentCommands()).toHaveLength(2)
    expect(summary).toMatchObject({
      concurrentlyFinalized: 1,
      completedAuto: 0,
      failures: 0,
    })
  })

  it('une VRAIE erreur sur l’écriture du statut est comptée, n’exécute aucune écriture secondaire, et fait échouer l’invocation', async () => {
    respondWith(missionPage(pendingMission()), new Error('AccessDeniedException'))

    await expect(invoke()).rejects.toThrow(/écriture\(s\) en échec/)
    expect(sentCommands()).toHaveLength(2)
  })

  it('traite TOUTES les Missions du lot avant de lever (une Mission en échec n’empêche pas les autres)', async () => {
    respondWith(
      missionPage(
        pendingMission({ id: 'mission-1' }),
        pendingMission({ id: 'mission-2', clinicValidationOutcome: 'DENIED' }),
      ),
      new Error('AccessDeniedException'), // mission-1
      {}, // mission-2 -> DISPUTED
    )

    await expect(invoke()).rejects.toThrow()
    expect(commandsOfKind('Update')).toHaveLength(2)
  })
})

describe('mission-validation-auto-finalizer — configuration fail-loud', () => {
  it.each([
    'MISSION_VALIDATION_TIMEOUT_DAYS',
    'MISSION_TABLE_NAME',
    'MISSION_STATUS_INDEX_NAME',
    'ANIMAL_TABLE_NAME',
    'REQUEST_TABLE_NAME',
    'CLINIC_OWNER_RELATION_TABLE_NAME',
    'CLINIC_TABLE_NAME',
  ])('lève AVANT toute lecture/écriture si %s est absente (aucune valeur de repli)', async (name) => {
    vi.stubEnv(name, '')
    respondWith(missionPage(pendingMission()))

    await expect(invoke()).rejects.toThrow()
    expect(sendMock).not.toHaveBeenCalled()
  })
})
