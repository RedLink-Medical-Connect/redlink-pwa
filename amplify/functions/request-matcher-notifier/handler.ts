import type { DynamoDBRecord, DynamoDBStreamEvent, Handler } from 'aws-lambda'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { buildNewCompatibleRequestEmail } from '../custom-message/templates/new-compatible-request-email'
import { writeNotification } from '../shared/write-notification'
import {
  calculateDistance,
  isBloodCompatible,
  isValidatedDonor,
  satisfiesFrequencyRule,
  matchesAvailability,
  matchesAvailabilityWindow,
  type EligibilityAnimal,
  type EligibilityAvailability,
} from '../shared/eligibility'

/**
 * Handler de la Lambda `request-matcher-notifier` -- voir `resource.ts` pour la vue d'ensemble.
 *
 * ÉTAPES (par `Request` en `INSERT`) :
 * 1. `GetItem` `Clinic` (lat/lng/name).
 * 2. `Scan` `Animal` filtré `species = requiredSpecies AND isValidatedDonor = true AND
 *    validationExpiresAt > now` (pré-filtre serveur, `bloodGroup` PAS filtré ici -- voir plus
 *    bas) -- même discipline "Scan filtré, volume négligeable pour ce pilote" que
 *    `upsertClinicOwnerRelation`/`mission-validation-auto-finalizer`.
 * 3. Par Animal survivant : `isBloodCompatible`/`isValidatedDonor`/`satisfiesFrequencyRule`
 *    RE-VÉRIFIÉS EN JS (défense en profondeur -- le filtre DynamoDB peut être relâché sans que
 *    la logique métier suive, même discipline que `rating-aggregation`). `bloodGroup` n'est PAS
 *    filtré côté DynamoDB : `isBloodCompatible('UNKNOWN', ...)` accepte N'IMPORTE QUEL groupe
 *    d'Animal connu -- un filtre DynamoDB statique sur `bloodGroup = :requiredBloodGroup`
 *    exclurait à tort tous les Animals quand la Clinic n'exige aucun groupe précis. Autant
 *    réutiliser la MÊME fonction `isBloodCompatible` que le reste du produit plutôt que
 *    dupliquer sa logique dans une `FilterExpression`.
 * 4. Déduplique par `ownerID` (plusieurs Animals compatibles d'un même Owner -> une seule
 *    notification).
 * 5. Par Owner candidat : `GetItem` `Owner` (lat/lng/maxTravelDistance/owner/email), distance
 *    (`calculateDistance`). Si `requestType === APPOINTMENT` : `Scan` `OwnerAvailability`
 *    filtré `ownerID`, `matchesAvailability`/`matchesAvailabilityWindow` selon que
 *    `appointmentDatetime` ou la paire `appointmentWindowStart/End` est renseignée (même
 *    dispatch que `useMatchingRequests.js`).
 * 6. Notification personnelle (badge + email) par Owner qui passe toutes les étapes.
 *
 * BEST-EFFORT PAR OWNER (pas seulement par Request) : un échec pour UN Owner (email invalide,
 * throttle...) ne doit jamais empêcher de notifier les AUTRES Owners compatibles de la même
 * Request. `retryAttempts: 0` côté `EventSourceMapping` (`amplify/backend.ts`), jamais
 * fail-loud -- même famille que le reste de ce système.
 */

const sesClient = new SESClient({})
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

interface Tables {
  clinic: string
  animal: string
  owner: string
  ownerAvailability: string
  notification: string
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Variable d'environnement ${name} manquante : elle est injectée par amplify/backend.ts.`,
    )
  }
  return value
}

function readTables(): Tables {
  return {
    clinic: requireEnv('CLINIC_TABLE_NAME'),
    animal: requireEnv('ANIMAL_TABLE_NAME'),
    owner: requireEnv('OWNER_TABLE_NAME'),
    ownerAvailability: requireEnv('OWNER_AVAILABILITY_TABLE_NAME'),
    notification: requireEnv('NOTIFICATION_TABLE_NAME'),
  }
}

