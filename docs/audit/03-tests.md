# Audit tests — Redlink PWA

Audit réalisé selon la grille `docs/audit/00-referentiel.md`. Toute référence de
règle ci-dessous ("X.Y") pointe vers ce référentiel.

## Méthode

- **Périmètre strict** : `src/composables/` (15 fichiers de production, hors
  fichiers de test) croisé avec tous les fichiers de test qui leur sont
  associés, où qu'ils vivent (`src/composables/__tests__/*.test.js` **et**
  `src/composables/*.spec.js` posés à côté du composable — les deux motifs
  sont ramassés par le pattern d'inclusion par défaut de Vitest
  (`**/*.{test,spec}.js`), donc tous deux "comptent" comme test existant).
  `src/services/` inspecté uniquement pour noter l'état de sa couverture, pas
  pour un audit complet (déjà hors du périmètre de la demande).
- **Exécution de la suite** : tentée via le subagent `qa-test-engineer` +
  MCP `vitest`, conformément à `CLAUDE.md`. Le MCP `vitest` ne s'est pas
  révélé exposé dans le contexte d'exécution du subagent (seuls Read/Write/
  Edit/Bash côté outils, `context7`/`serena` côté MCP y sont apparus) — bascule
  sur le fallback Bash déjà documenté par `CLAUDE.md`/`01-frontend.md` pour ce
  cas de figure (`npm run test:run`), en lecture seule (aucune modification de
  fichier demandée ni faite par le subagent).
- **Résultat de la suite** (`npm run test:run`, racine du repo) : **12
  fichiers de test, 226 tests passés, 0 échoué, 0 skippé**, 840ms. Des blocs
  `stderr` apparaissent dans la sortie brute pour `useAnimalValidation.test.js`,
  `useMissionClosure.test.js`, `useClinicRequest.spec.js` : ce sont des
  `console.error` émis par le code applicatif sur des chemins d'erreur
  testés intentionnellement (ex. `BLOOD_GROUP_UNKNOWN`, `Network error`), pas
  des échecs Vitest — tous les fichiers concernés sont marqués `✓`.
- **Couverture chiffrée : non obtenue.** `@vitest/coverage-v8` n'est ni dans
  `node_modules` ni dans `package.json` (`devDependencies`) de ce repo — la
  tentative (`vitest run --coverage`) échoue immédiatement avec `MISSING
  DEPENDENCY: Cannot find dependency '@vitest/coverage-v8'`. Le subagent n'a
  pas installé le package (changement de dépendance hors périmètre d'un audit
  en lecture seule, cf. consigne donnée). Aucun pourcentage global ni détail
  par fichier n'est donc disponible dans ce document — la section 5.1
  ci-dessous s'appuie sur une lecture exhaustive des 15 fichiers de
  `src/composables/` croisée avec la liste des fichiers de test existants,
  pas sur un rapport de couverture chiffré.
- **Recommandation d'outillage** (transverse, pas un constat de règle
  numérotée) : installer `@vitest/coverage-v8` (`npm install -D
  @vitest/coverage-v8`) pour permettre un futur audit chiffré — actuellement
  impossible à produire dans cet environnement.
- `src/services/eligibility-service.js` est couvert par deux fichiers de test
  (`eligibility-service.test.js`, `eligibility-service.criteria.test.js`) —
  aucun gap constaté sur `src/services/`, non détaillé plus loin.

---

## 5. Tests

### 5.1 — `useAnimals.js` : logique de mutation/rollback non triviale entièrement non testée
**Fichier** : `src/composables/useAnimals.js` (`updateAnimalDetails`, lignes
52-97 ; `deleteAnimalById`, lignes 99-122 ; `createNewAnimal`, lignes 124-159 ;
`calculateAge`, lignes 14-19)
**Catégorie** : 5.1 — Composables avec logique métier non-triviale sans test
**Sévérité** : Majeur (`Animal.bloodGroup`/`isVaccinated`/`donationFrequency`
alimentent directement les critères d'éligibilité consommés par
`useOwnerMissions.acceptMission` — référentiel : "éligibilité" est un flux
critique explicitement cité)
**Description** : Aucun fichier `useAnimals.test.js`/`.spec.js` n'existe dans
le repo. Au-delà du calcul d'âge déjà signalé individuellement dans
`01-frontend.md` (5.1, Mineur — élargi et absorbé ici dans un constat plus
large sur le fichier entier), ce composable contient plusieurs branches non
triviales, aucune testée :
- `updateAnimalDetails` : branche spéciale sur un succès partiel GraphQL
  (`error.data && error.data.updateAnimal` → traité comme un succès malgré
  une erreur levée, `console.warn` puis poursuite) vs. rethrow sinon.
