// @vitest-environment node
//
// Environnement `node` explicite (le défaut du repo est `jsdom`, posé pour les tests front) :
// ce fichier teste un handler Lambda, qui ne s'exécute jamais dans un navigateur. Les deux
// paquets AWS sont entièrement mockés ci-dessous, donc aucun appel réseau n'est possible ; le
// choix d'environnement reste celui qui décrit honnêtement le runtime visé.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Context, DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda'
// Imports statiques des modules mockés : `vi.mock()` est hissé au-dessus des imports par
// Vitest, ces deux lignes reçoivent donc bien les doublures définies plus bas.
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { handler, type RatingAggregationSummary } from './handler'

/**
 * Test du HANDLER de la Lambda `rating-aggregation` (étape 3/5), au-delà du module pur voisin
 * (`resolve-rating-aggregation.test.ts`) : ce que ce fichier vérifie et que l'autre ne peut pas,
 * c'est ce qui est réellement ÉCRIT dans DynamoDB -- combien d'écritures, sur quelle table, avec
 * quelle condition. Le brief de cette sous-tâche demande explicitement la preuve qu'un lot
 * contenant deux INSERT pour la même cible ne produit pas une double écriture : elle ne peut pas
 * s'obtenir sur la seule fonction de dédoublonnage.
 *
 * Le SDK est mocké au niveau MODULE (`vi.mock`) plutôt que via un vrai client : le handler
 * instancie son `DynamoDBDocumentClient` au chargement du module (forme reprise de la Lambda de
 * l'étape 2/5), il n'y a donc pas d'injection de dépendance à exploiter. Aucun test de handler
 * n'existait dans ce repo avant celui-ci -- premier du genre, volontairement limité aux
 * assertions qui portent une vraie garantie (nombre et forme des écritures), pas à un décalque
 * de l'implémentation.
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
}))

const RATING_TABLE = 'Rating-test-table'
const RATING_INDEX = 'ratingsByTarget'
const CLINIC_TABLE = 'Clinic-test-table'
const OWNER_TABLE = 'Owner-test-table'

type SentCommand = { commandName: string; input: Record<string, any> }

const insertRecord = (targetID: string, targetRole: string): DynamoDBRecord => ({
  eventName: 'INSERT',
  dynamodb: { NewImage: { targetID: { S: targetID }, targetRole: { S: targetRole } } },
})

const streamEvent = (...Records: DynamoDBRecord[]): DynamoDBStreamEvent => ({ Records })

/** Le handler est typé `Handler<...>` (3 arguments) -- contexte/callback factices ici. */
const invoke = async (event: DynamoDBStreamEvent): Promise<RatingAggregationSummary> =>
  (await handler(event, {} as Context, () => {})) as RatingAggregationSummary

/** Réponses successives de `send()` : une par commande envoyée, dans l'ordre. */
const respondWith = (...responses: unknown[]) => {
  for (const response of responses) {
    sendMock.mockImplementationOnce(() =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
    )
  }
}

const sentCommands = (): SentCommand[] => sendMock.mock.calls.map(([command]) => command)

const starsPage = (stars: number[]) => ({ Items: stars.map((value) => ({ stars: value })) })

/**
 * Échec de condition DynamoDB. Instancié via la VRAIE signature du SDK (`$metadata` requis par
 * `@aws-sdk/client-dynamodb`, que `tsc` vérifie sur les types réels même si le module est mocké
 * à l'exécution) -- la doublure ignore l'argument, mais le test reste valide si la classe
 * mockée disparaît un jour au profit du vrai SDK.
 */
const conditionalCheckFailed = () =>
  new ConditionalCheckFailedException({ $metadata: {}, message: 'The conditional request failed' })

