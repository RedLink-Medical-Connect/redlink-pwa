// Resolver AppSync JS (une seule fonction) de la requête custom `listActiveClinics`
// (`amplify/data/resource.ts`) -- annuaire des cliniques VÉRIFIÉES proposé à un Owner dans la
// popup post-inscription "se lier à une clinique" (`src/composables/useClinicLink.js`).
//
// Pourquoi pas `client.models.Clinic.list({ filter: { verificationStatus: { eq: 'ACTIVE' } } })` :
// `Clinic.verificationStatus` n'est lisible que par `Veterinarians`/`Admins`
// (`clinicVerificationStatusFieldAuth`) -- un Owner ne peut ni le lire ni filtrer dessus. Ce
// resolver cible directement la table managée (`dataSource: a.ref('Clinic')`) et BYPASSE donc
// le `@auth` du modèle (même raisonnement qu'ADR-0011) : le filtre est appliqué ICI, côté
// serveur, et la seule garde d'autorisation est celle de la requête elle-même
// (`allow.authenticated()`).
//
// Aucune fuite de champ possible : `response()` reconstruit chaque élément avec `id`/`name`/
// `address` UNIQUEMENT (jamais email/téléphone/RPPS/`owner`/agrégats de notation), quel que
// soit le contenu de l'item DynamoDB -- pas de `projection` DynamoDB (`name` est un mot réservé
// DynamoDB, et la reconstruction explicite suffit à garantir la forme de sortie).
//
// Pagination : un `Scan` DynamoDB applique `limit` AVANT le filtre -- une page peut donc revenir
// avec moins d'éléments que `limit` (voire zéro) ET un `nextToken`. L'appelant boucle tant que
// `nextToken` est non nul (`useClinicLink.fetchClinics()`).
//
// `.js` et non `.ts` : même raison que `link-request-to-mission.js` (fichier `entry` uploadé tel
// quel sur le runtime `APPSYNC_JS`, sans transpilation).
import * as ddb from '@aws-appsync/utils/dynamodb'
import { util } from '@aws-appsync/utils'

export function request(ctx) {
  return ddb.scan({
    limit: 1000,
    nextToken: ctx.args.nextToken || null,
    // 'ACTIVE' en littéral : un resolver AppSync JS n'a pas accès à `src/constants/enums.js`.
    filter: { verificationStatus: { eq: 'ACTIVE' } },
  })
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type)
  }

  const items = (ctx.result.items || []).map((clinic) => ({
    id: clinic.id,
    name: clinic.name,
    address: clinic.address || null,
  }))

  return { items, nextToken: ctx.result.nextToken || null }
}
