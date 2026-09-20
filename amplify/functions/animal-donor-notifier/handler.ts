import type { DynamoDBRecord, DynamoDBStreamEvent, Handler } from 'aws-lambda'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { buildAnimalValidatedEmail } from '../custom-message/templates/animal-validated-email'
import { writeNotification } from '../shared/write-notification'

/**
 * Handler de la Lambda `animal-donor-notifier`, déclenchée par le flux DynamoDB Streams de la
 * table `Animal` sur `MODIFY` (système de notifications, 2026-09-18) -- voir `resource.ts` du
 * même dossier pour le pourquoi/le risque de livraison SES.
 *
 * FILTRE DE TRANSITION FAIT DANS LE HANDLER (pas seulement au niveau `EventSourceMapping`,
 * `amplify/backend.ts`) -- même discipline "défense en profondeur" que `rating-aggregation` :
 * `NewImage.isValidatedDonor === true && OldImage.isValidatedDonor !== true`. Sans la
 * comparaison à `OldImage`, TOUT `MODIFY` d'un Animal DÉJÀ validé (ex. le vétérinaire corrige
 * `bloodGroup` via `correctCriticalFields`, ou toute autre écriture ultérieure sur cet Animal)
 * redéclencherait la notification -- l'événement qui compte est la TRANSITION vers "validé",
 * une seule fois par validation, pas chaque écriture sur une ligne déjà validée.
 *
 * Lecture directe des `AttributeValue` du flux (`OldImage`/`NewImage`), un seul `GetItem`
 * supplémentaire (`Owner`, pour `owner`/`email`) -- même discipline que
 * `mission-validation-auto-finalizer` (`fetchAnimalOwnerId`), projection réduite au strict
 * nécessaire.
 *
 * BEST-EFFORT, jamais fail-loud : une notification manquée n'a aucun effet de bord sur les
 * données (`Animal.isValidatedDonor` reste `true` que l'Owner ait été notifié ou non) --
 * `retryAttempts: 0` côté `EventSourceMapping` pour la même raison que
 * `clinic-verification-notifier`.
 */

const sesClient = new SESClient({})
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Variable d'environnement ${name} manquante : elle est injectée par amplify/backend.ts.`,
    )
  }
  return value
}

interface AnimalValidationTransition {
  eventName: string | null
  animalId: string | null
  animalName: string | null
  ownerId: string | null
  justValidated: boolean
}

function toTransition(record: DynamoDBRecord): AnimalValidationTransition {
  const oldImage = record?.dynamodb?.OldImage
  const newImage = record?.dynamodb?.NewImage

  const wasValidated = oldImage?.isValidatedDonor?.BOOL === true
  const isValidated = newImage?.isValidatedDonor?.BOOL === true

  return {
    eventName: record?.eventName ?? null,
    animalId: newImage?.id?.S ?? null,
    animalName: newImage?.name?.S ?? null,
    ownerId: newImage?.ownerID?.S ?? null,
    justValidated: isValidated && !wasValidated,
  }
}

/** `Owner.owner` (champ caché `"$sub::$username"`) + `Owner.email` -- projection réduite. */
async function fetchOwnerRecipient(
  tableName: string,
  ownerId: string,
): Promise<{ owner: string; email: string } | null> {
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

async function notifyOwnerOfValidatedDonor(
  transition: AnimalValidationTransition,
  ownerTableName: string,
  notificationTableName: string,
): Promise<void> {
  if (!transition.animalId || !transition.animalName || !transition.ownerId) {
    console.error('animal-donor-notifier: enregistrement Animal incomplet, notification ignorée', transition)
    return
  }

  const recipient = await fetchOwnerRecipient(ownerTableName, transition.ownerId)
  if (!recipient) {
    console.error(
      `animal-donor-notifier: Owner ${transition.ownerId} introuvable ou incomplet (owner/email), notification ignorée`,
    )
    return
  }

  try {
    await writeNotification(documentClient, notificationTableName, {
      recipientID: recipient.owner,
      type: 'ANIMAL_VALIDATED',
      titleKey: 'notifications.types.ANIMAL_VALIDATED.title',
      data: { animalName: transition.animalName },
      link: '/dashboard/animals',
    })
  } catch (err) {
    console.error('animal-donor-notifier: échec écriture badge Owner', err, transition)
  }

  try {
    const { subject, html } = buildAnimalValidatedEmail({ animalName: transition.animalName })
    const senderEmail = requireEnv('SES_SENDER_EMAIL')

    await sesClient.send(
      new SendEmailCommand({
        Source: senderEmail,
        Destination: { ToAddresses: [recipient.email] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Html: { Data: html, Charset: 'UTF-8' } },
        },
      }),
    )
  } catch (err) {
    // Best-effort, voir SES_SENDER_EMAIL vs CLINIC_VERIFICATION_ADMIN_EMAIL — l'échec attendu
    // en mode sandbox SES est documenté dans resource.ts, pas une anomalie de ce handler.
    console.error('animal-donor-notifier: échec envoi email Owner', err, transition)
  }
}

export const handler: Handler<DynamoDBStreamEvent> = async (event) => {
  const ownerTableName = requireEnv('OWNER_TABLE_NAME')
  const notificationTableName = requireEnv('NOTIFICATION_TABLE_NAME')

  for (const record of event.Records) {
    const transition = toTransition(record)
    if (transition.eventName !== 'MODIFY' || !transition.justValidated) continue

    await notifyOwnerOfValidatedDonor(transition, ownerTableName, notificationTableName)
  }
}
