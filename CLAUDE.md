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
- Pas de TypeScript — JS pur, avec JSDoc ponctuel pour le typage des fonctions.
  Exception scopée : `amplify/**/*.ts` (backend Gen2 uniquement, `src/` reste JS
  pur) — voir ADR-0007.

**Backend / Infra**
- **Migration Gen1 → Gen2 en cours (Phase 8, depuis le 2026-08-18)** — voir
  `docs/adr/` et le plan de roadmap. Amplify Gen1 est en *maintenance mode*
  depuis le 1er mai 2026 (fin de vie le 1er mai 2027) ; la Phase 8 réécrit le
  backend en Gen2 (`ampx`, `defineAuth`, `defineData`, `backend.ts`) à la main
  (pas l'outil CLI beta de migration), sous-tâche par sous-tâche, dans une
  seule branche/PR exceptionnellement (migration, pas une feature incrémentale).
  **Pendant la durée de la migration, ne plus rejeter un pattern Gen2 par
  principe** — un agent doit distinguer "résidu Gen1 pas encore migré" de
  "code Gen2 conforme à la sous-tâche en cours". Une fois la Phase 8 terminée
  et vérifiée de bout en bout, ce bloc redevient "Gen2 uniquement" et les
  lignes ci-dessous (Transformer v1, VTL, modèles `@model` Gen1) sont retirées.
- AppSync/GraphQL, Transformer v1 (`@model`, `@auth` — y compris au niveau
  champ), résolveurs VTL auto-générés — **legacy Gen1**, remplacé
  progressivement par `defineData` (Gen2) pendant la Phase 8
- Cognito (user pools, groupes `Veterinarians`/`Owners`) — migré vers
  `defineAuth` (Gen2, `amplify/auth/resource.ts`), Phase 8 sous-tâche 3.
  Groupes déclarés statiquement (`groups: [...]`), contrairement à Gen1 où ils
  étaient créés paresseusement au premier signup — voir ADR-0008.
- Lambda (Node.js, un trigger PostConfirmation) — migré vers le modèle de
  fonctions Gen2 (`amplify/functions/post-confirmation/`, TypeScript), Phase 8
  sous-tâche 3 ; l'équivalent Gen1 CommonJS reste en place le temps de la
  migration (voir ADR-0008)
- DynamoDB (via les modèles `@model` Gen1, puis `defineData` Gen2) — schéma de
  données migré vers `defineData` (Gen2, `amplify/data/resource.ts`), Phase 8
  sous-tâche 4 : les 8 types `@model` et leurs règles `@auth` (type et champ,
  ADR-0002 à 0006) sont traduits en `.authorization()` (voir ADR-0009 — en
  particulier `ClinicOwnerRelation.ownerDefinedIn("ownerID")`, la traduction
  Gen2 du pattern qui évite de reproduire le bug `d27f204`). Un piège Gen2
  découvert pendant cette sous-tâche, pas présent en Gen1 : `hasOne`/`hasMany`
  exige toujours un `belongsTo` apparié sur le modèle ciblé, avec un champ de
  référence identique des deux côtés — le processeur de schéma lève une
  erreur bloquante sinon (voir ADR-0010, `Request.mission`/`Mission.request`).
  Prérequis au lot 3/3 : `defineData` Gen2 n'expose **aucun** argument
  `condition` sur les mutations générées automatiquement
  (`client.models.X.update()`) — pour une écriture qui a besoin d'une garde
  DynamoDB conditionnelle (`ConditionExpression`, ex. écriture atomique
  anti-course, ADR-0001), le chemin Gen2 est une **mutation custom** +
  resolver JS AppSync (`a.handler.custom({ dataSource: a.ref('ModelName'),
  entry: './resolvers/....js' })`, `ddb.update({ key, condition, update })`
  de `@aws-appsync/utils/dynamodb`) ciblant directement la table managée du
  modèle — pas une traduction `a.model()`/`.authorization()`. Le resolver est
  obligatoirement `.js` (pas `.ts` : `resolveEntryPath()` l'upload tel quel,
  sans transpilation, vers le runtime `APPSYNC_JS`). Voir ADR-0011
  (`linkRequestToMission`) pour l'exemple de référence si un futur besoin
  similaire apparaît sur un autre composable.
  **Sous-tâche 5 (bascule des composables) terminée** : les 12/12 composables/
  services applicatifs qui parlaient GraphQL sont désormais sur `client.models.X`
  (`aws-amplify/data`) — `useAnimals.js`, `useOwnerProfile.js`,
  `useOwnerAvailability.js`, `useRegistrationCompletion.js` (lot 1),
  `useClinicDonors.js`, `useClinicRequest.js`, `useClinicSettings.js`,
  `useClinicStats.js` (lot 2), `useAnimalValidation.js`, `useMatchingRequests.js`,
  `useMissionClosure.js`, `useOwnerMissions.js` (lot 3, y compris
  `client.mutations.linkRequestToMission`, ADR-0011). Les documents GraphQL Gen1
  (`src/graphql/{queries,mutations,subscriptions,custom-queries,custom-mutations}.js`)
  sont désormais **orphelins** — plus aucun composable ne les importe — mais
  **pas supprimés** : leur suppression est différée à la sous-tâche 6 (une fois le
  scénario de bout en bout revérifié sur Gen2). `src/main.js`
  (`Amplify.configure(awsExports)`) reste sur la config Gen1 pour l'instant — le
  basculement vers `amplify_outputs.json` (Gen2) est la prochaine étape,
  nécessite un premier `ampx sandbox` (action du repo owner, aucun agent ne
  déploie) avant de pouvoir tourner en local. Changement de comportement central
  à connaître avant de toucher un composable non encore migré : le client
  Gen2 ne lève PAS d'exception sur une erreur GraphQL/`@auth` (contrairement
  au client Gen1) — il résout normalement `{ data, errors }`. Voir
  `src/services/graphql-error-service.js` (à partir du lot 2) pour le
  helper partagé qui retransforme `errors` en exception là où le contrat
  observable par l'appelant (vue, composable parent) doit rester inchangé.
  Pattern `selectionSet` (depuis le lot 2, requêtes avec relation imbriquée type
  Gen1 `getVetWithClinic`) : contrairement à une query Gen1 partagée entre
  plusieurs composables, le `selectionSet` Gen2 est posé par CHAQUE appelant —
  chacun ne demande que les champs qu'IL consomme réellement (ex.
  `useClinicDonors.fetchClinicContext()` ne sélectionne que
  `clinic.latitude`/`clinic.longitude`, quand `useClinicSettings.fetchSettings()`
  a besoin de tous les champs de `Clinic` pour son formulaire d'édition), plutôt
  que de recopier aveuglément la sélection de la query Gen1 remplacée. Vaut aussi
  pour un `.get()`/`.list()` sans relation imbriquée : ne pas laisser le
  `selectionSet` par défaut (tous les champs scalaires) sur un appel qui ne lit
  qu'un sous-ensemble des champs — surtout quand ce sous-ensemble appartient à
  un autre utilisateur (ex. `useClinicSettings.deleteAccount`'s
  garde-fou multi-vétérinaire, qui ne lit que `id` mais interrogeait par défaut
  les coordonnées de collègues).

