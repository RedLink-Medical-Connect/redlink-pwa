---
status: accepted
supersedes: none (voir "Relation avec le reste des ADR" ci-dessous)
---

# `defineData` Gen2 : traduction des règles `@auth` (type et champ), `ClinicOwnerRelation`

Phase 8, sous-tâche 4 : recréation des 8 types `@model` du schéma Gen1
(`amplify/backend/api/redlinkpwa/schema.graphql`, laissé intact) en `defineData` Gen2
(`amplify/data/resource.ts`), avec leurs règles d'autorisation. Cet ADR documente la
traduction `@auth` elle-même (le "comment"), pas le câblage des relations `hasMany`/
`hasOne`/`belongsTo` (voir `docs/adr/0010` pour ça, y compris les gaps préexistants
`Admins`/`Veterinarian.validatedMissions`).

## 1. Traduction directe, sémantique inchangée

`a.model({...}).authorization((allow) => [...])` (niveau modèle) et
`.authorization((allow) => [...])` posé sur un champ précis (niveau champ) sont la
traduction directe des règles `@auth` de type et de champ du schéma Gen1. Confirmé via
`context7` (`/aws-amplify/amplify-data`) et vérifié en lisant
`node_modules/@aws-amplify/data-schema/dist/esm/Authorization.d.ts` (signatures
`allow.owner()`/`allow.ownerDefinedIn()`/`allow.group()`/`allow.groups()`/
`allow.authenticated()`, toutes avec `.to([...])` pour restreindre les opérations) et
`ModelType.d.ts`/`ModelField.d.ts` (méthode `.authorization()` disponible aussi bien au
niveau modèle qu'au niveau champ) pour cette sous-tâche :

- `.authorization()` posée sur un CHAMP **REMPLACE** (ne fusionne pas) la règle de
  niveau modèle pour ce champ précis — exactement la sémantique Transformer v1
  qu'exploitaient déjà ADR-0002 à 0006 (`bloodGroup`, `lastDonationDate`,
  `isValidatedDonor`/`validationExpiresAt`, tous les champs Veterinarian-scopés de
  `Request`/`Mission`). Traduction directe, zéro changement de comportement attendu —
  seulement une syntaxe déclarative différente.
- `allow.owner()` = Gen1 `{ allow: owner }` (pas de `ownerField` explicite).
- `allow.ownerDefinedIn(champ)` = Gen1 `{ allow: owner, ownerField: champ }` — voir
  section 2 ci-dessous, seul endroit du schéma où c'est utilisé.
- `allow.group(nom)` / `allow.groups([...])` = Gen1 `{ allow: groups, groups: [...] }`.
  `.to([...])` = `operations: [...]`.
- `allow.authenticated()` = Gen1 `{ allow: private }` — **tout utilisateur Cognito
  authentifié, peu importe le groupe**, pas un vrai mode "private" au sens anglais
  courant. Utilisé pour `Request` (règle de type et de champ) et pour la règle `read`
  globale de `Clinic`/`Veterinarian`.

Pas d'`identityClaim()` custom nulle part : environnement Gen2 vierge (décision actée
avant cette sous-tâche, aucune donnée Gen1 à préserver), donc le format composite
`"$sub::$username"` que Gen1 écrivait dans le champ caché `owner`
(`Mutation.createAnimal.auth.1.req.vtl`, Gen1) n'a aucune conséquence pratique — seule la
cohérence interne Gen2 écriture/lecture compte. `allow.owner()` utilise le défaut Gen2
partout où Gen1 utilisait `{ allow: owner }` sans `ownerField`.

## 2. `ClinicOwnerRelation.ownerDefinedIn("ownerID")` — le point le plus sensible

