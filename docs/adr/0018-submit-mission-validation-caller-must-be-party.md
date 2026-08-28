---
status: accepted
---

# `submitMissionValidation` : l'appelant doit être PARTIE à la Mission (vérification d'identité dans le pipeline)

Correctif de sécurité trouvé par une passe QA le 2026-08-27 sur la branche
`feat/mission-dual-validation-and-ratings` (étapes 1 à 4/5 déjà revues par
`graphql-schema-reviewer` et `devsecops-aws`). Contrairement à ADR-0004/0005/0015, cet ADR ne
documente **pas** un résidu accepté : il documente un trou **fermé**, pourquoi il ne pouvait pas
rester ouvert, et ce qui reste hors de sa portée.

## 1. Le trou : « membre d'un groupe » n'est pas « partie à cette Mission »

`submitMissionValidation` est une mutation custom dont le resolver cible directement la table
managée du modèle `Mission` (`dataSource: a.ref('Mission')`) : elle **bypasse entièrement** les
règles `@auth` de `Mission`, de type comme de champ (mécanisme démontré par ADR-0011 §3.2). La
seule garde d'autorisation active est donc celle posée sur la mutation elle-même
(`allow.authenticated()`) plus ce que le resolver vérifie lui-même.

Or le resolver ne vérifiait qu'une chose : que `ctx.identity.groups` contienne `Veterinarians`
ou `Owners` (fonction `submit-mission-validation-write-side.js`). Jamais que cet appelant soit
partie à **cette** Mission. Exploitable en pratique, pas seulement en théorie — l'attaquant n'a
même pas à deviner un UUID :

- **Côté Owner** : la règle de niveau modèle de `Request` accorde `read` à
  `allow.authenticated()`. N'importe quel Owner authentifié peut donc lister toutes les Requests
  et lire l'id de leur Mission active
  (`client.models.Request.list({ selectionSet: ['mission.id'] })`), puis voter sur la Mission
  d'un autre Owner.
- **Côté Veterinarian** : `allow.group('Veterinarians').to(['read', 'update'])` sur `Mission`
  n'a aucune notion de « ma clinique » (résidu déjà documenté ailleurs dans `resource.ts` et
  ADR-0015 §2). N'importe quel vétérinaire, de n'importe quelle clinique, peut lister toutes les
  Missions du système (`client.models.Mission.list()`) et voter à la place de la clinique
  émettrice.

**Ce qui rend ce trou inacceptable pour un pilote, là où d'autres résidus ont été assumés** :
l'écriture est WRITE-ONCE PAR CÔTÉ (condition `attributeExists: false`). Un vote illégitime ne
crée pas une donnée fausse rattrapable — il **prive définitivement** la vraie partie de son
vote (aucun second appel n'est possible de ce côté, jamais, par construction) et peut pousser
une Mission légitime en `DISPUTED`/`NO_SHOW` de façon irréversible. La famille de résidus
ADR-0004/0005/0015 couvre des falsifications sans effet de bord durable ou rattrapables par un
vétérinaire ; celle-ci est un verrou permanent posé sur un tiers légitime. Aucun ADR existant ne
la couvrait (ADR-0015 §3 traite la forgerie de `raterID` sur `Rating`, un cas distinct).

## 2. La décision : 4 fonctions de vérification EN TÊTE du pipeline (3 -> 7)

Le pipeline `submitMissionValidation` passe de 3 à 7 `a.handler.custom({...})` dans
`.handler([...])` (`amplify/data/resource.ts`) :

| # | fichier (`amplify/data/resolvers/`) | `dataSource` | rôle |
|---|---|---|---|
| 1 | `submit-mission-validation-resolve-parties.js` | `Mission` | rôle de l'appelant + `animalID`/`requestID` -> `ctx.stash` |
| 2 | `submit-mission-validation-verify-owner-party.js` | `Animal` | Owner : `Animal.ownerID === ctx.identity.sub` |
| 3 | `submit-mission-validation-load-vet-clinic.js` | `Veterinarian` | Clinic : `clinicID` du vétérinaire appelant |
| 4 | `submit-mission-validation-verify-clinic-party.js` | `Request` | Clinic : `Request.clinicID === clinicID de l'appelant` |
| 5 | `submit-mission-validation-write-side.js` | `Mission` | écriture write-once du côté appelant (inchangée) |
| 6 | `submit-mission-validation-read-mission.js` | `Mission` | relecture fraîche (inchangée) |
| 7 | `submit-mission-validation-finalize-status.js` | `Mission` | statut agrégé (inchangée) |

Le rejet précède **toute** écriture : aucun côté n'est écrit puis « annulé » (il ne pourrait de
toute façon pas l'être, c'est justement le problème). Code d'erreur `Forbidden`, à côté des
`Unauthorized`/`InvalidOutcome`/`ALREADY_VALIDATED` déjà posés par ce pipeline.

