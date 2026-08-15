# Audit transversal — Redlink PWA

Audit réalisé selon la grille `docs/audit/00-referentiel.md`. Toute référence de
règle ci-dessous ("X.Y") pointe vers ce référentiel. Suite de
`docs/audit/01-frontend.md`, `02-backend.md`, `03-tests.md` — ne réaudite pas
leur périmètre depuis zéro, mais (1) balaie `src/` en entier pour les chaînes
françaises en dur, ce qu'aucun des trois audits précédents n'a fait sur
l'ensemble du dossier, et (2) recoupe leurs constats déjà écrits entre eux
pour faire remonter les cas où un même défaut de fond apparaît à deux endroits
distincts (composable + composant qui l'utilise, ou deux constats de deux
audits différents sur le même fichier).

## Méthode

- **i18n, périmètre `src/` entier** : `01-frontend.md` avait déjà passé
  ESLint (`@intlify/vue-i18n/no-raw-text`) sur `src/components/`,
  `src/composables/`, `src/views/` (41 fichiers). Ici, `npx eslint` relancé
  sur le reste de `src/` non couvert par ce périmètre (`src/api/`,
  `src/App.vue`, `src/layouts/`, `src/main.js`, `src/router/index.js`,
  `src/services/`, `src/stores/`, `src/i18n.js`, `src/constants/`) : **0
  warning**. Complété par une recherche `grep` de littéraux à consonance
  française (regex sur mots capitalisés suivis d'un mot, hors
  `console.log`/`console.warn`/`console.debug`) sur ce même sous-ensemble
  pour couvrir les chaînes JS hors template (messages d'erreur jetés,
  `alert`, etc., qu'ESLint `no-raw-text` ne voit pas) : une seule occurrence,
  un commentaire JSDoc (`eligibility-service.js:124`, pas une chaîne
  utilisateur). **Aucun nouveau fichier à ajouter à la dette i18n connue.**
- **Recoupement entre audits** : relecture complète des trois audits
  précédents, puis vérification par lecture directe du code (pas seulement
  du texte des audits) pour chaque hypothèse de recoupement — un composable
  cité dans `01-frontend.md` est-il consommé par un composant qui reproduit
  le même défaut, ou est-il aussi la cible d'un constat de `03-tests.md` qui
  aggrave le même défaut ? Seuls les recoupements vérifiés par lecture de
  code (pas de simple rapprochement textuel) sont retenus ci-dessous.
- **MCP** : `context7`/`eslint` utilisés comme dans les audits précédents ;
  `serena` non nécessaire ici (recherches ciblées par `grep`/lecture directe
  suffisantes vu le volume). Aucun fichier modifié (audit en lecture seule).

---

## 1. i18n — balayage complet de `src/`

Aucun constat neuf. La dette i18n de ce repo reste intégralement confinée à
`DashboardView.vue` (documentée dans `CLAUDE.md` et détaillée dans
`01-frontend.md`, section "Dette déjà connue") — le reste de `src/`, y
compris les répertoires jamais audités jusqu'ici (`api/`, `layouts/`,
`stores/`, `router/`, `services/`, `i18n.js`, `constants/`), n'introduit
aucune chaîne utilisateur en dur supplémentaire. Règle 6.1 : rien à ajouter.

---

## 2. Recoupements composable ↔ composant

### 2.1 — `loadError` : convention établie mais inconsistante sur 4 des 5 vues qui en auraient besoin

**Catégorie** : 1.1 / 3.6 (croisement) — **Sévérité** : Majeur (élève
l'appréciation de `01-frontend.md`, qui n'avait signalé qu'`AnimalsView.vue`
isolément)

**Constat** : `CLAUDE.md` documente `loadError` comme le pattern attendu pour
distinguer "chargement en erreur" de "liste réellement vide" (introduit dans
`useClinicDonors.js`/`useAnimalValidation.js`). En croisant les trois audits
et en relisant le code, ce pattern s'avère appliqué correctement dans
seulement 2 couples composable/vue sur 6 :

