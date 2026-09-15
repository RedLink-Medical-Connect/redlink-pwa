import type { DynamoDBRecord, DynamoDBStreamEvent, Handler } from 'aws-lambda'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { buildClinicVerificationNotificationEmail } from '../custom-message/templates/clinic-verification-notification-email'

/**
 * Handler de la Lambda `clinic-verification-notifier`, déclenchée par le flux DynamoDB
 * Streams de la table `Clinic` sur `INSERT` (voir `resource.ts` du même dossier pour le
 * pourquoi/l'identité SES de bootstrap, `amplify/backend.ts` pour le câblage du déclencheur et
 * la policy IAM `ses:SendEmail`, et le plan de durcissement sécurité "Différé 1" pour
 * l'ensemble de la sous-tâche vérification d'identité RPPS/numéro d'ordre).
 *
 * ------------------------------------------------------------------------------------------
 * LECTURE : DIRECTEMENT DEPUIS LE NewImage DU FLUX, AUCUNE REQUÊTE DYNAMODB SUPPLÉMENTAIRE
 * ------------------------------------------------------------------------------------------
 * Contrairement à `rating-aggregation` (qui interroge un GSI pour calculer un agrégat), ce
 * handler n'a besoin d'AUCUNE donnée hors de l'enregistrement `Clinic` qui vient d'être créé
 * -- `name`/`rpps`/`id` suffisent au contenu de l'email (voir
 * `../custom-message/templates/clinic-verification-notification-email.ts` pour la raison de
 * ne PAS inclure les champs du `Veterinarian` référent ici). Ce handler ne fait donc aucun
 * appel DynamoDB, seulement un appel SES -- pas de policy IAM DynamoDB nécessaire pour cette
 * fonction (voir `amplify/backend.ts`).
 *
 * Lecture directe des `AttributeValue` (`NewImage.name.S`), même choix que
 * `rating-aggregation/handler.ts` (`toSnapshot`) : les champs lus sont tous des chaînes,
 * `unmarshall()` (`@aws-sdk/util-dynamodb`) n'apporterait qu'une dépendance de plus.
 *
 * ------------------------------------------------------------------------------------------
 * ÉCHEC : LOGUÉ, JAMAIS FAIL-LOUD -- NOTIFICATION BEST-EFFORT, PAS UNE ÉCRITURE CRITIQUE
 * ------------------------------------------------------------------------------------------
 * Contrairement à `rating-aggregation` (qui DOIT rejouer sur échec -- un agrégat manqué reste
 * faux jusqu'au recalcul suivant), un email de notification manqué n'a aucun effet de bord sur
 * les données : la Clinic reste `PENDING` que l'admin ait été notifié ou non, et
 * `verificationStatus` est visible par tout Admin qui listerait les Clinics directement
 * (aucune interface ne le fait à ce jour, mais rien n'empêche l'admin de vérifier
 * manuellement). Un échec SES (identité non vérifiée avant le premier vrai déploiement,
 * throttling, etc.) ne doit donc pas bloquer indéfiniment le shard du flux `Clinic` -- même
 * famille que "écriture secondaire best-effort" (CLAUDE.md) transposée côté notification :
 * logué (`console.error`), jamais rethrow. `retryAttempts: 0` côté `EventSourceMapping`
 * (`amplify/backend.ts`) pour la même raison : un rejeu n'aiderait pas un échec durable
 * (identité SES non vérifiée), seulement un échec transitoire, et ce dépôt n'a de toute façon
 * aucun outil de suivi d'erreurs (trou d'observabilité déjà documenté, roadmap Phase 5) --
 * un `console.error` est le seul signal disponible, comme ailleurs dans ce repo.
 */

const sesClient = new SESClient({})

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Variable d'environnement ${name} manquante : elle est injectée par amplify/functions/clinic-verification-notifier/resource.ts.`,
    )
  }
  return value
}

interface ClinicInsertSnapshot {
  eventName: string | null
  id: string | null
  name: string | null
  rpps: string | null
}

function toSnapshot(record: DynamoDBRecord): ClinicInsertSnapshot {
  const image = record?.dynamodb?.NewImage
  return {
    eventName: record?.eventName ?? null,
    id: image?.id?.S ?? null,
    name: image?.name?.S ?? null,
    rpps: image?.rpps?.S ?? null,
  }
}

async function notifyAdminOfPendingClinic(snapshot: ClinicInsertSnapshot): Promise<void> {
  if (!snapshot.id || !snapshot.name) {
    console.error('clinic-verification-notifier: enregistrement Clinic incomplet, notification ignorée', snapshot)
    return
  }

  const { subject, html } = buildClinicVerificationNotificationEmail({
    clinicId: snapshot.id,
    clinicName: snapshot.name,
    clinicRpps: snapshot.rpps ?? '(non renseigné)',
  })

  const senderEmail = requireEnv('SES_SENDER_EMAIL')
  const adminEmail = requireEnv('ADMIN_NOTIFICATION_EMAIL')

  await sesClient.send(
    new SendEmailCommand({
      Source: senderEmail,
      Destination: { ToAddresses: [adminEmail] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    }),
  )
}

export const handler: Handler<DynamoDBStreamEvent> = async (event) => {
  for (const record of event.Records) {
    const snapshot = toSnapshot(record)
    if (snapshot.eventName !== 'INSERT') continue

    try {
      await notifyAdminOfPendingClinic(snapshot)
    } catch (err) {
      // Best-effort (voir en-tête) : logué, jamais rethrow -- ne bloque jamais le shard.
      console.error('clinic-verification-notifier: échec envoi email admin', err, snapshot)
    }
  }
}