### Points vérifiés dans les paquets installés, pas supposés

MCP `context7` toujours indisponible dans cette session (même méthode qu'ADR-0015/0016/0017) :

1. **Une fonction de pipeline par source de données** —
   `convertJsResolverDefinition` (`node_modules/@aws-amplify/backend-data/lib/convert_js_resolvers.js`)
   crée une `CfnFunctionConfiguration` **par entrée** de `.handler([...])`, chacune avec son
   propre `dataSourceName`. Rien n'impose que les entrées partagent une source ; les 3 fonctions
   existantes le faisaient par besoin, pas par contrainte.
2. **`a.ref('Animal')` -> `"AnimalTable"`** — `normalizeDataSourceName`
   (`node_modules/@aws-amplify/data-schema/dist/esm/SchemaProcessor.mjs`) traduit un
   `a.ref('X')` en `` `${link}Table` ``, le nom de la source de données générée par le
   transformer pour ce modèle. Même mécanique que le `RequestTable` de `linkRequestToMission`,
   déjà déployé et fonctionnel sur ce backend. Pin-testé
   (`amplify/data/__tests__/resource.transform.test.ts`, `schema.transform().jsFunctions`).
3. **`runtime.earlyReturn()`** (branche de rôle non concernée) — `Runtime.earlyReturn(obj?)`
   existe bien dans la version installée (`@aws-appsync/utils@1.12.0`,
   `lib/index.d.ts`), et son contrat est exactement celui dont ce découpage a besoin : *« When
   called in an AppSync function request handler, the data Source and response handler are
   skipped and the next function request handler [...] is called »*. Un Owner ne paie donc
   jamais les lectures de la branche Clinic, et réciproquement.
4. **`ctx.stash`** — espace serveur partagé par toutes les fonctions du pipeline
   (`Context.stash`, même fichier de types) ; aucun argument client ne peut l'alimenter,
   contrairement à `ctx.args`.
5. **Identifiants comparés** — `ctx.identity.sub` (`AppSyncIdentityCognito.sub`) est l'UUID
   Cognito de l'appelant, la même valeur que le `userId` de `getCurrentUser()` côté client. Les
   conventions applicatives de ce dépôt (pas des contraintes du framework) posent
   `Owner.id === cognitoUserId` et `Veterinarian.id === cognitoUserId`
   (`useRegistrationCompletion.js`), et `Animal.ownerID` porte l'`Owner.id`
   (`useAnimals.js`/`useRegistrationCompletion.js`) : les comparaisons portent bien sur deux
   identifiants du même espace.

### Alternatives évaluées et écartées

- **Une Lambda dans le pipeline** (une seule fonction faisant les 3 lectures via le SDK, comme
  ADR-0016). Écartée sur vérification, pas sur intuition : `isCustomHandler`
  (`SchemaProcessor.mjs`) ne teste que la marque du **premier** élément du tableau et
  `handleCustom` traite ensuite *tous* les handlers comme des resolvers JS — un tableau mixte
  `a.handler.custom` + `a.handler.function` n'est pas supporté. Il faudrait basculer le pipeline
  **entier** en Lambda, c'est-à-dire réécrire les 3 fonctions existantes (dont les conditions
  DynamoDB write-once et optimiste, le cœur revu de cette feature) et ajouter une Lambda
  synchrone dans le chemin d'écriture. Disproportionné.
