import type { DynamoDBRecord, DynamoDBStreamEvent, Handler } from 'aws-lambda'
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import {
  collectAggregationTargets,
  computeRatingAggregate,
  exceedsModerationThreshold,
  resolveModerationThresholds,
  type ModerationThresholds,
  type RatingAggregate,
  type RatingAggregationTarget,
  type RatingStreamRecordSnapshot,
} from './resolve-rating-aggregation'

/**
 * Handler de la Lambda `rating-aggregation`, déclenchée par le flux DynamoDB Streams de la table
 * `Rating` (voir `resource.ts` du même dossier pour le pourquoi, `amplify/backend.ts` pour le
 * câblage du déclencheur et la policy IAM, `resolve-rating-aggregation.ts` pour la logique pure
 * -- la seule partie testable sans I/O -- et docs/adr/0017 pour l'ensemble).
 *
 * ------------------------------------------------------------------------------------------
 * ACCÈS AUX DONNÉES : SDK DynamoDB EN DIRECT, PAS LE CLIENT DATA
 * ------------------------------------------------------------------------------------------
 * Même chemin que la Lambda planifiée de l'étape 2/5 (ADR-0016 §3, dont la revue devsecops-aws a
 * validé le pattern), pour des raisons ici encore plus contraignantes :
 * - les 5 champs de `Clinic` et les 2 champs d'`Owner` écrits par ce handler portent des règles
 *   `@auth` DE CHAMP qui n'accordent `create`/`update` à AUCUN rôle (`.authorization()` de champ
 *   REMPLACE la règle de niveau modèle, ADR-0009). Passer par le client Data en mode IAM
 *   (`allow.resource()`) supposerait d'ajouter la fonction dans ces règles -- c'est-à-dire de
 *   rouvrir par une mutation générée exactement ce que cette sous-tâche verrouille ;
 * - l'écriture du flag de modération a besoin d'une `ConditionExpression` DynamoDB (poser
 *   `needsAdminReviewSince` UNE SEULE FOIS), qu'aucune mutation générée n'expose (ADR-0011).
 * La garde d'autorisation n'est donc pas `@auth` mais la policy IAM de cette fonction, scopée à
 * l'ARN exact de chaque table/index (`amplify/backend.ts`).
 *
 * Conséquence assumée, identique à l'étape 2/5 : écrire en direct court-circuite AppSync, donc
 * aucun `updatedAt` automatique -- ce handler le pose lui-même.
 *
 * ------------------------------------------------------------------------------------------
 * IDEMPOTENCE ET REJEU : LA PROPRIÉTÉ CENTRALE DE CE HANDLER
 * ------------------------------------------------------------------------------------------
 * Un `EventSourceMapping` DynamoDB Streams REJOUE le lot entier tant que l'invocation échoue
 * (jusqu'à `retryAttempts`, voir `amplify/backend.ts`) et, pendant ce temps, BLOQUE la
 * progression du shard concerné. Ce handler est donc conçu pour que rejouer un lot soit
 * strictement sans effet de bord :
 * - chaque agrégat est RECALCULÉ intégralement depuis le GSI (jamais un incrément sur la valeur
 *   précédente) puis écrit en valeur ABSOLUE -- réécrire deux fois écrit deux fois la même chose ;
 * - le flag de modération est écrit sous condition `attribute_not_exists(needsAdminReview) OR
 *   needsAdminReview = false`, donc `needsAdminReviewSince` n'est posé qu'une fois, quel que soit
 *   le nombre de rejeux ou de notes suivantes sous le seuil.
 * C'est ce qui autorise le fail-loud (throw en fin d'invocation) : contrairement à un handler qui
 * incrémenterait des compteurs, ici le rejeu est la BONNE réponse à un échec transitoire.
 *
 * ------------------------------------------------------------------------------------------
 * CRITIQUE vs ANOMALIE DE DONNÉE
 * ------------------------------------------------------------------------------------------
 * - Erreur d'infrastructure (Query/Update en échec réseau, throttling, permission) : comptée,
 *   loguée, et l'invocation ÉCHOUE en fin de traitement -> rejeu du lot. C'est la seule façon
 *   qu'un agrégat manqué finisse par être écrit, et ce dépôt n'a aucun outil de suivi d'erreurs
 *   (trou d'observabilité connu, roadmap Phase 5) : une invocation en erreur est le seul signal
 *   visible.
 * - Cible INEXISTANTE (`attribute_exists(id)` non satisfaite) : ce n'est PAS une erreur
 *   d'infrastructure et rejouer n'y changerait rien -- c'est une `Rating` qui pointe vers un
 *   `Clinic`/`Owner` qui n'existe pas (compte supprimé entre-temps, ou `targetID` forgé : résidu
 *   explicitement assumé d'ADR-0015 §3, un Veterinarian peut soumettre un `targetID` arbitraire).
 *   Loguée et comptée à part, JAMAIS transformée en échec : sinon une seule ligne forgée
 *   bloquerait indéfiniment le shard, et avec lui l'agrégation de toutes les autres cibles.
 *   `attribute_exists(id)` est par ailleurs indispensable en soi : sans elle, `UpdateItem`
 *   CRÉERAIT un `Clinic`/`Owner` fantôme (upsert implicite de DynamoDB) ne contenant que des
 *   champs de notation -- même piège que celui déjà documenté dans
 *   `submit-mission-validation-write-side.js` et dans la Lambda de l'étape 2/5.
 */