- `deleteAnimalById` : suppression optimiste (retrait immédiat de
  `animals.value`) avec rollback conditionnel (`previousAnimals`) selon la
  même distinction succès-partiel/vraie-erreur que ci-dessus.
- `createNewAnimal` : valeur par défaut `bloodGroup: form.bloodGroup ||
  'UNKNOWN'` — logique déjà signalée côté produit (voir mémoire de session :
  "Animal blood group can be saved as UNKNOWN default, bypassing vet
  validation requirement") mais jamais vérifiée par un test qui figerait ce
  comportement.
**Recommandation** : Ajouter `useAnimals.test.js` couvrant au minimum les
branches succès-partiel de `updateAnimalDetails`/`deleteAnimalById`, le
rollback optimiste, et le défaut `bloodGroup: 'UNKNOWN'`.

### 5.1 — `useOwnerProfile.js` : suppression de compte multi-entités non testée
**Fichier** : `src/composables/useOwnerProfile.js` (`deleteAccount`, lignes
88-137)
**Catégorie** : 5.1 — Composables avec logique métier non-triviale sans test
**Sévérité** : Majeur (le composable touche `deleteUser()` — flux "auth"
explicitement cité par le référentiel — avec suppression en cascade des
`Animal` du Owner)
**Description** : Aucun fichier de test associé. `deleteAccount` mélange
plusieurs branches sensibles jamais vérifiées : nettoyage best-effort des
`Animal` (erreur avalée, `console.error` seulement — pattern "écriture
secondaire best-effort" au sens de `CLAUDE.md`, correctement catchée mais non
testée pour autant), suppression `Owner` uniquement si `ownerId.value` est
défini, puis suppression Cognito (`deleteUser()`) avec `throw authError` en
cas d'échec — c'est cette dernière branche qui détermine si l'utilisateur
voit une erreur ou une redirection silencieuse vers `/`.
**Recommandation** : Ajouter un test Vitest couvrant au moins : succès
complet, échec du nettoyage `Animal` (n'empêche pas la suite), échec de
`deleteUser()` (doit bien remonter/rethrow).

### 5.1 — `useClinicSettings.js` : suppression de compte Veterinarian + Clinic non testée
**Fichier** : `src/composables/useClinicSettings.js` (`deleteAccount`, lignes
134-159 ; branchement `vet.clinic` dans `fetchSettings`, lignes 67-80)
**Catégorie** : 5.1 — Composables avec logique métier non-triviale sans test
**Sévérité** : Majeur (même famille que le constat `useOwnerProfile.js`
ci-dessus — `deleteUser()`, flux auth explicitement cité)
**Description** : Même absence totale de test que `useOwnerProfile.js`, pour
un composable au pattern analogue mais sur deux entités (`Veterinarian` et
`Clinic`, chacune supprimée sous sa propre garde `if (vetId.value)`/`if
(clinicId.value)`) suivies de `deleteUser()` sans `try/catch` dédié à cette
dernière étape (contrairement à `useOwnerProfile.js` qui isole explicitement
l'erreur Cognito) — une différence de comportement entre les deux composables
qui n'est vérifiée par aucun test.
**Recommandation** : Ajouter un test Vitest couvrant les deux gardes de
suppression et le comportement de `deleteAccount` si `deleteUser()` échoue.

### 5.1 — `useMenu.js` : branchement de menu par rôle non testé
**Fichier** : `src/composables/useMenu.js` (`currentMenuItems`, lignes 76-80)
**Catégorie** : 5.1 — Composables avec logique métier non-triviale sans test
**Sévérité** : Mineur (branchement à 3 issues sur `auth.currentRole`, pas de
flux critique au sens du référentiel, mais logique réelle — pas un simple
passe-plat GraphQL puisqu'il n'y a d'ailleurs aucun appel réseau dans ce
composable)
**Description** : `currentMenuItems` sélectionne `vetItems`/`ownerItems`/`[]`
selon `auth.currentRole` — aucun test ne fige ce comportement (en particulier
le cas `else` non documenté : rôle inconnu → menu vide silencieux).
**Recommandation** : Test Vitest ciblé, secondaire par rapport aux trois
constats précédents.

---

### 3.6 — Deux conventions de nommage/emplacement pour les fichiers de test, sans règle documentée
**Fichiers concernés** :
- `src/composables/__tests__/{useAnimalValidation,useClinicDonors,useMatchingRequests,useMissionClosure,useOwnerMissions}.test.js`
  — dans `__tests__/`, suffixe `.test.js`.
- `src/composables/{useClinicHistory,useClinicRequest,useOwnerMissions}.spec.js`
  — posés à côté du composable, suffixe `.spec.js`, **hors** `__tests__/`.

**Catégorie** : 3.6 — Incohérences de nommage/convention
**Sévérité** : Mineur
**Description** : Les deux motifs coexistent sans qu'aucune convention ne
soit documentée (ni `CLAUDE.md`, ni `.cursorrules` cité en tête de
`CLAUDE.md`) pour arbitrer lequel utiliser. Cas particulier notable :
`useOwnerMissions.js` a **les deux à la fois** —
`__tests__/useOwnerMissions.test.js` (descriptions en français, couvre les
gates d'éligibilité 1-3 de `acceptMission` et le nettoyage de Mission
orpheline sur `REQUEST_ALREADY_TAKEN`) et `useOwnerMissions.spec.js`
(descriptions en anglais, couvre la propagation d'erreur d'auth et
`mapAcceptMissionError`). Les deux fichiers ne se recouvrent pas
(pas de duplication de règle 3.1 — chacun couvre un aspect distinct), mais
rien n'indique dans le repo pourquoi un troisième constat sur le même
composable n'irait pas dans un troisième fichier/convention encore
différente.
**Recommandation** : Choisir une convention unique (suggestion : `__tests__/
*.test.js`, déjà majoritaire — 5 fichiers contre 3) et migrer
`useClinicHistory.spec.js`/`useClinicRequest.spec.js`/`useOwnerMissions.spec.js`
dedans, en fusionnant `useOwnerMissions.spec.js` dans
`__tests__/useOwnerMissions.test.js` plutôt que renommer seul (les deux
testent le même composable). Sans urgence, mais à trancher avant que d'autres
composables ajoutent un troisième pattern.

---

## Suggestion séparée — candidat `@vue/test-utils`

**Fichier** : `src/views/dashboard/clinic/RequestsView.vue` (dialogue de
clôture de Mission, lignes 180-298 pour le template, `handleCloseMission`
lignes ~100-174 pour le script)
**Ce n'est pas un constat de règle 5.1** (`@vue/test-utils` est explicitement
hors recommandations pour ce repo, sauf justification claire par composant —
voir consigne de cet audit) — signalé séparément.
**Pourquoi ce cas précis, et pas une recommandation généralisée** : la
visibilité/l'état `disabled`/`loading` des deux boutons de clôture
(`complete_btn`/`no_show_btn`, lignes 259-277) dépend d'un `v-if` combiné sur
`selectedRequest.mission.status` (lignes 253-256) **et** sur `closingOutcome`
(ref locale). Le code contient un commentaire du développeur (lignes 145-152)
qui documente explicitement la fragilité : après un échec partiel de clôture
(Mission fermée mais erreur sur le `closeRequest` qui suit), `selectedRequest`
doit être **manuellement resynchronisé** depuis la liste rechargée pour que
ce `v-if` cesse d'afficher les deux boutons sur une Mission déjà close — sans
quoi un second clic reste possible. C'est une logique d'affichage réellement
couplée au rendu (état de dialogue + re-render conditionnel), pas réductible
à une fonction pure extractible dans un composable/service — le candidat
naturel serait un test `@vue/test-utils` montant `RequestsView.vue`, mockant
`useClinicRequest`/`useMissionClosure`, et vérifiant l'état des boutons après
un échec partiel simulé. Aucun autre fichier du périmètre audité n'a présenté
un cas aussi net ; ne pas généraliser cette suggestion à d'autres `.vue`
sans un examen similaire au cas par cas.

---

## Note hors grille — fichiers composables vides et non référencés

`src/composables/useAuth.js` et `src/composables/useGeoLocation.js` font
tous les deux **0 octet** et ne sont importés nulle part dans `src/`
(`grep -rn "useAuth\b"`/`"useGeoLocation"` ne retourne aucune référence hors
`useAuthStore`, un store Pinia distinct). Ce ne sont pas des composables avec
logique non testée au sens de la règle 5.1 (aucune logique du tout) — plutôt
des fichiers placeholder morts. Hors périmètre strict de cet audit tests,
signalé ici à titre informatif ; un futur passage 3.x (code smells) pourrait
trancher suppression vs. complétion.

---

## Dette déjà connue, non re-signalée

- **`usePassword.js` (validation mot de passe, flux auth) sans test** :
  déjà documenté dans `01-frontend.md`, règle 5.1, Majeur. Toujours vrai
  (vérifié : aucun `usePassword.test.js`/`.spec.js` dans le repo à ce jour) —
  non redétaillé ici.
- **`useOwnerAvailability.js` — tri des disponibilités sans test** : déjà
  documenté dans `01-frontend.md`, règle 5.1, Mineur (cas dimanche = 0).
  Toujours vrai — non redétaillé ici.
- **`useAnimals.js` — `calculateAge` sans test** : déjà documenté
  individuellement dans `01-frontend.md`, règle 5.1, Mineur. **Absorbé** dans
  le constat plus large de ce document ci-dessus (le fichier entier, pas
  seulement `calculateAge`, est sans aucun test) — ne pas traiter comme deux
  actions séparées.
