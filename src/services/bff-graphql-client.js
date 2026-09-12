import { generateClient as generateAmplifyClient } from 'aws-amplify/data'

/**
 * Remplacement direct de `generateClient()` (`aws-amplify/data`) -- voir
 * docs/adr/0021-bff-cognito-session-cloudfront.md §1/§4. Les 13 composables applicatifs
 * n'ont qu'UNE SEULE ligne à changer, leur import (`from 'aws-amplify/data'` -> `from
 * '@/services/bff-graphql-client'`) : `client.models.X.create()/get()/list()/update()/
 * delete()`, `client.mutations.X()`, `selectionSet`, `filter` restent identiques à
 * l'octet près -- ce module ne fait que router la même requête vers le BFF au lieu
 * d'AppSync directement.
 *
 * Exception documentée au principe "un service ne fait jamais d'appel GraphQL"
 * (.cursorrules) -- même famille d'exception que `mission-completion-side-effects.js`
 * (CLAUDE.md) : ceci n'est pas de la logique métier, c'est un remplacement direct
 * d'infrastructure (`generateClient` lui-même), utilisé UNIQUEMENT pour sa signature de
 * construction de client, jamais pour une opération métier.
 *
 * `authMode: 'lambda'` + `authToken` non-vide : PAS un vrai credential (voir
 * `headerBasedAuth`, `node_modules/@aws-amplify/api-graphql/src/internals/graphqlAuth.ts`)
 * -- ce mode exige seulement un header `Authorization` non vide côté client, sans
 * vérification. AppSync ne voit JAMAIS cette valeur : le BFF (`amplify/functions/bff/
 * graphql-proxy.ts`) la remplace systématiquement par le vrai ID token Cognito avant de
 * transmettre la requête. Un `authToken` global au niveau `Amplify.configure()` n'existe
 * pas (vérifié dans les types installés, `@aws-amplify/core` -- `GraphQLProviderConfig`
 * n'a pas de champ `authToken`/`headers` appliqué au endpoint AppSync réel) : c'est
 * pourquoi ce module existe, plutôt qu'un réglage global dans `main.js`.
 *
 * PAS d'`endpoint` ici (piège vérifié dans le code source installé,
 * `node_modules/@aws-amplify/api-graphql/src/internals/generateClient.ts`) : un `endpoint`
 * passé à `generateClient()` désactive complètement le chargement du schéma
 * (`addSchemaToClient()` ne tourne QUE si aucun `endpoint` n'est fourni au client) --
 * `.models` resterait un Proxy vide qui lève une exception au moindre accès. L'URL réelle
 * (`/api/graphql`, relative au domaine courant -- voir `src/main.js`) est donc surchargée au
 * niveau de la config GLOBALE (`Amplify.configure()`, `outputs.data.url`), jamais ici :
 * `addSchemaToClient` continue de lire la vraie introspection de schéma (`model_introspection`,
 * inchangé) via cette config globale, tandis que `authMode`/`authToken` posés ICI (au niveau du
 * CLIENT, pas globalement -- aucun équivalent global n'existe pour `authToken`, voir
 * ADR-0021 §1) l'emportent sur le `defaultAuthMode` global à chaque appel
 * (`InternalGraphQLAPI.ts` : `authModeOverride || defaultAuthMode`).
 */
export function generateClient(options = {}) {
  return generateAmplifyClient({
    authMode: 'lambda',
    authToken: 'bff-session',
    ...options,
  })
}
