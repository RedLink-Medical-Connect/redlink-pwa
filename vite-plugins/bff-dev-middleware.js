import { readFileSync } from 'node:fs'

/**
 * Sert les routes `/api/*` du BFF Cognito pendant `npm run dev` -- ferme le trou documenté
 * en ADR-0021 §6bis (`docs/adr/0021-bff-cognito-session-cloudfront.md`).
 *
 * POURQUOI CE PLUGIN EXISTE
 * -------------------------
 * Depuis la migration BFF, `src/stores/auth.js`/`useMfa.js`/`VerifyEmailView.vue` appellent
 * des chemins RELATIFS (`/api/auth/*`) et `src/main.js` pointe l'URL AppSync vers
 * `/api/graphql` : en production, CloudFront route ces chemins vers le Lambda (ADR-0021 §2).
 * En local, le serveur de dev Vite ne connaît pas ces chemins -- il renvoyait un 404 sur
 * chaque appel (inscription, mot de passe oublié, connexion...), l'app était inutilisable en
 * `npm run dev`.
 *
 * PAS un proxy vers un BFF déployé, PAS un mock : ce middleware exécute le VRAI handler
 * (`amplify/functions/bff/handler.ts`) dans le process Vite, via `server.ssrLoadModule()` (qui
 * transpile le TypeScript à la volée). Conséquences voulues :
 * - aucune duplication de la logique d'auth (une seule implémentation, celle qui part en prod) ;
 * - le code testé en local est exactement celui qui sera déployé, y compris le HMR quand on
 *   édite le handler ;
 * - les appels partent vers le VRAI Cognito (celui d'`amplify_outputs.json`), pas un double.
 *
 * ÉQUIVALENCE DU FORMAT D'ÉVÉNEMENT
 * ---------------------------------
 * Le handler attend un `APIGatewayProxyEventV2` (format Lambda Function URL / API Gateway HTTP
 * API v2.0). Ce middleware reconstruit les quatre champs qu'il lit réellement -- `rawPath`,
 * `requestContext.http.method`, `cookies` (TABLEAU `"nom=valeur"`, pas l'en-tête `Cookie` brut)
 * et `body` -- depuis la requête Node. Rien d'autre n'est fabriqué : un champ inventé ici
 * masquerait une dépendance réelle du handler au lieu de la révéler.
 *
 * COOKIES `Secure` EN HTTP LOCAL : ils fonctionnent, rien n'est retiré. Chrome et Firefox
 * traitent `http://localhost` comme une origine « potentiellement sûre » (Secure Contexts) et
 * acceptent donc l'attribut `Secure` sans HTTPS (Firefox depuis la v75, bug 1618113 ; même
 * décision côté Chromium). Le middleware transmet les `Set-Cookie` du handler TELS QUELS --
 * `HttpOnly`/`Secure`/`SameSite=Strict`/`Path=/api` inclus : le comportement de session testé
 * en local est celui de la production, pas une version assouplie.
 *
 * `apply: 'serve'` : ce plugin n'existe QUE pour le serveur de dev -- jamais dans un bundle de
 * production (`npm run build`), où CloudFront + le vrai Lambda prennent le relais.
 */
export function bffDevMiddleware() {
  return {
    name: 'redlink-bff-dev-middleware',
    apply: 'serve',

    configureServer(server) {
      let outputs
      try {
        outputs = JSON.parse(
          readFileSync(new URL('../amplify_outputs.json', import.meta.url), 'utf-8'),
        )
      } catch {
        // Même nature d'échec que l'import d'`amplify_outputs.json` dans `src/main.js` (voir
        // son commentaire) : ce fichier est gitignored et n'existe qu'après un déploiement
        // réel. On avertit et on laisse les `/api/*` retomber en 404 plutôt que de faire
        // planter tout le serveur de dev (le reste de l'app -- pages publiques, i18n, HMR --
        // reste utilisable).
        server.config.logger.warn(
          '[bff-dev] amplify_outputs.json introuvable : les routes /api/* resteront en 404. ' +
            'Lancez `npx ampx sandbox` pour le générer.',
        )
        return
      }

      // Variables d'environnement injectées en production par `amplify/backend.ts`
      // (`addEnvironment`) -- reconstruites ici depuis la même source de vérité que le
      // frontend. `AWS_REGION` est posée automatiquement par le runtime Lambda en prod ; en
      // local elle DOIT venir de la région réelle du user pool, pas d'une variable d'ambiance
      // de la machine qui pointerait ailleurs (le client SDK interrogerait un autre compte).
      process.env.COGNITO_USER_POOL_CLIENT_ID = outputs.auth.user_pool_client_id
      process.env.APPSYNC_GRAPHQL_URL = outputs.data.url
      process.env.AWS_REGION = outputs.auth.aws_region

      server.middlewares.use(async (req, res, next) => {
        // Middleware NON monté sur un préfixe (`server.middlewares.use(fn)`, pas
        // `use('/api', fn)`) : un montage préfixé ampute `req.url` du `/api`, or le handler
        // route sur le chemin COMPLET (`'POST /api/auth/signin'`, voir sa table de routes).
        if (!req.url?.startsWith('/api/')) return next()

        try {
          const { pathname } = new URL(req.url, 'http://localhost')
          const body = await readRequestBody(req)

          const { handler } = await server.ssrLoadModule('/amplify/functions/bff/handler.ts')

          const result = await handler({
            rawPath: pathname,
            requestContext: { http: { method: req.method } },
            // `event.cookies` (Function URL v2.0) est un TABLEAU de `"nom=valeur"` --
            // l'en-tête HTTP `Cookie`, lui, est une seule chaîne séparée par `"; "`.
            cookies: req.headers.cookie ? req.headers.cookie.split('; ') : undefined,
            body: body || undefined,
            isBase64Encoded: false,
          })

          res.statusCode = result.statusCode
          for (const [name, value] of Object.entries(result.headers ?? {})) {
            res.setHeader(name, value)
          }
          // Node accepte un tableau pour émettre PLUSIEURS en-têtes `Set-Cookie` distincts --
          // indispensable ici (le handler en pose jusqu'à 3 d'un coup : id/access/refresh).
          if (result.cookies?.length) {
            res.setHeader('Set-Cookie', result.cookies)
          }
          res.end(result.body ?? '')
        } catch (error) {
          // Fail-loud côté console du serveur (la stack complète est la seule information
          // exploitable pour déboguer le handler), réponse générique côté navigateur.
          server.config.logger.error(`[bff-dev] ${req.method} ${req.url} a échoué :`)
          console.error(error)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'BFF_DEV_MIDDLEWARE_ERROR' }))
        }
      })

      server.config.logger.info('[bff-dev] routes /api/* servies par amplify/functions/bff/handler.ts')
    },
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}
