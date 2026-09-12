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
- **Amplify Gen2 uniquement** (`ampx`, `defineAuth`, `defineData`,
  `backend.ts`) — la migration Gen1 → Gen2 (Phase 8, roadmap) est terminée
  côté code. Amplify Gen1 était en *maintenance mode* depuis le 1er mai 2026
  (fin de vie le 1er mai 2027) ; tout le code applicatif et l'infra déclarative
  Gen1 (`amplify/backend/`, Transformer v1/VTL, `src/graphql/{queries,
  mutations,subscriptions,custom-queries,custom-mutations}.js`) ont été
  retirés du dépôt en sous-tâche 6 (récupérables via l'historique git si
  besoin). Voir `docs/adr/0007` à `0011` — trace historique des décisions de
  migration, jamais marqués "superseded" au sens où leur raisonnement serait
  caduc (ADR-0001 à 0006 restent aussi la trace vivante des décisions de fond
  Gen1, dont la *forme* seule a changé de syntaxe en Gen2, voir ADR-0009/0010).
- AppSync/GraphQL via `defineData` — schéma déclaratif
  (`amplify/data/resource.ts`, `a.model()`/`a.schema()`), pas de SDL écrit à
  la main. Les 8 types `@model` et leurs règles d'autorisation (type et champ,
  traduction des patterns ADR-0002 à 0006) vivent dans ce fichier, avec le
  détail de la traduction `@auth` → `.authorization()` en commentaire et dans
  ADR-0009 (en particulier `ClinicOwnerRelation.ownerDefinedIn("ownerID")`,
  le pattern qui évite de reproduire le bug `d27f204`). `amplify/data/
  __tests__/resource.transform.test.ts` pin-teste `schema.transform().schema`
  (le SDL compilé) — c'est l'équivalent Gen2 de l'ancien
  `src/graphql/__tests__/schema.test.js` (Gen1, supprimé en sous-tâche 6,
  guaranties portées dans ce fichier plutôt que perdues).
- Une relation `hasOne`/`hasMany` exige toujours un `belongsTo` apparié sur le
  modèle ciblé, avec un champ de référence identique des deux côtés — le
  processeur de schéma Gen2 lève une erreur bloquante sinon (contrainte
  absente en Gen1/Transformer v1). Voir ADR-0010 (`Request.mission`/
  `Mission.request`, `Mission.activeForRequest`/`Request.missions` — ces deux
  derniers absents de Gen1, ajoutés uniquement pour satisfaire le validateur,
  `Veterinarian.validatedMissions` câblé sur le vrai FK).
- `defineData` n'expose **aucun** argument `condition` sur les mutations
  générées automatiquement (`client.models.X.update()`) — pour une écriture
  qui a besoin d'une garde DynamoDB conditionnelle (`ConditionExpression`, ex.
  écriture atomique anti-course à l'acceptation d'une Mission, ADR-0001), le
  chemin Gen2 est une **mutation custom** + resolver JS AppSync
  (`a.handler.custom({ dataSource: a.ref('ModelName'), entry:
  './resolvers/....js' })`, `ddb.update({ key, condition, update })` de
  `@aws-appsync/utils/dynamodb`) ciblant directement la table managée du
  modèle — pas une traduction `a.model()`/`.authorization()`. Le resolver est
  obligatoirement `.js` (pas `.ts` : `resolveEntryPath()` l'upload tel quel,
  sans transpilation, vers le runtime `APPSYNC_JS`). Voir ADR-0011
  (`linkRequestToMission`, `amplify/data/resolvers/link-request-to-mission.js`)
  pour l'exemple de référence à une seule fonction (un seul `dataSource`, un
  seul aller-retour DynamoDB).
