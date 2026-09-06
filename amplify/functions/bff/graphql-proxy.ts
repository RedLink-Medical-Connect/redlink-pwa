import { ID_TOKEN_COOKIE, buildSetCookie, readCookie } from './cookies'
import { tryRefresh } from './auth-routes'

/**
 * Relais BRUT de `/api/graphql` -- voir docs/adr/0021-bff-cognito-session-cloudfront.md §3.
 * `generateClient()` (`aws-amplify/data`, les 13 composables, INCHANGÉS) construit lui-même le
 * document GraphQL exactement comme aujourd'hui ; ce module ne fait QUE remplacer le header
 * `Authorization` bidon (`authMode: 'lambda'`, voir ADR-0021 §1, posé côté `src/main.js`) par le
 * vrai ID token Cognito avant de transmettre le body tel quel à la vraie URL AppSync, puis
 * renvoie la réponse AppSync telle quelle. Aucune réimplémentation du client Data server-side
 * (`aws-amplify/data/server` ne donne qu'un client GraphQL brut hors Next.js, ADR-0021 §3 --
 * inutile ici puisque le document GraphQL arrive déjà construit dans `rawBody`).
 */

const SESSION_TOKEN_MAX_AGE_SECONDS = 15 * 60

interface ProxyResult {
  statusCode: number
  rawBody: string
  contentType: string
  setCookies?: string[]
}

function getAppsyncUrl() {
  const url = process.env.APPSYNC_GRAPHQL_URL
  if (!url) throw new Error('APPSYNC_GRAPHQL_URL manquant')
  return url
}

async function forwardToAppsync(rawBody: string, idToken: string) {
  const response = await fetch(getAppsyncUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: idToken },
    body: rawBody,
  })
  return response
}

export async function proxyGraphql(
  rawBody: string | undefined,
  cookies: string[] | undefined,
): Promise<ProxyResult> {
  if (!rawBody) {
    return { statusCode: 400, contentType: 'application/json', rawBody: JSON.stringify({ errors: [{ message: 'MISSING_BODY' }] }) }
  }

  let idToken = readCookie(cookies, ID_TOKEN_COOKIE)
  let refreshedCookies: string[] | undefined

  if (!idToken) {
    const refreshed = await tryRefresh(cookies)
    if (!refreshed) {
      return {
        statusCode: 200, // AppSync répond toujours 200 avec `{ data: null, errors: [...] }` --
        // reproduit ici pour que `graphql-error-service.js` (client) traite ce cas exactement
        // comme une vraie erreur `@auth` AppSync, sans branche spéciale à ajouter côté composable.
        contentType: 'application/json',
        rawBody: JSON.stringify({ data: null, errors: [{ message: 'NOT_AUTHENTICATED' }] }),
      }
    }
    idToken = refreshed.IdToken!
    refreshedCookies = [
      buildSetCookie('rl_id_token', refreshed.IdToken!, { maxAgeSeconds: SESSION_TOKEN_MAX_AGE_SECONDS }),
      buildSetCookie('rl_access_token', refreshed.AccessToken!, {
        maxAgeSeconds: SESSION_TOKEN_MAX_AGE_SECONDS,
      }),
    ]
  }

  let response = await forwardToAppsync(rawBody, idToken)

  // L'ID token a pu expirer PENDANT la fenêtre entre la lecture du cookie et l'appel AppSync
  // (rare, mais possible sur une requête lente) -- un seul essai de rafraîchissement, jamais de
  // boucle (AppSync répond 401 sur un `UnauthorizedException`, pas un statut générique).
  if (response.status === 401 && !refreshedCookies) {
    const refreshed = await tryRefresh(cookies)
    if (refreshed) {
      idToken = refreshed.IdToken!
      refreshedCookies = [
        buildSetCookie('rl_id_token', refreshed.IdToken!, { maxAgeSeconds: SESSION_TOKEN_MAX_AGE_SECONDS }),
        buildSetCookie('rl_access_token', refreshed.AccessToken!, {
          maxAgeSeconds: SESSION_TOKEN_MAX_AGE_SECONDS,
        }),
      ]
      response = await forwardToAppsync(rawBody, idToken)
    }
  }

  const bodyText = await response.text()
  return {
    statusCode: response.status,
    contentType: response.headers.get('content-type') ?? 'application/json',
    rawBody: bodyText,
    setCookies: refreshedCookies,
  }
}