beforeEach(() => {
  sendMock.mockReset()
  vi.stubEnv('RATING_TABLE_NAME', RATING_TABLE)
  vi.stubEnv('RATING_TARGET_INDEX_NAME', RATING_INDEX)
  vi.stubEnv('CLINIC_TABLE_NAME', CLINIC_TABLE)
  vi.stubEnv('OWNER_TABLE_NAME', OWNER_TABLE)
  vi.stubEnv('CLINIC_MODERATION_AVERAGE_THRESHOLD', '3')
  vi.stubEnv('CLINIC_MODERATION_MIN_RATING_COUNT', '5')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('rating-aggregation handler — dédoublonnage d’un lot', () => {
  // LE test demandé par le brief : deux notations reçues par la MÊME clinique dans le MÊME lot.
  it('ne recalcule et n’écrit QU’UNE FOIS pour deux INSERT visant la même cible', async () => {
    respondWith(starsPage([5, 4]), {})

    const summary = await invoke(
      streamEvent(insertRecord('clinic-1', 'CLINIC'), insertRecord('clinic-1', 'CLINIC')),
    )

    const commands = sentCommands()
    expect(commands.filter((command) => command.commandName === 'Query')).toHaveLength(1)
    expect(commands.filter((command) => command.commandName === 'Update')).toHaveLength(1)
    expect(summary.targetsAggregated).toBe(1)
    expect(summary.ignoredDuplicates).toBe(1)
    expect(summary.failures).toBe(0)
  })

  it('traite séparément deux cibles distinctes du même lot', async () => {
    respondWith(starsPage([5]), {}, starsPage([2]), {})

    const summary = await invoke(
      streamEvent(insertRecord('clinic-1', 'CLINIC'), insertRecord('owner-1', 'OWNER')),
    )

    expect(sentCommands().filter((command) => command.commandName === 'Update')).toHaveLength(2)
    expect(summary.targetsAggregated).toBe(2)
  })

  it('n’émet AUCUNE commande pour un lot sans INSERT exploitable', async () => {
    const summary = await invoke(
      streamEvent(
        { eventName: 'MODIFY', dynamodb: { NewImage: { targetID: { S: 'c' }, targetRole: { S: 'CLINIC' } } } },
        { eventName: 'INSERT', dynamodb: { NewImage: { targetRole: { S: 'CLINIC' } } } },
        { eventName: 'INSERT', dynamodb: {} },
      ),
    )

    expect(sendMock).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ targetsAggregated: 0, ignoredNonInsert: 1, ignoredInvalid: 2 })
  })
})

describe('rating-aggregation handler — écriture des agrégats', () => {
  it('écrit la moyenne et le compte CLINIC sur la table Clinic, sans jamais créer la ligne', async () => {
    respondWith(starsPage([5, 4, 3]), {})

    await invoke(streamEvent(insertRecord('clinic-1', 'CLINIC')))

    const [query, update] = sentCommands()
    expect(query.input).toMatchObject({ TableName: RATING_TABLE, IndexName: RATING_INDEX })
    expect(query.input.ExpressionAttributeValues).toEqual({
      ':targetID': 'clinic-1',
      ':targetRole': 'CLINIC',
    })
    // Aucun `comment` ne doit transiter par cette Lambda : projection limitée aux notes.
    expect(query.input.ProjectionExpression).toBe('#stars')

    expect(update.input.TableName).toBe(CLINIC_TABLE)
    expect(update.input.Key).toEqual({ id: 'clinic-1' })
    expect(update.input.ExpressionAttributeNames).toMatchObject({
      '#average': 'averageRatingAsClinic',
      '#count': 'ratingCountAsClinic',
    })
    expect(update.input.ExpressionAttributeValues).toMatchObject({ ':average': 4, ':count': 3 })
    // Garde-fou anti-upsert : sans elle, un `targetID` forgé créerait une Clinic fantôme.
    expect(update.input.ConditionExpression).toBe('attribute_exists(id)')
  })

  it('écrit sur la table Owner, avec les champs Owner, pour une cible OWNER', async () => {
    respondWith(starsPage([4, 2]), {})

    await invoke(streamEvent(insertRecord('owner-1', 'OWNER')))

    const [, update] = sentCommands()
    expect(update.input.TableName).toBe(OWNER_TABLE)
    expect(update.input.ExpressionAttributeNames).toMatchObject({
      '#average': 'averageRatingAsOwner',
      '#count': 'ratingCountAsOwner',
    })
    expect(update.input.ExpressionAttributeValues).toMatchObject({ ':average': 3, ':count': 2 })
  })

  it('suit la pagination du GSI (une moyenne ne se calcule pas sur la 1re page seule)', async () => {
    respondWith(
      { ...starsPage([5, 5]), LastEvaluatedKey: { missionID: 'm1', raterRole: 'OWNER' } },
      starsPage([1, 1]),
      {},
    )

    await invoke(streamEvent(insertRecord('clinic-1', 'CLINIC')))

    const commands = sentCommands()
    expect(commands.filter((command) => command.commandName === 'Query')).toHaveLength(2)
    expect(commands[1].input.ExclusiveStartKey).toEqual({ missionID: 'm1', raterRole: 'OWNER' })
    const update = commands[2]
    expect(update.input.ExpressionAttributeValues).toMatchObject({ ':average': 3, ':count': 4 })
  })
})

