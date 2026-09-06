import { defineFunction } from '@aws-amplify/backend'

/**
 * BFF (Backend For Frontend) pour la session Cognito -- voir
 * `docs/adr/0021-bff-cognito-session-cloudfront.md` pour le design complet (pourquoi un
 * BFF, pourquoi CloudFront, pourquoi ça NE touche PAS les 13 composables applicatifs).
 *
 * Deux familles de routes (`handler.ts`) :
 * - `/api/auth/*` : SDK Cognito Identity Provider direct (`@aws-sdk/client-cognito-identity-provider`,
 *   ADR-0021 §4) -- signIn/signUp/confirmSignUp/resendSignUpCode/confirmSignIn (MFA)/
 *   forgotPassword/confirmForgotPassword/signOut/deleteUser. Chaque appel réussi qui
 *   établit une session pose l'ID token + le Refresh token en cookies `HttpOnly`/`Secure`/
 *   `SameSite=Strict`/`Path=/api` -- jamais renvoyés dans le corps de la réponse JSON.
 * - `/api/graphql` : relais BRUT (ADR-0021 §3) -- lit le cookie de session, résout/rafraîchit
 *   l'ID token, le pose comme header `Authorization`, transmet le body JSON tel quel à l'URL
 *   AppSync réelle, renvoie la réponse telle quelle. Le client (`generateClient()`, tous les
 *   composables) continue de construire le document GraphQL exactement comme aujourd'hui.
 *
 * `COGNITO_USER_POOL_ID`/`COGNITO_USER_POOL_CLIENT_ID`/`APPSYNC_GRAPHQL_URL`/`AWS_REGION_OVERRIDE` :
 * tokens CDK résolus seulement à la synthèse -- injectés depuis `amplify/backend.ts`
 * (`addEnvironment()`), jamais importés depuis `amplify/auth/resource.ts`/`amplify/data/resource.ts`
 * directement (même raison que les Lambdas `mission-validation-auto-finalizer`/`rating-aggregation` :
 * un import direct embarquerait tout `@aws-amplify/backend` dans le bundle esbuild).
 *
 * Pas de `resourceGroupName: 'data'` ici (contrairement aux deux Lambdas ci-dessus) : ce Lambda
 * ne demande AUCUNE permission IAM sur les tables `data` (il parle à Cognito et à AppSync par
 * HTTPS avec un vrai JWT userPool, jamais par accès direct DynamoDB) -- rien qui reproduise le
 * cycle `auth -> function -> data -> auth` documenté dans `rating-aggregation/resource.ts`.
 * Non vérifié par une synthèse CDK réelle (aucun agent ne déploie) -- à confirmer au premier
 * `ampx sandbox` du repo owner.
 */
export const bff = defineFunction({
  name: 'bff',
  entry: './handler.ts',
  timeoutSeconds: 15,
})
