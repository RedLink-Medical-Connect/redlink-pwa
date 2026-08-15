# Référentiel d'audit qualité — Redlink PWA

Règles utilisées pour auditer ce projet. Adapté à un projet Vue 3 / Amplify
Gen1 de taille moyenne (PME/startup) en pré-pilote, pas à un standard
enterprise type banque. Objectif : **sain et maintenable**, pas **zéro défaut
absolu**. Catégories inspirées de SonarQube, seuils et périmètre adaptés à la
stack et aux dettes déjà connues et documentées de ce repo (voir `CLAUDE.md`,
`docs/adr/`).

Chaque règle liste : sévérité par défaut, et une clause "OK d'ignorer si..."
pour éviter le zèle sur une dette déjà assumée par une décision explicite
(ADR, commentaire de schéma, `CLAUDE.md`). Une règle ne devient pas caduque
parce qu'une exception existe quelque part — l'exception doit être documentée
comme telle à l'endroit concerné, sinon le signalement reste valide.

Sévérités : **Bloquant** (empêche le pilote), **Majeur** (à corriger avant
généralisation, pas forcément avant pilote), **Mineur** (backlog, sans
urgence).

---

## 1. Bugs / Fiabilité

### 1.1 Promesses sans `catch`
Tout appel `async`/Promise en dehors d'un `try/catch` (ou d'un `.catch()`
explicite), en particulier les appels GraphQL via `generateClient()`.

- **Sévérité** : Bloquant si l'appel est déclenché par une action utilisateur
  directe (bouton, soumission de formulaire) sans feedback d'erreur possible ;
  Majeur si l'appel est secondaire (préchargement, effet de bord non
  critique).
- **OK d'ignorer si** : c'est une "écriture secondaire best-effort" au sens de
  `CLAUDE.md` (nettoyage de Mission orpheline, upsert `ClinicOwnerRelation`)
  — le `catch` existe mais avale volontairement l'erreur (log, pas de
  rethrow) ; c'est le pattern attendu, pas un bug. Vérifier que le `catch`
  existe bel et bien, même vide de UI-feedback — l'absence totale de
  try/catch reste un signalement valide.

### 1.2 Accès à des propriétés potentiellement `undefined`
Chaînage de propriétés sur une réponse GraphQL, un objet issu de `props`, ou
tout objet dont la présence n'est pas garantie par le flux, sans `?.` ni
vérification préalable.

- **Sévérité** : Majeur. Bloquant si le chemin est sur le golden path d'un
  flux critique (inscription, création de Request/Mission, acceptation,
  clôture).
- **OK d'ignorer si** : la valeur vient d'un objet dont la forme est garantie
  immédiatement au-dessus dans la même fonction (ex. juste après un `if
  (!data) return`), ou d'une constante interne (`enums.js`).

### 1.3 Listeners/watchers non nettoyés
`watch()`, `watchEffect()`, listeners DOM (`addEventListener`), timers
(`setInterval`/`setTimeout` récurrents), souscriptions GraphQL créés dans
`setup()`/`onMounted()` sans nettoyage correspondant dans `onUnmounted()`.

- **Sévérité** : Majeur. Bloquant si le composant concerné est monté/démonté
  fréquemment pendant une session (navigation entre vues du dashboard,
  polling — voir Phase 4.1).
- **OK d'ignorer si** : c'est un `watch()` sur une prop/state qui vit pour
  toute la durée de vie de l'app (ex. layout racine jamais démonté), ou un
  `watch()` Vue standard sans ressource externe à libérer (Vue le nettoie
  seul à l'unmount — seuls les listeners/timers/souscriptions *externes* à
  l'API réactive de Vue comptent ici).

### 1.4 Incohérences de type silencieuses (JSDoc manquant)
Fonction exportée (composable, service) dont la signature accepte un objet
complexe (plusieurs champs, ou l'un d'eux optionnel/nullable) sans JSDoc
`@param`/`@returns`, dans un point d'appel où une erreur de forme
casserait silencieusement (pas d'erreur runtime immédiate, juste un
comportement incorrect) — le pattern qui a causé le bug de signature réel sur
`acceptMission()`.

- **Sévérité** : Majeur sur les fonctions déjà responsables d'un incident
  connu ou touchant un flux d'argent/données sensibles (Mission, Request,
  auth) ; Mineur ailleurs.