describe('rating-aggregation handler — modération clinique', () => {
  it('signale la clinique quand la moyenne passe sous le seuil avec assez d’avis', async () => {
    respondWith(starsPage([1, 2, 3, 2, 2]), {}, {})

    const summary = await invoke(streamEvent(insertRecord('clinic-1', 'CLINIC')))

    const updates = sentCommands().filter((command) => command.commandName === 'Update')
    expect(updates).toHaveLength(2)
    const [, flag] = updates
    expect(flag.input.TableName).toBe(CLINIC_TABLE)
    expect(flag.input.ExpressionAttributeValues).toMatchObject({
      ':true': true,
      ':underReview': 'UNDER_REVIEW',
    })
    // La date d'entrée en revue ne doit être posée qu'UNE fois : c'est la condition qui le
    // garantit, pas une lecture préalable.
    expect(flag.input.ConditionExpression).toContain('attribute_not_exists(#needsAdminReview)')
    expect(flag.input.ConditionExpression).toContain('#needsAdminReview = :false')
    expect(summary.clinicsFlaggedForReview).toBe(1)
  })

  it('ne signale PAS une clinique sous le seuil avec trop peu d’avis (4 avis à 2,0)', async () => {
    respondWith(starsPage([2, 2, 2, 2]), {})

    const summary = await invoke(streamEvent(insertRecord('clinic-1', 'CLINIC')))

    expect(sentCommands().filter((command) => command.commandName === 'Update')).toHaveLength(1)
    expect(summary.clinicsFlaggedForReview).toBe(0)
  })

  // Frontière exacte demandée par la revue QA (2026-08-27) : EXACTEMENT 5 avis (borne de volume
  // atteinte, inclusive) à EXACTEMENT 3,0 de moyenne (borne de moyenne stricte, NON franchie).
  // Testée ici en plus du module pur (`resolve-rating-aggregation.test.ts`) parce que ce n'est
  // pas la même garantie : ce test prouve que le handler transmet bien l'agrégat CALCULÉ tel
  // quel au comparateur — un arrondi ou une coercition intermédiaire côté handler ferait
  // basculer ce cas sans qu'aucun test de fonction pure ne bouge.
  it('ne signale PAS une clinique à EXACTEMENT 5 avis pour EXACTEMENT 3,0 de moyenne (écriture de l’agrégat seule)', async () => {
    respondWith(starsPage([3, 3, 3, 3, 3]), {})

    const summary = await invoke(streamEvent(insertRecord('clinic-1', 'CLINIC')))

    const updates = sentCommands().filter((command) => command.commandName === 'Update')
    expect(updates).toHaveLength(1)
    expect(updates[0].input.ExpressionAttributeValues).toMatchObject({ ':average': 3, ':count': 5 })
    expect(summary.clinicsFlaggedForReview).toBe(0)
  })

  it('signale en revanche la MÊME clinique dès que la moyenne passe juste sous 3 avec 5 avis', async () => {
    // 14/5 = 2,8 : un seul avis d'écart avec le cas ci-dessus fait basculer la décision.
    respondWith(starsPage([3, 3, 3, 3, 2]), {}, {})

    const summary = await invoke(streamEvent(insertRecord('clinic-1', 'CLINIC')))

    expect(sentCommands().filter((command) => command.commandName === 'Update')).toHaveLength(2)
    expect(summary.clinicsFlaggedForReview).toBe(1)
  })

  it('ne signale JAMAIS un Owner, même très mal noté (aucune modération de ce côté)', async () => {
    respondWith(starsPage([1, 1, 1, 1, 1, 1]), {})

    const summary = await invoke(streamEvent(insertRecord('owner-1', 'OWNER')))

    expect(sentCommands().filter((command) => command.commandName === 'Update')).toHaveLength(1)
    expect(summary.clinicsFlaggedForReview).toBe(0)
  })

  it('ne compte pas un second signalement quand la clinique est déjà en revue (condition non satisfaite)', async () => {
    respondWith(starsPage([1, 1, 1, 1, 1]), {}, conditionalCheckFailed())

    const summary = await invoke(streamEvent(insertRecord('clinic-1', 'CLINIC')))

    expect(summary.clinicsFlaggedForReview).toBe(0)
    // Cas NORMAL, pas une erreur : l'invocation ne doit surtout pas échouer (sinon le lot est
    // rejoué en boucle sur une clinique déjà signalée).
    expect(summary.failures).toBe(0)
  })
})

