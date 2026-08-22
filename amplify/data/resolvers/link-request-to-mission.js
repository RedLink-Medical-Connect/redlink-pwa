// Resolver JS AppSync (runtime `APPSYNC_JS`, PAS Node) pour la mutation custom
// `linkRequestToMission` (`amplify/data/resource.ts`).
//
// Prérequis Phase 8, lot 3/3 sous-tâche 5 : équivalent Gen2 de la mutation Gen1
// `linkRequestToMission` (`src/graphql/custom-mutations.js`, condition Transformer v1
// auto-générée `condition: { status: { eq: OPEN } }` sur `updateRequest`) -- `defineData`
// Gen2 n'expose PAS d'argument `condition` équivalent sur les mutations générées
// automatiquement (`client.models.Request.update()`), voir `docs/adr/0011`.
//
// .js et non .ts (vérifié, pas supposé) : `resolveEntryPath()`/`convertJsResolverDefinition()`
// (`node_modules/@aws-amplify/backend-data/lib/resolve_entry_path.js`,
// `convert_js_resolvers.js`) uploadent le fichier `entry` tel quel comme asset S3 -- aucune
// étape de transpilation TS->JS dans ce chemin, contrairement à `amplify/functions/**` (Lambda,
// bundlé par esbuild). Le runtime AppSync JS (`APPSYNC_JS` 1.0.0) ne comprend que du JavaScript
// -- un fichier `.ts` avec syntaxe de types serait uploadé tel quel et échouerait à l'exécution.
//
// Syntaxe `ddb.update()`/`condition`/`update` vérifiée directement dans les types installés
// (`node_modules/@aws-appsync/utils/lib/dynamodb-helpers.d.ts`, pas devinée par analogie avec
// l'exemple `increment-like.js` de la doc officielle, qui utilise `operation: 'UpdateItem'` bas
// niveau + `util.dynamodb.toMapValues` plutôt que le helper `ddb.update()`) :
// - `condition: { <champ>: { eq: <valeur> } }` -- confirmé.
// - `update: { <champ>: <valeur> }` -- une valeur scalaire brute vaut un SET implicite. Le
//   helper n'a PAS d'opération `set` explicite (seulement `add`/`remove`/`replace`/`increment`/
//   `decrement`/`append`/`prepend`/`updateListItem`, `DynamoDBOperationAdd` etc. dans le même
//   fichier) -- `update: { status: { set: 'IN_PROGRESS' } }` n'existe pas dans cette API et
//   aurait échoué silencieusement/été mal interprété comme un objet imbriqué. Écart avec la
//   suggestion initiale du prérequis, corrigé après lecture des types (pas une supposition).
import * as ddb from '@aws-appsync/utils/dynamodb'
import { util } from '@aws-appsync/utils'

export function request(ctx) {
  const { id, activeMissionID } = ctx.args
  return ddb.update({
    key: { id },
    // Reproduit exactement la condition Transformer v1 de linkRequestToMission (Gen1) :
    // échoue (ConditionalCheckFailedException) si un autre Owner a déjà accepté la Request
    // entre-temps (ADR-0001). RequestStatus.OPEN/IN_PROGRESS en littéral -- comme le Gen1
    // (`src/graphql/custom-mutations.js`), un resolver AppSync JS n'a pas accès à
    // `src/constants/enums.js` (bundle frontend, pas backend).
    condition: { status: { eq: 'OPEN' } },
    update: {
      status: 'IN_PROGRESS',
      activeMissionID,
    },
  })
}

export function response(ctx) {
  // Propage l'erreur DynamoDB telle quelle (y compris ConditionalCheckFailedException) jusqu'au
  // client -- c'est ce signal que useOwnerMissions.js devra détecter dans la sous-tâche suivante
  // (lot 3/3), exactement comme le Gen1 `updateRequest` avec `condition` le fait déjà via
  // `generateClient().graphql()` qui rejette sur une réponse GraphQL contenant `errors`.
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type, ctx.result)
  }
  return ctx.result
}