interface RequestSnapshot {
  eventName: string | null
  requestId: string | null
  clinicId: string | null
  requiredSpecies: string | null
  requiredBloodGroup: string | null
  requestType: string | null
  appointmentDatetime: string | null
  appointmentWindowStart: string | null
  appointmentWindowEnd: string | null
}

function toSnapshot(record: DynamoDBRecord): RequestSnapshot {
  const image = record?.dynamodb?.NewImage
  return {
    eventName: record?.eventName ?? null,
    requestId: image?.id?.S ?? null,
    clinicId: image?.clinicID?.S ?? null,
    requiredSpecies: image?.requiredSpecies?.S ?? null,
    requiredBloodGroup: image?.requiredBloodGroup?.S ?? null,
    requestType: image?.requestType?.S ?? null,
    appointmentDatetime: image?.appointmentDatetime?.S ?? null,
    appointmentWindowStart: image?.appointmentWindowStart?.S ?? null,
    appointmentWindowEnd: image?.appointmentWindowEnd?.S ?? null,
  }
}

interface ClinicInfo {
  name: string
  latitude: number | null
  longitude: number | null
}

async function fetchClinic(tableName: string, clinicId: string): Promise<ClinicInfo | null> {
  const { Item } = await documentClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { id: clinicId },
      ProjectionExpression: '#name, latitude, longitude',
      ExpressionAttributeNames: { '#name': 'name' },
    }),
  )
  const name = Item?.name as string | undefined
  if (!name) return null
  return {
    name,
    latitude: (Item?.latitude as number | undefined) ?? null,
    longitude: (Item?.longitude as number | undefined) ?? null,
  }
}

interface CandidateAnimal extends EligibilityAnimal {
  id: string
  ownerID: string
}

/**
 * Candidats bruts : `species` égal + `isValidatedDonor = true` + `validationExpiresAt` future
 * -- voir l'en-tête du fichier pour pourquoi `bloodGroup` n'est PAS filtré ici.
 */
async function scanCandidateAnimals(
  tableName: string,
  requiredSpecies: string,
  nowIso: string,
): Promise<CandidateAnimal[]> {
  const animals: CandidateAnimal[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined

  do {
    const page = await documentClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression:
          'species = :species AND isValidatedDonor = :true AND validationExpiresAt > :now',
        ProjectionExpression:
          'id, ownerID, species, bloodGroup, isValidatedDonor, validationExpiresAt, lastDonationDate, donationFrequency',
        ExpressionAttributeValues: { ':species': requiredSpecies, ':true': true, ':now': nowIso },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    )
    animals.push(...((page.Items ?? []) as CandidateAnimal[]))
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)

  return animals
}

interface OwnerCandidate {
  owner: string
  email: string
  latitude: number | null
  longitude: number | null
  maxTravelDistance: number | null
}

async function fetchOwner(tableName: string, ownerId: string): Promise<OwnerCandidate | null> {
  const { Item } = await documentClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { id: ownerId },
      ProjectionExpression: '#owner, email, latitude, longitude, maxTravelDistance',
      ExpressionAttributeNames: { '#owner': 'owner' },
    }),
  )
  const owner = Item?.owner as string | undefined
  const email = Item?.email as string | undefined
  if (!owner || !email) return null
  return {
    owner,
    email,
    latitude: (Item?.latitude as number | undefined) ?? null,
    longitude: (Item?.longitude as number | undefined) ?? null,
    maxTravelDistance: (Item?.maxTravelDistance as number | undefined) ?? null,
  }
}

async function scanOwnerAvailabilities(
  tableName: string,
  ownerId: string,
): Promise<EligibilityAvailability[]> {
  const availabilities: EligibilityAvailability[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined

  do {
    const page = await documentClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'ownerID = :ownerID',
        ProjectionExpression: 'dayOfWeek, startTime, endTime',
        ExpressionAttributeValues: { ':ownerID': ownerId },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    )
    availabilities.push(...((page.Items ?? []) as EligibilityAvailability[]))
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)

  return availabilities
}

