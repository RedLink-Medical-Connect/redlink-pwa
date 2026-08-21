---
status: accepted
supersedes: none (voir "Relation avec ADR-0001 et le reste des ADR" ci-dessous)
---

# `defineData` Gen2 : mutation custom + resolver JS pour l'écriture atomique conditionnelle de `linkRequestToMission`

Phase 8, sous-tâche 5, prérequis au lot 3/3 (bascule de `useOwnerMissions.js`) — découvert par
le coordinateur en préparant ce lot, avant tout changement de composable. Cet ADR documente un
changement de **forme** imposé par le framework Gen2, pas une révision de la décision de fond
d'ADR-0001 (toujours valide, jamais rouverte ici).

## 1. Le problème : `defineData` Gen2 n'expose pas de `condition` sur les mutations générées

ADR-0001 documente la garde réelle contre la course concurrente entre deux Owners qui
accepteraient la même Request d'urgence en même temps (CdC §2.3, fan-out de notifications à
plusieurs Owners compatibles, l'envoi s'arrêtant "dès la première réponse positive") :
`linkRequestToMission` (`src/graphql/custom-mutations.js`, Gen1) fait un `updateRequest`
conditionné sur `status: { eq: OPEN }` — un `ConditionExpression` DynamoDB auto-généré par le
Transformer v1 pour chaque mutation `@model` qui déclare un argument `condition`. Si un second
Owner a déjà accepté entre-temps (`status != OPEN`), DynamoDB rejette l'écriture
(`ConditionalCheckFailedException`) — c'est la SEULE garde réelle contre cette course, pas un
détail de robustesse accessoire.

Vérifié pour cette sous-tâche : les mutations générées automatiquement par `defineData` Gen2
(`client.models.Request.update()`) n'exposent **aucun** argument `condition` équivalent —
`node_modules/@aws-amplify/data-schema-types/dist/esm/client/index.d.ts` (les types du client
généré réellement installés dans ce repo) ne contient aucune trace de `condition`/
`ConditionCheck`. Une traduction mécanique naïve du composable (`client.models.Request.update({
id, status, activeMissionID })` sans condition) réintroduirait exactement la fenêtre de course
qu'ADR-0001 existe pour fermer — un vrai bug de correction métier, pas un détail de style, donc
un prérequis bloquant avant de toucher `useOwnerMissions.js` (lot 3/3).

## 2. La solution : mutation custom, resolver JS `ddb.update()`, `dataSource: a.ref('Request')`

Amplify Gen2 documente `a.handler.custom({ dataSource, entry })` pour attacher un resolver JS
AppSync (runtime `APPSYNC_JS`, pas Node) à une query/mutation custom déclarée au niveau du
schéma (`a.schema({ ..., maCustomMutation: a.mutation()... })`, pas dans un `a.model({...})`).
Le JSDoc de `CustomHandlerInput.dataSource`
(`node_modules/@aws-amplify/data-schema/src/Handler.ts`) confirme explicitement que
`dataSource` peut référencer directement la table managée d'un modèle du schéma
(`a.ref('ModelName')`), pas seulement une table externe ajoutée via
`backend.data.addDynamoDbDataSource(...)` — l'exemple officiel de la doc
(`custom-business-logic/index.mdx`, `likePost`/`increment-like.js`) fait exactement ça sur le
modèle `Post`.

`amplify/data/resource.ts` (section 4, fin du schéma) ajoute :

```ts
linkRequestToMission: a
  .mutation()
  .arguments({ id: a.id().required(), activeMissionID: a.id().required() })
  .returns(a.ref('Request'))
  .authorization((allow) => [allow.authenticated()])
  .handler(a.handler.custom({ dataSource: a.ref('Request'), entry: './resolvers/link-request-to-mission.js' })),
```

`amplify/data/resolvers/link-request-to-mission.js` reproduit exactement la condition et les
deux champs écrits par le Gen1 `linkRequestToMission` :

```js
import * as ddb from '@aws-appsync/utils/dynamodb'
import { util } from '@aws-appsync/utils'

export function request(ctx) {
  const { id, activeMissionID } = ctx.args
  return ddb.update({
    key: { id },
    condition: { status: { eq: 'OPEN' } },
    update: { status: 'IN_PROGRESS', activeMissionID },
  })
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type, ctx.result)
  }
  return ctx.result
}
```