- **OK d'ignorer si** : la fonction a un seul paramètre primitif, ou son
  usage est strictement interne à un seul fichier (pas exportée, pas de
  risque de dérive d'appelant).

---

## 2. Sécurité

### 2.1 `v-html` sans sanitization
Toute utilisation de `v-html` sur du contenu qui n'est pas 100% contrôlé et
statique (littéral dans le template, chaîne i18n figée).

- **Sévérité** : Bloquant si la source contient une donnée saisie par un
  utilisateur (Owner ou Veterinarian) à un moment quelconque du flux, même
  indirectement (nom d'animal, note libre, etc.).
- **OK d'ignorer si** : le contenu est une chaîne i18n gérée par l'équipe
  (pas de saisie utilisateur dans la chaîne interpolée) — signaler quand même
  en Mineur si le pattern pourrait être copié ailleurs avec une source
  dynamique.

### 2.2 `@auth` GraphQL manquant ou trop permissif
Type ou champ `@model` sans règle `@auth`, ou avec une règle `@auth` de type
qui n'exclut pas des `operations` non nécessaires (cf. le bug réel corrigé en
Phase 5 sur `Request`/`Mission`, ADR-0004) — vérifié contre le VTL généré
(`amplify api gql-compile`), pas seulement contre le texte du schéma.

- **Sévérité** : Bloquant.
- **OK d'ignorer si** : la limite est déjà identifiée et documentée comme
  compromis assumé dans un ADR existant (voir ADR-0004, section "Limites
  connues, non fermées par cette décision" — `Mission.status` écrivable en
  `create` par l'Owner, `Request.status`/`activeMissionID` écrivables par
  n'importe quel Owner authentifié). Dans ce cas, référencer l'ADR dans le
  rapport d'audit plutôt que de re-signaler comme découverte neuve — mais
  seulement si le comportement observé correspond exactement au compromis
  décrit, pas à un dérivé plus large.

### 2.3 Secrets/clés/IDs en dur dans le code
Toute clé API, secret, ID d'environnement AWS, token, ou identifiant sensible
écrit en littéral dans un fichier suivi par git (hors `.env*`, déjà couvert
par le hook `PreToolUse`).

- **Sévérité** : Bloquant, quel que soit le fichier.
- **OK d'ignorer si** : c'est un ID public non sensible par nature (ex. un
  `userPoolId`/`region` Cognito déjà exposé côté client par construction
  dans `aws-exports.js`, qui n'est pas un secret) — à vérifier au cas par
  cas, pas une exemption automatique.

### 2.4 Sur-exposition de champs GraphQL par rôle
Query/mutation qui sélectionne des champs que le rôle de l'utilisateur
courant (Owner vs Veterinarian) n'a pas besoin d'afficher ou de recevoir,
même si `@auth` les y autorise en lecture — surface d'exposition inutile côté
client (payload réseau visible en DevTools) plutôt qu'un trou d'accès en soi.

- **Sévérité** : Mineur, sauf si le champ sur-exposé est une donnée
  personnelle sensible d'un tiers (ex. coordonnées d'un autre Owner) — alors
  Majeur.
- **OK d'ignorer si** : le champ est trivial/non sensible (enums de statut,
  dates techniques) et sa présence simplifie une query custom déjà justifiée
  ailleurs dans le même flux.

---

## 3. Code smells / Maintenabilité

### 3.1 Duplication
Bloc de 15 lignes ou plus, quasi identique (logique équivalente, noms de
variables ou littéraux différents), répété dans 2 fichiers ou plus.

- **Sévérité** : Majeur si le bloc dupliqué contient de la logique métier
  (calcul d'éligibilité, mapping d'erreur, construction de payload GraphQL) ;
  Mineur si c'est de la structure UI (template PrimeVue répété).
- **OK d'ignorer si** : la duplication est entre un composable et son test
  (setup de mock répété volontairement pour la lisibilité du test), ou entre
  deux flux qui se ressemblent aujourd'hui mais dont rien ne garantit qu'ils
  resteront synchronisés (extraire prématurément créerait un faux couplage).

### 3.2 Complexité cyclomatique
Fonction avec plus de 4 niveaux d'imbrication, ou plus de 8 branches
conditionnelles (`if`/`else if`/`switch case`/opérateurs ternaires
imbriqués) cumulées.

- **Sévérité** : Majeur.
- **OK d'ignorer si** : la fonction est un moteur de règles intentionnellement
  linéaire (ex. `checkEligibility()` avec ses critères successifs) où chaque
  branche correspond à un critère métier documenté et nommé — signaler
  seulement si l'imbrication dépasse le seuil *en plus* de la liste de
  critères plate (imbrication réelle, pas juste beaucoup de `if` au même
  niveau).

### 3.3 Fichiers trop longs
`.vue`/`.js` de plus de 300 lignes : "à surveiller". Plus de 500 lignes : "à
découper en priorité".

- **Sévérité** : Mineur (300–500 lignes) / Majeur (500+ lignes).
- **OK d'ignorer si** : le fichier est un fichier de test avec beaucoup de
  cas similaires côte à côte (lisibilité prime sur la longueur pour les
  tests), ou un fichier de constantes/schéma dont la longueur vient du volume
  de données déclaratives, pas de complexité logique.

### 3.4 `console.log`/`console.error` de debug oubliés
Appel `console.*` en dehors d'un vrai logger, laissé dans du code de
production (pas dans un test, pas derrière un flag de dev).

- **Sévérité** : Mineur.
- **OK d'ignorer si** : c'est un `console.error` dans un `catch` d'écriture
  secondaire best-effort (cf. `CLAUDE.md`) — c'est le seul mécanisme
  d'observabilité actuel de ce repo (aucun outil de suivi d'erreurs, trou
  connu et tracké roadmap Phase 5). Ne pas demander sa suppression sans
  proposer un remplacement, sinon on perd la seule trace de ces échecs.