const CLINIC_ROLE = 'CLINIC'
const UNDER_REVIEW = 'UNDER_REVIEW'

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

/** Exporté pour le test du handler (`handler.test.ts`), jamais consommé en production. */
export type RatingAggregationSummary = {
  /** Enregistrements reçus dans le lot (avant tout filtrage). */
  recordsReceived: number
  /** Cibles distinctes réellement recalculées (après filtrage + dédoublonnage). */
  targetsAggregated: number
  ignoredNonInsert: number
  ignoredInvalid: number
  ignoredDuplicates: number
  /** Cliniques signalées à la modération lors de CETTE invocation (premier franchissement). */
  clinicsFlaggedForReview: number
  /** Cibles dont la ligne `Clinic`/`Owner` n'existe pas (voir l'en-tête) -- jamais un échec. */
  missingTargets: number
  failures: number
}

/** Lit une variable d'environnement requise -- fail-loud, jamais de repli silencieux. */
function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Variable d'environnement ${name} manquante : elle est injectée par amplify/backend.ts (addEnvironment) à partir des tables managées par defineData.`,
    )
  }
  return value
}

/**
 * Traduit un enregistrement brut du flux en la forme minimale que consomme la logique pure.
 *
 * Lecture directe des `AttributeValue` (`NewImage.targetID.S`) plutôt qu'`unmarshall()`
 * (`@aws-sdk/util-dynamodb`) : les deux champs lus sont des chaînes, `unmarshall` n'apporterait
 * rien qu'une dépendance de plus dans le bundle et un cast (les types `AttributeValue` de
 * `@types/aws-lambda` et ceux du SDK sont structurellement incompatibles).
 *
 * `NewImage` est garanti présent sur un `INSERT` par le `StreamViewType` des tables managées Gen2
 * (`NEW_AND_OLD_IMAGES`, posé par le transformer -- voir ADR-0017 §1) ; `Keys` ne suffirait pas
 * (la clé primaire de `Rating` est `(missionID, raterRole)`, elle ne porte pas `targetID`). Si un
 * jour cette vue changeait, les enregistrements seraient comptés `invalid` et logués, pas
 * silencieusement traités comme des cibles vides.
 */
function toSnapshot(record: DynamoDBRecord): RatingStreamRecordSnapshot {
  const image = record?.dynamodb?.NewImage
  return {
    eventName: record?.eventName ?? null,
    targetID: image?.targetID?.S ?? null,
    targetRole: image?.targetRole?.S ?? null,
  }
}

