import type { Handler } from 'aws-lambda'
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import {
  resolveAutoFinalizationOutcome,
  resolveClinicOwnerRelationUpsert,
  resolveTimeoutDays,
  todayAsAWSDate,
} from './resolve-auto-finalization-outcome'

/**
 * Handler de la Lambda planifiée de finalisation automatique des Missions restées en
 * `PENDING_VALIDATION` (voir `resource.ts` du même dossier pour le pourquoi/le planning, et
 * `resolve-auto-finalization-outcome.ts` pour la logique pure -- la seule partie testable de
 * cette Lambda, volontairement séparée de toute I/O).
 *
 * ------------------------------------------------------------------------------------------
 * COMMENT CETTE LAMBDA ACCÈDE AUX DONNÉES : SDK DynamoDB EN DIRECT, PAS LE CLIENT DATA
 * ------------------------------------------------------------------------------------------
 * Point le plus incertain de cette sous-tâche, tranché ICI et à scruter en revue. Vérification
 * faite dans les paquets INSTALLÉS (le MCP `context7` n'était pas disponible dans cette session,
 * et `amplify-docs` n'indexe que Gen1 -- limitation permanente documentée dans CLAUDE.md) :
 *
 * Deux chemins existent en Gen2 pour qu'une Lambda lise/écrive des données gérées par
 * `defineData` avec sa PROPRE identité IAM (jamais un utilisateur Cognito) :
 *
 * 1. Client Data en mode IAM : `allow.resource(maFonction)` sur le schéma/les modèles +
 *    `generateClient<Schema>({ authMode: 'iam' })` dans le handler. Le mécanisme existe bien
 *    dans la version installée (`ruleIsResourceAuth`/`extractFunctionSchemaAccess`,
 *    `node_modules/@aws-amplify/data-schema/dist/esm/SchemaProcessor.mjs`).
 *    ÉCARTÉ, pour deux raisons dirimantes propres à ce schéma :
 *    a. Les mutations GÉNÉRÉES n'exposent AUCUN argument `condition` (c'est le constat fondateur
 *       d'ADR-0011, revérifié pour cette sous-tâche). Or l'écriture de `Mission.status` DOIT
 *       être conditionnée à `status = PENDING_VALIDATION` pour ne pas écraser une finalisation
 *       concurrente arrivée entre le Query et l'écriture (même classe de garde que la fonction
 *       3/3 du resolver `submit-mission-validation-finalize-status.js`). Ce chemin ne sait pas
 *       exprimer cette garde.
 *    b. `Mission.status` et les 5 champs de validation portent des règles `@auth` DE CHAMP qui
 *       REMPLACENT (ne fusionnent pas) la règle de niveau modèle (ADR-0009). Une règle
 *       `allow.resource(...)` posée au niveau schéma/modèle ne s'appliquerait donc PAS à ces
 *       champs : il faudrait ajouter la fonction dans chacun des helpers
 *       `missionStatusFieldAuth`/`missionValidationFieldsReadOnly` -- exactement les garde-fous
 *       que l'étape 1/5 vient de poser (correctifs BLOQUANT/ÉLEVÉ du `graphql-schema-reviewer`)
 *       -- et ré-ouvrir ces champs à une écriture par mutation générée. Beaucoup plus invasif
 *       sur `amplify/data/resource.ts` que ce que cette sous-tâche autorise (ajout du GSI,
 *       strictement additif), pour un résultat moins sûr.
 * 2. SDK DynamoDB directement sur les tables managées, permissions IAM scopées aux ARN exacts
 *    (`amplify/backend.ts`, `addToRolePolicy`). RETENU. C'est le pendant Lambda de ce que font
 *    déjà les resolvers custom de ce schéma (`a.handler.custom({ dataSource: a.ref('Mission') })`
 *    cible lui aussi la table managée en direct et bypasse `@auth` -- ADR-0011 section 3.2) :
 *    la garde d'autorisation n'est plus `@auth` mais la policy IAM, ici volontairement minimale
 *    (une action par usage réel, sur l'ARN exact de chaque table, jamais de wildcard).
 *    `backend.data.resources.tables['<Model>']` est le point d'accès documenté aux tables
 *    managées (`node_modules/@aws-amplify/graphql-api-construct/lib/amplify-graphql-api.js`,
 *    exemple `api.resources.tables["Todo"].tableArn` ; le mapping est construit par
 *    `getGeneratedResources`, clé = nom du modèle).
 *
 * Conséquence ASSUMÉE de ce choix, à connaître avant d'éditer ce fichier : écrire en direct
 * dans la table court-circuite AppSync, donc aucun `createdAt`/`updatedAt`/`__typename`
 * automatique. Ce handler les pose lui-même (voir plus bas) pour que les lignes qu'il écrit
 * soient indiscernables de celles écrites par l'API.
 *
 * ------------------------------------------------------------------------------------------
 * CRITIQUE vs BEST-EFFORT
 * ------------------------------------------------------------------------------------------
 * - CRITIQUE : l'écriture conditionnelle de `Mission.status`. Un échec de la CONDITION n'est PAS
 *   une erreur (la Mission a été finalisée entre-temps par un `submitMissionValidation` réel --
 *   même raisonnement que la fonction 3/3 du resolver : l'autre chemin a écrit un état au moins
 *   aussi frais). Un échec pour toute AUTRE raison est compté et signalé.
 * - BEST-EFFORT : les 3 écritures secondaires reprises de `useMissionClosure.js`
 *   (`Animal.lastDonationDate`, upsert `ClinicOwnerRelation`, incrément des compteurs `Clinic`).
 *   Chacune avale son erreur (log, jamais de rethrow qui interromprait le traitement des
 *   Missions suivantes) -- convention "écriture secondaire best-effort" de CLAUDE.md.
 *   DUPLICATION ASSUMÉE avec le composable (choix du plan d'architecture) : runtimes différents,
 *   aucun module partageable ; l'alternative unifiée (DynamoDB Streams) a été jugée
 *   disproportionnée pour 3 petites écritures. Voir aussi
 *   `resolveClinicOwnerRelationUpsert` dans le module pur voisin (même règle de décision que
 *   `src/services/clinic-owner-relation-service.js`, dupliquée pour la même raison).
 *
 * Toutes les écritures secondaires sont conditionnées à la RÉUSSITE de l'écriture critique de la
 * Mission concernée : une invocation rejouée (retry du planificateur après un échec) ne peut donc
 * jamais double-incrémenter `Clinic.transfusionsDone` ni recréer une `ClinicOwnerRelation`, la
 * condition `status = PENDING_VALIDATION` n'étant satisfaite qu'une seule fois par Mission.
 *
 * Le handler lève en TOUTE FIN d'exécution si au moins une écriture a échoué (après avoir traité
 * toutes les Missions, jamais avant) : ce dépôt n'a aucun outil de suivi d'erreurs (trou
 * d'observabilité connu, roadmap Phase 5) et un `console.error` dans une exécution planifiée
 * nocturne n'est lu par personne -- une invocation en ERREUR, elle, est visible comme métrique
 * Lambda. Même arbitrage fail-loud que `post-confirmation/handler.ts` (Phase 7.3).
 */

