import type { Handler } from 'aws-lambda'
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider'

/**
 * Invoquée par `amplify/functions/bff/clinic-routes.ts` (`InvokeCommand`, jamais exposée
 * directement) -- voir `resource.ts` pour le "pourquoi" de cette Lambda séparée. Deux actions,
 * dispatchées sur `event.action` plutôt que deux fonctions/deux Lambdas séparées : elles
 * partagent le même client Cognito et sont toujours appelées dans le même flux applicatif
 * (create, puis rollback best-effort si une étape ULTÉRIEURE côté `bff` échoue -- l'écriture
 * DynamoDB de la ligne `Veterinarian`, qui doit rester dans `bff` : voir son commentaire de
 * fichier sur pourquoi le champ `owner` doit être posé depuis là).
 */
const client = new CognitoIdentityProviderClient()

export interface CreateAccountEvent {
  action: 'create'
  userPoolId: string
  email: string
  locale?: string
}

export interface RollbackAccountEvent {
  action: 'rollback'
  userPoolId: string
  username: string
}

export type VeterinarianAccountAdminEvent = CreateAccountEvent | RollbackAccountEvent

export type CreateAccountResult = { ok: true; sub: string; username: string } | { ok: false; error: string }
export type RollbackAccountResult = { ok: true } | { ok: false; error: string }
export type VeterinarianAccountAdminResult = CreateAccountResult | RollbackAccountResult

async function createAccount(event: CreateAccountEvent): Promise<CreateAccountResult> {
  let createResult
  try {
    createResult = await client.send(
      new AdminCreateUserCommand({
        UserPoolId: event.userPoolId,
        Username: event.email,
        UserAttributes: [
          { Name: 'email', Value: event.email },
          { Name: 'email_verified', Value: 'true' },
          // Même attribut que `signUp()` (`amplify/functions/bff/auth-routes.ts`) -- sans lui,
          // `currentRole` (`stores/auth.js`) retombe sur son défaut `'owner'` à la première
          // connexion de la collègue, faute de trigger PostConfirmation pour le poser (celui-ci
          // ne se déclenche que sur `ConfirmSignUp`/`AdminConfirmSignUp`, jamais sur la
          // résolution du challenge `NEW_PASSWORD_REQUIRED` d'un compte `AdminCreateUser`).
          { Name: 'profile', Value: 'vet' },
        ],
        ClientMetadata: typeof event.locale === 'string' ? { locale: event.locale } : undefined,
      }),
    )
  } catch (err) {
    const error = err as { name?: string }
    if (error.name === 'UsernameExistsException') {
      return { ok: false, error: 'EMAIL_ALREADY_EXISTS' }
    }
    console.error('createAccount: AdminCreateUser error:', err)
    return { ok: false, error: 'INVITE_FAILED' }
  }

  const attrs = Object.fromEntries((createResult.User?.Attributes ?? []).map((a) => [a.Name, a.Value]))
  const sub = attrs.sub
  const username = createResult.User?.Username
  if (!sub || !username) {
    return { ok: false, error: 'INVITE_FAILED' }
  }

  try {
    await client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: event.userPoolId,
        Username: username,
        GroupName: 'Veterinarians',
      }),
    )
  } catch (err) {
    console.error('createAccount: échec AdminAddUserToGroup, rollback du compte Cognito :', err)
    try {
      await client.send(new AdminDeleteUserCommand({ UserPoolId: event.userPoolId, Username: username }))
    } catch (rollbackErr) {
      console.error('createAccount: rollback AdminDeleteUser également en échec :', rollbackErr)
    }
    return { ok: false, error: 'INVITE_FAILED' }
  }

  return { ok: true, sub, username }
}

async function rollbackAccount(event: RollbackAccountEvent): Promise<RollbackAccountResult> {
  try {
    await client.send(new AdminDeleteUserCommand({ UserPoolId: event.userPoolId, Username: event.username }))
    return { ok: true }
  } catch (err) {
    // Best-effort assumé (même idiome que useOwnerMissions.js/useMissionClosure.js, CLAUDE.md) :
    // `bff` a déjà décidé de répondre 500 à l'appelant avant ce rollback, il ne fait
    // qu'atténuer le résidu -- son propre échec ne doit pas faire planter cette Lambda.
    console.error('rollbackAccount: AdminDeleteUser error:', err)
    return { ok: false, error: 'ROLLBACK_FAILED' }
  }
}

export const handler: Handler<VeterinarianAccountAdminEvent, VeterinarianAccountAdminResult> = async (
  event,
) => {
  if (event.action === 'create') return createAccount(event)
  if (event.action === 'rollback') return rollbackAccount(event)
  return { ok: false, error: 'UNKNOWN_ACTION' }
}
