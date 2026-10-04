import { GetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import { readCookie, ACCESS_TOKEN_COOKIE } from './cookies'

export interface Caller {
  sub: string
  email: string
  username: string
}

function getCognitoClient() {
  return new CognitoIdentityProviderClient({ region: process.env.AWS_REGION })
}

/**
 * Identité de l'appelant, validée AUPRÈS DE COGNITO (même principe que `tryGetUser()` dans
 * `auth-routes.ts`, ADR-0021 §4) -- pas un JWT décodé localement : les routes qui l'utilisent
 * écrivent en direct sur DynamoDB/S3 (bypass AppSync et de ses règles `@auth`), la confiance
 * doit venir de Cognito, pas du contenu d'un cookie.
 *
 * Extrait de `clinic-routes.ts` (invitation d'un vétérinaire) quand `animal-photo-routes.ts` en
 * a eu besoin à son tour -- une seule implémentation de cette vérification pour toutes les
 * routes BFF qui agissent hors d'AppSync.
 */
export async function requireCaller(cookies: string[] | undefined): Promise<Caller | null> {
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
 * Valeur du champ caché `owner` (`allow.owner()`, `amplify/data/resource.ts`) pour cet
 * appelant -- format `"${sub}::${username}"`, confirmé par le pin test
 * `resource.transform.test.ts` (voir aussi `clinic-routes.ts`).
 */
export function ownerIdentity(caller: Caller): string {
  return `${caller.sub}::${caller.username}`
}
