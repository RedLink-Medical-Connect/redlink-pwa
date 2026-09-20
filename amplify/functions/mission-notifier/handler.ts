import type { DynamoDBRecord, DynamoDBStreamEvent, Handler } from 'aws-lambda'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { buildMissionAcceptedEmail } from '../custom-message/templates/mission-accepted-email'
import {
  buildMissionValidationReminderEmail,
  type MissionValidationReminderRecipientRole,
} from '../custom-message/templates/mission-validation-reminder-email'
import { buildMissionDisputedEmail } from '../custom-message/templates/mission-disputed-email'
import { writeNotification } from '../shared/write-notification'

/**
 * Handler de la Lambda `mission-notifier` -- voir `resource.ts` pour la vue d'ensemble des
 * trois événements couverts. `Mission` ne porte PAS `clinicID` (seulement `requestID`) : la
 * résolution `Request.clinicID` (`fetchRequestClinicId`) reprend exactement le pattern déjà
 * établi par `mission-validation-auto-finalizer/handler.ts`.
 *
 * BEST-EFFORT partout, jamais fail-loud : une notification manquée n'a aucun effet de bord sur
 * les données (même famille que `clinic-verification-notifier`/`animal-donor-notifier`).
 * `retryAttempts: 0` côté `EventSourceMapping` (`amplify/backend.ts`).
 */

const sesClient = new SESClient({})
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

interface Tables {
  request: string
  clinic: string
  animal: string
  owner: string
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
    request: requireEnv('REQUEST_TABLE_NAME'),
    clinic: requireEnv('CLINIC_TABLE_NAME'),
    animal: requireEnv('ANIMAL_TABLE_NAME'),
    owner: requireEnv('OWNER_TABLE_NAME'),
    notification: requireEnv('NOTIFICATION_TABLE_NAME'),
  }
}

interface MissionSnapshot {
  eventName: string | null
  missionId: string | null
  requestId: string | null
  animalId: string | null
  status: string | null
  oldStatus: string | null
  ownerValidationOutcome: string | null
  clinicValidationOutcome: string | null
  ownerDisputeReason: string | null
}

function toSnapshot(record: DynamoDBRecord): MissionSnapshot {
  const oldImage = record?.dynamodb?.OldImage
  const newImage = record?.dynamodb?.NewImage
  return {
    eventName: record?.eventName ?? null,
    missionId: newImage?.id?.S ?? null,
    requestId: newImage?.requestID?.S ?? null,
    animalId: newImage?.animalID?.S ?? null,
    status: newImage?.status?.S ?? null,
    oldStatus: oldImage?.status?.S ?? null,
    ownerValidationOutcome: newImage?.ownerValidationOutcome?.S ?? null,
    clinicValidationOutcome: newImage?.clinicValidationOutcome?.S ?? null,
    ownerDisputeReason: newImage?.ownerDisputeReason?.S ?? null,
  }
}

/** `Request.clinicID` -- même pattern que `mission-validation-auto-finalizer/handler.ts`. */
async function fetchRequestClinicId(tableName: string, requestId: string): Promise<string | null> {
  const { Item } = await documentClient.send(
    new GetCommand({ TableName: tableName, Key: { id: requestId }, ProjectionExpression: 'clinicID' }),
  )
  return (Item?.clinicID as string | undefined) ?? null
}

interface ClinicRecipient {
  owner: string
  name: string
  email: string
}

async function fetchClinicRecipient(tableName: string, clinicId: string): Promise<ClinicRecipient | null> {
  const { Item } = await documentClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { id: clinicId },
      ProjectionExpression: '#owner, #name, email',
      ExpressionAttributeNames: { '#owner': 'owner', '#name': 'name' },
    }),
  )
  const owner = Item?.owner as string | undefined
  const name = Item?.name as string | undefined
  const email = Item?.email as string | undefined
  if (!owner || !name || !email) return null
  return { owner, name, email }
}

interface AnimalInfo {
  name: string
  ownerID: string
}