**Tests**
- Vitest (unitaire — le seul réellement utilisé)
- Playwright (e2e — un seul test existant, contre un vrai backend, **pas mocké**)
- `@vue/test-utils` : un seul test de composant `.vue` à ce jour
  (`AppMobileMenu.test.js`, Phase 6.3) — justifié par une logique de navigation
  role-aware qui vit uniquement dans ce composant (`.cursorrules` interdit à un
  composable de naviguer, donc pas de seam composable équivalent pour cette
  régression précise). Rien d'automatique au-delà : cas par cas, voir R-24
  (roadmap) pour le prochain candidat évalué.

**Qualité**
- ESLint (config plate, `eslint.config.js`) + `@intlify/eslint-plugin-vue-i18n`
- Prettier (`skipFormatting`)
- Husky (hook `prepare`)

**Autre**
- Stripe prévu mais non implémenté (champs de schéma existants, page de test
  isolée) — hors périmètre V1
- npm comme gestionnaire de paquets

## MCP disponibles pour ce projet

`context7`, `vitest`, `eslint`, `playwright` et `github` sont check-in dans
`.mcp.json` (versionné, tout le monde les récupère au clone). `amplify-docs` reste
configuré en dehors (global, par machine) — son binaire pointe vers un chemin
local, pas encore packagé pour être partageable en l'état.

