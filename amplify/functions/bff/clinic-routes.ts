import { GetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { readCookie, ACCESS_TOKEN_COOKIE } from './cookies'
import type { RouteResult } from './auth-routes'
import type {
  VeterinarianAccountAdminEvent,
  CreateAccountResult,
  RollbackAccountResult,
} from '../veterinarian-account-admin/handler'

/**
 * Routes `/api/clinic/*` du BFF -- invitation d'un vétérinaire par le vétérinaire référent de
 * sa clinique (voir la conversation produit qui a mené à ce choix : `AdminCreateUser` plutôt
 * qu'un modèle `VeterinarianInvitation` + envoi SES, pour réutiliser l'infra `CustomMessage`
 * déjà en place, docs/adr/0022-branded-transactional-emails.md).
 *
 * Les appels Cognito Admin (`AdminCreateUser`/`AdminAddUserToGroup`/`AdminDeleteUser`) ne sont
 * PAS faits ici mais délégués à une DEUXIÈME Lambda, `veterinarianAccountAdmin`
 * (`amplify/functions/veterinarian-account-admin/`), via `InvokeCommand` -- voir le commentaire
 * de `amplify/auth/resource.ts` pour le "pourquoi" (deux tentatives de donner ces permissions
 * directement à `bff` ont chacune cassé un déploiement réel, `ampx sandbox`, 2026-09-13).
 *
 * Écriture DynamoDB DIRECTE sur la table `Veterinarian` (bypass AppSync), même idiome que
 * `mission-validation-auto-finalizer`/`rating-aggregation` (voir CLAUDE.md, "Lambda + accès
 * DynamoDB direct") -- nécessaire ici pour une raison différente de ces deux Lambdas : le
 * champ caché `owner` (`allow.owner()`, `amplify/data/resource.ts`) n'a de sens que posé avec
 * l'identité de la COLLÈGUE invitée, jamais celle du référent qui appelle cette route. Un
 * `client.models.Veterinarian.create()` relayé avec la session du référent (ADR-0021)
 * poserait `owner = référent` -- la collègue ne pourrait alors plus jamais modifier son propre
 * profil (`updateVetDetails`, `useClinicSettings.js`, protégé par `allow.owner()` seul, aucune
 * règle `allow.group('Veterinarians').to(['update'])` de secours). Format du champ `owner`
 * (`"${sub}::${username}"`, confirmé via context7 `/aws-amplify/docs` + le commentaire
 * `amplify/data/resource.ts` lignes 22-26 sur le format Gen1 identique) : `Username` posé
 * explicitement à l'email sur `AdminCreateUserCommand` (dans `veterinarian-account-admin/
 * handler.ts`), comme le fait déjà `signUp()` (`auth-routes.ts`) pour l'inscription
 * self-service -- mêmes deux identités, mêmes règles `owner()`, même format des deux côtés.
 * Cette écriture reste DANS `bff` (et non dans `veterinarianAccountAdmin`) précisément parce
 * qu'elle a besoin de l'accès DynamoDB direct que `bff` a déjà (référent/clinicID), plutôt que
 * de dupliquer cet accès sur les deux Lambdas.
 */

function getCognitoClient() {
  return new CognitoIdentityProviderClient({ region: process.env.AWS_REGION })
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const lambdaClient = new LambdaClient({})

function getUserPoolId() {
  const userPoolId = process.env.COGNITO_USER_POOL_ID
  if (!userPoolId) throw new Error('COGNITO_USER_POOL_ID manquant')
  return userPoolId
}

function getVeterinarianTableName() {
  const tableName = process.env.VETERINARIAN_TABLE_NAME
  if (!tableName) throw new Error('VETERINARIAN_TABLE_NAME manquant')
  return tableName
}

function getClinicTableName() {
  const tableName = process.env.CLINIC_TABLE_NAME
  if (!tableName) throw new Error('CLINIC_TABLE_NAME manquant')
  return tableName
}

function getAccountAdminFunctionName() {
  const name = process.env.VETERINARIAN_ACCOUNT_ADMIN_FUNCTION_NAME
  if (!name) throw new Error('VETERINARIAN_ACCOUNT_ADMIN_FUNCTION_NAME manquant')
  return name
}

/** Invoque `veterinarianAccountAdmin` (RequestResponse, synchrone) et parse son payload JSON. */
async function invokeAccountAdmin<T extends CreateAccountResult | RollbackAccountResult>(
  event: VeterinarianAccountAdminEvent,
): Promise<T> {
  const result = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: getAccountAdminFunctionName(),
      Payload: Buffer.from(JSON.stringify(event)),
    }),
  )
  if (result.FunctionError || !result.Payload) {
    throw new Error(`veterinarianAccountAdmin invocation failed: ${result.FunctionError ?? 'no payload'}`)
  }
  return JSON.parse(Buffer.from(result.Payload).toString('utf-8')) as T
}

/**
 * Identité de l'appelant, validée AUPRÈS DE COGNITO (même principe que `tryGetUser()` dans
 * `auth-routes.ts`, ADR-0021 §4) -- pas un JWT décodé localement : cette route écrit un compte
 * Cognito et une ligne DynamoDB, la confiance doit venir de Cognito, pas du contenu d'un cookie.
 */
async function requireCaller(
  cookies: string[] | undefined,
): Promise<{ sub: string; email: string; username: string } | null> {
  const accessToken = readCookie(cookies, ACCESS_TOKEN_COOKIE)
  if (!accessToken) return null
  try {
    const result = await getCognitoClient().send(new GetUserCommand({ AccessToken: accessToken }))
    const attrs = Object.fromEntries((result.UserAttributes ?? []).map((a) => [a.Name, a.Value]))
    if (!attrs.sub || !attrs.email || !result.Username) return null
    return { sub: attrs.sub, email: attrs.email, username: result.Username }
  } catch (err) {
    console.error('requireCaller error:', err)
    return null
  }
}

