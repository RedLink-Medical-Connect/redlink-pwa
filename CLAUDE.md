# CLAUDE.md

Contexte pour agents travaillant sur Redlink — PWA de mise en relation entre
cliniques vétérinaires en recherche de sang et propriétaires d'animaux donneurs
potentiels. Voir aussi `CONTEXT.md` (glossaire domaine) et `docs/adr/` (décisions
architecturales) et `.cursorrules` (conventions détaillées pour l'éditeur).

## Stack technique

**Frontend**
- Vue 3 (Composition API, `<script setup>`) + Vite
- vue-router, vue-i18n, Pinia
- PrimeVue (composants UI), Tailwind CSS
- vite-plugin-pwa (PWA)
- Pas de TypeScript — JS pur, avec JSDoc ponctuel pour le typage des fonctions

**Backend / Infra**
- AWS Amplify **Gen1** (amplify-cli) — **jamais** de pattern Gen2 (`defineAuth`,
  `defineData`, `backend.ts`, etc.), ce repo ne les utilise pas
- AppSync/GraphQL, Transformer v1 (`@model`, `@auth` — y compris au niveau
  champ), résolveurs VTL auto-générés
- Cognito (user pools, groupes `Veterinarians`/`Owners`)
- Lambda (Node.js, un trigger PostConfirmation, CommonJS/`require`)
- DynamoDB (via les modèles `@model`)

**Tests**
- Vitest (unitaire — le seul réellement utilisé)
- Playwright (e2e — un seul test existant, contre un vrai backend, **pas mocké**)
- `@vue/test-utils` installé mais jamais utilisé (aucun test de composant `.vue`
  dans ce repo à ce jour)

**Qualité**
- ESLint (config plate, `eslint.config.js`) + `@intlify/eslint-plugin-vue-i18n`
- Prettier (`skipFormatting`)
- Husky (hook `prepare`)

**Autre**
- Stripe prévu mais non implémenté (champs de schéma existants, page de test
  isolée) — hors périmètre V1
- npm comme gestionnaire de paquets

## MCP disponibles pour ce projet

- **amplify-docs** — à consulter avant tout code touchant Amplify (auth, API,
  schema, functions). Confirme systématiquement que la réponse concerne Gen1,
  pas Gen2.
- **context7** — vérifie l'API exacte de Vue 3 / Pinia / PrimeVue / vue-router /
  vue-i18n avant d'écrire du code (pas de TypeScript ici pour rattraper les
  erreurs à la compilation).
- **vitest** — lance les tests via ce MCP plutôt que `npm run test` en Bash brut.
- **eslint** — vérifie les warnings avant de proposer un commit, en particulier
  les règles i18n. Une dette de warnings i18n est déjà trackée sur ce repo (voir
  `DashboardView.vue`) — demande confirmation avant de la corriger en masse.
- **playwright** — le seul test e2e tourne contre un vrai backend (Cognito/
  DynamoDB réels, pas mocké). Demande une confirmation explicite avant de le
  lancer : ça peut créer ou modifier des données réelles.

## Conventions du projet

- **Composables** : `src/composables/useXxx.js`, exportent une fonction
  `useXxx()` qui retourne des refs/computed + méthodes. Logique métier et appels
  GraphQL dedans, jamais dans les composants. Erreur → message utilisateur : une
  fonction pure exportée à côté (ex. `mapAcceptMissionError`,
  `mapValidationErrorKey`), pas un objet inline dans le composant — seul endroit
  testable sans monter de composant `.vue` (aucun test de ce type dans ce repo).
  Elle ne peut pas appeler `useI18n()`/`t()` : renvoie une **clé** i18n, le
  composant fait `t(laFonction(...))`. Un chargement dont l'échec doit être
  visible à l'écran (pas juste une action en arrière-plan) a besoin d'un ref
  d'erreur dédié (ex. `loadError`) — sinon "en erreur" et "vraiment vide" sont
  indistinguables pour l'utilisateur.
- **Services (deep modules)** : `src/services/xxx-service.js` — fonctions pures
  exportées, aucune réactivité Vue, aucun appel GraphQL, aucun accès DOM (voir
  `eligibility-service.js`).
- **GraphQL** : `generateClient()` + `authMode: 'userPool'`, `try/catch/finally`
  avec un ref de loading dédié. Pour une query/mutation dont les champs
  dépassent le codegen par défaut : l'ajouter dans `custom-queries.js`/
  `custom-mutations.js` — jamais éditer `queries.js`/`mutations.js`/
  `subscriptions.js` à la main (fichiers auto-générés, écrasés au prochain
  `amplify codegen`/`amplify push` ; un vrai bug a déjà eu cette cause exacte
  dans ce repo).
- **i18n** : `$t()` est la norme (la grande majorité des vues/composants du
  repo l'utilisent). `DashboardView.vue` a des chaînes françaises en dur — dette
  connue et trackée, pas un modèle à suivre.
- **Enums** : les valeurs de statut/type viennent de `src/constants/enums.js`,
  jamais de littéraux en dur — partiellement suivi seulement, dette existante
  par endroits (ex. `MissionStatus` n'a pas d'entrée `CANCELLED`).

## Tenir ce fichier à jour

Ce fichier vit avec le projet, il ne se fige pas au premier commit. Quand une
sous-tâche introduit un nouveau composable/service/pattern GraphQL réellement
suivi (pas une supposition — un usage observé dans le code), ou qu'une décision
change quelque chose listé plus haut, la mettre à jour dans la même PR plutôt
que de la laisser dériver — c'est exactement ce qui est arrivé une fois à la
section "7 piliers" de `lead-dev-reviewer.md`, restaurée après coup. Un
changement qui mérite plus de détail va dans `docs/adr/` ou `CONTEXT.md`
(glossaire domaine), avec juste un pointeur ici — ce fichier reste sous 100
lignes, une carte pas une documentation exhaustive.
