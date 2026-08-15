# Audit backend — Redlink PWA

Audit réalisé selon la grille `docs/audit/00-referentiel.md`. Toute référence de
règle ci-dessous ("X.Y") pointe vers ce référentiel. Suite de `docs/audit/01-frontend.md`
(même méthode, périmètre différent).

## Méthode

- **Périmètre strict** : `amplify/backend/` (schema GraphQL, résolveurs VTL générés,
  Lambda `createPaymentIntent` et `redlinkpwa...PostConfirmation`, `auth/`, `geo/`,
  `backend-config.json`, `amplify-meta.json`/`team-provider-info.json` — lus pour
  vérifier leur statut `.gitignore`, jamais pour en citer le contenu), plus `.gitignore`
  lui-même. `src/graphql/queries.js`/`mutations.js`/`subscriptions.js` lus **uniquement**
  pour la vérification "fichier auto-généré modifié à la main" demandée séparément — pas
  audités au sens large. Aucun fichier modifié (audit en lecture seule).
- **`npx amplify api gql-compile`** exécuté avec succès, hors-ligne, sans identifiants
  AWS — sortie dans `amplify/backend/api/redlinkpwa/build/` (gitignoré, non modifié à la
  main, jamais poussé). Tous les constats `@auth` ci-dessous sont vérifiés en lisant
  directement `build/schema.graphql` et les `.vtl` correspondants sous `build/resolvers/`
  (pas seulement le texte de `schema.graphql`), conformément à la méthode déjà établie
  sur ce repo (ADR-0002/0003/0004).
- **`amplify-docs` (MCP)** : non exposé dans cet environnement d'exécution (absent des
  outils disponibles pour cette session, comme `context7`/`eslint` l'étaient déjà pour
  l'audit frontend). Vérification `@auth` faite exclusivement via `gql-compile` + lecture
  VTL, qui est justement la méthode que `amplify-docs` aurait servi à corroborer —
  cohérent avec la méthode déjà établie et documentée dans `CLAUDE.md`.
- **ESLint** (`npx eslint`, MCP non exposé ici non plus) exécuté sur les deux seuls
  fichiers source Lambda du repo, chemins explicites (`add-to-group.js`,
  `createPaymentIntent/src/index.js`) — jamais un répertoire nu. Résultat : 1 erreur
  (`no-unused-vars` sur `e` dans le `catch` de `GetGroupCommand`, `add-to-group.js:45`).