describe('rating-aggregation handler — anomalies et échecs', () => {
  it('traite une cible inexistante comme une anomalie de donnée, pas comme un échec', async () => {
    // Résidu ADR-0015 : un Veterinarian peut forger un `targetID` arbitraire. Faire échouer
    // l'invocation bloquerait le shard en rejeu jusqu'à expiration des enregistrements.
    respondWith(starsPage([5]), conditionalCheckFailed())

    const summary = await invoke(streamEvent(insertRecord('clinic-fantome', 'CLINIC')))

    expect(summary.missingTargets).toBe(1)
    expect(summary.targetsAggregated).toBe(0)
    expect(summary.failures).toBe(0)
    // Aucune tentative de signalement sur une ligne qui n'existe pas.
    expect(sentCommands().filter((command) => command.commandName === 'Update')).toHaveLength(1)
  })

  it('lève en fin d’invocation si une écriture a échoué (rejeu du lot, idempotent)', async () => {
    respondWith(starsPage([5]), new Error('ProvisionedThroughputExceededException'))

    await expect(invoke(streamEvent(insertRecord('clinic-1', 'CLINIC')))).rejects.toThrow(
      '1 cible(s) en échec',
    )
  })

  it('traite les autres cibles du lot avant de lever', async () => {
    respondWith(starsPage([5]), new Error('boom'), starsPage([4]), {})

    await expect(
      invoke(streamEvent(insertRecord('clinic-1', 'CLINIC'), insertRecord('owner-1', 'OWNER'))),
    ).rejects.toThrow()

    const updates = sentCommands().filter((command) => command.commandName === 'Update')
    expect(updates).toHaveLength(2)
    expect(updates[1].input.TableName).toBe(OWNER_TABLE)
  })

  it('lève AVANT toute écriture si un seuil de modération n’est pas configuré', async () => {
    vi.stubEnv('CLINIC_MODERATION_MIN_RATING_COUNT', '')

    await expect(invoke(streamEvent(insertRecord('clinic-1', 'CLINIC')))).rejects.toThrow(
      'CLINIC_MODERATION_MIN_RATING_COUNT',
    )
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('lève AVANT toute écriture si un nom de table est absent', async () => {
    vi.stubEnv('OWNER_TABLE_NAME', '')

    await expect(invoke(streamEvent(insertRecord('owner-1', 'OWNER')))).rejects.toThrow(
      'OWNER_TABLE_NAME',
    )
    expect(sendMock).not.toHaveBeenCalled()
  })
})