/**
 * TOUTES les notes reçues par une cible, via le GSI `(targetID, targetRole)`
 * (`amplify/data/resource.ts`, `RATING_TARGET_INDEX_NAME`) -- jamais un Scan de la table
 * `Rating`. `ProjectionExpression` limitée à `stars`, le seul champ consommé par le calcul :
 * même discipline que le `selectionSet` posé par chaque appelant côté front (CLAUDE.md), et
 * garantie qu'aucun `comment` (texte libre, potentiellement sensible) ne transite par cette
 * Lambda ni ses logs.
 * Pagination suivie jusqu'au bout : une clinique très notée ne doit pas voir sa moyenne calculée
 * sur la seule première page.
 */
async function listStarsForTarget(
  tableName: string,
  indexName: string,
  target: RatingAggregationTarget,
): Promise<Array<number | string | null | undefined>> {
  const stars: Array<number | string | null | undefined> = []
  let exclusiveStartKey: Record<string, unknown> | undefined

  do {
    const page = await documentClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: '#targetID = :targetID AND #targetRole = :targetRole',
        ProjectionExpression: '#stars',
        ExpressionAttributeNames: {
          '#targetID': 'targetID',
          '#targetRole': 'targetRole',
          '#stars': 'stars',
        },
        ExpressionAttributeValues: {
          ':targetID': target.targetID,
          ':targetRole': target.targetRole,
        },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    )

    for (const item of page.Items ?? []) {
      stars.push((item as { stars?: number | string | null }).stars)
    }
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)

  return stars
}

/**
 * Écriture des deux champs agrégés (`Clinic` ou `Owner`), INCONDITIONNELLE hormis le garde-fou
 * anti-upsert `attribute_exists(id)`.
 *
 * ÉCART DÉLIBÉRÉ avec l'écriture de `Mission.status` (étape 2/5), à scruter en revue : là-bas
 * l'écriture est conditionnée à l'état lu (`status = PENDING_VALIDATION`) parce qu'écraser une
 * finalisation concurrente est une régression PERMANENTE sur une donnée médicale terminale. Ici,
 * rien de tel : un agrégat est une valeur DÉRIVÉE, entièrement recalculable, et chaque nouvelle
 * notation la recalcule depuis la source de vérité. Le seul désordre possible est une inversion
 * d'écriture entre deux invocations concurrentes portant sur la même cible (les notations d'une
 * même cible ont des clés de partition différentes -- `missionID` -- donc peuvent tomber dans des
 * shards différents, traités en parallèle) : la valeur écrite en dernier peut alors être d'un
 * enregistrement plus ancien, et l'agrégat afficher un avis de retard jusqu'à la notation
 * suivante. Conséquence assumée et auto-réparatrice.
 * Alternative envisagée puis ÉCARTÉE : une condition de monotonie
 * (`attribute_not_exists(ratingCountAsClinic) OR ratingCountAsClinic <= :count`). Elle fermerait
 * ce désordre, au prix d'un chemin d'échec conditionnel de plus à distinguer d'une vraie erreur
 * -- disproportionné pour une valeur d'affichage au volume d'un pilote. À reconsidérer si les
 * agrégats servent un jour à autre chose qu'à de l'affichage (ex. exclusion automatique).
 *
 * @returns `true` si la ligne existait et a été mise à jour, `false` si la cible n'existe pas
 *   (voir l'en-tête : anomalie de donnée, jamais un échec).
 */
async function updateTargetAggregate(
  tableName: string,
  target: RatingAggregationTarget,
  aggregate: RatingAggregate,
  nowIso: string,
): Promise<boolean> {
  const [averageField, countField] =
    target.targetRole === CLINIC_ROLE
      ? ['averageRatingAsClinic', 'ratingCountAsClinic']
      : ['averageRatingAsOwner', 'ratingCountAsOwner']

  try {
    await documentClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { id: target.targetID },
        UpdateExpression: 'SET #average = :average, #count = :count, #updatedAt = :now',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeNames: {
          '#average': averageField,
          '#count': countField,
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':average': aggregate.average,
          ':count': aggregate.count,
          ':now': nowIso,
        },
      }),
    )
    return true
  } catch (error) {
    if (isConditionalCheckFailed(error)) return false
    throw error
  }
}