const TIME_ZONE = 'Europe/Paris'
const PENDING_VALIDATION = 'PENDING_VALIDATION'

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

type MissionRow = {
  id: string
  status?: string | null
  animalID?: string | null
  requestID?: string | null
  clinicValidationOutcome?: string | null
  clinicValidatedAt?: string | null
  ownerValidationOutcome?: string | null
  ownerValidatedAt?: string | null
}

type AutoFinalizerSummary = {
  pendingValidationScanned: number
  completedAuto: number
  disputed: number
  /** Échéance pas encore atteinte -- le cas normal et massif de chaque exécution. */
  notDueYet: number
  /** Donnée incohérente (voir `AutoFinalizationSkipReason`) : jamais finalisée, toujours loguée. */
  inconsistent: number
  /** Finalisée entre-temps par un vrai `submitMissionValidation` (condition d'écriture non satisfaite). */
  concurrentlyFinalized: number
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
 * Toutes les Missions actuellement en `PENDING_VALIDATION`, via le GSI `Mission.status`
 * (`amplify/data/resource.ts`, `MISSION_STATUS_INDEX_NAME`) -- jamais un Scan de table complète.
 * `ProjectionExpression` explicite (id + les 4 champs de validation + les 2 FK réellement
 * consommés) plutôt que les attributs projetés par défaut : même discipline que le
 * `selectionSet` posé par chaque appelant côté front (CLAUDE.md).
 * Pagination suivie jusqu'au bout : une exécution ne doit pas s'arrêter à la 1re page.
 */
async function listMissionsPendingValidation(
  tableName: string,
  indexName: string,
): Promise<MissionRow[]> {
  const missions: MissionRow[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined

  do {
    const page = await documentClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: '#status = :status',
        ProjectionExpression:
          'id, #status, animalID, requestID, clinicValidationOutcome, clinicValidatedAt, ownerValidationOutcome, ownerValidatedAt',
        // `status` est un mot réservé DynamoDB : alias obligatoire, y compris dans la projection.
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': PENDING_VALIDATION },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    )

    missions.push(...((page.Items ?? []) as MissionRow[]))
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)

  return missions
}

/**
 * Écriture CRITIQUE : `Mission.status`, conditionnée à `status = PENDING_VALIDATION` au moment
 * exact de l'écriture. Sans cette garde, une Mission finalisée par un `submitMissionValidation`
 * réel entre le Query ci-dessus et cette écriture serait écrasée par un statut automatique --
 * une régression PERMANENTE (rien ne la corrige ensuite), exactement la classe de course que la
 * fonction 3/3 du resolver ferme de son côté.
 *
 * N'écrit QUE `status` (et `updatedAt`) : le côté silencieux n'est JAMAIS renseigné comme s'il
 * avait validé. Écrire `clinicValidationOutcome: 'CONFIRMED'` sur un côté qui n'a jamais répondu
 * fabriquerait une trace de validation inexistante (et bloquerait définitivement ce côté, la
 * fonction 1/3 du resolver étant write-once sur `attributeExists: false`). `COMPLETED_AUTO` porte
 * à lui seul l'information "finalisée sans la seconde réponse" -- c'est sa raison d'être.
 *
 * @returns `true` si la Mission a bien été finalisée, `false` si la condition a échoué (Mission
 *   finalisée entre-temps -- cas NORMAL, pas une erreur).
 */
async function finalizeMissionStatus(
  tableName: string,
  missionId: string,
  finalStatus: string,
  nowIso: string,
): Promise<boolean> {
  try {
    await documentClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { id: missionId },
        UpdateExpression: 'SET #status = :finalStatus, #updatedAt = :now',
        ConditionExpression: '#status = :pendingValidation',
        ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
        ExpressionAttributeValues: {
          ':finalStatus': finalStatus,
          ':pendingValidation': PENDING_VALIDATION,
          ':now': nowIso,
        },
      }),
    )
    return true
  } catch (error) {
    // `instanceof` ET repli sur `name` : l'exception modélisée n'est la MÊME classe que si le
    // bundle ne contient qu'une seule copie de `@aws-sdk/client-dynamodb` (vérifié aujourd'hui :
    // `@aws-sdk/lib-dynamodb` n'en imbrique pas de copie, il l'a en peerDependency). Un futur
    // `npm install` qui hoisterait autrement ferait silencieusement échouer le seul `instanceof`
    // -- et une condition non satisfaite (cas NORMAL) serait alors comptée comme une erreur dure,
    // faisant échouer toute l'invocation pour rien.
    if (
      error instanceof ConditionalCheckFailedException ||
      (error as { name?: string } | null)?.name === 'ConditionalCheckFailedException'
    ) {
      return false
    }
    throw error
  }
}