- **Mutation custom en PIPELINE** (plusieurs fonctions, sources de données
  hétérogènes) : `.handler([...])` accepte un TABLEAU de `a.handler.custom({...})`
  — compile en un vrai resolver AppSync `kind: PIPELINE`, une fonction = UNE SEULE
  source de données (`dataSource: a.ref('ModelName')`), chaînées via
  `ctx.prev.result`. Nécessaire dès qu'une écriture doit (a) vérifier des données
  sur PLUSIEURS modèles avant/pendant l'écriture (ex. l'appelant est-il réellement
  partie à la ressource ?), ou (b) écrire sur plusieurs tables dans le même appel.
  `ctx.stash` : espace serveur partagé entre fonctions du pipeline, inaccessible au
  client, pour faire transiter un état calculé tôt (rôle de l'appelant, FK résolus)
  vers une fonction plus tardive sans le relire. `runtime.earlyReturn(ctx.prev.result)` :
  fait sauter la source de données ET le `response()` de la fonction courante — le
  moyen de porter plusieurs branches conditionnelles (ex. une vérification qui ne
  s'applique qu'à UN des deux rôles appelants) dans un seul pipeline sans payer les
  lectures qui ne concernent pas l'appelant courant. La DERNIÈRE fonction du
  pipeline doit renvoyer `ctx.prev.result` du type attendu par `.returns(...)` —
  si elle écrit sur une AUTRE table que le type de retour (ex. une fonction finale
  qui écrit `Animal` alors que la mutation `.returns(a.ref('Mission'))`), elle doit
  explicitement propager le résultat de la fonction précédente, pas son propre
  résultat. **Plafond AppSync : 10 fonctions par pipeline.** Voir
  `submitMissionValidation` (`amplify/data/resource.ts`, **10/10 fonctions — plafond
  atteint, plus aucune marge sans retirer une fonction existante ou changer de
  mécanisme**, `amplify/data/resolvers/submit-mission-validation-*.js`) et
  ADR-0018/0019/0020 pour l'exemple de référence complet (vérification d'identité
  multi-modèle + écriture cross-table).
- Cognito via `defineAuth` (`amplify/auth/resource.ts`) — user pools, groupes
  `Veterinarians`/`Owners` déclarés statiquement (`groups: [...]`),
  contrairement à Gen1 où ils étaient créés paresseusement au premier signup —
  voir ADR-0008.
- **BFF Cognito (`amplify/functions/bff/`)** : la session Cognito entière (ID/Access/
  Refresh token) vit exclusivement côté serveur, dans des cookies `HttpOnly`/`Secure`/
  `SameSite=Strict` — le navigateur ne détient jamais un JWT en JS, même en mémoire. SDK
  Cognito Identity Provider direct pour `/api/auth/*` (`signIn`/`signUp`/MFA/mot de passe
  oublié/MFA TOTP — `USER_PASSWORD_AUTH`, pas de réimplémentation SRP), relais GraphQL
  BRUT pour `/api/graphql` (le client `.models.X` construit le document GraphQL exactement
  comme avant, seul le header `Authorization` est substitué en vol). CloudFront devant SPA
  (Amplify Hosting) et BFF (Lambda Function URL + OAC) pour rester same-origin — nécessaire
  pour que `SameSite=Strict` fonctionne sans domaine personnalisé. Voir ADR-0021 pour le
  design complet, en particulier le piège vérifié dans le code source installé (`endpoint`
  passé à `generateClient()` désactive le chargement du schéma `.models`) qui a fait
  changer d'approche en cours d'implémentation.
- Geo (Amazon Location Service, place index) : pas de première-classe Gen2
  (pas de `defineGeo()`) — échappatoire CDK dans `amplify/backend.ts`
  (`backend.createStack('geo-stack')`, policy IAM scopée à l'ARN de l'index sur
  les DEUX rôles `authenticatedUserIamRole`/`unauthenticatedUserIamRole`,
  `backend.addOutput({ geo: {...} })`) — même famille de pattern que la
  mutation custom conditionnelle (ADR-0011) et la politique de mot de passe
  (ADR-0008). **Pas `CfnPlaceIndex`** (`aws-cdk-lib/aws-location`) : ce type
  synthétise directement `AWS::Location::PlaceIndex`, un type de ressource
  CloudFormation non reconnu dans `eu-west-3` (région réelle de ce projet) —
  `AwsCustomResource` (`aws-cdk-lib/custom-resources`, `AwsSdkCall.region`
  explicite vers `eu-west-1`) à la place, confirmé par un échec de déploiement
  réel (`ampx sandbox`). Référence pour toute future ressource AWS hors
  périmètre `auth`/`data`. Voir ADR-0012 (accès invité déjà couvert par le
  défaut Gen2 de `defineAuth`, rien à faire côté `amplify/auth/resource.ts`) et
  ADR-0013 (le correctif `AwsCustomResource`, qui amende la forme de la section
  2 d'ADR-0012 sans changer son raisonnement de fond).
- Lambda : trigger PostConfirmation sur le modèle de fonctions Gen2
  (`amplify/functions/post-confirmation/`, TypeScript, `defineFunction`),
  référencé depuis `amplify/auth/resource.ts` — voir ADR-0008.
- **Emails transactionnels de marque, avec i18n** : trigger Cognito `CustomMessage`
  (`amplify/functions/custom-message/`), même famille que PostConfirmation ci-dessus
  (référencé depuis `amplify/auth/resource.ts`, pas de `resourceGroupName`). Un template
  global (`templates/layout.ts`, `renderLayout()`) dont héritent les emails spécifiques
  (`templates/verification-email.ts` — couvre SignUp ET ResendCode,
  `templates/forgot-password-email.ts`) : fonctions TS pures qui renvoient des strings HTML
  (tables + CSS inline, compatibilité Outlook/Gmail), pas de moteur de templates. Locale
  transmise par `clientMetadata` (posée par le BFF sur `SignUpCommand`/
  `ResendConfirmationCodeCommand`/`ForgotPasswordCommand`), résolue avec repli sur `fr`
  uniquement côté `custom-message` (`i18n/messages.ts`, `resolveEmailLocale`) — jamais côté
  BFF. Référence pour tout futur email transactionnel (notification de match, etc.) : ajouter
  un fichier dans `templates/`, pas un nouveau système. Identité visuelle alignée sur le site
  réel, jamais inventée pour l'email (adresse expéditeur non personnalisable, défaut Cognito
  `no-reply@verificationemail.com`) : couleur d'accent `#ff3b4e`, wordmark `RedLink` (casse
  exacte, hardcodé dans `layout.ts` — jamais traduit, comme `AppHeader.vue`/`AppFooter.vue`).
  Voir ADR-0022 §5.
