/**
 * Fichier à part, SANS AUCUN import de `@aws-amplify/backend` -- `resource.ts` (qui importe
 * `defineFunction`) ne peut pas être importé par `handler.ts` : `@aws-amplify/backend` refuse
 * de s'exécuter hors d'un contexte "backend" ("This package is for backend use only and
 * should not be used in a browser environment"), ce qui casse Vitest (`handler.test.ts`,
 * environnement jsdom) dès que `handler.ts` importe quoi que ce soit venant de `resource.ts`.
 * Même raison que `COGNITO_USER_POOL_ID`/`APPSYNC_GRAPHQL_URL`/etc. voyagent en variables
 * d'environnement plutôt qu'en import direct (voir le commentaire sur `resource.ts`) --
 * `ORIGIN_VERIFY_HEADER` n'est qu'un NOM de header (pas une valeur secrète, qui reste elle
 * exclusivement une variable d'environnement), mais reste tout de même dans ce fichier séparé
 * pour rester importable par les deux côtés (`amplify/backend.ts` ET `handler.ts`) sans jamais
 * risquer d'embarquer `@aws-amplify/backend`.
 *
 * Nom du header "secret partagé" que CloudFront attache à CHAQUE requête qu'il transmet à
 * l'origine Lambda de `bff` (`amplify/backend.ts`, *origin custom header*) -- `handler.ts`
 * compare sa valeur à `process.env.ORIGIN_VERIFY_SECRET` et rejette (403) tout appel qui ne
 * l'a pas.
 *
 * Remplace `authType: AWS_IAM`/OAC (2026-09-13, confirmé en déploiement réel) : OAC pour une
 * origine Lambda Function URL ne sait signer correctement que les requêtes SANS corps
 * (GET/HEAD) -- pour POST/PUT (la quasi-totalité des routes de ce handler), OAC exige que le
 * CLIENT fournisse lui-même un `x-amz-content-sha256`/une signature SigV4, ce qu'un `fetch()`
 * de navigateur ne fait jamais. Symptôme observé : `403 SignatureDoesNotMatch` sur
 * `POST /api/auth/signup` via CloudFront, alors qu'un `GET /api/auth/session` (sans corps)
 * passait. Limitation documentée d'AWS, pas une mauvaise configuration -- voir
 * docs.aws.amazon.com/AmazonCloudFront (private-content-restricting-access-to-lambda,
 * "Lambda doesn't support unsigned payloads") et
 * https://advancedweb.hu/shorts/cloudfront-supports-oac-for-lambda-except-it-does-not/. Le
 * header secret est le pattern que la doc AWS elle-même recommande pour un Lambda Function
 * URL derrière CloudFront quand OAC ne convient pas (même famille que le pattern historique
 * ALB + CloudFront + header custom).
 */
export const ORIGIN_VERIFY_HEADER = 'x-origin-verify'