Comportement observable identique à Gen1 : même condition (`status = OPEN`), mêmes deux champs
écrits (`status`, `activeMissionID`), même erreur propagée jusqu'au client
(`ConditionalCheckFailedException`, via `util.error()` dans `response(ctx)` — interrompt
l'évaluation et fait apparaître l'erreur dans `errors[]` de la réponse GraphQL, exactement comme
le Gen1 `generateClient().graphql({ query: linkRequestToMission, ... })` rejette déjà aujourd'hui
sur une réponse contenant `errors`). C'est ce signal que `useOwnerMissions.js` devra détecter
dans le lot 3/3 — hors périmètre de ce prérequis, qui ne touche à aucun composable.

## 3. Décisions tranchées pendant cette sous-tâche

### 3.1 `.js`, pas `.ts`, pour le resolver — vérifié, pas supposé

ADR-0007 scope TypeScript à `amplify/**/*.ts` sans distinguer les resolvers JS AppSync des
fichiers de définition backend (`resource.ts`, `backend.ts`). Vérifié spécifiquement pour ce
fichier avant de trancher : `resolveEntryPath()` et `convertJsResolverDefinition()`
(`node_modules/@aws-amplify/backend-data/lib/resolve_entry_path.js` et
`convert_js_resolvers.js`) uploadent le fichier pointé par `entry` **tel quel** comme asset S3
(`new Asset(scope, s3AssetName, { path: resolveEntryPath(handler.entry) })`) — aucune étape de
transpilation TS→JS dans ce chemin, contrairement à `amplify/functions/**` (Lambda, bundlé par
esbuild via `defineFunction`). Le resolver est déployé avec le runtime AppSync
`APPSYNC_JS`/`1.0.0`, qui n'exécute que du JavaScript (un sous-ensemble d'ES2015, pas tout
Node) — un fichier `.ts` avec syntaxe de types serait uploadé tel quel et échouerait à
l'exécution (pas à la compilation : `tsc --noEmit` ne couvre pas ce fichier puisqu'aucun import
TypeScript ne le référence en tant que module typé, seulement comme chemin `entry` en chaîne de
caractères). `.js` est donc la seule forme qui fonctionne réellement, pas un choix de
cohérence stylistique avec le reste de `amplify/`.

### 3.2 Règle d'autorisation : `allow.authenticated()`, sans `.to([...])`

Reproduit le même niveau qu'en Gen1 (`{ allow: private }` = tout utilisateur Cognito
authentifié, peu importe le groupe) — cohérent avec le raisonnement déjà écrit dans
`resource.ts` sur la règle de type `Request` (`allow.authenticated().to(['read', 'update'])`,
commentaire "`update` est requis ici : `linkRequestToMission`... Sans cette règle, l'acceptation
d'une Mission par un Owner échoue au niveau auth").

Point vérifié plutôt que recopié : `.to([...])` n'existe même pas sur le builder d'autorisation
des opérations custom (`AllowModifierForCustomOperation`,
`node_modules/@aws-amplify/data-schema/dist/esm/Authorization.d.ts`) — il n'y a pas d'ensemble
CRUD à restreindre sur une mutation custom (une seule action, pas cinq opérations `@model`).

Point plus sensible, découvert en creusant ce choix (pas dans le brief de départ) : une mutation
custom dont le resolver cible directement la table managée d'un modèle
(`dataSource: a.ref('Request')`) **bypasse entièrement** les règles `@auth` (type ET champ) de
ce modèle — confirmé en lisant `CustomOperation.d.ts` (le paramètre `authorization` d'une
`CustomOperation` utilise `AllowModifierForCustomOperation`, un builder complètement distinct de
celui utilisé par `a.model(...).authorization(...)`). Contrairement au Gen1, où le scoping
champ-par-champ de `Request` (`status`/`activeMissionID` volontairement hors
`.authorization()` de champ, voir le commentaire existant au-dessus de la règle de type) ET la
règle de type `allow.authenticated().to(['read', 'update'])` coopéraient pour n'autoriser QUE
cette écriture précise, ici la seule garde d'autorisation active pour cette opération est celle
posée directement sur `linkRequestToMission`. Ce n'est pas un affaiblissement pratique : les
arguments de la mutation sont `id`/`activeMissionID` uniquement (pas un input générique type
`UpdateRequestInput`), donc le resolver ne peut physiquement écrire que ces deux champs, quel
que soit l'appelant authentifié — le même résultat que le scoping Gen1, obtenu différemment (par
la forme étroite des arguments plutôt que par une combinaison de règles `@auth`). Signalé
explicitement ici pour que le Lead Dev le vérifie : c'est un changement de mécanisme, pas
seulement de syntaxe, même si le comportement observable reste équivalent.