/**
 * Signalement d'une clinique à la modération admin : `needsAdminReview`/`needsAdminReviewSince`/
 * `accountStatus = UNDER_REVIEW`, en UNE écriture conditionnelle.
 *
 * `attribute_not_exists(needsAdminReview) OR #needsAdminReview = :false` (plutôt qu'un GetItem
 * préalable, l'autre option du plan) : la condition est évaluée par DynamoDB AU MOMENT de
 * l'écriture, donc `needsAdminReviewSince` porte la date du PREMIER franchissement du seuil et
 * n'est jamais réécrite par les notes suivantes -- y compris si deux invocations concurrentes
 * franchissent le seuil en même temps, ce qu'un couple lire-puis-écrire ne garantirait pas. Une
 * écriture par note, sans cette condition, ferait glisser la date en permanence et rendrait le
 * champ inutilisable pour la modération ("depuis quand cette clinique est-elle en revue ?").
 *
 * Aucun chemin ne remet ces champs à `false`/`ACTIVE` : la sortie de revue est une décision
 * ADMIN (interface non construite ici, comme pour les Missions `DISPUTED`). Un effacement
 * automatique dès que la moyenne remonte supprimerait la trace même que la modération doit
 * examiner -- voir `exceedsModerationThreshold` (module pur) et ADR-0017 §4.
 *
 * @returns `true` si la clinique vient d'être signalée, `false` si elle l'était déjà (ou si la
 *   ligne n'existe pas -- les deux se traduisent par la même condition non satisfaite, et
 *   appellent la même absence d'action : le cas "ligne absente" a de toute façon déjà été détecté
 *   et logué par `updateTargetAggregate`, qui s'exécute avant).
 */
async function flagClinicForAdminReview(
  tableName: string,
  clinicId: string,
  nowIso: string,
): Promise<boolean> {
  try {
    await documentClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { id: clinicId },
        UpdateExpression:
          'SET #needsAdminReview = :true, #needsAdminReviewSince = :now, #accountStatus = :underReview, #updatedAt = :now',
        ConditionExpression:
          'attribute_exists(id) AND (attribute_not_exists(#needsAdminReview) OR #needsAdminReview = :false)',
        ExpressionAttributeNames: {
          '#needsAdminReview': 'needsAdminReview',
          '#needsAdminReviewSince': 'needsAdminReviewSince',
          '#accountStatus': 'accountStatus',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':true': true,
          ':false': false,
          ':underReview': UNDER_REVIEW,
          ':now': nowIso,
        },
      }),
    )
    return true
  } catch (error) {
    if (isConditionalCheckFailed(error)) return false
    throw error
  }
}

/**
 * `instanceof` ET repli sur `name` -- reprise à l'identique de l'étape 2/5 (voir
 * `mission-validation-auto-finalizer/handler.ts`) : l'exception modélisée n'est la MÊME classe
 * que si le bundle ne contient qu'une seule copie de `@aws-sdk/client-dynamodb`. Un futur
 * `npm install` qui hoisterait autrement ferait silencieusement échouer le seul `instanceof`, et
 * une condition non satisfaite (cas NORMAL ici : clinique déjà signalée) serait comptée comme une
 * erreur dure -- faisant échouer l'invocation, donc rejouer le lot, en boucle.
 */
function isConditionalCheckFailed(error: unknown): boolean {
  return (
    error instanceof ConditionalCheckFailedException ||
    (error as { name?: string } | null)?.name === 'ConditionalCheckFailedException'
  )
}

/**
 * Type de retour `RatingAggregationSummary` plutôt que le `DynamoDBStreamHandler` de
 * `@types/aws-lambda` (qui impose `DynamoDBBatchResponse | void`) : ce résumé est ignoré par
 * Lambda pour une source de flux SANS `reportBatchItemFailures` (non activé, voir
 * `amplify/backend.ts`), et il rend le handler assertable en test comme celui de l'étape 2/5.
 * L'événement, lui, reste typé `DynamoDBStreamEvent` -- c'est le contrat qui compte réellement.
 */
