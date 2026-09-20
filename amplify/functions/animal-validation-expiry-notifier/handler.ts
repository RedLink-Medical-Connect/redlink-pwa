import type { Handler } from 'aws-lambda'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { buildAnimalValidationExpiredEmail } from '../custom-message/templates/animal-validation-expired-email'
import { writeNotification } from '../shared/write-notification'

/**
 * Handler de la Lambda PLANIFIÉE `animal-validation-expiry-notifier` -- voir `resource.ts` pour
 * le besoin métier et le fuseau/planning.
 *
 * CONDITION DE SÉLECTION/ÉCRITURE -- comparaison de DEUX ATTRIBUTS DU MÊME ITEM (pas une
 * simple présence/absence) : `Animal.donorValidationExpiryNotifiedAt` (`amplify/data/
 * resource.ts`, voir son commentaire dédié) doit être absent OU strictement ANTÉRIEUR à
 * `validationExpiresAt` COURANT -- sans quoi un Animal REVALIDÉ après une première expiration
 * (validité 1 an, renouvelable) ne serait plus jamais notifié à sa prochaine expiration. Syntaxe
 * DynamoDB standard : une `FilterExpression`/`ConditionExpression` peut comparer deux chemins
 * d'attributs directement (`attrA < attrB`), pas seulement un attribut à une valeur littérale.
 *
 * BEST-EFFORT PAR ANIMAL, JAMAIS FAIL-LOUD -- contrairement à `mission-validation-auto-
 * finalizer` (dont un échec DOIT rejouer, une Mission bloquée a un vrai coût métier) : une
 * notification d'expiration manquée n'a AUCUN effet de bord sur les données (l'expiration
 * elle-même reste un état virtuel calculé côté front, jamais écrit ici). Même famille que le
 * reste de ce système de notifications (`clinic-verification-notifier` et suivants) : logué,
 * jamais rethrow.
 *
 * `UpdateItem` (marquage `donorValidationExpiryNotifiedAt`) APRÈS la notification, pas avant :
 * si la notification échoue (best-effort, voir ci-dessus), on retente quand même à la PROCHAINE
 * exécution planifiée plutôt que de marquer un Animal comme notifié sans l'avoir réellement été
 * -- ordre délibéré, à l'inverse d'un marquage optimiste qui masquerait un échec de livraison.
 */

const sesClient = new SESClient({})
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

export type AnimalValidationExpiryNotifierSummary = {
  candidatesScanned: number
  notified: number
  skippedIncomplete: number
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

interface ExpiredAnimal {
  id: string
  name?: string
  ownerID?: string
  validationExpiresAt: string
}

/**
 * Animals dont la validation est expirée (`validationExpiresAt <= now`) et jamais notifiés
 * POUR CE CYCLE (voir l'en-tête de fichier pour la comparaison à deux attributs).
 */
async function scanExpiredUnnotifiedAnimals(tableName: string, nowIso: string): Promise<ExpiredAnimal[]> {
  const animals: ExpiredAnimal[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined

  do {
    const page = await documentClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression:
          'isValidatedDonor = :true AND validationExpiresAt <= :now AND (attribute_not_exists(donorValidationExpiryNotifiedAt) OR donorValidationExpiryNotifiedAt < validationExpiresAt)',
        ProjectionExpression: 'id, #name, ownerID, validationExpiresAt',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: { ':true': true, ':now': nowIso },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    )
    animals.push(...((page.Items ?? []) as ExpiredAnimal[]))
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)

  return animals
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

/**
 * Marque l'Animal comme notifié POUR CE CYCLE -- conditionné (anti-race avec une autre
 * invocation concurrente/un rejeu) à la MÊME comparaison que le Scan : la condition n'est
 * PLUS satisfaite si un autre appel a déjà marqué cet Animal pour ce même cycle entre-temps.
 */
async function markAnimalNotified(
  tableName: string,
  animalId: string,
  nowIso: string,
): Promise<void> {
  await documentClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { id: animalId },
      UpdateExpression: 'SET donorValidationExpiryNotifiedAt = :now, #updatedAt = :now',
      ConditionExpression:
        'attribute_exists(id) AND (attribute_not_exists(donorValidationExpiryNotifiedAt) OR donorValidationExpiryNotifiedAt < validationExpiresAt)',
      ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: { ':now': nowIso },
    }),
  )
}

/** @returns `true` si une notification a réellement été TENTÉE (Animal/Owner exploitables). */
async function notifyOwnerOfExpiredValidation(
  animal: ExpiredAnimal,
  ownerTableName: string,
  animalTableName: string,
  notificationTableName: string,
  nowIso: string,
): Promise<boolean> {
  if (!animal.name || !animal.ownerID) {
    console.error('animal-validation-expiry-notifier: Animal incomplet, notification ignorée', animal)
    return false
  }

  const recipient = await fetchOwnerRecipient(ownerTableName, animal.ownerID)
  if (!recipient) {
    console.error(
      `animal-validation-expiry-notifier: Owner ${animal.ownerID} introuvable/incomplet, notification ignorée`,
    )
    return false
  }

  try {
    await writeNotification(documentClient, notificationTableName, {
      recipientID: recipient.owner,
      type: 'ANIMAL_VALIDATION_EXPIRED',
      titleKey: 'notifications.types.ANIMAL_VALIDATION_EXPIRED.title',
      data: { animalName: animal.name },
      link: '/dashboard/animals',
    })
  } catch (err) {
    console.error('animal-validation-expiry-notifier: échec écriture badge', err, animal.id)
  }

  try {
    const { subject, html } = buildAnimalValidationExpiredEmail({ animalName: animal.name })
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
    console.error('animal-validation-expiry-notifier: échec envoi email', err, animal.id)
  }

  try {
    await markAnimalNotified(animalTableName, animal.id, nowIso)
  } catch (err) {
    console.error('animal-validation-expiry-notifier: échec marquage donorValidationExpiryNotifiedAt', err, animal.id)
  }

  return true
}

export const handler: Handler<unknown, AnimalValidationExpiryNotifierSummary> = async () => {
  const animalTable = requireEnv('ANIMAL_TABLE_NAME')
  const ownerTable = requireEnv('OWNER_TABLE_NAME')
  const notificationTable = requireEnv('NOTIFICATION_TABLE_NAME')

  const nowIso = new Date().toISOString()
  const animals = await scanExpiredUnnotifiedAnimals(animalTable, nowIso)

  const summary: AnimalValidationExpiryNotifierSummary = {
    candidatesScanned: animals.length,
    notified: 0,
    skippedIncomplete: 0,
  }

  for (const animal of animals) {
    const attempted = await notifyOwnerOfExpiredValidation(
      animal,
      ownerTable,
      animalTable,
      notificationTable,
      nowIso,
    )
    if (attempted) {
      summary.notified += 1
    } else {
      summary.skippedIncomplete += 1
    }
  }

  console.log(`animal-validation-expiry-notifier : ${JSON.stringify(summary)}`)
  return summary
}