async function fetchAnimal(tableName: string, animalId: string): Promise<AnimalInfo | null> {
  const { Item } = await documentClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { id: animalId },
      ProjectionExpression: '#name, ownerID',
      ExpressionAttributeNames: { '#name': 'name' },
    }),
  )
  const name = Item?.name as string | undefined
  const ownerID = Item?.ownerID as string | undefined
  if (!name || !ownerID) return null
  return { name, ownerID }
}

interface OwnerRecipient {
  owner: string
  email: string
}

async function fetchOwnerRecipient(tableName: string, ownerId: string): Promise<OwnerRecipient | null> {
  const { Item } = await documentClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { id: ownerId },
      ProjectionExpression: '#owner, email',
      ExpressionAttributeNames: { '#owner': 'owner' },
    }),
  )
  const owner = Item?.owner as string | undefined
  const email = Item?.email as string | undefined
  if (!owner || !email) return null
  return { owner, email }
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const senderEmail = requireEnv('SES_SENDER_EMAIL')
  await sesClient.send(
    new SendEmailCommand({
      Source: senderEmail,
      Destination: { ToAddresses: [to] },
      Message: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Html: { Data: html, Charset: 'UTF-8' } } },
    }),
  )
}

/** `INSERT` -- un Owner vient d'accepter une Request : notifie la Clinic. */
async function notifyMissionAccepted(snapshot: MissionSnapshot, tables: Tables): Promise<void> {
  if (!snapshot.requestId || !snapshot.animalId) {
    console.error('mission-notifier: Mission INSERT incomplète, notification ignorée', snapshot)
    return
  }

  const [clinicId, animal] = await Promise.all([
    fetchRequestClinicId(tables.request, snapshot.requestId),
    fetchAnimal(tables.animal, snapshot.animalId),
  ])
  if (!clinicId || !animal) {
    console.error('mission-notifier: clinicID/Animal introuvable pour MISSION_ACCEPTED', snapshot)
    return
  }

  const clinic = await fetchClinicRecipient(tables.clinic, clinicId)
  if (!clinic) {
    console.error(`mission-notifier: Clinic ${clinicId} introuvable/incomplète pour MISSION_ACCEPTED`)
    return
  }

  try {
    await writeNotification(documentClient, tables.notification, {
      recipientID: clinic.owner,
      type: 'MISSION_ACCEPTED',
      titleKey: 'notifications.types.MISSION_ACCEPTED.title',
      data: { animalName: animal.name },
      link: '/dashboard/requests',
    })
  } catch (err) {
    console.error('mission-notifier: échec écriture badge MISSION_ACCEPTED', err, snapshot)
  }

  try {
    const { subject, html } = buildMissionAcceptedEmail({ animalName: animal.name })
    await sendEmail(clinic.email, subject, html)
  } catch (err) {
    console.error('mission-notifier: échec envoi email MISSION_ACCEPTED', err, snapshot)
  }
}

/**
 * `MODIFY`, transition vers `PENDING_VALIDATION` -- relance le côté qui n'a PAS encore voté.
 * Exactement un des deux outcomes est renseigné (invariant write-once-par-côté du resolver
 * `submit-mission-validation-write-side.js`) : celui qui l'EST désigne le côté qui a voté,
 * celui qui NE L'EST PAS désigne le destinataire de la relance.
 */
