---
status: accepted
supersedes: none (voir "Relation avec le reste des ADR" ci-dessous)
---

# `defineData` Gen2 : câblage des relations (`hasMany`/`hasOne`/`belongsTo`), gaps préexistants

Phase 8, sous-tâche 4 — complément à `docs/adr/0009` (traduction `@auth`). Cet ADR
documente le câblage des relations entre les 8 modèles, en particulier une contrainte du
validateur de schéma Gen2 découverte pendant cette sous-tâche (absente en Gen1) qui a
forcé l'ajout de deux champs de relation sans équivalent Gen1, et les deux gaps
préexistants signalés par le coordinateur (non corrigés ici, hors périmètre).

## 1. Contrainte Gen2 découverte : une relation `hasOne`/`hasMany` exige TOUJOURS un `belongsTo` apparié, avec un champ de référence IDENTIQUE des deux côtés

Le schéma Gen1 (Transformer v1) tolère des directives `@hasOne`/`@hasMany`/`@belongsTo`
non appariées — `Mission.request: Request @belongsTo(fields: ["requestID"])` n'a par
exemple aucune contrepartie `hasMany` déclarée sur `Request` en Gen1, et ça compile/
déploie sans erreur (juste un champ non exposé dans l'autre sens).

Le processeur de schéma Gen2 (`@aws-amplify/data-schema`) est strict sur ce point —
vérifié en lisant `node_modules/@aws-amplify/data-schema/dist/esm/SchemaProcessor.mjs`
(fonctions `getAssociatedConnectionField`/`getModelRelationship`, commentaire explicite
lignes ~1465-1474) : toute relation `hasOne`/`hasMany` doit avoir un `belongsTo`
apparié sur le modèle ciblé (et vice-versa), et **les deux côtés doivent déclarer le
même tableau `references`** (le nom du champ de référence). Sans ça,
`getAssociatedConnectionField` lève une erreur explicite
(`Unable to find associated relationship definition in <Model>`) — pas un warning,
une erreur bloquante à la construction du schéma (donc à `npx tsc --noEmit` +
`defineData(...)` lui-même, avant même un déploiement réel).

Autre point vérifié dans le même fichier : pour un couple `hasOne`/`belongsTo`, le champ
de référence (`references`) doit être un champ scalaire **physiquement défini sur le
modèle qui déclare `belongsTo`** (le "child", celui qui stocke réellement la valeur du
FK) — pas sur celui qui déclare `hasOne`. Ça détermine, pour chaque relation, quel côté
doit porter `hasOne` et quel côté doit porter `belongsTo`, indépendamment de ce que Gen1
avait choisi.

### Conséquence 1 : `Request.mission` change de direction (`hasOne` → `belongsTo`)

Gen1 : `Request.activeMissionID: ID` + `Request.mission: Mission @hasOne(fields:
["activeMissionID"])` — le champ de référence (`activeMissionID`) est physiquement
stocké sur `Request` elle-même, pas sur `Mission`.

Appliqué tel quel en Gen2 (`Request.mission: a.hasOne('Mission', 'activeMissionID')`),
le validateur exigerait un champ `activeMissionID` **sur `Mission`** (le modèle ciblé
par le `hasOne`) — qui n'existe pas et n'a pas de sens (le FK n'est pas stocké là).

Traduction correcte : `Request.mission: a.belongsTo('Mission', 'activeMissionID')` — le
champ de référence reste sur `Request` (qui déclare `belongsTo`), cohérent avec
l'emplacement physique réel du FK. Apparié à un nouveau champ sur `Mission` (voir
ci-dessous). **Comportement applicatif inchangé** : `request.mission` reste résolu
exactement de la même façon côté client (`request.mission.animal.ownerProfile...`,
utilisé par `RequestsView.vue` et `useClinicHistory.js` — vérifié par grep applicatif
avant cette décision, ces usages persistent tels quels en sous-tâche 5). Seule la
déclaration change de sens, imposée par le framework — pas un choix de modélisation.

### Conséquence 2 : deux champs de relation ajoutés, absents de Gen1

Pour satisfaire l'appariement obligatoire ci-dessus :

- **`Mission.activeForRequest: a.hasOne('Request', 'activeMissionID')`** — contrepartie
  obligatoire de `Request.mission` (`belongsTo`, ci-dessus). Jamais consommé par un
  composable applicatif (Gen1 non plus : aucun champ réciproque n'existait sur
  `Mission`). Nom choisi pour rester lisible dans le client généré si un futur besoin
  apparaît (plutôt qu'un nom générique/anonyme), sans intention d'usage immédiat.
- **`Request.missions: a.hasMany('Mission', 'requestID')`** — contrepartie obligatoire
  de `Mission.request` (`belongsTo` via `requestID`, déjà présent en Gen1 mais jamais
  apparié). `hasMany` (pas `hasOne`) parce qu'une `Request` peut avoir plusieurs
  `Mission` dans le temps (une `Mission` `NO_SHOW`/`CANCELLED` suivie d'une nouvelle
  `Mission` pour la même `Request`) — `Request.mission` (singulier, ci-dessus) reste le
  seul pointeur vers la Mission **active**, `Request.missions` (pluriel) expose
  l'historique complet.

**Ce ne sont pas de nouvelles fonctionnalités produit** : ce sont des champs de
relation mécaniquement requis par le validateur de schéma Gen2 pour que le schéma
compile du tout, exactement de la même nature que la correction de
`Veterinarian.validatedMissions` (section 2 ci-dessous) déjà pré-autorisée par le
coordinateur de cette sous-tâche. Aucun composable applicatif actuel (avant la
sous-tâche 5) ne les référence. Signalé explicitement ici pour que le Lead Dev les
distingue clairement d'un élargissement de périmètre — c'est une conséquence du
passage d'un Transformer tolérant (v1) à un validateur strict (Gen2), pas une décision
produit.

**Alternative écartée** : ne pas déclarer `Request.mission`/`Mission.request` comme de
vraies relations Gen2 et laisser `activeMissionID`/`requestID` comme simples champs
scalaires (`a.id()`), en reportant la résolution "manuelle" (deuxième requête) à la
sous-tâche 5. Rejetée : ça aurait dégradé une capacité déjà exploitée par le code actuel
(une seule requête imbriquée `listRequests` avec `mission { animal { ownerProfile { ... } } } }`,
`custom-queries.js`) en plusieurs allers-retours réseau, sans bénéfice — le coût
(déclarer deux champs de relation supplémentaires, inertes tant qu'ils ne sont pas
appelés) est nul en pratique et strictement inférieur à celui d'une réécriture de
composable non demandée par cette sous-tâche.

## 2. `Veterinarian.validatedMissions` — champ mort en Gen1, câblé correctement ici (mécanique, pas une nouvelle fonctionnalité)

Confirmé par le coordinateur avant cette sous-tâche : Gen1 déclare
`Veterinarian.validatedMissions: [Mission] @hasMany` **sans** `indexName`/`fields`
explicites (le commentaire Gen1 le dit lui-même : "Si vous voulez lister les missions
par vétérinaire, ajoutez @index(name: "byVet") ici" — jamais fait). `grep -rn
"validatedMissions" src/` ne retourne que les fichiers auto-générés
(`src/graphql/{queries,mutations,subscriptions}.js`), jamais un composable/service
applicatif — champ mort côté produit.

En Gen2, ce champ non apparié aurait de toute façon fait échouer la construction du
schéma (section 1 ci-dessus). Câblé avec le vrai FK qui existe déjà sur `Mission`
(`validatedByVeterinarianID`, déjà utilisé par ADR-0002/0004) :
`Veterinarian.validatedMissions: a.hasMany('Mission', 'validatedByVeterinarianID')`,
apparié à `Mission.validatedBy: a.belongsTo('Veterinarian', 'validatedByVeterinarianID')`
(déjà présent en Gen1 comme en Gen2, inchangé). Correction **mécanique** de traduction
(sans elle, le schéma ne compile pas), pas une nouvelle fonctionnalité — aucun
composable n'exploite ce champ à ce jour.

## 3. Gaps préexistants, non corrigés ici (dette déjà documentée, pas une régression introduite)

Signalés par la revue DevSecOps AWS de la sous-tâche 3, confirmés par le coordinateur de
cette sous-tâche — reproduits à l'identique, volontairement **non fermés** :

1. **Groupe Cognito `Admins`** (`Veterinarian`, `allow.group('Admins').to(['read',
   'delete'])`) : jamais provisionné par l'IaC, ni en Gen1 ni dans
   `amplify/auth/resource.ts` (Gen2, sous-tâche 3, ne déclare que
   `Veterinarians`/`Owners` dans `groups: [...]`). La règle est reproduite à l'identique
   dans `amplify/data/resource.ts` — ajouter `Admins` à `defineAuth({ groups: [...] })`
   changerait le périmètre de la sous-tâche 3 (Cognito), pas de celle-ci (données).
   Conséquence pratique inchangée par rapport à Gen1 : cette règle reste inatteignable
   tant qu'aucun groupe `Admins` n'existe réellement dans le user pool.
2. **`Veterinarian.validatedMissions`** : voir section 2 ci-dessus — câblé
   mécaniquement pour que le schéma compile, mais reste un champ mort côté applicatif
   (aucun composable ne l'utilise, avant comme après cette migration).

## Relation avec le reste des ADR

Comme ADR-0008 : ce nouvel ADR ne modifie aucune décision Gen1 antérieure — il
documente une contrainte structurelle du framework Gen2 (appariement obligatoire des
relations) découverte pendant la traduction, et les deux champs qu'elle a forcé
d'ajouter. Aucun des compromis actés par ADR-0001 à 0006 n'est rouvert.