/**
 * `POST /api/clinic/veterinarians` : le référent (= `Clinic.owner`, voir
 * `amplify/data/resource.ts:402` -- déjà le seul autorisé à supprimer sa Clinic,
 * `useClinicSettings.deleteAccount`) invite un·e collègue par email.
 */
export async function inviteVeterinarian(
  body: { email?: string; locale?: string },
  cookies: string[] | undefined,
): Promise<RouteResult> {
  const email = body.email?.trim().toLowerCase()
  if (!email) return { statusCode: 400, body: { error: 'MISSING_EMAIL' } }

  const caller = await requireCaller(cookies)
  if (!caller) return { statusCode: 401, body: { error: 'NOT_AUTHENTICATED' } }

  try {
    const vetResult = await documentClient.send(
      new GetCommand({ TableName: getVeterinarianTableName(), Key: { id: caller.sub } }),
    )
    const clinicID = vetResult.Item?.clinicID
    if (!clinicID) return { statusCode: 403, body: { error: 'NOT_A_VETERINARIAN' } }

    const clinicResult = await documentClient.send(
      new GetCommand({ TableName: getClinicTableName(), Key: { id: clinicID } }),
    )
    const clinicOwner = clinicResult.Item?.owner
    const callerIdentity = `${caller.sub}::${caller.username}`
    if (clinicOwner !== callerIdentity) {
      return { statusCode: 403, body: { error: 'NOT_CLINIC_REFERENT' } }
    }

    const createResult = await invokeAccountAdmin<CreateAccountResult>({
      action: 'create',
      userPoolId: getUserPoolId(),
      email,
      locale: body.locale,
    })

    if (!createResult.ok) {
      if (createResult.error === 'EMAIL_ALREADY_EXISTS') {
        return { statusCode: 409, body: { error: createResult.error } }
      }
      // `veterinarianAccountAdmin` tourne en Lambda RÉELLE (contrairement à `bff`, exécuté en
      // local par `vite-plugins/bff-dev-middleware.js` en dev) -- son propre `console.error`
      // (AdminCreateUser/AdminAddUserToGroup) part dans SES logs CloudWatch, jamais dans ce
      // terminal. On relaie au moins le code d'erreur reçu ici pour éviter d'avoir à aller les
      // chercher pour un premier diagnostic.
      console.error('inviteVeterinarian: veterinarianAccountAdmin a échoué :', createResult.error)
      return { statusCode: 500, body: { error: 'INVITE_FAILED' } }
    }

    const { sub: newSub, username: newUsername } = createResult

    // `veterinarianAccountAdmin` a déjà réussi à cet instant -- Cognito a déjà envoyé l'email
    // avec un mot de passe temporaire FONCTIONNEL (`CustomMessage_AdminCreateUser`). Un échec
    // de l'écriture ci-dessous laisserait un compte Cognito authentifiable mais SANS ligne
    // `Veterinarian`/hors groupe `Veterinarians` -- pire, un nouvel essai du référent
    // échouerait ensuite en boucle sur `UsernameExistsException` (409 ci-dessus), sans recours
    // self-service. Rollback best-effort (revue devsecops-aws) : ramène au pire au même état
    // "rien n'a été créé" qu'un échec de `AdminCreateUserCommand` lui-même, pour que le
    // référent puisse simplement réessayer.
    try {
      // Écrit en direct (bypass AppSync, voir le commentaire de fichier) : `createdAt`/
      // `updatedAt`/`__typename` posés à la main (CLAUDE.md, "Lambda + accès DynamoDB
      // direct"). `firstname`/`lastname` volontairement vides -- la collègue les complète
      // elle-même dans Réglages (`updateVetDetails`, déjà fonctionnel dès que `owner` est
      // correctement posé).
      const now = new Date().toISOString()
      await documentClient.send(
        new PutCommand({
          TableName: getVeterinarianTableName(),
          Item: {
            id: newSub,
            clinicID,
            firstname: '',
            lastname: '',
            email,
            // Compte pas encore confirmé : la collègue n'a pas encore résolu le challenge
            // `NEW_PASSWORD_REQUIRED` (voir le commentaire du champ dans
            // `amplify/data/resource.ts`) -- passe à `true` via son propre `update()` une fois
            // authentifiée (`useClinicVeterinarians.confirmOwnAccount()`).
            accountConfirmed: false,
            owner: `${newSub}::${newUsername}`,
            createdAt: now,
            updatedAt: now,
            __typename: 'Veterinarian',
          },
          // Anti-course (même idiome qu'ADR-0011) : `newSub` vient de l'invocation de
          // `veterinarianAccountAdmin` qui vient de créer ce Cognito user, `id` ne peut donc
          // pas déjà exister -- une collision signalerait un bug, pas une situation à absorber
          // silencieusement.
          ConditionExpression: 'attribute_not_exists(id)',
        }),
      )
    } catch (err) {
      console.error('inviteVeterinarian: échec après création du compte, rollback :', err)
      try {
        await invokeAccountAdmin<RollbackAccountResult>({
          action: 'rollback',
          userPoolId: getUserPoolId(),
          username: newUsername,
        })
      } catch (rollbackErr) {
        console.error('inviteVeterinarian: rollback également en échec :', rollbackErr)
      }
      return { statusCode: 500, body: { error: 'INVITE_FAILED' } }
    }

    return { statusCode: 200, body: { status: 'INVITED', id: newSub } }
  } catch (err) {
    console.error('inviteVeterinarian error:', err)
    return { statusCode: 500, body: { error: 'INVITE_FAILED' } }
  }
}
