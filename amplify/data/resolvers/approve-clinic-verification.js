// Resolver JS AppSync (runtime `APPSYNC_JS`, PAS Node) pour la mutation custom
// `approveClinicVerification` (`amplify/data/resource.ts`).
//
// Vérification d'identité du vétérinaire référent (RPPS + numéro d'ordre) -- plan de
// durcissement sécurité "Différé 1" (2026-09-02/04). Même famille de resolver que
// `link-request-to-mission.js` (mutation custom, un seul `dataSource`, un seul
// `ddb.update()`) -- voir ce fichier pour le détail de la syntaxe `ddb.update()`/`condition`/
// `update`, vérifiée dans les types installés (`@aws-appsync/utils/lib/dynamodb-helpers.d.ts`),
// pas devinée.
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
  return ctx.result
}