- **`BatchGetItem` multi-tables depuis une seule fonction.** La source de données d'un modèle
  est provisionnée avec un rôle IAM scopé à SA table ; une lecture cross-tables échouerait à
  l'exécution, ce qu'aucun test local ne peut confirmer sans `ampx sandbox` (interdit ici).
- **Un simple résidu documenté** (option explicitement ouverte par le brief, famille
  ADR-0004/0005/0015). Écartée pour la raison de la section 1 : verrou **permanent** sur un
  tiers légitime, exploitable sans deviner d'identifiant, contre un correctif qui tient en 4
  fichiers dans l'idiome déjà établi de ce pipeline et testable avec le harnais existant.

## 3. Écarts de comportement observable, assumés

- **Un `missionId` inexistant renvoie désormais `Forbidden`** (et plus tôt), là où il renvoyait
  `ALREADY_VALIDATED` — résidu documenté dans l'en-tête de la fonction d'écriture (la condition
  `id: { attributeExists: true }` ANDée ne dit pas laquelle des sous-conditions a échoué). Le
  message et le code sont volontairement **identiques** pour « Mission introuvable » et « vous
  n'êtes pas partie » : les distinguer ferait de cette mutation un oracle d'existence de Mission
  pour tout authentifié. Aucun changement côté front n'est nécessaire :
  `mapSubmitDonationValidationError` (`useOwnerMissions.js`) ne normalise que
  `ALREADY_VALIDATED`/`INVALID_OUTCOME` et retombe sur son message générique pour tout le reste ;
  et un `missionId` inexistant ne peut venir que d'un appel API direct hors UI.
- **Rejet d'un appelant hors des deux groupes : désormais en fonction 1/7**, pas en 5/7. Même
  code (`Unauthorized`) et même message ; la fonction d'écriture garde sa propre garde (elle
  reste correcte isolément, indépendamment de l'ordre du pipeline).
- **3 lectures DynamoDB supplémentaires au maximum** par appel (2 côté Owner, 3 côté Clinic),
  toutes en `consistentRead` sur une clé primaire. `consistentRead` ici n'a pas la raison de la
  fonction 6/7 (correction du calcul agrégé) mais celle-ci : une réplique périmée refuserait un
  vote **légitime**, et ce refus n'est pas rattrapable autrement qu'en réessayant. Coût
  négligeable à ce volume (une validation par Mission et par côté).

## 4. Ce que ce correctif ne ferme PAS (résidus inchangés, signalés)

- **La lecture reste large.** Un vétérinaire de la clinique A peut toujours *lister* les
  Missions de la clinique B, et tout Owner authentifié peut lire les `Request` et l'id de leur
  Mission active. Ce correctif ferme l'**écriture** (le vote), pas la visibilité — fermer la
  seconde demanderait un modèle d'autorisation « ma clinique » qui n'existe pas dans ce schéma
  (choix déjà tranché deux fois sur ce dépôt : un scope large mais honnête plutôt qu'un filtre
  qui simulerait une garantie que le modèle de données ne porte pas).
- **La partie vérifiée côté clinique est la CLINIQUE, pas le vétérinaire individuel** :
  n'importe quel vétérinaire de la clinique émettrice peut voter pour elle. C'est le modèle
  métier (`CONTEXT.md` : une Request est « un besoin de sang exprimé par une Clinic »), pas une
  approximation — rien dans le schéma ne rattache une Mission à un vétérinaire nommément avant
  sa clôture.