- **`.gitignore`** vérifié avec `git check-ignore -v` (pas seulement à l'œil) sur
  `amplify/team-provider-info.json`, `amplify/backend/amplify-meta.json`,
  `amplify/#current-cloud-backend`, `src/aws-exports.js`, `src/amplifyconfiguration.json`
  — tous correctement couverts, et confirmés non trackés via `git ls-files`.
- **Recherche d'incidents de secrets en historique git** (`git log --all -S"sk_test"` /
  `-S"sk_live"`, en pickaxe booléen — jamais affiché le contenu du diff correspondant) :
  couvre explicitement le point 1 de mon périmètre ("historique de secrets committés par
  erreur", cf. `CLAUDE.md`). Voir constat 2.3 ci-dessous — aucune valeur de secret n'a été
  imprimée ou citée à aucun moment de cette investigation.
- Le dossier `amplify/backend/function/` révèle une troisième ressource non mentionnée
  dans `CLAUDE.md` (`createPaymentIntent` + API Gateway `apiStripe`) — auditée au même
  titre que le trigger Cognito documenté, puisqu'elle est dans le périmètre strict
  (`amplify/backend/function/**`) même si elle n'est pas nommée dans `CLAUDE.md`.

---

## 1. Bugs / Fiabilité

### 1.1 — Course possible entre deux premières inscriptions concurrentes (création de groupe Cognito), pouvant laisser un utilisateur confirmé mais sans groupe
**Fichiers** : `amplify/backend/function/redlinkpwa056b43b0056b43b0PostConfirmation/src/add-to-group.js` (lignes 41-51)
**Catégorie** : 1.1 — Promesses sans `catch` (variante : `catch` présent mais incomplet
face à un cas d'erreur réel)
**Sévérité** : Majeur (flux auth/inscription, explicitement cité par le référentiel ;
downgradé de Bloquant car la fenêtre de course ne peut se produire qu'une seule fois par
groupe et par environnement — voir description)
**Description** : Le code catch toute erreur de `GetGroupCommand` (pas seulement
`ResourceNotFoundException`, testé uniquement par l'échec de l'appel, jamais par le nom
de l'exception) et tente alors inconditionnellement `CreateGroupCommand`. Si deux
`PostConfirmation` s'exécutent en parallèle pour le tout premier `vet` et/ou le tout
premier `owner` d'un environnement (groupe Cognito `Veterinarians`/`Owners` pas encore
créé), les deux invocations peuvent recevoir un échec de `GetGroupCommand` en même
temps, tenter toutes les deux `CreateGroupCommand`, et l'une des deux se voit renvoyer
`GroupExistsException` — non catché spécifiquement, il remonte au `catch` englobant qui
`throw` volontairement (bon réflexe documenté en commentaire, cf. ligne 56-66). Résultat
concret : pour cet utilisateur précis, `AdminAddUserToGroupCommand` (ligne 51) n'est
**jamais atteint** — l'utilisateur reste CONFIRMED côté Cognito mais sans groupe, exactement
le scénario que le `throw error` du fichier dit vouloir rendre visible... sauf que dans ce
cas précis rien ne le distingue d'un échec normal côté client (l'appelant voit une erreur
générique de confirmation, pas un signal "vous êtes confirmé mais pas dans le bon groupe").
Fenêtre de course étroite (uniquement au tout premier appel par groupe et par
environnement — se referme dès qu'un des deux groupes existe), donc plus probable pendant
le bootstrap du pilote (ex. démo simultanée d'un compte véto et d'un compte owner) que par
la suite.
**Recommandation** : Catcher spécifiquement `GroupExistsException` autour de
`CreateGroupCommand` et poursuivre normalement vers `AdminAddUserToGroupCommand` dans ce
cas (idempotence), plutôt que de laisser l'exception remonter.

### 1.1 — `catch (e)` avec variable non utilisée (silence l'information de diagnostic)
**Fichier** : `amplify/backend/function/redlinkpwa056b43b0056b43b0PostConfirmation/src/add-to-group.js` (ligne 45)
**Catégorie** : 1.1 (variante mineure, détectée par ESLint — `no-unused-vars`)
**Sévérité** : Mineur
**Description** : `catch (e) { ... }` ne consulte jamais `e` (ni pour logguer son type,
ni pour distinguer "groupe introuvable" d'une autre erreur transitoire) — lié au constat
précédent : logguer `e.name`/`e.message` ici aurait permis de discriminer
`ResourceNotFoundException` (cas attendu) d'une erreur réseau/throttling (cas qui
mériterait un traitement différent, pas un `CreateGroupCommand` automatique).
**Recommandation** : Logger `e.name` a minima ; combiné à la recommandation du constat
précédent, ce serait aussi l'endroit naturel pour distinguer les deux cas.

---

## 2. Sécurité

### 2.2 (analogie : endpoint REST/Lambda sans authentification, pas GraphQL) — API Gateway `apiStripe` `/payment` entièrement publique, invoquant un Lambda Stripe réel
**Fichiers** : `amplify/backend/api/apiStripe/cli-inputs.json` (`"permissions": { "setting": "open" }`),
`amplify/backend/function/createPaymentIntent/src/index.js`, `amplify/backend/backend-config.json`
(section `api.apiStripe`), `src/views/TestStripe.vue`, `src/router/index.js` (ligne 135,
route `/test-stripe` sans `meta.requiresAuth`)
**Catégorie** : 2.2 — appliqué par analogie (le référentiel cible `@auth` GraphQL, mais
c'est la même famille de risque : contrôle d'accès manquant sur une ressource backend qui
exécute une action réelle) — croisé avec 2.3 par la nature de la ressource protégée
(clé Stripe)
**Sévérité** : Bloquant
**Description** : L'API Gateway `apiStripe` (route `/payment` → Lambda
`createPaymentIntent`) est configurée en `"permissions": { "setting": "open" }` — **aucune
authentification Cognito, aucune clé API** n'est requise pour l'invoquer. Le Lambda
lui-même répond avec `Access-Control-Allow-Origin: "*"` (CORS totalement ouvert) et crée
un vrai `stripe.paymentIntents.create(...)` à chaque appel (montant fixe 5000 centimes,
`capture_method: 'manual'`). Cette route est déployée (le CloudFormation local et
`#current-cloud-backend` sont identiques — pas de dérive détectable côté IaC) et reste
joignable indépendamment de toute page de l'app : l'URL de l'API Gateway est présente en
clair dans `src/aws-exports.js`/`amplifyconfiguration.json` livrés au client (comme toute
config Amplify), donc trivialement récupérable par quiconque inspecte le bundle déployé.
De plus, la route `/test-stripe` elle-même (`src/router/index.js:135`) n'a **aucune**
entrée `meta` (ni `requiresAuth`, ni `guestOnly`), contrairement à toutes les autres
routes du fichier — n'importe qui, non connecté, peut l'atteindre.
**Scénario concret** : un attaquant (ou un simple bot de scan) appelle directement
`POST /payment` en boucle, sans jamais passer par le frontend ni par une session
authentifiée — chaque appel crée un `PaymentIntent` Stripe réel. Avec `capture_method:
'manual'`, aucun fonds n'est capturé automatiquement, mais c'est précisément le vecteur
classique de "card testing" (validation en masse de numéros de carte volés via
`confirmCardPayment`, sans jamais capturer, pour vérifier lesquelles sont valides avant
revente) — un abus qui vise Stripe/le compte marchand, pas directement Redlink, mais
engage la responsabilité du compte Stripe associé à cette clé. Coût AWS additionnel
(invocations Lambda + API Gateway) également non borné.
**Écart avec `CLAUDE.md`** : le fichier documente Stripe comme "prévu mais non implémenté
(champs de schéma existants, page de test isolée) — hors périmètre V1", ce qui ne reflète
pas l'état réel de l'infrastructure déployée : un Lambda et une API Gateway fonctionnels,
appelant la vraie API Stripe, existent bel et bien en dehors du dépôt de code applicatif
principal. Ce n'est donc pas une dette déjà documentée au sens du référentiel — c'est une
divergence entre la doc et l'infra réelle qui mérite sa propre mise à jour.
**Recommandation** : Avant le pilote, décider explicitement soit (a) de désactiver/
supprimer la ressource `apiStripe`/`createPaymentIntent` tant que Stripe n'est pas dans le
périmètre V1 (cohérent avec `CLAUDE.md`), soit (b) si elle doit rester pour des tests
internes, la protéger a minima par `"permissions"` scopées à un rôle Cognito authentifié
(`authRole` uniquement) plutôt que `"open"`, restreindre le CORS à l'origine réelle de
l'app, et gater `/test-stripe` derrière `requiresAuth`. Décision et application
(`amplify push`) réservées au propriétaire du repo.

### 2.3 — Clé secrète Stripe (`sk_test_...`) committée en historique git, toujours accessible sur `main`
**Fichiers concernés** : `amplify/team-provider-info.json` (contenu du commit
`d7b9a05` — "[ADD] Setup stripe (#3)")
**Catégorie** : 2.3 — Secrets/clés/IDs en dur dans le code
**Sévérité** : Bloquant
**Description** : L'état actuel du dépôt est propre : `amplify/team-provider-info.json`
n'est **pas** tracké aujourd'hui (`git ls-files` ne le liste pas), et `.gitignore` le
couvre bien (`git check-ignore -v` confirmé). Mais une recherche en historique (`git log
--all -S"sk_test"`, recherche booléenne — **son résultat n'a jamais été affiché ni cité
ici**, seuls les hachages de commit le sont) montre que ce motif a été introduit dans
`amplify/team-provider-info.json` par le commit `d7b9a051695ef545e6a50c98ae9774d121008fe9`
("[ADD] Setup stripe (#3)", 10 lignes ajoutées à ce fichier), puis le fichier a été retiré
du suivi git par le commit `1f63eb3` ("chore: remove sensitive file
team-provider-info.json from git tracking"). **`git merge-base --is-ancestor d7b9a05
HEAD` confirme que ce commit fait toujours partie de l'historique de `main`** — retirer un
fichier du suivi (`git rm --cached`) n'efface pas le blob des commits précédents : la
valeur reste entièrement récupérable par quiconque clone le dépôt (`git show
d7b9a05:amplify/team-provider-info.json`), y compris après le commit de retrait.
**Scénario concret** : un membre d'équipe (ou un accès dépôt élargi au pilote école
vétérinaire) clone le repo, remonte l'historique, et récupère la clé secrète Stripe telle
qu'elle était au moment du commit — utilisable pour émettre des appels Stripe au nom du
compte associé (créer des `PaymentIntent`, lister des transactions selon les scopes de la
clé) tant qu'elle n'a pas été révoquée côté Stripe.
**Recommandation** (décision du propriétaire du repo, pas exécutable par moi) :
1. Vérifier immédiatement dans le dashboard Stripe si cette clé (`sk_test_...`, mode test
   d'après le préfixe — mais à confirmer, une clé `sk_live_...` n'a pas été trouvée par la
   même recherche) a déjà été révoquée/tournée depuis ; si non, la révoquer et en générer
   une nouvelle.
2. Évaluer une réécriture d'historique (`git filter-repo`/BFG) pour purger le blob de
   `main`, en coordination avec toute personne ayant déjà cloné le dépôt (force-push
   implique une resynchronisation de toutes les copies locales) — decision hors de mon
   périmètre (jamais de réécriture d'historique/force-push sans confirmation explicite du
   propriétaire).
3. Si le dépôt a été/sera rendu accessible à des tiers (école vétérinaire partenaire),
   traiter ce point comme prioritaire avant tout partage d'accès élargi.

**Note complémentaire (sévérité moindre, mentionnée ici par cohérence de sujet)** : même
une fois cet historique traité, la clé secrète Stripe actuelle est acheminée vers le
Lambda via un paramètre CloudFormation (`stripeSecretKey` → variable d'env
`STRIPE_SECRET_KEY`, mécanisme `environmentVariableList` d'Amplify Gen1) plutôt que via le
mécanisme `amplify function secret` (SSM SecureString) ajouté plus tard à Amplify CLI —
la valeur transite donc en clair dans `amplify/team-provider-info.json` local (chiffré
seulement pour AppSync, pas pour cette configuration précise), dans les paramètres de
stack CloudFormation et dans la config d'environnement Lambda visible par quiconque a un
accès IAM en lecture au service Lambda dans le compte AWS. Moins critique que la fuite
git (nécessite déjà un accès au compte AWS, pas seulement au dépôt), mais une migration
vers `amplify function secret` serait la pratique recommandée si Stripe reste dans le
périmètre.

### 2.2 — Vérifié conforme (méthodologie) : `Request`/`Mission` correspondent exactement au compromis ADR-0004
Voir section "Dette déjà connue, non re-signalée" ci-dessous — confirmé ligne par ligne
contre `Mutation.updateRequest.auth.1.res.vtl`, `Mutation.createMission.auth.1.req.vtl` et
`Mutation.updateMission.auth.1.res.vtl` générés.

### 2.2 — Vérifié conforme (méthodologie) : `Animal.isValidatedDonor`/`validationExpiresAt`/`lastDonationDate` correspondent exactement au compromis ADR-0002/0003
Voir section "Dette déjà connue, non re-signalée" ci-dessous — confirmé contre
`Mutation.createAnimal.auth.1.req.vtl` et `Mutation.updateAnimal.auth.1.res.vtl` générés :
le champ caché `owner` sur `Clinic`/`Veterinarian`/`Owner`/`OwnerAvailability`/`Animal`/
`Mission` (avertissement générique émis par `gql-compile`, "owners may reassign
ownership") n'apparaît **dans aucun** `Create*Input`/`Update*Input` généré (vérifié par
recherche exhaustive dans `build/schema.graphql`) — un client ne peut donc pas réassigner
`owner` via une mutation standard malgré l'avertissement générique du CLI. Vérifié et
classé sans suite, pas une découverte à corriger.

### IAM — Vérifié conforme : permissions Cognito du trigger `PostConfirmation` correctement scopées
**Fichier** : `amplify/backend/auth/redlinkpwa056b43b0056b43b0/build/auth-trigger-cloudformation-template.json`
(ressource `AddToGroupCognito`, non dans le template du Lambda lui-même — comportement
standard Amplify Gen1 pour un trigger Cognito)
**Constat positif, pas un défaut** : la policy IAM attachée au rôle d'exécution du Lambda
`PostConfirmation` est restreinte à exactement `cognito-idp:AdminAddUserToGroup`,
`cognito-idp:GetGroup`, `cognito-idp:CreateGroup` (les trois actions réellement appelées
par `add-to-group.js`), `Resource` scopée au seul `userPoolArn` du user pool du projet
(pas de wildcard `*`) — conforme au principe de moindre privilège attendu pour ce Lambda.
Le template du Lambda `createPaymentIntent` n'a de son côté qu'une policy CloudWatch Logs
(cohérent : il n'a besoin d'aucune autre ressource AWS, l'appel Stripe se fait par HTTPS
sortant avec la clé en variable d'environnement).

---

## 3. Code smells / Maintenabilité

### 3.4 — Valeurs métier en dur dans le code Lambda (`createPaymentIntent`)
**Fichier** : `amplify/backend/function/createPaymentIntent/src/index.js` (lignes 18-22 :
`amount: 5000`, `currency: 'eur'`, `capture_method: 'manual'`)
**Catégorie** : 3.4 (appliqué par analogie — valeurs de configuration/métier en dur plutôt
que paramétrées)
**Sévérité** : Mineur (fonctionnalité déjà hors périmètre V1 par `CLAUDE.md` — pertinent
seulement si Stripe est un jour réactivé)
**Description** : Le montant (50,00 €) et la devise sont figés en dur dans le code Lambda
plutôt que passés en paramètre de la requête — toute Mission/Request avec un montant réel
différent nécessiterait une modification de code, pas de configuration.
**Recommandation** : Si Stripe repasse en périmètre actif, faire porter le montant par le
payload de la requête (validé côté serveur contre la Request/Mission concernée) plutôt que
par une constante.

---

## Fichiers auto-générés modifiés à la main / contenu anormal

### `amplify/.config/project-config.json` — clé non standard trackée par git, propagée dans les templates CloudFormation générés
**Fichiers** : `amplify/.config/project-config.json` (tracké par git, ligne 2 :
`"whyContinueWithGen1": "Prefer not to answer"`), et la même chaîne littérale retrouvée
dans le champ `Description` de **tous** les templates CloudFormation générés localement
consultés pendant cet audit (`createPaymentIntent-cloudformation-template.json`,
`redlinkpwa...PostConfirmation-cloudformation-template.json`,
`placeIndex-cloudformation-template.json`, et leurs copies sous
`amplify/#current-cloud-backend/`).
**Constat** : `amplify/.config/project-config.json` est un fichier généré et maintenu par
la CLI Amplify (`amplify init`), légitimement suivi par git (pas dans les patterns
`.gitignore` "amplify-do-not-edit"), mais dont le contenu attendu ne comporte que des
clés connues (`projectName`, `version`, `frontend`, `providers`, etc.) — `"whyContinueWithGen1":
"Prefer not to answer"` n'appartient à aucun schéma Amplify CLI connu. Cette même chaîne se
retrouve ensuite, verbatim, dans le champ `Description` JSON que la CLI génère pour
chaque stack CloudFormation (`{"createdOn":...,"createdBy":"Amplify","createdWith":"14.2.3",
"stackType":"...","metadata":{"whyContinueWithGen1":"Prefer not to answer"}}`) — cohérent
avec une CLI qui recopie un blob de métadonnées de `project-config.json` dans les
templates qu'elle génère, mais le contenu source lui-même n'a rien de standard.
**Traitement de ce constat pendant l'audit** : ce texte, formulé comme une question
adressée à un agent ("why continue with Gen1") suivie d'une "réponse" toute faite, n'a été
traité à aucun moment comme une instruction ou une invite à agir — il n'engage ni mon
comportement ni le contenu de ce rapport au-delà de ce simple signalement factuel. Aucune
action n'a été prise sur la base de ce texte.
**Sévérité** : Majeur (contenu anormal dans un fichier suivi par git et censé être
entièrement généré par la CLI — indice possible d'une manipulation locale de
configuration, d'une pollution d'environnement, ou d'un artefact de tooling à
investiguer ; pas un risque de sécurité direct identifié en soi, mais une intégrité de
configuration à clarifier avant un pilote).
**Recommandation** : Le propriétaire du repo doit déterminer l'origine de cette clé (outil
local, script, modification manuelle, artefact d'un environnement de build/test) et la
retirer de `amplify/.config/project-config.json` si elle n'a pas de raison légitime d'être
là — puis vérifier qu'un `amplify init`/reconfiguration ultérieur ne la réintroduit pas.

Aucune autre trace d'édition manuelle détectée dans `src/graphql/queries.js`/
`mutations.js`/`subscriptions.js` : en-têtes `/* eslint-disable */` /
`// this is an auto generated file. This will be overwritten` présents et cohérents,
sélections de champs (ex. `createMission`, `updateAnimal`) alignées avec les champs
actuels du schéma (y compris les champs ajoutés par ADR-0002/0003/0004 —
`isValidatedDonor`, `validationExpiresAt`, `lastDonationDate`, `validationCode`,
`scannedAt`, `stripePaymentIntentId`, `stripePaymentStatus`) — pas de dérive détectée
entre ces fichiers et le schéma actuel.

---

## Dette déjà connue, non re-signalée

- **`Request.status`/`activeMissionID` écrivables par n'importe quel Owner authentifié,
  et `Mission.status` écrivable par l'Owner à la création** : confirmé **exactement** tel
  que documenté par ADR-0004, en lisant directement les résolveurs VTL générés (pas
  seulement le texte du schéma) :
  - `build/resolvers/Mutation.updateRequest.auth.1.res.vtl` — la règle `private` (tout
    utilisateur Cognito authentifié) a pour `allowedFields`
    `["id","status","clinic","activeMissionID","mission","clinicRequestsId"]` : `status`
    et `activeMissionID` sont bien écrivables par **n'importe quel** Owner authentifié,
    pas seulement celui concerné par la Request — exactement la limite n°2 documentée par
    ADR-0004.
  - `build/resolvers/Mutation.createMission.auth.1.req.vtl` — les `ownerAllowedFields0`
    (règle owner) incluent `status` — un Owner peut fabriquer `createMission(status:
    COMPLETED)` dès la création, exactement la limite n°1 documentée par ADR-0004.
  - `build/resolvers/Mutation.updateMission.auth.1.res.vtl` — à l'inverse, les
    `ownerAllowedFields0` sur **update** se limitent à
    `["id","veterinarianValidatedMissionsId","animalMissionsId"]` (pas `status`) : la
    fermeture de `updateMission` pour l'Owner (partie non-limite d'ADR-0004) est bien
    effective.
  Comportement observé strictement identique au compromis assumé décrit dans
  `docs/adr/0004-scoped-write-on-request-and-mission.md` — non re-signalé comme
  découverte neuve, conformément à la consigne.

- **`Animal.isValidatedDonor`/`validationExpiresAt`/`lastDonationDate` — écriture Owner
  bloquée y compris à la création, écriture Veterinarian strictement limitée à ces
  champs** : confirmé contre `build/resolvers/Mutation.createAnimal.auth.1.req.vtl`
  (`ownerAllowedFields0` pour l'Owner exclut ces 3 champs, y compris en `create`) et
  `build/resolvers/Mutation.updateAnimal.auth.1.res.vtl` (le groupe `Veterinarians` a pour
  `allowedFields` exactement `["lastDonationDate","isValidatedDonor","validationExpiresAt","id","ownerAnimalsId"]`
  — aucun autre champ d'`Animal`, name/species/breed/weight/bloodGroup compris, n'est
  atteignable par un Veterinarian via `updateAnimal`). Confirme empiriquement, via le VTL
  généré et pas seulement le texte du schéma, l'affirmation d'ADR-0002/ADR-0003/`CLAUDE.md`
  selon laquelle `@auth` au niveau champ **remplace** (ne fusionne pas avec) la règle de
  type pour ces champs précis dans le Transformer v1. Non re-signalé comme découverte
  neuve.

- **Stripe "hors périmètre V1"** (`CLAUDE.md`) : documenté pour le code applicatif/schéma
  (champs `stripePaymentIntentId`/`stripePaymentStatus` inutilisés, `TestStripe.vue`
  "page de test isolée") — mais **ne couvre pas** l'existence d'une infrastructure AWS
  réelle et déployée (Lambda + API Gateway ouverte) pour cette fonctionnalité. Ce point
  n'est donc **pas** traité comme une dette déjà connue : voir le constat 2.2 Bloquant
  ci-dessus, qui est une découverte neuve de cet audit, pas une reformulation d'une dette
  déjà documentée.