/**
 * Écriture best-effort 1/3 : `Animal.lastDonationDate` à la date du jour (`AWSDate`), ce qui
 * réarme la Frequency Rule (CONTEXT.md) -- même effet que la clôture `COMPLETED` côté
 * `useMissionClosure.js`. `attribute_exists(id)` : sans cette condition, un `UpdateItem` sur un
 * `animalID` inexistant CRÉERAIT un Animal partiel (upsert implicite de DynamoDB) -- même piège
 * que celui documenté dans `submit-mission-validation-write-side.js`.
 */
async function updateAnimalLastDonationDate(
  tableName: string,
  animalId: string,
  today: string,
  nowIso: string,
): Promise<void> {
  await documentClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { id: animalId },
      UpdateExpression: 'SET lastDonationDate = :today, #updatedAt = :now',
      ConditionExpression: 'attribute_exists(id)',
      ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: { ':today': today, ':now': nowIso },
    }),
  )
}

/**
 * Écriture best-effort 2/3 : upsert d'une `ClinicOwnerRelation` (annuaire donneurs de la
 * clinique, `DonorsView.vue`). Scan filtré sur `ownerID` -- équivalent exact de ce que fait
 * `client.models.ClinicOwnerRelation.list({ filter: { ownerID: { eq } } })` côté front (un
 * `list` filtré Amplify EST un Scan + FilterExpression) ; aucun GSI applicatif n'existe sur ce
 * modèle et cette sous-tâche n'en ajoute pas (hors périmètre : le GSI demandé porte sur
 * `Mission.status`). Volume négligeable pour ce pilote.
 *
 * La ligne créée reproduit ce qu'AppSync aurait écrit : `id` généré, `__typename`, `createdAt`/
 * `updatedAt` -- une ligne écrite en direct sans eux serait subtilement différente de toutes les
 * autres (tri par date, cohérence de l'annuaire).
 *
 * @returns `true` si une NOUVELLE relation a été créée (donc un nouveau propriétaire donneur
 *   pour cette clinique), `false` sinon -- même contrat que `upsertClinicOwnerRelation`
 *   (`useMissionClosure.js`), consommé par l'incrément de `donorOwnersCount`.
 */