`ClinicOwnerRelation` est le **seul** endroit du schéma où le Gen1 `ownerField`
explicite est utilisé (schema.graphql, lignes 165-174, commentaire déjà dense dans le
Gen1 original). Ces lignes sont **toujours écrites côté Veterinarian**
(`useMissionClosure.js`, à la clôture d'une Mission), **jamais par l'Owner lui-même** —
c'est précisément le scénario qui a produit le bug réel du commit `d27f204` :

- Sans `ownerField`/`ownerDefinedIn` explicite, la règle `owner` par défaut s'appuie sur
  le champ caché auto-injecté par le Transformer, dont la valeur est l'identité de **qui
  ÉCRIT la ligne** — dans ce cas, toujours le Veterinarian (puisque c'est
  `useMissionClosure.js`, appelé côté Vet, qui crée la `ClinicOwnerRelation`).
- Le besoin métier réel est différent : l'Owner doit pouvoir lire (via
  `clinicOwnerRelationsByOwnerID`) les relations qui le concernent LUI, pas celles qu'il
  a écrites (il n'en écrit aucune). Le champ `ownerID` du modèle porte cette identité
  réelle.
- Sans le scoping explicite, `clinicOwnerRelationsByOwnerID` serait resté vide en
  permanence côté Owner (le champ caché `owner` ne matchant jamais l'identité de
  l'Owner qui lit) — exactement le bug corrigé par `d27f204`.

Traduction Gen2 : `allow.ownerDefinedIn('ownerID')`, qui porte la même intention
explicite que le Gen1 `{ allow: owner, ownerField: "ownerID" }` — le champ `ownerID`
du modèle (pas le champ caché) sert de source de vérité pour la règle `owner`. Vérifié
via `Authorization.d.ts` : `ownerDefinedIn(ownerField)` est exactement le builder conçu
pour ce cas ("Authorize access on a per-user (owner) basis with specifying which field
should be used as the owner field").

La seconde règle du modèle, `allow.group('Veterinarians')` (**sans** `.to([...])`,
c'est-à-dire sans restriction d'opérations), est reproduite à l'identique du Gen1 —
c'est délibéré en Gen1 (les Veterinarians ont besoin de create/read/update/delete
complets sur ces lignes pour piloter `useMissionClosure.js`), pas un oubli à combler
dans cette migration.

## 3. Récapitulatif par type (référence rapide)

Traduction 1:1 des règles du schéma Gen1 vers `amplify/data/resource.ts` — le détail est
en commentaire directement dans le fichier, cette section ne fait que pointer vers les
ADR d'origine pour chaque pattern repris :

- `Clinic`, `Veterinarian` : `allow.owner()` + `allow.group(...)` + `allow.authenticated().to(['read'])`.
- `Owner`, `OwnerAvailability` : `allow.owner()` + `allow.group('Veterinarians').to(['read'])`.
- `Animal` : règle de type `allow.owner()` + `allow.group('Veterinarians').to(['read'])`,
  quatre champs avec `.authorization()` dédiée (ADR-0002, ADR-0003, ADR-0006 — la variante
  `bloodGroup`, owner SANS restriction d'opérations, contrairement aux trois autres).
- `ClinicOwnerRelation` : voir section 2.
- `Request` : règle de type `allow.group('Veterinarians')` + `allow.authenticated().to(['read', 'update'])`
  (le `update` nécessaire à `linkRequestToMission`, ADR-0001/commentaire Gen1 lignes
  188-199), six champs avec `.authorization()` dédiée (ADR-0004/0005), `status`/
  `activeMissionID` volontairement hors scoping champ (commentaire dédié dans
  `resource.ts`).
- `Mission` : règle de type `allow.owner().to(['create', 'read', 'delete'])` (PAS
  `update`, ADR-0004) + `allow.group('Veterinarians').to(['read', 'update'])`, cinq
  champs avec `.authorization()` dédiée (ADR-0004), `status` volontairement hors
  scoping champ (limite connue, non fermée par cette migration, voir ADR-0004).

## Relation avec le reste des ADR

Comme ADR-0008 (`defineAuth` Gen2) : cet ADR **ne modifie aucune décision Gen1
antérieure**. ADR-0002 à 0006 restent la trace vivante des décisions de fond (pourquoi
tel champ est scopé Veterinarian, pourquoi `bloodGroup` est la variante) — elles ne sont
pas "superseded" au sens où leur raisonnement serait caduc, seulement leur *forme*
d'implémentation change de syntaxe (`@auth(rules: [...])` GraphQL SDL Transformer v1 →
`.authorization((allow) => [...])` Gen2 declarative builder). Ce nouvel ADR documente ce
changement de forme et vérifie qu'aucune règle ne s'est perdue ou déformée au passage —
il ne rouvre aucun des compromis déjà actés (résidus Transformer documentés dans
ADR-0002/0003/0004/0006 : aucune valeur ne peut être contrainte par le serveur, seulement
un ensemble d'opérations — cette limite existe à l'identique côté Gen2, le modèle
d'autorisation d'AppSync/Transformer v2 n'est pas plus expressif que v1 sur ce point
précis).