export const handler: Handler<DynamoDBStreamEvent, RatingAggregationSummary> = async (event) => {
  const thresholds: ModerationThresholds = resolveModerationThresholds(process.env)
  const ratingTable = requiredEnv('RATING_TABLE_NAME')
  const ratingTargetIndex = requiredEnv('RATING_TARGET_INDEX_NAME')
  const clinicTable = requiredEnv('CLINIC_TABLE_NAME')
  const ownerTable = requiredEnv('OWNER_TABLE_NAME')

  // Une seule horloge pour toute l'invocation : deux cibles traitées dans le même lot doivent
  // porter le même `updatedAt`, et deux cliniques signalées le même `needsAdminReviewSince`.
  const nowIso = new Date().toISOString()

  const records = event?.Records ?? []
  const { targets, ignored } = collectAggregationTargets(records.map(toSnapshot))

  const summary: RatingAggregationSummary = {
    recordsReceived: records.length,
    targetsAggregated: 0,
    ignoredNonInsert: ignored.nonInsert,
    ignoredInvalid: ignored.invalid,
    ignoredDuplicates: ignored.duplicates,
    clinicsFlaggedForReview: 0,
    missingTargets: 0,
    failures: 0,
  }

  if (ignored.invalid > 0) {
    console.error(
      `${ignored.invalid} enregistrement(s) du flux Rating ignoré(s) : targetID/targetRole absent ou inconnu (aucun agrégat recalculé pour ces lignes).`,
    )
  }

  for (const target of targets) {
    try {
      const stars = await listStarsForTarget(ratingTable, ratingTargetIndex, target)
      const aggregate = computeRatingAggregate(stars)
      const isClinic = target.targetRole === CLINIC_ROLE

      const updated = await updateTargetAggregate(
        isClinic ? clinicTable : ownerTable,
        target,
        aggregate,
        nowIso,
      )

      if (!updated) {
        // Anomalie de donnée, pas une erreur d'exécution (voir l'en-tête) : la cible n'existe
        // pas. Rejouer n'y changerait rien -- on log et on passe à la suivante.
        summary.missingTargets += 1
        console.error(
          `Agrégat de notation non écrit : ${target.targetRole} ${target.targetID} introuvable (Rating pointant vers une cible inexistante).`,
        )
        continue
      }

      summary.targetsAggregated += 1

      // Modération : cliniques UNIQUEMENT (aucune logique de ce type côté Owner, hors périmètre
      // du plan). Gated par la RÉUSSITE de l'écriture d'agrégat ci-dessus -- signaler une
      // clinique dont on n'a pas pu écrire la moyenne afficherait un flag que rien n'explique.
      if (isClinic && exceedsModerationThreshold(aggregate, thresholds)) {
        const flagged = await flagClinicForAdminReview(clinicTable, target.targetID, nowIso)
        if (flagged) {
          summary.clinicsFlaggedForReview += 1
          console.warn(
            `Clinique ${target.targetID} signalée à la modération : moyenne ${aggregate.average} sur ${aggregate.count} avis (seuils ${thresholds.averageThreshold}/${thresholds.minRatingCount}).`,
          )
        }
      }
    } catch (error) {
      summary.failures += 1
      console.error(
        `Erreur agrégation des notations pour ${target.targetRole} ${target.targetID} :`,
        error,
      )
    }
  }

  console.log(`Agrégation des notations : ${JSON.stringify(summary)}`)

  if (summary.failures > 0) {
    // Fail-loud EN FIN d'invocation seulement (toutes les cibles du lot ont été tentées) : le
    // rejeu du lot par l'`EventSourceMapping` est ici la bonne réponse à un échec transitoire,
    // parce que chaque écriture est idempotente (voir l'en-tête). `retryAttempts` est BORNÉ dans
    // `amplify/backend.ts` -- sans quoi une erreur permanente bloquerait le shard jusqu'à
    // expiration des enregistrements (24 h).
    throw new Error(
      `Agrégation des notations terminée avec ${summary.failures} cible(s) en échec -- voir les logs ci-dessus.`,
    )
  }

  return summary
}
