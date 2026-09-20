import type { DynamoDBRecord, DynamoDBStreamEvent, Handler } from 'aws-lambda'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { buildClinicVerificationNotificationEmail } from '../custom-message/templates/clinic-verification-notification-email'
import { writeNotification } from '../shared/write-notification'

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
 * ne PAS inclure les champs du `Veterinarian` référent ici). Ce handler ne fait donc AUCUNE
 * LECTURE DynamoDB, ni sur `Clinic` ni sur `Notification` -- corrigé le 2026-09-17 (revue
 * devsecops-aws, système de notifications) : cette section décrivait encore "pas de policy IAM
 * DynamoDB nécessaire" après l'ajout de `notifyAdminBadgeOfPendingClinic` plus bas (`PutItem`
 * sur `Notification`, policy posée dans `amplify/backend.ts`) -- ce handler a bien BESOIN d'une
 * policy IAM DynamoDB désormais, seulement pas pour une LECTURE.
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
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

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

/**
 * Écrit la notification BADGE (broadcast `recipientGroup: "Admins"`, système de
 * notifications, 2026-09-17) -- voir `amplify/data/resource.ts` (modèle `Notification`) pour
 * l'idiome `@auth` complet (`allow.groupDefinedIn('recipientGroup')`, AUCUN rôle Cognito n'a
 * `create` : cette Lambda, via son identité IAM, est la SEULE voie d'écriture légitime pour ce
 * type de notification).
 *
 * Écriture DIRECTE DynamoDB (`writeNotification`, `../shared/write-notification.ts` -- extrait
 * le 2026-09-18, cette fonction en était l'implémentation d'origine, voir ce module pour le
 * pourquoi de l'extraction), INDÉPENDANTE de l'email (`notifyAdminOfPendingClinic` ci-dessus) :
 * deux appels distincts, deux `try/catch` distincts dans `handler` ci-dessous -- un échec
 * DynamoDB ne doit jamais empêcher l'email (déjà fonctionnel, seul canal historique) et
 * réciproquement, un échec SES (identité non vérifiée, voir `resource.ts`) ne doit jamais
 * empêcher le badge de s'afficher.
 */
async function notifyAdminBadgeOfPendingClinic(snapshot: ClinicInsertSnapshot): Promise<void> {
  if (!snapshot.id || !snapshot.name) {
    console.error('clinic-verification-notifier: enregistrement Clinic incomplet, badge ignoré', snapshot)
    return
  }

  const notificationTableName = requireEnv('NOTIFICATION_TABLE_NAME')

  await writeNotification(documentClient, notificationTableName, {
    recipientGroup: 'Admins',
    type: 'CLINIC_PENDING_VERIFICATION',
    titleKey: 'notifications.types.CLINIC_PENDING_VERIFICATION.title',
    data: { clinicName: snapshot.name },
  })
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

    try {
      await notifyAdminBadgeOfPendingClinic(snapshot)
    } catch (err) {
      // Best-effort, indépendant de l'email (voir en-tête de la fonction ci-dessus).
      console.error('clinic-verification-notifier: échec écriture badge admin', err, snapshot)
    }
  }
}