- **`resourceGroupName` sur `defineFunction` — critère complet** : une Lambda sans
  `resourceGroupName` rejoint par défaut la stack imbriquée partagée avec
  `post-confirmation` (trigger Cognito, dont `auth` dépend). Le critère pour lui en poser
  un n'est **pas** seulement "ai-je besoin d'une permission IAM sur `data`" (angle initial
  documenté ci-dessous pour les deux Lambdas à accès DynamoDB direct) — `backend.ts` posant
  un `addEnvironment()` référençant une ressource `auth`/`data` cross-stack suffit, À LUI
  SEUL, à fermer un cycle (`bff/resource.ts`, ADR-0021 §6ter — zéro permission DynamoDB,
  mais deux `addEnvironment()` cross-stack ont suffi à provoquer
  `CloudformationStackCircularDependencyError` en déploiement réel). Vérifier les DEUX
  angles avant de conclure qu'un `resourceGroupName` n'est pas nécessaire.
- **Lambda planifiée + accès DynamoDB direct** : `defineFunction({ schedule: { cron,
  timezone } })` (`amplify/functions/mission-validation-auto-finalizer/`, EventBridge
  Scheduler ; cron EventBridge à 5-6 champs, `day-of-month` OU `day-of-week` à `?`).
  Une Lambda qui doit écrire dans les données managées par `defineData` passe par le
  **SDK DynamoDB sur la table managée** (`backend.data.resources.tables['<Model>']`,
  policy IAM scopée à l'ARN exact — l'ARN de l'INDEX pour un `Query` sur GSI), pas par
  le client Data en mode IAM (`allow.resource()`) : les mutations générées n'ont pas de
  `condition` (ADR-0011) et une règle `allow.resource()` de niveau modèle ne s'applique
  pas aux champs portant un `@auth` de CHAMP (ADR-0009). Corollaire : écrire en direct
  bypasse AppSync, donc `createdAt`/`updatedAt`/`__typename` sont à poser à la main.
  Index secondaire : `.secondaryIndexes((index) => [index('champ').name(...)])` — un
  champ `a.ref()` d'enum y est éligible (contrairement à `.identifier()`, ADR-0015).
  Voir ADR-0016.
- **Lambda déclenchée par un flux DynamoDB** : les tables managées Gen2 ont DÉJÀ
  leurs Streams activés (`NEW_AND_OLD_IMAGES`, posé en dur par le transformer sur
  toute table `AMPLIFY_TABLE`) — rien à activer, `tables['<Model>'].tableStreamArn`
  est directement exploitable. `defineFunction` n'a pas de déclencheur "flux" :
  câblage CDK dans `backend.ts` (`lambda.addEventSource(new DynamoEventSource(table,
  {...}))`, qui pose l'`EventSourceMapping` ET les droits de lecture du flux).
  Régler explicitement `retryAttempts` (défaut = rejeu INFINI, shard bloqué 24 h) et
  filtrer sur `eventName` ; le handler doit être idempotent (le lot entier est rejoué
  sur échec). Voir `amplify/functions/rating-aggregation/` et ADR-0017.
- DynamoDB via les modèles `defineData` (`@model`/`a.model()`).
- **Champ dénormalisé calculé côté serveur (agrégat)** : quatrième idiome `@auth` de ce
  schéma — `.authorization()` de CHAMP n'accordant que `read`, à personne `create`/
  `update` (`clinicRatingAndModerationFieldsReadOnly`/`ownerRatingAggregateFieldsReadOnly`,
  agrégats de notation sur `Clinic`/`Owner`). Pour toute valeur qu'un client ne doit pas
  pouvoir falsifier ni même calculer : l'écriture passe uniquement par une Lambda (SDK
  direct). Attention en posant ce genre de règle : elle REMPLACE la règle de modèle
  (ADR-0009), donc retirer un rôle qui y avait `read` casse toute lecture SANS
  `selectionSet` explicite faite par ce rôle. Voir ADR-0017. Les seuils de
  modération (3 étoiles/5 avis pour `needsAdminReview`) sont des variables
  d'environnement de la Lambda `rating-aggregation` (`amplify/functions/
  rating-aggregation/resource.ts`), PAS dans `src/constants/` — un futur seuil
  d'alerte dashboard clinique (3,5 étoiles/3 avis, ADR-0017 §7, pas encore
  câblé côté front) devra décider où il vit : dupliquer la valeur côté
  `src/constants/enums.js` casserait la source de vérité unique si les deux
  seuils divergent un jour, la lire depuis le backend n'a pas de mécanisme
  établi dans ce repo à ce jour.
- **Enregistrement write-once (preuve immuable)** : `.authorization()` de niveau modèle
  posant `create`+`read` seul, sans jamais accorder `update`/`delete` à qui que ce soit,
  même l'auteur de la ligne — troisième idiome `@auth` de ce schéma, à côté des deux
  helpers de champ déjà établis (`ownerCreateReadOnlyVetReadUpdate`/
  `ownerReadOnlyVetReadUpdate`, tous deux laissent quelqu'un faire `update`). Utilisé par
  `ConsentRecord` (consentement CGU/confidentialité) et `DonorValidationAttestation`
  (attestation vétérinaire sur l'honneur) — voir ADR-0014. Référence pour tout futur
  enregistrement dont la valeur probante dépend de ne jamais pouvoir être réécrit.
- **Pages légales versionnées, contenu hors code** : markdown par document/langue
  (`public/legal/*.{fr,en}.md`, servi tel quel par Vite, jamais bundlé), chargé via
  `fetch()` (`useLegalDocument.js`) et rendu via `marked`
  (`src/services/legal-content-service.js`) — version en vigueur centralisée dans
  `src/constants/legal.js`, séparée du contenu lui-même. Voir ADR-0014.
- Les 13 composables applicatifs qui parlent GraphQL sont sur
  `client.models.X` (`generateClient()` importé de `@/services/bff-graphql-client`, pas
  directement `aws-amplify/data` depuis le BFF, voir plus haut/ADR-0021 — l'appel
  `client.models.X.*()` lui-même est identique à l'octet près) : `useAnimals.js`,
  `useOwnerProfile.js`, `useOwnerAvailability.js`,
  `useRegistrationCompletion.js`, `useClinicDonors.js`, `useClinicRequest.js`,
  `useClinicSettings.js`, `useClinicStats.js`, `useAnimalValidation.js`,
  `useMatchingRequests.js`, `useMissionClosure.js`, `useOwnerMissions.js` (ces
  deux derniers via `client.mutations.submitMissionValidation`, double
  validation de Mission, ADR-0018/0019/0020 — `useOwnerMissions.js` aussi via
  `client.mutations.linkRequestToMission`, ADR-0011), `useRatings.js`
  (notation par étoiles, `client.models.Rating.create()`, ADR-0015).
  **`src/composables/mission-completion-side-effects.js`** est un module à
  part — ni un `useXxx()` composable (aucune réactivité, rien à exposer à un
  composant) ni un `service` au sens strict ci-dessous (il fait des appels
  GraphQL, ce que `.cursorrules` interdit à un service) : un module partagé
  "composable-like" qui reçoit le client Gen2 en PARAMÈTRE (jamais
  `generateClient()` en interne) pour être appelable depuis `useMissionClosure.js`
  ET `useOwnerMissions.js` sans qu'un composable importe les internals d'un
  autre — convention à réutiliser pour toute future logique d'écriture
  GraphQL partagée par plusieurs composables. `src/
  main.js` importe `amplify_outputs.json` (généré par `npx ampx sandbox`,
  gitignored — n'existe qu'après un premier déploiement réel, action du repo
  owner, aucun agent ne déploie). Comportement central à connaître : le
  client Gen2 ne lève PAS d'exception sur une erreur GraphQL/`@auth` — il
  résout normalement `{ data, errors }`. Voir
  `src/services/graphql-error-service.js` pour le helper partagé qui
  retransforme `errors` en exception là où le contrat observable par
  l'appelant (vue, composable parent) doit rester inchangé.
  Pattern `selectionSet` (requêtes avec relation imbriquée, ex. `Clinic`
  imbriqué dans `Veterinarian`) : le `selectionSet` Gen2 est posé par CHAQUE
  appelant — chacun ne demande que les champs qu'IL consomme réellement (ex.
  `useClinicDonors.fetchClinicContext()` ne sélectionne que
  `clinic.latitude`/`clinic.longitude`, quand `useClinicSettings.fetchSettings()`
  a besoin de tous les champs de `Clinic` pour son formulaire d'édition).
  Vaut aussi pour un `.get()`/`.list()` sans relation imbriquée : ne pas
  laisser le `selectionSet` par défaut (tous les champs scalaires) sur un
  appel qui ne lit qu'un sous-ensemble des champs — surtout quand ce
  sous-ensemble appartient à un autre utilisateur (ex.
  `useClinicSettings.deleteAccount`'s garde-fou multi-vétérinaire, qui ne lit
  que `id` mais interrogeait par défaut les coordonnées de collègues).

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
  schema, functions). **Limitation permanente de l'outil, pas liée à une
  migration en cours** (la Phase 8 est terminée côté code) : son index local
  ne couvre que la doc Gen1 — inutilisable pour vérifier un pattern Gen2
  (`defineAuth`, `defineData`, fonctions) tant que le binaire n'est pas
  repointé. S'appuyer sur `context7`/recherche web pour tout ce qui est Gen2
  (c'est-à-dire tout le backend de ce repo désormais). Repointer l'index vers
  la doc Gen2 dès qu'un binaire à jour est disponible (pas fait à ce jour, pas
  bloquant).
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
un vrai bug de ce repo vient de là ; ces fichiers Gen1 n'existent plus depuis
la Phase 8 sous-tâche 6, le hook reste en place mais ne matche plus rien tant
que Gen2 ne génère pas d'équivalent à ce chemin) et tout fichier `.env*`
(historique de secrets committés par erreur). Voir `.claude/hooks/`.

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
  `eligibility-service.js`). Exceptions documentées (remplacements directs
  d'infrastructure, pas de la logique métier, même famille que
  `mission-completion-side-effects.js`) : `bff-graphql-client.js` (remplace
  `generateClient()` d'`aws-amplify/data`), `bff-auth-session.js` (remplace
  `getCurrentUser()`/`deleteUser()` d'`aws-amplify/auth`), `bff-fetch.js` (helper
  `fetch()` partagé vers `/api/auth/*`) — voir ADR-0021.
- **GraphQL (Gen2)** : `generateClient()` (`@/services/bff-graphql-client`, pas
  `aws-amplify/data` directement depuis un composable, voir ADR-0021),
  `client.models.X.create()/get()/list()/update()/delete()` pour le CRUD
  standard, `client.mutations.X()` pour une opération custom déclarée dans
  `amplify/data/resource.ts` (une seule à ce jour, `linkRequestToMission`,
  voir ADR-0011). `try/catch/finally` avec un ref de loading dédié — le
  client Gen2 ne lève PAS d'exception sur une erreur GraphQL/`@auth`, il
  résout `{ data, errors }` ; voir `src/services/graphql-error-service.js`
  pour retransformer `errors` en exception là où l'appelant a besoin de ce
  contrat. `selectionSet` explicite posé par chaque appelant pour toute
  requête avec relation imbriquée ou qui ne lit qu'un sous-ensemble des
  champs scalaires (voir la section Backend/Infra plus haut).
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
  utilisé cinq fois (ADR-0002, ADR-0003, ADR-0004, ADR-0005 ; traduit en Gen2
  par ADR-0009) — `.authorization()` au niveau champ dans
  `amplify/data/resource.ts` (pas de mutation dédiée/Lambda), le composable
  n'envoyant dans `input` que les champs qu'il a le droit d'écrire (plus
  besoin d'une mutation `*Simple` séparée comme en Gen1 : le client Gen2
  n'envoie que ce qu'on lui passe). Référence pour tout futur champ écrit par
  les Veterinarians **seuls** (règle owner restreinte à `[read]`). Limite
  connue, inchangée en Gen2 : `.authorization()` ne restreint jamais une
  valeur (seulement un ensemble d'opérations) — voir ADR-0004/ADR-0005 pour
  les cas où ça laisse un résidu assumé. **Variante** quand le champ est déjà
  écrit par l'Owner (règle owner alors laissée sans restriction d'opérations) :
  voir ADR-0006 (`Animal.bloodGroup`) — ne pas copier `[read]` pour l'Owner
  dans ce cas, ça casserait la création/édition existante.
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
