// Fonction 2/2 du pipeline AppSync JS de la mutation custom `approveClinicVerification`
// (`amplify/data/resource.ts`) -- système de notifications, 2026-09-17. Voir l'en-tête de
// `approve-clinic-verification.js` (fonction 1/2) pour le pourquoi du passage en pipeline et le
// contenu du `ctx.stash` qu'elle alimente.
//
// SEULE fonction de ce pipeline dont la source de données n'est pas `Clinic` --
// `dataSource: a.ref('Notification')` (`amplify/data/resource.ts`) : une fonction de pipeline
// AppSync ne peut interroger qu'UNE source de données (même contrainte documentée en tête de
// `submit-mission-validation-verify-owner-party.js`).
//
// `ddb.put({ key: { id: util.autoId() }, item: {...} })` -- syntaxe vérifiée dans les types
// installés (`@aws-appsync/utils/lib/dynamodb-helpers.d.ts`, JSDoc de `put()`), pas devinée :
// première utilisation de `ddb.put()`/`util.autoId()` dans ce dépôt (tous les resolvers
// existants ne font que des `update()`/`get()`, jamais de création). `createdAt`/`updatedAt`/
// `__typename` posés à la main : `ddb.put()` est un générateur de requête DynamoDB brut, pas le
// resolver généré par `a.model()` pour `Notification.create()` (que cette mutation bypasse
// entièrement, comme le reste de ce pipeline bypasse le `@auth` de `Notification`) -- même
// discipline que la convention Lambda "écriture directe DynamoDB" (CLAUDE.md,
// `amplify/functions/bff/clinic-routes.ts` pour l'exemple le plus proche d'une VRAIE création).
//
// NO-OP (`runtime.earlyReturn(ctx.prev.result)`) si `ctx.stash.clinicOwner` est absent : une
// Clinic sans `owner` serait un résidu de données très ancien/anormal (voir le commentaire de
// `Clinic.authorization` -- `allow.owner()` pose ce champ à la création, aucun code applicatif
// ne crée de Clinic sans passer par ce chemin), mais advienne que peut, écrire une
// `Notification` avec `recipientID: null` produirait une ligne qu'AUCUNE règle `@auth`
// (`ownerDefinedIn`/`groupDefinedIn`, toutes deux dynamiques) ne pourrait jamais faire
// correspondre à personne -- notification fantôme, jamais lisible. Mieux vaut ne rien écrire.
import * as ddb from '@aws-appsync/utils/dynamodb'
import { util, runtime } from '@aws-appsync/utils'

export function request(ctx) {
  if (!ctx.stash.clinicOwner) {
    runtime.earlyReturn(ctx.prev.result)
  }

  const now = util.time.nowISO8601()

  return ddb.put({
    key: { id: util.autoId() },
    item: {
      recipientID: ctx.stash.clinicOwner,
      recipientGroup: null,
      type: 'CLINIC_VERIFIED',
      titleKey: 'notifications.types.CLINIC_VERIFIED.title',
      bodyKey: null,
      data: { clinicName: ctx.stash.clinicName || '' },
      link: '/dashboard',
      read: false,
      createdAt: now,
      updatedAt: now,
      __typename: 'Notification',
    },
  })
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type, ctx.result)
  }

  // DERNIÈRE fonction du pipeline : DOIT renvoyer la Clinic de la fonction 1/2 (`.returns(a.ref
  // ('Clinic'))` sur la mutation), jamais `ctx.result` (la `Notification` qu'on vient de créer,
  // mauvais type) -- piège documenté en tête de fichier `resource.ts` pour tout pipeline.
  return ctx.prev.result
}