| Composable | `loadError` exposé ? | Vue consommatrice | Consommé ? |
|---|---|---|---|
| `useClinicDonors.js` | Oui | `DonorsView.vue` | Oui |
| `useAnimalValidation.js` | Oui | `ValidationsView.vue` | Oui |
| `useClinicRequest.js` | Oui (ligne 27, propagé lignes 56/75/162) | `RequestsView.vue` | **Non** — `RequestsView.vue:13` ne déstructure que `requests, isLoading, fetchRequests, closeRequest` ; le `v-if="!isLoading && requests.length === 0"` (ligne 323) affiche le même message vide (`dashboard.requests.empty`) qu'il s'agisse d'une liste vide ou d'un échec de `fetchRequests()`/`fetchClinicId()` |
| `useClinicHistory.js` | Oui (ré-exporte celui de `useClinicRequest.js`, ligne 129/139) | `HistoryView.vue` | Oui |
| `useAnimals.js` | **N'existe pas** (déjà signalé isolément en 01, 1.1 Majeur) | `AnimalsView.vue` | — |
| `useOwnerMissions.js` | **N'existe pas** (seul `isLoading` existe, ligne 87) | `MissionsView.vue` | — (ligne 120 : `v-if="isLoading"` puis ligne 216 `v-if="historyMissions.length === 0"`, aucune distinction erreur possible) |
| `useMatchingRequests.js` | **N'existe pas** (seul `isLoading` existe, ligne 42) | `DashboardView.vue` | — (ligne 91 `v-if="loadingMatches"` puis ligne 96 `v-else-if="matches.length === 0"`, même limite) |

