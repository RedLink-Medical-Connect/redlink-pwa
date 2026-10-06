/**
 * Détection d'un échec de chargement d'un chunk JS lazy (route `component: () => import(...)`)
 * et décision de recharger la page -- fonctions pures, utilisées par `router.onError`
 * (`src/router/index.js`).
 *
 * Bug réel constaté en prod (2026-10-06) : la distribution CloudFront devant Amplify Hosting
 * pouvait servir un `index.html`/JS d'entrée d'un ANCIEN build (cache `s-maxage` d'un an),
 * pointant vers des chunks supprimés depuis (`/assets/RegisterOwnerView-<ancien hash>.js` ->
 * 404). L'import dynamique échouait et vue-router annulait la navigation sans rien afficher :
 * les boutons du /home semblaient inertes. Un rechargement complet récupère le HTML à jour.
 */

// Messages des trois moteurs : Chromium, Firefox, WebKit (Safari iOS), + préchargement Vite.
const CHUNK_LOAD_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
]

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isChunkLoadError(error) {
  const message = typeof error === 'string' ? error : error?.message
  if (!message) return false
  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

/** Fenêtre anti-boucle : pas plus d'un rechargement automatique par période. */
export const CHUNK_RELOAD_COOLDOWN_MS = 10_000

/**
 * Recharger seulement si aucun rechargement automatique n'a eu lieu dans la fenêtre -- sinon un
 * chunk durablement absent (vraie panne, pas un cache périmé) rechargerait la page en boucle.
 *
 * @param {number|null} lastReloadAt timestamp (ms) du dernier rechargement auto, ou null
 * @param {number} now
 * @returns {boolean}
 */
export function shouldReloadForChunkError(lastReloadAt, now) {
  if (!lastReloadAt) return true
  return now - lastReloadAt > CHUNK_RELOAD_COOLDOWN_MS
}