async function upsertClinicOwnerRelation(
  tableName: string,
  clinicId: string,
  ownerId: string,
  nowIso: string,
): Promise<boolean> {
  const existingRelations: Array<{ clinicID?: string | null }> = []
  let exclusiveStartKey: Record<string, unknown> | undefined

  do {
    const page = await documentClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'ownerID = :ownerID',
        ProjectionExpression: 'clinicID',
        ExpressionAttributeValues: { ':ownerID': ownerId },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    )
    existingRelations.push(...((page.Items ?? []) as Array<{ clinicID?: string | null }>))
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)

  const toCreate = resolveClinicOwnerRelationUpsert(existingRelations, clinicId)
  if (!toCreate) return false

  await documentClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        id: crypto.randomUUID(),
        clinicID: toCreate.clinicID,
        ownerID: ownerId,
        isPrimaryClinic: toCreate.isPrimaryClinic,
        __typename: 'ClinicOwnerRelation',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    }),
  )
  return true
}

/**
 * Écriture best-effort 3/3 : indicateurs du tableau de bord vétérinaire (CdC §2.4) --
 * `transfusionsDone` toujours, `donorOwnersCount` seulement si la relation vient d'être créée.
 *
 * ÉCART DE MÉCANISME (pas d'effet) assumé par rapport à `incrementClinicStats`
 * (`useMissionClosure.js`), à signaler en revue : le composable fait une lecture PUIS une
 * écriture et documente lui-même la course qui en découle ("deux Missions closes à quelques
 * instants d'écart peuvent perdre un incrément... un vrai incrément atomique demanderait un
 * resolver dédié, hors périmètre"). Ici l'incrément atomique DynamoDB est disponible sans
 * infrastructure supplémentaire, puisqu'on écrit déjà en direct dans la table : le résultat
 * observable est identique (+1 / +1 conditionnel), sans la course ni le GetItem préalable.
 * `if_not_exists(..., :zero)` reproduit le `?? 0` du composable (compteurs initialisés à 0 à
 * l'inscription, mais un `null` reste possible sur une donnée ancienne).
 * `attribute_exists(id)` : même protection anti-upsert que pour l'Animal ci-dessus.
 */
async function incrementClinicStats(
  tableName: string,
  clinicId: string,
  isNewDonorOwner: boolean,
  nowIso: string,
): Promise<void> {
  await documentClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { id: clinicId },
      UpdateExpression:
        'SET transfusionsDone = if_not_exists(transfusionsDone, :zero) + :one, donorOwnersCount = if_not_exists(donorOwnersCount, :zero) + :donorIncrement, #updatedAt = :now',
      ConditionExpression: 'attribute_exists(id)',
      ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':donorIncrement': isNewDonorOwner ? 1 : 0,
        ':now': nowIso,
      },
    }),
  )
}