async function notifyValidationReminder(snapshot: MissionSnapshot, tables: Tables): Promise<void> {
  if (!snapshot.requestId || !snapshot.animalId) {
    console.error('mission-notifier: Mission MODIFY incomplète, relance ignorée', snapshot)
    return
  }

  const missingSide: MissionValidationReminderRecipientRole | null = snapshot.clinicValidationOutcome
    ? snapshot.ownerValidationOutcome
      ? null // les deux sont déjà renseignés -- pas un cas de relance (résidu de donnée, voir ci-dessous)
      : 'OWNER'
    : snapshot.ownerValidationOutcome
      ? 'CLINIC'
      : null // aucun des deux -- pas exploitable, résidu de donnée

  if (!missingSide) {
    console.error(
      'mission-notifier: transition PENDING_VALIDATION avec 0 ou 2 outcomes renseignés (résidu de donnée), relance ignorée',
      snapshot,
    )
    return
  }

  const animal = await fetchAnimal(tables.animal, snapshot.animalId)
  if (!animal) {
    console.error('mission-notifier: Animal introuvable pour MISSION_VALIDATION_REMINDER', snapshot)
    return
  }

  let recipientID: string
  let recipientEmail: string
  let link: string

  if (missingSide === 'CLINIC') {
    const clinicId = await fetchRequestClinicId(tables.request, snapshot.requestId)
    const clinic = clinicId ? await fetchClinicRecipient(tables.clinic, clinicId) : null
    if (!clinic) {
      console.error('mission-notifier: Clinic introuvable pour la relance côté clinique', snapshot)
      return
    }
    recipientID = clinic.owner
    recipientEmail = clinic.email
    link = '/dashboard/requests'
  } else {
    const owner = await fetchOwnerRecipient(tables.owner, animal.ownerID)
    if (!owner) {
      console.error('mission-notifier: Owner introuvable pour la relance côté propriétaire', snapshot)
      return
    }
    recipientID = owner.owner
    recipientEmail = owner.email
    link = '/dashboard/missions'
  }

  try {
    await writeNotification(documentClient, tables.notification, {
      recipientID,
      type: 'MISSION_VALIDATION_REMINDER',
      titleKey: 'notifications.types.MISSION_VALIDATION_REMINDER.title',
      data: { animalName: animal.name },
      link,
    })
  } catch (err) {
    console.error('mission-notifier: échec écriture badge MISSION_VALIDATION_REMINDER', err, snapshot)
  }

  try {
    const { subject, html } = buildMissionValidationReminderEmail({
      animalName: animal.name,
      recipientRole: missingSide,
    })
    await sendEmail(recipientEmail, subject, html)
  } catch (err) {
    console.error('mission-notifier: échec envoi email MISSION_VALIDATION_REMINDER', err, snapshot)
  }
}

/** `MODIFY`, transition vers `DISPUTED` -- broadcast Admins. */
async function notifyMissionDisputed(snapshot: MissionSnapshot, tables: Tables): Promise<void> {
  if (!snapshot.missionId) {
    console.error('mission-notifier: Mission DISPUTED sans id, notification ignorée', snapshot)
    return
  }

  try {
    await writeNotification(documentClient, tables.notification, {
      recipientGroup: 'Admins',
      type: 'MISSION_DISPUTED',
      titleKey: 'notifications.types.MISSION_DISPUTED.title',
      data: { missionId: snapshot.missionId, disputeReason: snapshot.ownerDisputeReason },
    })
  } catch (err) {
    console.error('mission-notifier: échec écriture badge MISSION_DISPUTED', err, snapshot)
  }

  try {
    const { subject, html } = buildMissionDisputedEmail({
      missionId: snapshot.missionId,
      disputeReason: snapshot.ownerDisputeReason,
    })
    const adminEmail = requireEnv('ADMIN_NOTIFICATION_EMAIL')
    await sendEmail(adminEmail, subject, html)
  } catch (err) {
    console.error('mission-notifier: échec envoi email MISSION_DISPUTED', err, snapshot)
  }
}

export const handler: Handler<DynamoDBStreamEvent> = async (event) => {
  const tables = readTables()

  for (const record of event.Records) {
    const snapshot = toSnapshot(record)

    if (snapshot.eventName === 'INSERT') {
      await notifyMissionAccepted(snapshot, tables)
      continue
    }

    if (snapshot.eventName !== 'MODIFY') continue

    if (snapshot.status === 'PENDING_VALIDATION' && snapshot.oldStatus !== 'PENDING_VALIDATION') {
      await notifyValidationReminder(snapshot, tables)
    } else if (snapshot.status === 'DISPUTED' && snapshot.oldStatus !== 'DISPUTED') {
      await notifyMissionDisputed(snapshot, tables)
    }
  }
}
