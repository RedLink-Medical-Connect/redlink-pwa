// Fonction 1/2 du pipeline AppSync JS de la mutation custom `approveClinicVerification`
// (`amplify/data/resource.ts`).
//
// Vérification d'identité du vétérinaire référent (RPPS + numéro d'ordre) -- plan de
// durcissement sécurité "Différé 1" (2026-09-02/04). Même famille de resolver que
// `link-request-to-mission.js` (un seul `dataSource`, un seul `ddb.update()`) -- voir ce
// fichier pour le détail de la syntaxe `ddb.update()`/`condition`/`update`, vérifiée dans les
// types installés (`@aws-appsync/utils/lib/dynamodb-helpers.d.ts`), pas devinée.
//
// PASSÉ EN PIPELINE le 2026-09-17 (système de notifications, `resource.ts` section 5) : la
// logique d'ÉCRITURE de CETTE fonction ne change pas -- seul `response()` gagne un `ctx.stash`
// pour la fonction 2/2 (`approve-clinic-verification-notify-vet.js`, `dataSource:
// a.ref('Notification')`), qui a besoin de `owner`/`name`/`id` de la Clinic qu'on vient
// d'activer pour écrire sa notification. `ddb.update()` renvoie les attributs de l'item
// APRÈS écriture (comportement par défaut, pas de `returnValues` explicite ici) -- `owner` est
// un attribut DynamoDB ordinaire (champ caché auto-injecté par `allow.owner()` au niveau
// modèle de `Clinic`, jamais un artefact GraphQL calculé à la lecture), donc présent dans
// `ctx.result` au même titre que `name`/`id`.
//
// `.js` et non `.ts` : même raison que `link-request-to-mission.js`
// (`resolveEntryPath()`/`convertJsResolverDefinition()` uploadent le fichier `entry` tel quel,
// sans transpilation -- un `.ts` échouerait à l'exécution sur le runtime `APPSYNC_JS`).
import * as ddb from '@aws-appsync/utils/dynamodb'
import { util } from '@aws-appsync/utils'

export function request(ctx) {
  const { id } = ctx.args
  return ddb.update({
    key: { id },
    // 'PENDING' en littéral, pas `ClinicVerificationStatus.PENDING` -- un resolver AppSync JS
    // n'a pas accès à `src/constants/enums.js` (bundle frontend), même limite que
    // `link-request-to-mission.js` sur `RequestStatus.OPEN`. Échoue
    // (ConditionalCheckFailedException) si la Clinic est déjà `ACTIVE` ou n'existe pas --
    // idempotence : une double approbation (double-clic, retry réseau) ne fait pas planter
    // silencieusement une Clinic déjà active dans un état incohérent.
    condition: { verificationStatus: { eq: 'PENDING' } },
    update: { verificationStatus: 'ACTIVE' },
  })
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type, ctx.result)
  }

  const clinic = ctx.result

  // Rangés pour la fonction 2/2 -- voir son en-tête pour le no-op (`runtime.earlyReturn`) si
  // `clinicOwner` est absent (Clinic sans `owner`, résidu très ancien, pas un cas normal).
  ctx.stash.clinicOwner = clinic && clinic.owner
  ctx.stash.clinicName = clinic && clinic.name
  ctx.stash.clinicId = clinic && clinic.id

  return clinic
}
