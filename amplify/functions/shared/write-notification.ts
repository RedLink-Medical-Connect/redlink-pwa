import { PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

/**
 * Écrit une ligne `Notification` en DIRECT sur DynamoDB (bypass AppSync, `createdAt`/
 * `updatedAt`/`__typename` posés à la main -- CLAUDE.md, même convention que
 * `clinic-routes.ts`/`mission-validation-auto-finalizer`). Extrait le 2026-09-18 de
 * `clinic-verification-notifier/handler.ts` (`notifyAdminBadgeOfPendingClinic`, la toute
 * première écriture de ce genre) : réutilisé désormais par CINQ autres Lambdas -- une
 * duplication réelle et répétée, contrairement aux "3 petites écritures" que
 * `mission-validation-auto-finalizer` documente comme volontairement PAS partagées
 * (runtimes différents, un seul appelant chacune) -- ici c'est le MÊME shape, appelé depuis
 * SIX endroits distincts, exactement le cas où extraire un module partagé réduit un vrai
 * risque de divergence plutôt que d'ajouter une abstraction non demandée.
 *
 * `recipientID`/`recipientGroup` : voir `amplify/data/resource.ts` (modèle `Notification`)
 * pour l'idiome `@auth` complet -- un SEUL des deux doit être renseigné par appel (l'autre
 * `null`), jamais les deux, jamais aucun (une ligne sans les deux serait une notification
 * fantôme, illisible par personne). Ce module ne valide PAS cette contrainte lui-même : c'est
 * à la charge de chaque appelant, qui connaît son propre mode d'adressage (personnel vs
 * broadcast) -- ajouter une validation ici dupliquerait une connaissance déjà présente au
 * point d'appel sans fermer de trou réel (un appelant qui se trompe se trompe de la même façon
 * qu'il appelle directement `ddb.put()` ou ce helper).
 */
export interface NotificationWriteInput {
  recipientID?: string | null
  recipientGroup?: string | null
  type: string
  titleKey: string
  bodyKey?: string | null
  data?: Record<string, unknown> | null
  link?: string | null
}

export async function writeNotification(
  documentClient: DynamoDBDocumentClient,
  tableName: string,
  notification: NotificationWriteInput,
): Promise<void> {
  const now = new Date().toISOString()

  await documentClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        id: crypto.randomUUID(),
        recipientID: notification.recipientID ?? null,
        recipientGroup: notification.recipientGroup ?? null,
        type: notification.type,
        titleKey: notification.titleKey,
        bodyKey: notification.bodyKey ?? null,
        data: notification.data ?? null,
        link: notification.link ?? null,
        read: false,
        createdAt: now,
        updatedAt: now,
        __typename: 'Notification',
      },
    }),
  )
}