- **amplify-docs** — à consulter avant tout code touchant Amplify (auth, API,
  schema, functions). **Limitation connue depuis la Phase 8** : son index
  local ne couvre que la doc Gen1 — inutilisable pour vérifier un pattern Gen2
  (`defineAuth`, `defineData`, fonctions). Pour la durée de la migration,
  s'appuyer sur `context7`/recherche web pour tout ce qui est Gen2, et
  continuer à confirmer via `amplify-docs` uniquement les points encore Gen1
  (code legacy pas encore migré). Repointer l'index vers la doc Gen2 dès qu'un
  binaire à jour est disponible (pas fait à ce jour, pas bloquant).
- **context7** — vérifie l'API exacte de Vue 3 / Pinia / PrimeVue / vue-router /
  vue-i18n avant d'écrire du code (pas de TypeScript ici pour rattraper les
  erreurs à la compilation).
- **vitest** — lance les tests via ce MCP plutôt que `npm run test` en Bash brut.
- **eslint** — vérifie les warnings avant de proposer un commit, en particulier
  les règles i18n. Une dette de warnings i18n (`no-raw-text` sur emojis/
  ponctuation notamment) subsiste par endroits sur ce repo — demande
  confirmation avant de la corriger en masse ; voir le skill `/i18n-audit` pour
  un état des lieux sans correction automatique.
- **playwright** — le seul test e2e tourne contre un vrai backend (Cognito/
  DynamoDB réels, pas mocké). Demande une confirmation explicite avant de le
  lancer : ça peut créer ou modifier des données réelles.
- **github** — lecture/création de PR et statut CI directement, plutôt que `gh`
  en Bash brut.

## Garde-fous automatiques (`.claude/settings.json`)

Deux `PreToolUse` hooks bloquent l'édition par l'agent de fichiers sensibles :
les GraphQL auto-générés (`src/graphql/{queries,mutations,subscriptions}.js` —
un vrai bug de ce repo vient de là) et tout fichier `.env*` (historique de
secrets committés par erreur). Voir `.claude/hooks/`.

## Subagents disponibles

En plus du pipeline roadmap (`senior-dev` → `qa-test-engineer` →
`lead-dev-reviewer` → `devsecops-aws`, invoqué selectivement) : `graphql-schema-
reviewer` (revue ciblée de tout diff sur `schema.graphql`, en complément de
`lead-dev-reviewer` — voir le bug réel du commit `d27f204` qui motive son
existence) et `a11y-reviewer` (passe accessibilité légère sur les `.vue`
touchés, en parallèle du reviewer principal).

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
- **i18n** : `$t()` est la norme, suivie dans toutes les vues/composants du
  repo (`DashboardView.vue` avait des chaînes françaises en dur — corrigé,
  roadmap Phase 7 section C).
- **Enums** : les valeurs de statut/type viennent de `src/constants/enums.js`,
  jamais de littéraux en dur (R-14, `docs/audit/BACKLOG.md` — traité, roadmap
  Phase 7 section C).
- **Accessibilité — nom accessible sur un champ à placeholder seul** : prop
  `ariaLabel` (défaut `''`) sur un composant wrapper (`inheritAttrs: false`),
  forwardée nommément sur le composant PrimeVue interne (`:aria-label="ariaLabel
  || undefined"` — le `|| undefined` évite un `aria-label=""` qui viderait le nom
  accessible). Voir `PhoneInput.vue`/`AddressAutocomplete.vue`, consommé par
  `RegisterOwnerView.vue` (roadmap Phase 6.B). Référence pour tout futur
  formulaire qui ne peut pas se permettre un `<label>` visible.