/** `Animal.ownerID` (le propriétaire du donneur) -- projection limitée au seul champ consommé. */
async function fetchAnimalOwnerId(tableName: string, animalId: string): Promise<string | null> {
  const { Item } = await documentClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { id: animalId },
      ProjectionExpression: 'ownerID',
    }),
  )
  return (Item?.ownerID as string | undefined) ?? null
}

/**
 * `Request.clinicID` (la clinique émettrice) -- projection limitée au seul champ consommé.
 * Lecture ABSENTE du périmètre initial de cette sous-tâche (qui ne citait que Mission/Animal/
 * ClinicOwnerRelation/Clinic), signalée comme telle en rapport : `Mission` ne porte PAS de
 * `clinicID`, seulement `requestID`. Côté front, `RequestsView.vue` passe le `clinicID` déjà
 * chargé à `closeMission()` ; ici, personne ne le fournit -- il faut le résoudre. D'où une 5e
 * table dans la policy IAM, en LECTURE SEULE sur ce seul champ.
 */
async function fetchRequestClinicId(tableName: string, requestId: string): Promise<string | null> {
  const { Item } = await documentClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { id: requestId },
      ProjectionExpression: 'clinicID',
    }),
  )
  return (Item?.clinicID as string | undefined) ?? null
}

/**
 * Les 3 écritures secondaires d'une Mission passée en `COMPLETED_AUTO` -- JAMAIS appelée pour
 * `DISPUTED` : un litige n'est pas un don réalisé (ni `lastDonationDate`, ni annuaire, ni
 * compteurs), exactement comme `NO_SHOW` ne déclenche rien côté `useMissionClosure.js`.
 * N'échoue jamais : chaque étape avale son erreur et l'enchaînement continue au mieux.
 *
 * @returns le nombre d'écritures secondaires en échec (pour le résumé/la visibilité).
 */
async function applyCompletedAutoSideEffects(
  mission: MissionRow,
  tables: {
    animal: string
    request: string
    clinicOwnerRelation: string
    clinic: string
  },
  now: Date,
): Promise<number> {
  const nowIso = now.toISOString()
  const today = todayAsAWSDate(now, TIME_ZONE)
  let failures = 0

  let ownerId: string | null = null
  if (mission.animalID) {
    // Deux `try` distincts (écriture puis lecture) plutôt qu'un seul : ce sont deux échecs
    // différents, avec deux conséquences différentes (Frequency Rule non réarmée d'un côté,
    // annuaire/compteurs non écrits de l'autre) -- un message commun rendrait le log trompeur.
    try {
      await updateAnimalLastDonationDate(tables.animal, mission.animalID, today, nowIso)
    } catch (error) {
      failures += 1
      console.error(
        `Erreur mise à jour de la date de dernier don (Animal ${mission.animalID}, Mission ${mission.id}) :`,
        error,
      )
    }

    try {
      ownerId = await fetchAnimalOwnerId(tables.animal, mission.animalID)
    } catch (error) {
      failures += 1
      console.error(
        `Erreur lecture du propriétaire de l'animal donneur (Animal ${mission.animalID}, Mission ${mission.id}) :`,
        error,
      )
    }
  } else {
    console.error(`Mission ${mission.id} sans animalID : date de dernier don non mise à jour.`)
  }

  let clinicId: string | null = null
  if (mission.requestID) {
    try {
      clinicId = await fetchRequestClinicId(tables.request, mission.requestID)
    } catch (error) {
      failures += 1
      console.error(
        `Erreur lecture de la clinique émettrice (Request ${mission.requestID}, Mission ${mission.id}) :`,
        error,
      )
    }
  }

  if (!clinicId || !ownerId) {
    // Même repli que `upsertClinicOwnerRelation` côté front (no-op + log si un id manque) : sans
    // les deux identifiants, ni l'annuaire ni les compteurs ne peuvent être écrits correctement.
    console.error(
      `Liaison clinique/propriétaire et compteurs ignorés pour la Mission ${mission.id} : clinicID ou ownerID manquant.`,
    )
    return failures
  }

  let isNewDonorOwner = false
  try {
    isNewDonorOwner = await upsertClinicOwnerRelation(
      tables.clinicOwnerRelation,
      clinicId,
      ownerId,
      nowIso,
    )
  } catch (error) {
    failures += 1
    console.error(
      `Erreur liaison clinique/propriétaire (ClinicOwnerRelation, Mission ${mission.id}) :`,
      error,
    )
  }

  try {
    await incrementClinicStats(tables.clinic, clinicId, isNewDonorOwner, nowIso)
  } catch (error) {
    failures += 1
    console.error(
      `Erreur incrément des indicateurs clinique (transfusionsDone/donorOwnersCount, Clinic ${clinicId}, Mission ${mission.id}) :`,
      error,
    )
  }

  return failures
}