- **Le résidu de robustesse de la fonction d'écriture est inchangé** : si la relecture (6/7) ou
  la finalisation (7/7) échoue durement, le vote reste écrit sans que `Mission.status` soit
  recalculé, sans chemin de reprise (voir l'en-tête de `submit-mission-validation-write-side.js`).
- **Le résidu ADR-0004 est inchangé** : un Owner peut toujours fabriquer un
  `createMission(status: COMPLETED)` à la création.
- **Un Owner peut SUPPRIMER sa Mission à n'importe quel statut** — résidu identifié le 2026-08-28
  (revue `lead-dev-reviewer`, finding MOYEN), **documenté et non fermé**. La règle de niveau
  modèle de `Mission` (`allow.owner().to(['create', 'read', 'delete'])`, antérieure à toute cette
  feature) existe pour le nettoyage de la Mission orpheline d'`acceptMission` (écriture
  best-effort après échec de la condition d'ADR-0001/ADR-0011). Elle ne distingue aucun statut :
  un Owner peut donc appeler `client.models.Mission.delete()` sur une Mission
  `PENDING_VALIDATION` — avant d'avoir voté, ou après un vote de la clinique qui ne lui convient
  pas — voire `DISPUTED`/`NO_SHOW`, faisant disparaître la trace d'un no-show ou d'un litige.
  C'est le **pendant destructif** du trou que cet ADR ferme : le write-once garantit qu'un vote
  ne peut être ni écrasé ni volé, pas que la ligne qui le porte survive. Un `Admins` (lecture
  seule) ou la Lambda planifiée ne verront jamais ce qui a été supprimé.
  **Pourquoi ce n'est pas fermé ici** : la fermeture propre demanderait de retirer `delete` à
  l'Owner **et** de faire passer le nettoyage d'orpheline par un chemin serveur (mutation custom
  supprimant la Mission sous condition `status ∈ {ACCEPTED, PENDING_ARRIVAL}` et
  `Request.activeMissionID ≠ cette Mission`, ou nettoyage différé côté Lambda) — une 3e mutation
  custom et un changement `@auth` de niveau modèle sur `Mission`, disproportionnés pour un pilote
  à utilisateurs de confiance (école vétérinaire partenaire) où l'incitation est faible et le
  volume connu. Même arbitrage que la famille ADR-0004/0005/0015. **À rouvrir en priorité** si
  les Missions `DISPUTED` gagnent un jour une interface admin ou une valeur contractuelle : la
  garantie que cet ADR obtient sur le vote n'aura pas de valeur probante tant qu'une partie peut
  supprimer la ligne entière.
- **Plafond AppSync** : un resolver de pipeline accepte au plus 10 fonctions ; ce pipeline en
  consomme 7. Pin-testé pour qu'une future sous-tâche ne s'en approche pas sans le voir.

## 5. Tests

`amplify/data/__tests__/submit-mission-validation.resolvers.test.js` (harnais QA du 2026-08-27,
**étendu** plutôt que dupliqué : magasin multi-tables `Mission`/`Animal`/`Veterinarian`/`Request`
+ identité de l'appelant, sentinelle `runtime.earlyReturn`) couvre les 4 nouvelles fonctions
isolément et le pipeline complet — rejet d'un autre Owner, rejet d'un vétérinaire d'une autre
clinique, rejet d'un vétérinaire sans profil, non-régression des deux chemins légitimes, et
surtout : **après un vote illégitime rejeté, la vraie partie peut encore voter** (la garantie
qui motive tout le correctif). `amplify/data/__tests__/resource.transform.test.ts` pin l'ordre
exact des 7 fonctions et leur source de données — un réordonnancement du tableau `.handler([...])`
(qui replacerait l'écriture avant les vérifications) ne casse rien d'autre.

Limite connue, laissée à la prochaine passe QA : le harnais d'intégration front
`src/composables/__tests__/mission-dual-validation.integration.test.js` rejoue encore les 3
seules fonctions d'écriture (il ne modélise donc pas la vérification d'identité). Non touché
ici : une autre sous-tâche travaillait en parallèle sur `src/composables/`.
