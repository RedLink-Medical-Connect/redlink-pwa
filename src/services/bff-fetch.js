/**
 * Helper partagé pour parler au BFF Cognito (`/api/auth/*`) -- voir
 * docs/adr/0021-bff-cognito-session-cloudfront.md. Centralise le contrat commun (JSON,
 * `credentials: 'include'` pour que le navigateur attache/reçoive les cookies `HttpOnly` de
 * session) utilisé par `stores/auth.js`, `useMfa.js` et `VerifyEmailView.vue` -- évite de
 * dupliquer ce boilerplate à chaque appelant.
 */
export async function bffFetch(path, { method = 'POST', body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, data }
}