export const handler: Handler<unknown, AutoFinalizerSummary> = async () => {
  const timeoutDays = resolveTimeoutDays(process.env)
  const missionTable = requiredEnv('MISSION_TABLE_NAME')
  const missionStatusIndex = requiredEnv('MISSION_STATUS_INDEX_NAME')
  const tables = {
    animal: requiredEnv('ANIMAL_TABLE_NAME'),
    request: requiredEnv('REQUEST_TABLE_NAME'),
    clinicOwnerRelation: requiredEnv('CLINIC_OWNER_RELATION_TABLE_NAME'),
    clinic: requiredEnv('CLINIC_TABLE_NAME'),
  }

  // Une seule horloge pour toute l'invocation : deux Missions traitées dans la même exécution
  // doivent être jugées sur la même échéance et dater du même jour.
  const now = new Date()
  const nowIso = now.toISOString()

  const missions = await listMissionsPendingValidation(missionTable, missionStatusIndex)

  const summary: AutoFinalizerSummary = {
    pendingValidationScanned: missions.length,
    completedAuto: 0,
    disputed: 0,
    notDueYet: 0,
    inconsistent: 0,
    concurrentlyFinalized: 0,
    failures: 0,
  }

  for (const mission of missions) {
    const outcome = resolveAutoFinalizationOutcome(mission, {
      nowMs: now.getTime(),
      timeoutDays,
    })

    if (outcome.kind === 'SKIP') {
      if (outcome.reason === 'DEADLINE_NOT_REACHED') {
        summary.notDueYet += 1
      } else {
        // Anomalie de donnée, jamais une erreur d'exécution : loguée pour être visible (en
        // particulier `BOTH_SIDES_RESPONDED`, signature du résidu documenté en tête de
        // `submit-mission-validation-write-side.js`) mais ne fait PAS échouer l'invocation --
        // il n'y a rien à réessayer, cette Lambda n'a aucun droit de trancher ces cas.
        summary.inconsistent += 1
        console.error(
          `Mission ${mission.id} en PENDING_VALIDATION non finalisable automatiquement (${outcome.reason}) -- aucune écriture.`,
        )
      }
      continue
    }

    let finalized: boolean
    try {
      finalized = await finalizeMissionStatus(missionTable, mission.id, outcome.finalStatus, nowIso)
    } catch (error) {
      summary.failures += 1
      console.error(
        `Erreur finalisation automatique de la Mission ${mission.id} (statut visé ${outcome.finalStatus}) :`,
        error,
      )
      continue
    }

    if (!finalized) {
      // Condition non satisfaite : la Mission a été finalisée entre-temps par un vrai
      // `submitMissionValidation`. Cas NORMAL, pas une erreur -- voir l'en-tête de ce fichier et
      // `submit-mission-validation-finalize-status.js` (même raisonnement, même traitement).
      summary.concurrentlyFinalized += 1
      continue
    }

    if (outcome.finalStatus === 'COMPLETED_AUTO') {
      summary.completedAuto += 1
      summary.failures += await applyCompletedAutoSideEffects(mission, tables, now)
    } else {
      summary.disputed += 1
    }
  }

  console.log(
    `Finalisation automatique des Missions (délai ${timeoutDays} jours) : ${JSON.stringify(summary)}`,
  )

  if (summary.failures > 0) {
    // Fail-loud EN FIN d'exécution seulement (toutes les Missions ont été traitées) -- voir
    // l'en-tête : sans outil de suivi d'erreurs, une invocation en erreur est le seul signal
    // réellement visible. Rejouer cette invocation est sans danger : toute écriture secondaire
    // est gardée par l'écriture conditionnelle de `Mission.status`, qui ne peut réussir qu'une
    // fois par Mission.
    throw new Error(
      `Finalisation automatique terminée avec ${summary.failures} écriture(s) en échec -- voir les logs ci-dessus.`,
    )
  }

  return summary
}