### 3.5 Composables multi-responsabilités
Composable qui mélange fetch réseau, mutation d'état local, logique métier
(calculs, règles) et navigation (`router.push`), le tout dans la même
fonction exportée.

- **Sévérité** : Majeur si le mélange rend le composable difficile à tester
  isolément (logique métier non extractible sans monter un composant) ;
  Mineur si c'est juste une question de lisibilité.
- **OK d'ignorer si** : la fonction est courte (moins d'une dizaine de
  lignes) et le mélange reste trivial à suivre visuellement — le critère est
  la testabilité/lisibilité réelle, pas le nombre de catégories de code
  touchées en soi.

### 3.6 Incohérences de nommage/convention
Écart par rapport à une convention déjà établie ailleurs dans le repo (ex.
`useXxx` vs un autre préfixe, structure try/catch/finally différente d'un
composable à l'autre, ordre des imports).

- **Sévérité** : Mineur.
- **OK d'ignorer si** : le code suit une convention théorique externe
  (guide de style générique) mais diverge de ce que fait déjà la majorité de
  ce repo — dans ce cas c'est la convention du repo qui gagne, pas
  l'inverse ; ne pas signaler un fichier qui suit *le* pattern du repo sous
  prétexte qu'un standard extérieur ferait différemment.

---

## 4. Performance

### 4.1 `watch()` qui pourrait être un `computed()`
`watch()` dont le seul effet est de recalculer et assigner une valeur dérivée
dans une autre ref, sans effet de bord externe (pas d'appel réseau, pas de
navigation, pas de mutation d'un système externe).

- **Sévérité** : Mineur.
- **OK d'ignorer si** : le `watch()` a besoin de la valeur précédente
  (comparaison avant/après), d'un contrôle explicite du timing
  (`immediate`/`flush`), ou déclenche un effet de bord même minime en plus de
  l'assignation.

### 4.2 Requêtes GraphQL sans pagination sur listes potentiellement grandes
`list*` GraphQL sans `limit`/`nextToken` géré, sur un type dont le volume
peut croître sans borne connue à l'échelle du pilote (Missions, Requests,
Animals d'une clinique avec beaucoup de donneurs).

- **Sévérité** : Majeur si le volume attendu au pilote dépasse déjà la limite
  par défaut d'AppSync (souvent proche de la centaine d'items) ; Mineur si le
  volume restera trivial pendant la durée du pilote (ex. dizaines
  d'utilisateurs test).
- **OK d'ignorer si** : c'est le filtrage/matching côté client du MVP,
  documenté comme dette assumée directement dans le code (`useMatchingRequests.js`,
  `eligibility-service.js`) — la limite de volume est déjà connue et son
  traitement est hors périmètre V1 par décision explicite, pas un oubli.

### 4.3 Mutation d'objets réactifs dans `.filter()`/`.map()`
Callback de `.filter()`/`.map()`/`.reduce()` qui mute (assignation directe,
`push`, etc.) un objet réactif Vue au lieu de retourner une nouvelle valeur.

- **Sévérité** : Majeur (source de bugs de réactivité difficiles à
  diagnostiquer, pas seulement de perf).
- **OK d'ignorer si** : la mutation porte sur un objet local créé à
  l'intérieur du callback lui-même (donc non réactif, non partagé).

### 4.4 Re-fetch réseau évitable
Appel GraphQL redemandant une donnée déjà présente en mémoire dans le state
du composable/composant (pas d'invalidation entre-temps qui le justifierait).

- **Sévérité** : Mineur, sauf si le re-fetch est déclenché à haute fréquence
  (dans une boucle, un `watch()` qui se déclenche souvent) — alors Majeur.
- **OK d'ignorer si** : le re-fetch suit un événement qui invalide
  légitimement le cache local (retour de premier plan après polling, cf.
  Phase 4.1 dashboard-refresh — c'est le comportement voulu, pas un oubli).

---

## 5. Tests

### 5.1 Composables avec logique métier non-triviale sans test Vitest
Composable qui contient une branche conditionnelle, un calcul, ou une
transformation de données au-delà d'un simple passe-plat GraphQL, sans test
Vitest correspondant.

- **Sévérité** : Majeur si le composable touche un flux critique (matching,
  éligibilité, clôture de Mission, auth) ; Mineur ailleurs.
- **OK d'ignorer si** : la logique est un simple mapping GraphQL
  (`try/catch/finally` standard sans branche métier) — pas de valeur ajoutée
  à tester ce qui n'est que de la plomberie déjà couverte indirectement par
  le seul test e2e Playwright existant.

### 5.2 Tests qui testent l'implémentation plutôt que le comportement
Test qui assert sur des détails internes (appel exact d'une fonction privée,
structure interne d'un état) plutôt que sur l'observable (valeur retournée,
état exposé, comportement visible), rendant le test fragile aux
refactorings qui ne changent pas le comportement.

- **Sévérité** : Mineur, sauf si le couplage à l'implémentation a déjà causé
  un faux négatif/positif documenté (test qui casse sans régression réelle,
  ou qui passe malgré une régression réelle) — alors Majeur.
- **OK d'ignorer si** : le composable exporté n'a pas d'autre surface
  observable que l'appel interne testé (rare, à vérifier au cas par cas
  plutôt qu'à supposer).

---

## 6. i18n (spécifique à ce projet)

### 6.1 Chaînes visibles utilisateur en dur au lieu de `$t()`
Texte destiné à l'utilisateur final écrit en littéral (français ou autre)
dans un template ou un message d'erreur, au lieu de passer par `$t()`/`t()`.

- **Sévérité** : Mineur.
- **OK d'ignorer si** : la chaîne est dans `DashboardView.vue` et fait déjà
  partie de la dette i18n connue et trackée de ce repo (voir `CLAUDE.md` et
  le skill `/i18n-audit`) — la re-signaler individuellement n'apporte rien de
  neuf ; référencer la dette existante plutôt que de lister chaque
  occurrence. Ne demande **pas** de correction en masse sans confirmation
  explicite de l'utilisateur, conformément à `CLAUDE.md`.

---

## Notes d'application

- Ce référentiel sert de grille de lecture pour les audits `docs/audit/`
  suivants — un audit référence la règle par son numéro (ex. "2.2 —
  `Animal.bloodGroup`") plutôt que de reformuler le critère à chaque fois.
- Une règle "OK d'ignorer si" n'est pas un blanc-seing permanent : si le
  contexte qui justifiait l'exception change (ex. le pilote passe à
  l'échelle, une dette documentée n'est plus d'actualité), la règle
  redevient pleinement applicable.
- Ce référentiel vit avec le projet comme `CLAUDE.md` : une règle qui s'avère
  mal calibrée pendant un audit réel (trop de bruit, ou un vrai problème
  qui lui échappe) se corrige ici, dans la même PR que l'audit qui l'a
  révélé.
