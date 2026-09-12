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
 * `resourceGroupName: 'data'` -- correctif post-déploiement réel (2026-09-12,
 * `CloudformationStackCircularDependencyError` confirmé par un vrai `ampx sandbox` en échec,
 * stacks `auth`/`waf`/`geo`/`data`/`function` cités). Le raisonnement initial de cette
 * sous-tâche ("ce Lambda n'a besoin d'aucune permission IAM sur les tables `data`, donc pas
 * besoin de `resourceGroupName`") ne couvrait que l'angle IAM -- il ratait que
 * `addEnvironment()` crée LUI AUSSI une dépendance de stack, indépendamment de toute policy.
 * Sans lui, `bff` atterrit par défaut dans la même stack imbriquée partagée que
 * `post-confirmation` (trigger Cognito, dont `auth` a besoin de l'ARN -- `auth` dépend donc de
 * cette stack "function"). Or `amplify/backend.ts` pose sur `bff`
 * `COGNITO_USER_POOL_CLIENT_ID` (référence `auth`) ET `APPSYNC_GRAPHQL_URL` (référence
 * `data`) -- cette même stack "function" dépend donc AUSSI de `auth`, d'où un cycle direct
 * `auth -> function -> auth` (même famille que le cycle
 * `auth -> function -> data -> auth` déjà documenté dans
 * `mission-validation-auto-finalizer/resource.ts`/`rating-aggregation/resource.ts`, mais qui
 * n'a ici pas même besoin de repasser par `data` pour se refermer). `resourceGroupName: 'data'`
 * place directement `bff` DANS la stack `data` -- sa référence à `cfnGraphqlApi` (déjà dans
 * cette même stack) devient une référence INTRA-stack, et sa référence à `auth`
 * (`userPoolClientId`) suit la même direction que celle déjà établie par `data` lui-même (mode
 * d'authentification Cognito de l'API AppSync, comportement Gen2 standard) -- aucun nouveau
 * cycle. `post-confirmation` reste seul dans la stack "function" par défaut, qui ne référence
 * plus rien en retour : le cycle est cassé.
 */
export const bff = defineFunction({
  name: 'bff',
  entry: './handler.ts',
  resourceGroupName: 'data',
  timeoutSeconds: 15,
})