### 3.3 Écart corrigé par rapport à la piste de départ : syntaxe exacte de `ddb.update()`

La syntaxe initialement envisagée pour l'objet `update` (`{ status: { set: 'IN_PROGRESS' } }`)
ne correspond PAS à l'API réelle de `@aws-appsync/utils/dynamodb` — vérifié en lisant
`node_modules/@aws-appsync/utils/lib/dynamodb-helpers.d.ts` (`DynamoDBUpdateObject`,
`DynamoDBOperationAdd`/`Remove`/`Replace`/`Increment`/`Decrement`/`Append`/`Prepend`/
`UpdateListItem` — pas d'opération `set`). Une valeur scalaire brute (`status: 'IN_PROGRESS'`)
EST le SET implicite ; les opérations nommées (`operations.add(...)`, `operations.replace(...)`,
etc., importées depuis le même module) ne servent qu'aux cas qui ne sont pas un simple
remplacement de valeur. Corrigé après lecture des types installés plutôt que deviné par analogie
avec l'exemple `increment-like.js` de la doc officielle (qui utilise une requête bas niveau
`operation: 'UpdateItem'` + `util.dynamodb.toMapValues`, pas le helper `ddb.update()`) — les deux
formes existent dans l'API AppSync JS, mais seule la seconde (`ddb.update()`) offre `condition`
comme option de premier niveau directement documentée dans son type d'entrée
(`DynamoDBUpdateInput.condition`), donc c'est celle utilisée ici.

### 3.4 Version de `@aws-appsync/utils` installée

`@aws-appsync/utils@1.12.0` (dernière version stable de la branche `1.x` disponible sur le
registre npm au moment de cette sous-tâche). La branche `2.x` existe (`2.0.3`, `2.1.1`) mais ce
repo n'a aucun retour d'expérience dessus — reste sur `1.x`, cohérent avec une migration Gen2 déjà
risquée par nature (sous-tâche 3/ADR-0007) qui privilégie systématiquement le chemin le plus
documenté/éprouvé. Le package sert uniquement à la vérification de types locale (`tsc --noEmit`)
et à l'autocomplétion pendant le développement — le runtime AppSync JS fournit `@aws-appsync/utils`
lui-même en production, ce n'est pas une dépendance embarquée dans le bundle déployé.

## 4. Le resolver JS n'est pas unit-testable comme une fonction Node classique

Runtime AppSync JS spécifique (`APPSYNC_JS`), pas Node — pas de `require`/`import` réel possible
depuis Vitest sans un mock complet et non représentatif de `@aws-appsync/utils/dynamodb`. Même
choix assumé que pour `amplify/auth/resource.ts`/`amplify/data/resource.ts` en sous-tâches 3/4 :
logique déclarative/runtime spécifique, pas de fonction pure testable sans déploiement réel
(`ampx sandbox`, hors périmètre de cette sous-tâche). La déclaration du schéma elle-même
(présence de la mutation custom, arguments, type de retour) reste vérifiable par le même test de
compilation `schema.transform()` que le reste de `amplify/data/resource.ts`
(`amplify/data/__tests__/resource.transform.test.ts`) — c'est la profondeur de couverture
retenue ici, la même que celle déjà acceptée pour ADR-0009/ADR-0010.

## Relation avec ADR-0001 et le reste des ADR

Comme ADR-0009/ADR-0010 : cet ADR ne modifie **aucune** décision de fond d'ADR-0001 — la garde
métier (condition sur `status = OPEN`, échec propre si déjà pris) reste identique, seule sa
forme d'implémentation change (mutation `@model` conditionnée par le Transformer v1 → mutation
custom + resolver JS explicite, imposée par l'absence de `condition` sur les mutations générées
Gen2). ADR-0001 reste la trace vivante de la décision produit ; cet ADR documente uniquement le
changement de forme et vérifie que le comportement observable (condition, champs écrits, erreur
propagée) est identique des deux côtés.
