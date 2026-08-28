// Fonction 2/7 du pipeline `submitMissionValidation` -- côté OWNER de la vérification
// d'identité (voir l'en-tête de `submit-mission-validation-resolve-parties.js`, fonction 1/7,
// pour le trou de sécurité que ces 4 fonctions ferment, et docs/adr/0018).
//
// SEULE fonction du pipeline dont la source de données n'est pas `Mission` :
// `dataSource: a.ref('Animal')` (`amplify/data/resource.ts`). Une fonction de pipeline AppSync
// ne peut interroger qu'UNE source de données -- c'est précisément pourquoi la vérification
// prend 4 fonctions et pas une seule (Mission -> Animal pour l'Owner, Mission -> Veterinarian +
// Request pour la Clinic). Vérifié, pas supposé : `convertJsResolverDefinition`
// (`node_modules/@aws-amplify/backend-data/lib/convert_js_resolvers.js`) crée une
// `CfnFunctionConfiguration` PAR entrée de `.handler([...])`, chacune avec son propre
// `dataSourceName`, et `normalizeDataSourceName` (`node_modules/@aws-amplify/data-schema/dist/
// esm/SchemaProcessor.mjs`) traduit `a.ref('Animal')` en `"AnimalTable"` -- le nom de la source
// de données générée par le transformer pour ce modèle (même mécanique que le `RequestTable`
// de `linkRequestToMission`, déjà déployé et fonctionnel).
//
// VÉRIFICATION : `Animal.ownerID === ctx.identity.sub`. Convention applicative établie de ce
// dépôt (pas une contrainte du framework) : `Owner.id` EST le `cognitoUserId`
// (`useRegistrationCompletion.js`, `client.models.Owner.create({ id: cognitoUserId, ... })`), et
// `Animal.ownerID` porte cet `Owner.id` (`useAnimals.js`/`useRegistrationCompletion.js`).
// `ctx.identity.sub` est l'UUID Cognito de l'appelant (`AppSyncIdentityCognito.sub`,
// `node_modules/@aws-appsync/utils/lib/index.d.ts`) -- la même valeur que le `userId` renvoyé
// par `getCurrentUser()` côté client. On compare donc bien deux identifiants du même espace.
//
// NO-OP quand l'appelant est une clinique : `runtime.earlyReturn(ctx.prev.result)` -- la source
// de données ET le `response()` de CETTE fonction sont sautés, le pipeline continue à la
// fonction suivante avec cette valeur comme `ctx.prev.result` (contrat documenté du type
// `Runtime`, `index.d.ts` : "When called in an AppSync function request handler, the data Source
// and response handler are skipped and the next function request handler [...] is called").
// C'est ce qui permet à un pipeline unique de porter les deux branches sans lecture inutile :
// un Owner ne paie jamais les lectures de la branche Clinic et réciproquement.
import * as ddb from '@aws-appsync/utils/dynamodb'
import { util, runtime } from '@aws-appsync/utils'

const FORBIDDEN_MESSAGE =
  "Vous n'êtes pas partie à cette Mission -- soumission de validation refusée."

export function request(ctx) {
  if (ctx.stash.callerRole !== 'OWNER') {
    runtime.earlyReturn(ctx.prev.result)
  }

  return ddb.get({ key: { id: ctx.stash.missionAnimalID }, consistentRead: true })
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type, ctx.result)
  }

  const animal = ctx.result
  const sub = (ctx.identity && ctx.identity.sub) || ''

  // Fail-closed sur les trois cas d'un coup (Animal introuvable, `ownerID` absent, `ownerID`
  // d'un autre Owner) -- même message, même code : voir la fonction 1/7 pour pourquoi ce
  // pipeline ne distingue jamais "n'existe pas" de "pas à vous".
  if (!animal || !animal.ownerID || animal.ownerID !== sub) {
    util.error(FORBIDDEN_MESSAGE, 'Forbidden')
  }

  // La Mission lue par la fonction 1/7 continue de circuler telle quelle : aucune fonction en
  // aval ne consomme `ctx.prev.result` avant la 7/7 (qui, elle, lit la relecture FRAÎCHE de la
  // 6/7), mais propager la valeur d'entrée plutôt que l'`Animal` évite qu'un futur ajout de
  // fonction hérite d'un `prev` au type surprenant.
  return ctx.prev.result
}
