# Audit frontend — Redlink PWA

Audit réalisé selon la grille `docs/audit/00-referentiel.md`. Toute référence de
règle ci-dessous ("X.Y") pointe vers ce référentiel.

## Méthode

- **Périmètre strict** : `src/components/`, `src/composables/`, `src/views/`.
  Aucun autre répertoire lu ni modifié (`src/services/`, `src/graphql/`,
  `amplify/`, tests exclus du contenu audité — leur seule *existence* a été
  utilisée pour juger la règle 5.1).
- **Lecture exhaustive** des 41 fichiers de production du périmètre (composant
  par composant, composable par composable, vue par vue) plutôt qu'un
  échantillonnage — le MCP `serena` n'étant pas exposé dans cet environnement
  d'exécution, la recherche de duplication/complexité s'est appuyée sur une
  lecture complète croisée avec `grep`/`git grep` ciblés (ex. littéraux
  d'énum, `v-html`, timers/listeners) plutôt que sur une analyse symbolique
  automatisée.
- **ESLint** (`npx eslint`, fallback documenté dans `CLAUDE.md` puisque le MCP
  `eslint` n'est pas non plus exposé ici) exécuté sur les 41 fichiers du
  périmètre (fichiers explicites, jamais un répertoire nu). Résultat : 1
  erreur (`no-unused-vars` sur `getVetWithClinic` dans `useClinicRequest.js`)
  et 40 warnings, très majoritairement `@intlify/vue-i18n/no-raw-text` (texte
  brut dans des templates hors `DashboardView.vue`, ex. `HomeView.vue`,
  `AppFooter.vue`, `AppHeader.vue`, `RequestsView.vue`, `AnimalsView.vue`,
  `MissionsView.vue`) et quelques `vue/attributes-order`/
  `vue/attribute-hyphenation`/`vue/require-default-prop`. Ces classes sont
  **volontairement non re-listées ci-dessous** (déjà détectées telles
  quelles par l'outil) — se référer directement à la sortie ESLint plutôt
  qu'à ce document pour leur détail.
- **context7** non consulté : aucun doute d'API Vue 3/Composition rencontré
  qui aurait nécessité une vérification externe pendant cet audit.
- Les clauses "OK d'ignorer si..." du référentiel ont été appliquées avant
  tout signalement ; les correspondances exactes avec une dette déjà
  documentée ailleurs dans le repo sont regroupées en fin de document plutôt
  que mélangées aux constats neufs.

---

## 1. Bugs / Fiabilité

### 1.1 — Suppression de créneau de disponibilité sans feedback d'erreur possible
**Fichiers** : `src/composables/useOwnerAvailability.js` (fonction
`removeAvailability`, lignes 63-76), `src/views/dashboard/owner/AvailabilityView.vue`
(ligne 215, `@click="removeAvailability(slot.id)"`)
**Catégorie** : 1.1 — Promesses sans `catch` (variante : catch présent mais
n'expose aucun feedback)
**Sévérité** : Bloquant
**Description** : `removeAvailability` catch l'erreur GraphQL, la logue via
`console.error`, mais ne la relance jamais et ne pilote aucun ref d'erreur ;
l'appelant (bouton poubelle dans `AvailabilityView.vue`) n'enveloppe pas
l'appel non plus. Un échec de suppression (réseau, `@auth`) est donc
totalement invisible pour le Owner : le créneau reste affiché sans aucun
message d'erreur ni état de chargement en échec, alors que `addAvailability`
dans le même fichier relance bien l'erreur (`throw e`) et est correctement
catché côté vue avec un toast. Ce n'est pas une "écriture secondaire
best-effort" au sens de `CLAUDE.md` (c'est la seule écriture de l'action
"supprimer", déclenchée directement par un clic utilisateur).
**Recommandation** : Aligner `removeAvailability` sur `addAvailability` (relancer
l'erreur) et faire catcher `AvailabilityView.vue` avec un toast d'échec.

### 1.1 — `fetchAnimals` avale ses erreurs, rendant mort le traitement d'erreur de la vue appelante
**Fichiers** : `src/composables/useAnimals.js` (fonction `fetchAnimals`,
lignes 21-50), `src/views/dashboard/owner/AnimalsView.vue` (lignes 37-49)
**Catégorie** : 1.1 — Promesses sans `catch` (variante : catch interne qui
empêche le traitement d'erreur de l'appelant de jamais s'exécuter)
**Sévérité** : Majeur
**Description** : `fetchAnimals()` catch toute erreur en interne (log +
`animals.value = []`) et ne relance jamais — contrairement à
`useAnimalValidation.js`/`useClinicDonors.js`/`useClinicRequest.js`, ce
composable n'expose pas non plus de `loadError`. Conséquence observable :
`AnimalsView.vue` appelle `fetchAnimals().catch((err) => { if (err.message ===
'SessionExpired') router.push('/login') ... })`, mais cette branche ne
s'exécutera jamais puisque la promesse ne rejette jamais — la redirection
"session expirée" et le toast d'échec de chargement sont du code mort. Un
échec réseau/`@auth` est donc indiscernable de "aucun animal" pour
l'utilisateur.
**Recommandation** : Ajouter un `loadError` à `useAnimals.js` (même
convention que les composables voisins) et faire consommer ce ref par
`AnimalsView.vue` plutôt que de compter sur un `.catch()` qui ne se
déclenchera jamais.

### 1.2 — Accès `.message` non protégé sur une erreur de type incertain (flux d'inscription)
**Fichier** : `src/views/auth/VerifyEmailView.vue` (ligne 63,
`if (!e.message.includes('Current status is CONFIRMED')) throw e`)
**Catégorie** : 1.2 — Accès à des propriétés potentiellement `undefined`
**Sévérité** : Majeur (le référentiel prévoit Bloquant si le chemin est sur
le golden path d'un flux critique — "inscription" est explicitement cité ;
retenu en Majeur ici car l'effet observable réel est un message d'erreur
générique dégradé plutôt qu'un crash total, mais la classification mérite
d'être tranchée en revue)
**Description** : Si l'erreur levée par `auth.confirmRegistration` n'a pas de
propriété `.message` (forme `{ errors: [...] }` plutôt qu'une `Error`
standard, cas déjà documenté ailleurs dans ce repo — voir
`isConditionalCheckFailure` dans `useOwnerMissions.js`), `.includes(...)`
lève une `TypeError` qui remplace silencieusement l'erreur d'origine avant
même le `throw e` prévu, masquant la vraie cause de l'échec d'inscription.
**Recommandation** : Sécuriser l'accès (`e.message?.includes(...)` ou
vérification de type préalable) avant de tester le message.

### 1.2 — Accès `e.errors[0].message` sans vérifier la longueur du tableau (création de Request)
**Fichier** : `src/composables/useClinicRequest.js` (lignes 131-133)
**Catégorie** : 1.2 — Accès à des propriétés potentiellement `undefined`
**Sévérité** : Majeur (flux explicitement cité par le référentiel — "création
de Request" — mais accès situé dans le bloc de logging d'erreur, pas sur le
chemin de succès ; downgrade documenté ici pour la revue)
**Description** : `if (e.errors) { console.error(..., e.errors[0].message) }`
ne vérifie que la présence du tableau, pas sa longueur — un `e.errors`
vide (`[]`, toujours "truthy") ferait planter ce log avec une nouvelle
`TypeError`, qui remonterait à la place de l'erreur originale de création de
Request.
**Recommandation** : Vérifier `e.errors?.length > 0` avant d'indexer.

### 1.4 — `form` multi-champs sans JSDoc sur des fonctions exportées touchant `Animal`
**Fichier** : `src/composables/useAnimals.js` (`updateAnimalDetails`, lignes
52-97 ; `createNewAnimal`, lignes 124-159)
**Catégorie** : 1.4 — Incohérences de type silencieuses (JSDoc manquant)
**Sévérité** : Mineur
**Description** : Les deux fonctions acceptent un objet `form` à une
dizaine de champs (dont certains optionnels : `breed`, `birthDate`) sans
`@param`/`@returns`, exportées et consommées depuis deux vues différentes
(`AnimalsView.vue`, `AddAnimalView.vue`) — une dérive de forme entre
appelant et fonction (ex. `weight` non numérique) ne casserait pas
immédiatement, juste silencieusement (`parseFloat` renvoie `NaN`).
**Recommandation** : Documenter la forme attendue de `form` en JSDoc, sur le
modèle de `useMissionClosure.closeMission`.

---

## 2. Sécurité

### 2.3 — Clé Stripe publique en dur dans le code (jugement)
**Fichier** : `src/views/TestStripe.vue` (ligne 8)
**Catégorie** : 2.3 — Secrets/clés/IDs en dur dans le code
**Sévérité** : Mineur (voir note de jugement ci-dessous — le référentiel fixe
Bloquant par défaut "quel que soit le fichier")
**Description** : `loadStripe('pk_test_51Sc1gTL3JgDp3G6ikoJ...')` est une clé
littérale committée. **Jugement retenu pour cet audit** : il s'agit d'une clé
*publiable* Stripe (`pk_test_...`), explicitement conçue par Stripe pour
être exposée côté client (contrairement à une clé secrète `sk_...`) — même
statut que l'exemple `userPoolId`/`region` Cognito donné en exemption par le
référentiel lui-même. Le risque de fuite de données/paiement via cette seule
clé est donc faible. Le référentiel demande cependant une vérification "au
cas par cas, pas une exemption automatique" : signalé ici pour que le Lead
Dev tranche explicitement plutôt que de disparaître silencieusement.
`CLAUDE.md` documente par ailleurs `TestStripe.vue` comme "page de test
isolée, hors périmètre V1" (Stripe non implémenté) — l'architecture
environnante (composable dédié, tests) n'a pas été auditée plus loin sur ce
fichier pour cette raison.
**Recommandation** : Déplacer la clé vers une variable d'environnement
(`import.meta.env`) par hygiène/cohérence avec le reste du repo, même si le
risque de sécurité direct est jugé faible ici.

---

## 3. Code smells / Maintenabilité

### 3.3 — Fichiers entre 300 et 500 lignes ("à surveiller")
**Fichiers** : `src/views/dashboard/clinic/RequestsView.vue` (456 lignes),
`src/views/dashboard/clinic/NewRequestView.vue` (358), `src/views/dashboard/clinic/SettingsView.vue`
(357), `src/views/HomeView.vue` (348), `src/views/dashboard/owner/AnimalsView.vue` (321)
**Catégorie** : 3.3 — Fichiers trop longs
**Sévérité** : Mineur
**Description** : Cinq vues dépassent le seuil de 300 lignes (aucune ne
dépasse 500). Toutes mélangent template PrimeVue volumineux et logique
(dialogs, formulaires multi-étapes) dans un seul fichier `.vue`.
**Recommandation** : Surveiller ; envisager l'extraction de sous-composants
(ex. la modale de clôture de Mission dans `RequestsView.vue`) si la
croissance continue.

### 3.4 — `console.log` de debug oubliés (hors best-effort)
**Fichier** : `src/composables/useClinicRequest.js` (lignes 113, 122 —
`console.log("🚀 Envoi Mutation avec Input :", input)` et
`console.log("✅ Succès création :", result)`)
**Catégorie** : 3.4 — `console.log`/`console.error` de debug oubliés
**Sévérité** : Mineur
**Description** : Deux `console.log` de debug (avec emojis) restent dans le
chemin de succès de `createNewRequest`, en dehors de tout flag de dev — ne
correspond pas à l'exemption "catch d'écriture secondaire best-effort" du
référentiel (ce sont des `console.log`, pas des `console.error` dans un
`catch`, et ils sont sur le chemin de succès).
**Recommandation** : Retirer ces logs de debug (ou les remplacer par un vrai
logger si un jour introduit).

### 3.5 — Logique GraphQL/métier critique directement dans une vue, sans composable
**Fichier** : `src/views/auth/VerifyEmailView.vue` (script complet, lignes
49-185)
**Catégorie** : 3.5 — Composables multi-responsabilités (appliqué par
analogie : ici l'anti-pattern touche une *vue* qui fait le travail d'un
composable, pas un composable existant)
**Sévérité** : Majeur
**Description** : `handleVerify` mélange, dans le fichier `.vue` lui-même :
5 appels `client.graphql()` directs (`createOwnerSimple`, `createAnimalSimple`,
`createOwnerAvailabilitySimple`, `createClinicSimple`, `createVeterinarianSimple`),
la logique métier de branchement Owner/Veterinarian, le mapping des champs
d'entrée, et la navigation (`router.push`) — à l'inverse de la convention du
repo documentée dans `CLAUDE.md` ("Logique métier et appels GraphQL...
jamais dans les composants"). Cette logique termine la création du compte
(écriture des entités `Owner`/`Animal`/`Clinic`/`Veterinarian`) et n'est
testable, dans l'état actuel du repo (aucun test de composant `.vue`, voir
`CLAUDE.md`), qu'en montant le composant entier — ce qui n'est fait nulle
part (voir aussi le constat 5.1 associé).
**Recommandation** : Extraire cette logique dans un composable dédié (ex.
`useRegistrationCompletion.js`), sur le modèle des autres flux d'écriture du
repo.

### 3.6 — Statuts/types d'énumération en dur au lieu de `constants/enums.js`
**Fichiers** :
- `src/composables/useClinicRequest.js:106,110,147,151` (`'EMERGENCY'`/`'APPOINTMENT'`/`'OPEN'`/`'CLOSED'`)
- `src/views/dashboard/clinic/RequestsView.vue:35-44,194,354,372,429` (`getSeverity` + comparaisons `requestType`/`status`/`requiredSpecies`)
- `src/views/dashboard/owner/MissionsView.vue:39-64` (`getStatusLabel`/`getStatusSeverity`)
- `src/views/dashboard/owner/AnimalsView.vue:256` (`animal.species === 'DOG'`)
- `src/views/auth/VerifyEmailView.vue:104` (`(data.animal_species || 'DOG')`)

**Catégorie** : 3.6 — Incohérences de nommage/convention
**Sévérité** : Mineur
**Description** : `constants/enums.js` centralise `RequestType`, `RequestStatus`,
`MissionStatus`, `Species`, et ces mêmes fichiers importent déjà l'un ou
l'autre de ces enums pour *d'autres* comparaisons dans le même fichier (ex.
`RequestsView.vue` utilise correctement `MissionStatus.COMPLETED` mais
compare `requestType`/`status`/`requiredSpecies` à des littéraux) — c'est
l'incohérence *intra-fichier* qui rend ce constat solide, pas seulement
l'absence générale d'enum.
**Recommandation** : Remplacer ces littéraux par les enums déjà importés
(ou à importer) dans chacun de ces fichiers.

### 3.6 — Liste des groupes sanguins dupliquée au lieu de réutiliser `BloodGroupsBySpecies`
**Fichier** : `src/views/dashboard/clinic/NewRequestView.vue` (lignes 31-35)
**Catégorie** : 3.6 — Incohérences de nommage/convention
**Sévérité** : Mineur
**Description** : `bloodOptions` réimplémente en dur
`['A','B','AB']`/`['DEA 1.1-','DEA 1.1+','Dal','Kai']` au lieu de consommer
`BloodGroupsBySpecies` (`constants/enums.js`), pourtant utilisée correctement
pour le même besoin dans `RegisterOwnerView.vue` et `AddAnimalView.vue`/`AnimalsView.vue`
via `computed(() => BloodGroupsBySpecies[...] || [])`.
**Recommandation** : Faire consommer `BloodGroupsBySpecies` par
`NewRequestView.vue` comme les autres vues du même besoin.

### 3.6 — `fetchClinicId()` avale son erreur, ce qui vide `loadError` de son sens dans `fetchRequests()`
**Fichier** : `src/composables/useClinicRequest.js` (`fetchClinicId`, lignes
30-52 ; `fetchRequests`, lignes 54-79)
**Catégorie** : 3.6 — Incohérences de nommage/convention (le `loadError`
introduit dans ce même fichier, documenté comme distinguant "erreur" de
"vide", est contourné par ce chemin précis)
**Sévérité** : Mineur
**Description** : `fetchClinicId()` catch toute erreur en interne et
retourne `null` ; `fetchRequests()` traite alors ce `null` comme "pas de
clinique" (`requests.value = []`, `loadError` jamais mis à `true`) — un échec
réseau/`@auth` lors de la résolution du `clinicID` est donc, dans ce chemin
précis, indiscernable d'un vétérinaire réellement sans clinique, alors que
c'est exactement la distinction que `loadError` a été introduit pour
garantir ailleurs dans ce fichier (Phase 3.3, voir commentaire dans le
fichier lui-même).
**Recommandation** : Remonter l'erreur de `fetchClinicId()` (ou un indicateur
dédié) jusqu'à `fetchRequests()` pour que `loadError` reflète aussi ce cas.

### 3.6 — Composables sans `catch` interne, contrairement à la convention `try/catch/finally` du repo
**Fichiers** : `src/composables/useOwnerProfile.js` (`fetchProfile`, lignes
29-62 ; `updateProfile`, lignes 64-86), `src/composables/useClinicSettings.js`
(`fetchSettings`, lignes 44-85)
**Catégorie** : 3.6 — Incohérences de nommage/convention
**Sévérité** : Mineur
**Description** : Ces fonctions n'ont qu'un `try/finally`, sans `catch` ni
`console.error`, contrairement à la convention documentée dans `CLAUDE.md`
("try/catch/finally... console.error en français") suivie par la quasi-totalité
des autres composables du repo. Fonctionnellement non cassé ici : les vues
appelantes (`ProfileView.vue`, `SettingsView.vue`) rattrapent bien l'erreur
avec leur propre `.catch()`/toast — mais c'est un pattern différent du reste
du repo, sans log développeur dédié dans le composable lui-même.
**Recommandation** : Harmoniser avec la convention (ajouter `catch` +
`console.error` dans le composable) par cohérence, sans urgence puisque le
comportement observable actuel n'est pas cassé.

---

## 4. Performance

### 4.4 — `fetchProfile()` re-demandé à chaque poll (60s) sans nécessité
**Fichier** : `src/composables/useMatchingRequests.js` (`searchMatches`,
ligne 72 : `await fetchProfile()`, appelée sans garde à chaque appel — y
compris silencieux, voir `startAutoRefresh`/`DASHBOARD_REFRESH_INTERVAL_MS`)
**Catégorie** : 4.4 — Re-fetch réseau évitable
**Sévérité** : Mineur
**Description** : Contrairement à `fetchAnimals()` (appelée seulement `if
(animals.value.length === 0)`), `fetchProfile()` est rechargée
inconditionnellement à chaque `searchMatches()`, y compris chaque tick du
polling de fond (toutes les 60s, tant que le dashboard Owner reste ouvert) —
alors que le profil de l'Owner (adresse, distance max) change rarement en
cours de session. Le commentaire du fichier justifie l'appel systématique
("`form` n'est jamais `null`, donc on ne peut pas se fier à sa nullité") mais
ne traite pas spécifiquement le coût du re-fetch répété par le polling.
**Recommandation** : Ne recharger le profil que sur le premier appel de la
session (comme `fetchAnimals`), pas à chaque tick de polling silencieux.

---

## 5. Tests

### 5.1 — `usePassword.js` (validation mot de passe, flux auth) sans test Vitest
**Fichier** : `src/composables/usePassword.js`
**Catégorie** : 5.1 — Composables avec logique métier non-triviale sans test
**Sévérité** : Majeur (composable consommé par les flux d'inscription
Owner/Clinic — "auth" est explicitement cité par le référentiel comme flux
critique)
**Description** : `isValid`/`doMatch`/`validate` encodent une règle métier
(longueur minimale, correspondance des deux champs) réutilisée par
`RegisterOwnerView.vue` et `RegisterClinicView.vue`, sans aucun test dédié
(aucun fichier `usePassword.test.js`/`.spec.js` dans le repo).
**Recommandation** : Ajouter un test Vitest couvrant `isValid`/`doMatch`/`validate`.

### 5.1 — Logique de complétion d'inscription (`VerifyEmailView.vue`) non testable en l'état
**Fichier** : `src/views/auth/VerifyEmailView.vue`
**Catégorie** : 5.1 — Composables avec logique métier non-triviale sans test
(appliqué par analogie à cette vue, voir aussi constat 3.5 sur le même
fichier)
**Sévérité** : Majeur (flux auth/inscription)
**Description** : Le branchement Owner/Veterinarian et les 5 écritures
GraphQL de complétion d'inscription ne sont couverts par aucun test, et ne
sont pas extractibles en fonction pure testable dans leur forme actuelle
(voir constat 3.5) — ce repo n'ayant aucun test de composant `.vue`
(`CLAUDE.md`), cette logique reste actuellement entièrement non testée.
**Recommandation** : Traiter conjointement avec le constat 3.5 : l'extraction
en composable rendrait ce constat adressable par un test Vitest classique.

### 5.1 — `calculateAge` (`useAnimals.js`) sans test
**Fichier** : `src/composables/useAnimals.js` (lignes 14-19)
**Catégorie** : 5.1 — Composables avec logique métier non-triviale sans test
**Sévérité** : Mineur (ne touche pas directement matching/éligibilité/clôture/auth)
**Description** : Calcul d'âge à partir d'une date de naissance, avec un cas
limite explicite (`if (!d) return '?'`), sans test associé.
**Recommandation** : Extraire si besoin de réutilisation, sinon ajouter un
test Vitest ciblé sur ce calcul.

### 5.1 — Tri des disponibilités (`useOwnerAvailability.js`) sans test
**Fichier** : `src/composables/useOwnerAvailability.js` (lignes 25-29,
transformation `dayOfWeek === 0 ? 7 : dayOfWeek` pour trier Lundi→Dimanche)
**Catégorie** : 5.1 — Composables avec logique métier non-triviale sans test
**Sévérité** : Mineur
**Description** : Logique de tri avec une règle non triviale (dimanche = 0
en JS, replacé en position 7) sans test dédié.
**Recommandation** : Ajouter un test Vitest sur ce tri, en particulier le cas
dimanche.

---

## 6. i18n

Aucun constat neuf dans cette section : les occurrences de texte brut
détectées dans le périmètre sont soit déjà couvertes par ESLint
(`@intlify/vue-i18n/no-raw-text`, voir note de méthode), soit rattachées à la
dette déjà connue de `DashboardView.vue` (voir ci-dessous).

---

## Dette déjà connue, non re-signalée

- **`DashboardView.vue` — chaînes françaises en dur** (ex. "Bienvenue sur
  Redlink...", "Recherche d'urgences à proximité...", "Aucune urgence
  détectée", "J'accepte d'aider", "URGENCE", "Clinique Vétérinaire") :
  correspond exactement à la dette i18n documentée dans `CLAUDE.md` et
  détectée telle quelle par ESLint (`@intlify/vue-i18n/no-raw-text`,
  `src/views/dashboard/owner/DashboardView.vue` lignes 86-156). Règle 6.1,
  non re-signalé individuellement conformément à l'exception du référentiel.
  Aucune correction en masse proposée (conformément à `CLAUDE.md`, qui la
  soumet à confirmation explicite de l'utilisateur).

- **`useOwnerMissions.js` — `'CANCELLED'` en littéral** (`historyMissions`,
  ligne 280) : documenté explicitement dans le code lui-même
  ("`'CANCELLED'` n'a pas d'équivalent dans `MissionStatus`... laissé en
  littéral, hors périmètre de ce sous-tâche") et référencé nommément dans
  `CLAUDE.md` ("`MissionStatus` n'a pas d'entrée `CANCELLED`"). Règle 3.6,
  non re-signalé.

- **`useMatchingRequests.js` — `listOpenRequestsWithClinic` sans pagination**
  (liste globale de toutes les Requests `OPEN`, tous vétérinaires confondus,
  filtrée côté client) : correspond exactement à l'exemption nommée de la
  règle 4.2 ("c'est le filtrage/matching côté client du MVP, documenté comme
  dette assumée directement dans le code (`useMatchingRequests.js`,
  `eligibility-service.js`)"). Le commentaire en tête de fonction le
  documente explicitement comme choix MVP. Non re-signalé.

- **`useAnimalValidation.js` — portée globale (pas "ma clinique")** : documenté
  explicitement dans le fichier lui-même comme conséquence directe du modèle
  `@auth` actuel sur `Animal` (accès `read` global, pas de scoping par
  clinique) — correspond au type de compromis couvert par ADR-0004 /
  `CLAUDE.md` ("scoping d'une liste vet-facing globalement plutôt que de
  simuler un filtrage par clinique sans réelle barrière de sécurité"). Non
  re-signalé comme découverte neuve.