async function notifyOwnerOfCompatibleRequest(
  ownerId: string,
  snapshot: RequestSnapshot,
  clinic: ClinicInfo,
  tables: Tables,
): Promise<void> {
  const owner = await fetchOwner(tables.owner, ownerId)
  if (!owner) {
    console.error(`request-matcher-notifier: Owner ${ownerId} introuvable/incomplet, ignoré`)
    return
  }

  const distanceKM = calculateDistance(owner.latitude, owner.longitude, clinic.latitude, clinic.longitude)
  if (owner.maxTravelDistance == null || distanceKM > owner.maxTravelDistance) return

  if (snapshot.requestType === 'APPOINTMENT') {
    const availabilities = await scanOwnerAvailabilities(tables.ownerAvailability, ownerId)
    const isWindowMode = snapshot.appointmentWindowStart && snapshot.appointmentWindowEnd
    const matches = isWindowMode
      ? matchesAvailabilityWindow(
          availabilities,
          snapshot.appointmentWindowStart,
          snapshot.appointmentWindowEnd,
        )
      : matchesAvailability(availabilities, snapshot.appointmentDatetime)
    if (!matches) return
  }

  try {
    await writeNotification(documentClient, tables.notification, {
      recipientID: owner.owner,
      type: 'NEW_COMPATIBLE_REQUEST',
      titleKey: 'notifications.types.NEW_COMPATIBLE_REQUEST.title',
      data: { clinicName: clinic.name },
      link: '/dashboard/board',
    })
  } catch (err) {
    console.error('request-matcher-notifier: échec écriture badge NEW_COMPATIBLE_REQUEST', err, ownerId)
  }

  try {
    const { subject, html } = buildNewCompatibleRequestEmail({
      clinicName: clinic.name,
      requiredSpecies: snapshot.requiredSpecies ?? '',
      requiredBloodGroup: snapshot.requiredBloodGroup ?? '',
    })
    const senderEmail = requireEnv('SES_SENDER_EMAIL')

    await sesClient.send(
      new SendEmailCommand({
        Source: senderEmail,
        Destination: { ToAddresses: [owner.email] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Html: { Data: html, Charset: 'UTF-8' } },
        },
      }),
    )
  } catch (err) {
    console.error('request-matcher-notifier: échec envoi email NEW_COMPATIBLE_REQUEST', err, ownerId)
  }
}

async function processNewRequest(snapshot: RequestSnapshot, tables: Tables): Promise<void> {
  if (!snapshot.requestId || !snapshot.clinicId || !snapshot.requiredSpecies) {
    console.error('request-matcher-notifier: Request INSERT incomplète, ignorée', snapshot)
    return
  }

  const clinic = await fetchClinic(tables.clinic, snapshot.clinicId)
  if (!clinic) {
    console.error(`request-matcher-notifier: Clinic ${snapshot.clinicId} introuvable, ignorée`)
    return
  }

  const nowIso = new Date().toISOString()
  const candidates = await scanCandidateAnimals(tables.animal, snapshot.requiredSpecies, nowIso)

  const eligibleOwnerIds = new Set<string>()
  for (const animal of candidates) {
    if (!animal.ownerID) continue
    if (!isBloodCompatible(snapshot.requiredSpecies, snapshot.requiredBloodGroup, animal.species, animal.bloodGroup)) {
      continue
    }
    if (!isValidatedDonor(animal)) continue
    if (!satisfiesFrequencyRule(animal)) continue
    eligibleOwnerIds.add(animal.ownerID)
  }

  for (const ownerId of eligibleOwnerIds) {
    await notifyOwnerOfCompatibleRequest(ownerId, snapshot, clinic, tables)
  }
}

export const handler: Handler<DynamoDBStreamEvent> = async (event) => {
  const tables = readTables()

  for (const record of event.Records) {
    const snapshot = toSnapshot(record)
    if (snapshot.eventName !== 'INSERT') continue

    await processNewRequest(snapshot, tables)
  }
}