- **Écriture Veterinarian scopée sur `Animal`/`Request`/`Mission`** : pattern
  utilisé cinq fois (ADR-0002, ADR-0003, ADR-0004, ADR-0005) — `@auth` au niveau
  champ (pas de mutation dédiée/Lambda) apparié à une mutation `*Simple`
  n'envoyant que les champs autorisés. Référence pour tout futur champ
  écrit par les Veterinarians **seuls** (règle owner restreinte à `[read]`).
  Limite connue : le Transformer v1 ne restreint jamais une valeur (seulement
  un ensemble d'opérations) — voir ADR-0004/ADR-0005 pour les cas où ça laisse
  un résidu assumé. **Variante** quand le champ est déjà écrit par l'Owner
  (règle owner alors laissée sans restriction d'opérations) : voir ADR-0006
  (`Animal.bloodGroup`) — ne pas copier `[read]` pour l'Owner dans ce cas, ça
  casserait la création/édition existante.
- **Écriture secondaire best-effort** : une écriture non critique qui suit une
  écriture critique déjà réussie (nettoyage de Mission orpheline dans
  `useOwnerMissions.js`, upsert `ClinicOwnerRelation` dans
  `useMissionClosure.js`) avale son erreur (log, jamais rethrow) — sinon
  l'utilisateur verrait un échec trompeur alors que l'essentiel a réussi. Zéro
  outil de suivi d'erreurs ici : un échec répété reste invisible (trou
  d'observabilité connu, roadmap Phase 5, pas résolu).
- **Lecture secondaire non-exclusive isolée** : un critère non-exclusif
  ("favorise, sans exclure", ex. Clinic Priority dans `checkEligibility()`) dont
  la lecture GraphQL est indépendante du reste d'un flux plus large a besoin de
  son propre `try/catch` dédié, avec repli sur une valeur par défaut neutre (ex.
  `ownerClinicIds = []` dans `useMatchingRequests.js`) — jamais le `try/catch`
  englobant du composable. Sinon un échec transitoire de cette seule lecture
  annule tout le flux (ex. vide `matches.value` en entier) alors que son propre
  échec ne devrait dégrader que ce critère précis. Pendant de la "écriture
  secondaire best-effort" ci-dessus, mais côté lecture.
- **Lecture secondaire EXCLUSIVE isolée, fail-closed** : le pendant du point
  précédent quand le critère lu n'est PAS "favorise sans exclure" mais
  authentiquement exclusif (ex. `matchesAvailability()` dans
  `useMatchingRequests.js`, ADR-0005 — un créneau de RDV que l'Owner ne peut
  structurellement pas honorer n'est jamais un vrai match). Le repli neutre du
  point précédent (`[]` → dégrade juste le tri) devient ici un faux positif à
  éviter : pas de repli neutre, pas même de `try/catch` dédié si le composable
  réutilisé (ex. `useOwnerAvailability.js`) avale déjà ses erreurs sans jamais
  réassigner sa ref sur échec — un tableau vide en sortie du composable suffit à
  produire `false` côté fonction pure, fail-closed par construction plutôt que
  par code de repli dupliqué.
- **Résolution de contexte (`clinicID`/etc.) qui ne catch pas ses propres
  erreurs** : un helper interne à un composable qui résout un identifiant
  requis pour la suite du flux (ex. `fetchClinicContext()` dans
  `useClinicDonors.js`, `fetchClinicId()` dans `useClinicRequest.js`) ne doit
  PAS avaler ses erreurs réseau/`@auth` dans son propre `try/catch` — il ne
  renvoie `null`/`undefined` QUE pour le cas légitime "cette ressource n'existe
  pas encore" (ex. Veterinarian sans `clinicID`). Une vraie erreur remonte telle
  quelle jusqu'au `try/catch` de la fonction appelante (celle qui pilote
  `loadError`), seule à même de distinguer "en erreur" de "légitimement vide" —
  sinon `loadError` ne se déclenche jamais sur ce chemin, quel que soit
  l'échec (voir `docs/audit/BACKLOG.md` R-12).

- **Backend Gen2 (`amplify/**/*.ts`)** : un seul `tsconfig.json` à la racine,
  scopé via `include: ["amplify/**/*.ts"]` (aucun effet sur le lint/build
  frontend, voir ADR-0007) ; vérification par `npx tsc --noEmit -p
  tsconfig.json` (aucun appel réseau/AWS), jamais `ampx sandbox`/`pipeline-
  deploy` en dehors d'un déploiement réel décidé par le repo owner. Un trigger
  Cognito suit `amplify/functions/<nom>/{resource.ts,handler.ts}`
  (`defineFunction`), référencé depuis `amplify/auth/resource.ts` ; une
  permission IAM à accorder à une fonction se fait dans `amplify/backend.ts`
  via l'échappatoire CDK (`backend.<fn>.resources.lambda.addToRolePolicy(...)`),
  toujours scopée à la ressource exacte (jamais de wildcard) — voir ADR-0008
  pour un exemple complet.

## Tenir ce fichier à jour

Vit avec le projet, ne se fige pas au premier commit. Une sous-tâche qui
introduit un pattern réellement suivi (pas une supposition) le documente ici
dans la même PR — c'est arrivé une fois à la section "7 piliers" de
`lead-dev-reviewer.md`, restaurée après coup faute de ça. Le détail lourd va
dans `docs/adr/`/`CONTEXT.md`, juste un pointeur ici : une carte sous 100
lignes, pas une documentation exhaustive.