**Pourquoi ce n'est pas juste une répétition de 01** : `01-frontend.md` avait
signalé le cas `useAnimals.js`/`AnimalsView.vue` comme un bug isolé de
composable (catch mort empêchant le `.catch()` de la vue de jamais
s'exécuter). En le recoupant avec les deux autres composables du dashboard
Owner (`useOwnerMissions.js`, `useMatchingRequests.js`), il apparaît que
**trois des quatre vues du dashboard Owner** (`AnimalsView`, `MissionsView`,
`DashboardView` — seule `AvailabilityView` échappe, car différente
architecture) partagent le même trou : le concept `loadError` n'a jamais été
porté aux composables Owner, alors qu'il l'a été aux composables Clinic
(`useClinicDonors.js`, `useAnimalValidation.js`, `useClinicRequest.js`). Et
`RequestsView.vue` — la vue Clinic qui a justement motivé l'ajout de
`loadError` à `useClinicRequest.js` (voir commentaire ligne 23-26 du fichier,
"Ajouté en Phase 3.3 pour `useClinicHistory.js`... purement additif, ne
change pas le comportement observable de `RequestsView.vue` [qui ne le
consomme pas]") — reste elle-même non branchée, alors que son propre
composable expose déjà tout ce qu'il faut.

**Recommandation** : Traiter comme un seul chantier plutôt que 4 correctifs
isolés : (a) faire consommer `loadError` par `RequestsView.vue` (coût quasi
nul, le ref existe déjà) ; (b) ajouter `loadError` à `useOwnerMissions.js` et
`useMatchingRequests.js` sur le même modèle, puis les faire consommer par
`MissionsView.vue`/`DashboardView.vue` ; (c) traiter `useAnimals.js` comme
déjà recommandé en 01 (1.1).

### 2.2 — Statut `'CANCELLED'` : le trou d'enum documenté dans un composable a déjà fuité dans un composant indépendant

**Catégorie** : 3.6 — **Sévérité** : Mineur (mais élève la portée du constat
existant)

**Constat** : `CLAUDE.md` et `01-frontend.md` documentent `'CANCELLED'`
comme un littéral assumé dans `useOwnerMissions.js` (ligne 280,
commentaire explicite "`'CANCELLED'` n'a pas d'équivalent dans
`MissionStatus`"), traité comme dette connue et non re-signalé. Le même
littéral `'CANCELLED'` existe pourtant, **indépendamment**, dans
`RequestsView.vue` (`getSeverity`, ligne 41 — `case 'CANCELLED': return
'contrast'`), un fichier sans aucun rapport avec `useOwnerMissions.js`
(il consomme `useClinicRequest.js`, un `Request`, pas un `Mission`). Ce
n'est donc pas une reproduction directe composable→composant, mais deux
occurrences indépendantes du même trou d'enum (`MissionStatus`/`RequestStatus`
sans entrée `CANCELLED`), déjà repérée une fois par `01-frontend.md` dans sa
liste groupée (3.6, ligne 210 : `RequestsView.vue:35-44` était déjà cité pour
`getSeverity`) mais sans faire le lien avec la dette `CANCELLED` documentée
séparément dans "Dette déjà connue".
**Recommandation** : Ajouter `CANCELLED` à `MissionStatus`/`RequestStatus`
dans `constants/enums.js` réglerait les deux occurrences en une fois, plutôt
que de continuer à traiter chaque nouvelle apparition comme un cas isolé.

### 2.3 — `VerifyEmailView.vue` : trois constats distincts de trois sections différentes, une seule cause

**Catégorie** : 3.5 + 3.6 + 5.1 (croisement intra-audit, tous dans
`01-frontend.md`) — **Sévérité** : Majeur (inchangée, mais le regroupement
change la priorité de traitement)

**Constat** : `01-frontend.md` liste, sur le même fichier
`VerifyEmailView.vue`, trois constats séparés dans trois sections
différentes du document : 3.5 (logique métier/GraphQL dans la vue plutôt
qu'un composable, 5 appels `client.graphql()` directs), 3.6 (`'DOG'` en
littéral ligne 104 plutôt que `Species.DOG`), 5.1 (logique non testable en
l'état, faute d'extraction). Présentés comme trois constats indépendants,
ils partagent une seule et même cause : l'absence de composable dédié. Un
composable `useRegistrationCompletion.js` (déjà recommandé en 3.5) aurait
mécaniquement pour effet d'exposer `Species.DOG` au même niveau que les
autres composables du repo (import déjà utilisé ailleurs pour le même besoin,
ex. `AddAnimalView.vue`) et de rendre la logique testable en Vitest sans
monter de composant. **Ne pas traiter comme 3 tickets indépendants** :
l'extraction unique adresse les trois constats de `01-frontend.md` à la
fois.

---

## 3. Recoupements composable ↔ tests

### 3.1 — `useAnimals.js` : le bug Majeur de `01-frontend.md` vit dans un fichier à 0% de couverture

**Catégorie** : 1.1 × 5.1 — **Sévérité** : Majeur (compound)

**Constat** : `01-frontend.md` (1.1) signale que `fetchAnimals()` avale son
erreur en interne, rendant mort le `.catch()` de `AnimalsView.vue`.
`03-tests.md` (5.1) signale, indépendamment, qu'aucun fichier
`useAnimals.test.js` n'existe et détaille plusieurs autres branches non
triviales non testées (succès partiel GraphQL, rollback optimiste, défaut
`bloodGroup: 'UNKNOWN'`). Les deux constats portent sur le **même fichier** :
non seulement le bug de `01-frontend.md` n'est couvert par aucun test qui
l'aurait détecté, mais aucune régression future sur ce fichier ne serait
détectée non plus — la correction recommandée par 01 (ajouter un `loadError`)
devrait être accompagnée du test recommandé par 03, pas traitée séparément,
sans quoi le correctif lui-même resterait aussi peu vérifié que le bug qu'il
corrige.

### 3.2 — `useOwnerAvailability.js` : le bug Bloquant de `01-frontend.md` vit dans un fichier entièrement non testé, pas seulement sur son tri

**Catégorie** : 1.1 × 5.1 — **Sévérité** : Bloquant (élève la portée du
constat 5.1 de `03-tests.md`)

**Constat** : `01-frontend.md` (1.1) signale en **Bloquant** que
`removeAvailability()` avale son erreur sans aucun feedback utilisateur
possible (ni `throw`, ni `loadError`, ni catch côté vue). `03-tests.md` (5.1,
Mineur) signale séparément que le tri des disponibilités
(`dayOfWeek === 0 ? 7 : dayOfWeek`) n'a pas de test. Vérification directe :
`src/composables/useOwnerAvailability.js` n'a **aucun** fichier de test
associé (ni `__tests__/useOwnerAvailability.test.js`, ni
`useOwnerAvailability.spec.js` — absent des deux listes de fichiers de test
existants du repo). Le constat 5.1 de `03-tests.md`, formulé uniquement
autour du tri, sous-représente donc la portée réelle : c'est le fichier
entier, **y compris la fonction responsable du bug Bloquant**, qui est à 0%
de couverture. Un test sur `removeAvailability` aurait la même valeur (sinon
plus, vu la sévérité) que celui déjà recommandé sur le tri.
**Recommandation** : En plus du correctif 1.1 déjà recommandé (relancer
l'erreur, aligner sur `addAvailability`), ajouter `useOwnerAvailability.test.js`
couvrant `removeAvailability` (succès, échec) et le tri — pas seulement l'un
des deux comme le suggérait `03-tests.md` isolément.

### 3.3 — `useOwnerProfile.js` / `useClinicSettings.js` : écart de convention (01) et absence totale de test (03) se recoupent sur les mêmes deux fichiers

**Catégorie** : 3.6 × 5.1 — **Sévérité** : Majeur (compound)

**Constat** : `01-frontend.md` (3.6, Mineur) signale que ces deux composables
n'ont qu'un `try/finally` sans `catch`/`console.error`, contrairement à la
convention du reste du repo — noté comme "fonctionnellement non cassé" car
les vues appelantes rattrapent l'erreur elles-mêmes. `03-tests.md` (5.1,
Majeur ×2) signale, sur les **deux mêmes fichiers**, l'absence totale de test
sur `deleteAccount` (suppression en cascade Owner+Animals ou
Veterinarian+Clinic, suivie de `deleteUser()` Cognito). Le recoupement
change l'appréciation du premier constat : l'argument "fonctionnellement non
cassé" de 01 repose sur une lecture manuelle du flux d'erreur à travers
composable + vue — précisément le genre de garantie qu'un test fige
normalement, et qui manque ici. Tant qu'aucun test ne verrouille le
comportement de `deleteAccount` en cas d'échec partiel, la conformité de ces
deux fichiers à "pas cassé, juste différent du reste" reste une lecture
manuelle non vérifiée automatiquement — sur un flux qui supprime des
comptes et des entités liées de façon irréversible.
**Recommandation** : Traiter les deux constats ensemble sur ces deux
fichiers : ajouter le test recommandé par 03 en fixant explicitement le
comportement actuel (catch implicite côté vue) avant, ou en même temps que,
l'harmonisation `try/catch/finally` recommandée par 01 — sinon
l'harmonisation elle-même n'est pas vérifiée.

---

## 4. Recoupement frontend ↔ backend

### 4.1 — `TestStripe.vue` : le jugement "risque faible" de `01-frontend.md` a été formulé avant que `02-backend.md` ne découvre l'infrastructure réelle

**Catégorie** : 2.3 × 2.2 — **Sévérité** : Bloquant (hérite de la sévérité du
constat 02 le plus récent — ne pas s'arrêter à la lecture du constat 01 seul)

**Constat** : `01-frontend.md` (2.3) documente la clé Stripe publique en dur
dans `TestStripe.vue` comme Mineur, avec un jugement explicite fondé sur deux
hypothèses : (a) c'est une clé *publiable* (`pk_test_...`), pas secrète ; (b)
"`CLAUDE.md` documente par ailleurs `TestStripe.vue` comme 'page de test
isolée, hors périmètre V1'... l'architecture environnante... n'a pas été
auditée plus loin pour cette raison." `02-backend.md` (2.2), écrit après,
invalide la seconde hypothèse : la page `/test-stripe` n'est pas isolée —
elle appelle une API Gateway (`apiStripe`) entièrement ouverte
(`"permissions": "open"`, CORS `*`) vers un Lambda qui crée de vrais
`PaymentIntent` Stripe, joignable directement sans passer par le frontend.
Le jugement "risque faible" de 01 portait uniquement sur la clé publique
elle-même (correct en soi — une clé `pk_test_` exposée n'est effectivement
pas un secret) mais pas sur la surface qu'elle active : un attaquant n'a
même pas besoin de cette clé publique pour abuser du endpoint, il lui suffit
de l'URL API Gateway, elle aussi présente dans le bundle client
(`aws-exports.js`). **Lire les deux constats séparément sous-estime le
risque combiné** ; lus ensemble, la conclusion de 02 (Bloquant) prime.
**Recommandation** : Déjà couverte par la recommandation 02 (désactiver
`apiStripe`/`createPaymentIntent` avant pilote, ou les protéger + gater
`/test-stripe` derrière `requiresAuth`) — ce constat ajoute seulement que la
clé Stripe en dur (recommandation 01, "déplacer vers `import.meta.env` par
hygiène") devient secondaire tant que l'action Bloquante de 02 n'est pas
traitée : corriger l'un sans l'autre laisse le endpoint ouvert exploitable
que la clé soit en dur ou non.

---

## Notes de méthode

- Les recoupements ci-dessus ont tous été vérifiés par lecture directe du
  code au moment de cet audit (pas uniquement par rapprochement du texte des
  trois audits précédents) — références de ligne à jour au moment de la
  rédaction.
- Aucun recoupement de duplication de code au sens strict de la règle 3.1
  (bloc de 15+ lignes quasi identique) n'a été trouvé entre fichiers déjà
  audités séparément — les recoupements retenus ici sont tous des
  recoupements de *cause*, pas de *code dupliqué littéralement*.
