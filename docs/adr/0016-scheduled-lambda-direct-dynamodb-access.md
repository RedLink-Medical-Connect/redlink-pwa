---
status: accepted
supersedes: none (complète ADR-0011 et ADR-0015, voir "Relation avec le reste des ADR")
---

# Lambda planifiée de finalisation automatique : GSI `Mission.status` + accès DynamoDB direct

Étape 2/5 de la double validation de Mission (2026-08-26). L'étape 1/5 (ADR-0015, commits
`4282625`/`643b355`) a posé le schéma, les règles `@auth` et le pipeline
`submitMissionValidation` : une Mission passe en `PENDING_VALIDATION` dès qu'UN SEUL des deux
côtés (Owner ou Clinic) a soumis sa validation. Si l'autre côté ne répond jamais, **rien ne
débloque la Mission** — la fonction 1/3 du pipeline est write-once par côté, donc même
l'appelant initial n'a plus aucun recours.

Cet ADR documente les décisions prises en construisant le mécanisme de délai :
`amplify/functions/mission-validation-auto-finalizer/` (Lambda planifiée), le GSI qu'elle a
rendu nécessaire, et la façon dont elle accède aux données.

## 1. GSI sur `Mission.status` — pourquoi maintenant et pas à l'étape 1/5

L'étape 1/5 n'accédait jamais aux Missions autrement que **par leur clé primaire**
(`ddb.get`/`ddb.update` sur `{ id: missionId }`, les 3 fonctions du pipeline). La Lambda pose
la question inverse : *"quelles Missions sont actuellement en `PENDING_VALIDATION` ?"*. Sans
index, la seule réponse possible est un `Scan` complet de la table `Mission` à chaque exécution
planifiée — coût et latence croissant indéfiniment avec l'historique des Missions clôturées,
alors que l'ensemble réellement recherché reste minuscule. D'où un ajout **strictement
additif** à `amplify/data/resource.ts` (aucune règle `@auth` ni aucun champ touché) :

```ts
.secondaryIndexes((index) => [index('status').name(MISSION_STATUS_INDEX_NAME).queryField(null)])
```

Deux points vérifiés dans les paquets **installés** plutôt que supposés (le MCP `context7`
n'était pas disponible dans la session d'implémentation ; `amplify-docs` n'indexe que Gen1,
limitation permanente documentée dans `CLAUDE.md`) :

- `secondaryIndexes((index) => [...])` est bien l'API réelle
  (`node_modules/@aws-amplify/data-schema/dist/esm/ModelType.d.ts`, avec `.name()`/
  `.queryField()`/`.projection()` sur `ModelIndex.d.ts`).
- Un champ `a.ref()` d'énum **est** éligible comme clé de partition d'un index secondaire —
  contrairement à `.identifier()`, où ADR-0015 a découvert exactement l'inverse. Deux
  validateurs différents : `ExtractSecondaryIndexIRFields` (ModelType.d.ts, *"3. RefType that
  refers to a top level defined EnumType"*) et la validation runtime correspondante dans
  `transformedSecondaryIndexesForModel` (`SchemaProcessor.mjs`), qui lève si le `a.ref()` ne
  pointe **pas** vers un enum. `Mission.status` reste donc `a.ref('MissionStatus')` tel quel.

SDL compilé obtenu (pin-testé dans `amplify/data/__tests__/resource.transform.test.ts`) :

```graphql
status: MissionStatus! @index(name: "missionsByStatus", queryField: null) @auth(rules: [...])
```

**Nom explicite** (`.name(...)`) : le nom physique du GSI est consommé hors du schéma (policy
IAM et variable d'environnement de la Lambda, `amplify/backend.ts`). Le laisser dériver du nom
auto-généré par le transformer rendrait ces deux endroits dépendants d'une valeur non garantie.
La constante `MISSION_STATUS_INDEX_NAME` est exportée par `amplify/data/resource.ts` et
importée par `amplify/backend.ts` — jamais par le handler (voir §3).

**`queryField(null)`, écart assumé** par rapport au défaut du framework (qui générerait une
query `listMissionByStatus`) : le seul consommateur de l'index est la Lambda, qui interroge la
table en direct. Une query publique sans appelant élargirait la surface d'API, et hériterait des
règles de **niveau modèle** de `Mission` (`allow.group('Veterinarians').to(['read'])`, sans
notion de "ma clinique") — rien de nouveau en droit (`listMissions` le permet déjà) mais aucun
besoin de l'ajouter. Réversible sans coût : `queryField` ne touche que l'API GraphQL, pas la
structure du GSI ; le rétablir plus tard (interface admin des Missions `DISPUTED`) ne provoque
aucune mise à jour de table.

Pas de sort key ni de projection restreinte (défaut `ALL`) : aucun champ ne porte l'échéance
(voir §2), donc aucun candidat sort key ne permettrait de filtrer côté DynamoDB ; et une
projection `INCLUDE` figerait la liste exacte des champs lus dans l'infrastructure, au prix
d'une mise à jour de GSI à chaque champ supplémentaire lu plus tard.

## 2. Échéance dérivée, jamais persistée

Aucun champ `validationDeadline` n'est ajouté au schéma (choix du plan d'architecture, confirmé
ici) : la Lambda dérive l'échéance de `MIN(clinicValidatedAt, ownerValidatedAt)` (en ignorant
celui des deux qui est absent) + `MISSION_VALIDATION_TIMEOUT_DAYS`. Conséquence : changer le
délai s'applique **rétroactivement** à toutes les Missions en attente, sans migration de
données — ce qui est le comportement souhaitable pour un pilote qui n'a pas encore calibré ce
délai avec l'école vétérinaire partenaire (même statut que `MIN_DAYS_BETWEEN_DONATIONS`,
roadmap Phase 5).

`MISSION_VALIDATION_TIMEOUT_DAYS` (variable d'environnement, `defineFunction({ environment })`)
est la **seule** source de vérité de la durée. `resolveTimeoutDays()` **lève** si la variable est
absente/invalide, sans valeur de repli : un `?? 7` réintroduirait le délai en dur que ce
découpage cherche à éviter, et une variable mal orthographiée produirait silencieusement un
autre délai que celui déployé. Fail-loud, même arbitrage que `post-confirmation` (ADR-0008 /
roadmap Phase 7.3).

Matrice appliquée après échéance (le côté silencieux est traité comme s'il avait **confirmé**) :

| Côté ayant répondu | Côté silencieux (auto) | Statut écrit     |
| ------------------ | ---------------------- | ---------------- |
| `CONFIRMED`        | `CONFIRMED`            | `COMPLETED_AUTO` |
| `DENIED`           | `CONFIRMED`            | `DISPUTED`       |

`COMPLETED`/`NO_SHOW` restent **inaccessibles** à cette Lambda : ils supposent deux réponses
réelles, et seul le resolver peut les écrire. La copie de cette matrice
(`resolve-auto-finalization-outcome.ts`, fonction pure) est la seule version **testable** de la
réconciliation dans ce dépôt — celle du resolver (`submit-mission-validation-finalize-status.js`)
tourne sur le runtime `APPSYNC_JS`, qu'aucun test de ce repo ne peut exécuter aujourd'hui.

**Le côté silencieux n'est jamais falsifié** : la Lambda écrit `status` (et `updatedAt`),
jamais `clinicValidationOutcome`/`ownerValidationOutcome`. Fabriquer une réponse qui n'a pas eu
lieu détruirait la valeur probante du couple outcome/timestamp (même esprit que les
enregistrements write-once d'ADR-0014) et bloquerait définitivement ce côté (la fonction 1/3 du
pipeline est conditionnée à `attributeExists: false`). `COMPLETED_AUTO` porte à lui seul
l'information "finalisée sans la seconde réponse" — c'est sa raison d'être.

## 3. Accès aux données : SDK DynamoDB direct, pas le client Data en mode IAM

Point le plus incertain de cette sous-tâche. Deux chemins existent en Gen2 pour qu'une Lambda
lise/écrive des données gérées par `defineData` avec sa propre identité IAM :

**1. Client Data en mode IAM** — `allow.resource(maFonction)` sur le schéma/les modèles +
`generateClient<Schema>({ authMode: 'iam' })`. Le mécanisme existe bien dans la version
installée (`ruleIsResourceAuth`/`extractFunctionSchemaAccess`, `SchemaProcessor.mjs`).
**Écarté**, pour deux raisons dirimantes propres à ce schéma :

- Les mutations générées n'exposent **aucun** argument `condition` (constat fondateur
  d'ADR-0011, revérifié). Or l'écriture de `Mission.status` doit impérativement être conditionnée
  à `status = PENDING_VALIDATION` au moment de l'écriture, pour ne pas écraser une finalisation
  arrivée entre le Query et l'écriture (même classe de garde que la fonction 3/3 du resolver).
- `Mission.status` et les 5 champs de validation portent des règles `@auth` **de champ** qui
  REMPLACENT celles de niveau modèle (ADR-0009). Une règle `allow.resource(...)` posée au niveau
  schéma/modèle ne s'y appliquerait donc pas : il faudrait ajouter la fonction dans
  `missionStatusFieldAuth`/`missionValidationFieldsReadOnly` — précisément les garde-fous que
  l'étape 1/5 vient de poser (correctifs BLOQUANT/ÉLEVÉ du `graphql-schema-reviewer`) — et
  rouvrir ces champs à une écriture par mutation générée. Plus invasif, et moins sûr.

**2. SDK DynamoDB directement sur les tables managées**, permissions IAM scopées aux ARN exacts.
**Retenu.** C'est le pendant Lambda de ce que font déjà les resolvers custom de ce schéma
(`a.handler.custom({ dataSource: a.ref('Mission') })` cible lui aussi la table managée et
bypasse `@auth`, ADR-0011 §3.2) : la garde d'autorisation n'est plus `@auth` mais la policy IAM.

`backend.data.resources.tables['<Model>']` est le point d'accès aux tables managées (clé = nom du
modèle), vérifié dans le paquet installé : `@aws-amplify/graphql-api-construct`
(`amplify-graphql-api.js`, exemple `api.resources.tables["Todo"].tableArn` ; mapping construit
par `getGeneratedResources`, `lib/internal/construct-exports.js` ; `setResourceName(table, { name:
modelName })` côté `graphql-model-transformer`).

Policy IAM (`amplify/backend.ts`, `addToRolePolicy`), une action par usage **réel**, sur l'ARN
exact, jamais de wildcard :

| Table                 | Actions                       | Usage                                        |
| --------------------- | ----------------------------- | -------------------------------------------- |
| `Mission` (index GSI) | `Query`                       | Missions en `PENDING_VALIDATION`             |
| `Mission`             | `UpdateItem`                  | écriture conditionnelle du statut final      |
| `Animal`              | `GetItem`, `UpdateItem`       | `ownerID` ; `lastDonationDate`               |
| `Request`             | `GetItem`                     | `clinicID` (voir §5)                         |
| `ClinicOwnerRelation` | `Scan`, `PutItem`             | annuaire donneurs de la clinique             |
| `Clinic`              | `UpdateItem`                  | `transfusionsDone`/`donorOwnersCount`        |

`Query` porte sur l'ARN de **l'index** (`<tableArn>/index/missionsByStatus`), pas sur la table :
une action d'index n'est pas couverte par l'ARN de la table seule. Et la Lambda n'a **pas**
`dynamodb:Scan` sur `Mission` : elle ne peut structurellement pas retomber sur un Scan complet si
le GSI venait à manquer, elle échouerait bruyamment.

Conséquence assumée de ce choix : écrire en direct court-circuite AppSync, donc aucun
`createdAt`/`updatedAt`/`__typename` automatique. Le handler les pose lui-même, pour que les
lignes qu'il écrit soient indiscernables de celles écrites par l'API.

## 4. Duplication assumée des 3 écritures secondaires de `useMissionClosure.js`

Sur `COMPLETED_AUTO` (jamais sur `DISPUTED` — un litige n'est pas un don réalisé, exactement
comme `NO_SHOW` ne déclenche rien côté composable), la Lambda refait les trois écritures
best-effort déjà établies : `Animal.lastDonationDate` (réarme la Frequency Rule, ADR-0003),
upsert `ClinicOwnerRelation` (annuaire, Phase 3.1), incrément
`Clinic.transfusionsDone`/`donorOwnersCount` (CdC §2.4, Phase 6.7).

Ce code est **dupliqué**, pas partagé (choix du plan d'architecture) : les deux runtimes n'ont
aucun module commun (le front est du JS pur hors du `tsconfig` backend, ADR-0007 ; importer un
service front dans un bundle Lambda mélangerait deux périmètres de déploiement). L'alternative
unifiée — déclencher ces écritures depuis un flux DynamoDB Streams consommé par les deux chemins
— a été jugée disproportionnée pour trois petites écritures best-effort. La règle de décision de
`resolveClinicOwnerRelationUpsert` (`src/services/clinic-owner-relation-service.js`) est
recopiée dans le module pur de la Lambda **avec un pointeur croisé explicite dans les deux
sens** : toute évolution doit être appliquée aux deux endroits.

Un seul écart de **mécanisme** (pas d'effet) : l'incrément des compteurs `Clinic` est atomique
(`if_not_exists(x, 0) + 1`) au lieu du lire-puis-écrire du composable, qui documente lui-même la
course qui en découle *("un vrai incrément atomique demanderait un resolver dédié, hors
périmètre")*. Ici c'est disponible sans infrastructure supplémentaire, puisqu'on écrit déjà en
direct dans la table. Résultat observable identique, sans la course ni la lecture préalable.

Toutes les écritures secondaires sont gardées par la **réussite** de l'écriture conditionnelle du
statut : une invocation rejouée ne peut jamais double-incrémenter un compteur ni recréer une
relation, la condition `status = PENDING_VALIDATION` n'étant satisfaite qu'une fois par Mission.

## 5. Écart signalé par rapport au périmètre initial : la table `Request` en lecture

Le brief de cette sous-tâche citait quatre tables (`Mission`, `Animal`, `ClinicOwnerRelation`,
`Clinic`). Il en faut une cinquième, en **lecture seule** : `Mission` ne porte pas de `clinicID`,
seulement `requestID`. Côté front, `RequestsView.vue` passe le `clinicID` déjà chargé à
`closeMission()` ; ici personne ne le fournit, il faut le résoudre (`Request.clinicID`) pour
pouvoir écrire l'annuaire et les compteurs de la bonne clinique. Signalé explicitement plutôt
qu'ajouté en silence dans la policy.

## 6. Résidus assumés

- **Anomalies de donnée non tranchées** : si les deux côtés ont déjà répondu alors que la
  Mission est restée en `PENDING_VALIDATION` (signature du résidu de robustesse documenté en
  tête de `submit-mission-validation-write-side.js` : échec dur des fonctions 2/3), la Lambda
  **ne finalise pas** et se contente de le logger. La rattraper reviendrait à écrire
  `COMPLETED_AUTO`/`DISPUTED` là où le vrai calcul aurait pu donner `COMPLETED`/`NO_SHOW`. Le
  résidu reste ouvert ; il n'est pas aggravé. Sa fermeture propre resterait la mutation admin de
  recalcul déjà esquissée dans le resolver.
- **Aucune notification** aux deux parties lors d'une finalisation automatique (ni email ni
  dashboard) : la Phase 4.2 (Lambda email) est en stand-by. Un `DISPUTED` automatique n'est donc
  visible que pour un `Admins` qui va le chercher.
- **Observabilité** : le handler lève en fin d'exécution si au moins une écriture a échoué. Ce
  dépôt n'a aucun outil de suivi d'erreurs (trou connu, roadmap Phase 5) et un `console.error`
  d'une exécution planifiée nocturne n'est lu par personne — une invocation en **erreur** est le
  seul signal réellement visible. Le rejeu déclenché par le planificateur est sans danger (voir
  §4).
- **Point chaud DynamoDB** : la clé de partition du GSI est un statut (une dizaine de valeurs
  distinctes), donc peu de partitions. Sans conséquence au volume d'un pilote ; à revoir avec un
  sort key temporel si le volume de Missions devient réel.

## 7. Bug réel post-déploiement : cycle de dépendance entre stacks imbriquées

Un vrai `ampx sandbox` (2026-09-01, après le câblage UI de l'étape 4/5) a échoué au déploiement
CloudFormation avec `CloudformationStackCircularDependencyError` sur les stacks imbriquées
`[auth, geo-stack, data, function]`.

**Cause** : ni cette fonction ni `rating-aggregation` (ADR-0017) ne déclarait de
`resourceGroupName` dans son `defineFunction()`. Sans lui, Amplify Gen2 les place par défaut dans
la même stack imbriquée partagée que `post-confirmation` (trigger Cognito, référencé depuis
`amplify/auth/resource.ts` — `auth` dépend donc de cette stack "function"). Or les policies IAM de
§3 (`addToRolePolicy` sur `backend.data.resources.tables[...]`) font l'inverse : cette même stack
"function" dépend de `data`. Et `data` dépend déjà de `auth` (mode d'authentification Cognito de
l'API AppSync, comportement Gen2 standard, sans lien avec cette sous-tâche). D'où le cycle
`auth -> function -> data -> auth`, rejeté par CloudFormation avant même de toucher une seule
ressource (aucun rollback à gérer).

**Correctif** : `resourceGroupName: 'data'` ajouté au `defineFunction()` de cette fonction et de
`rating-aggregation` (`amplify/functions/*/resource.ts`) — résolution suggérée par le message
d'erreur d'Amplify lui-même. Les deux fonctions rejoignent directement la stack `data` ; leurs
références aux tables deviennent intra-stack, ce qui casse le cycle sans toucher au reste du
graphe de dépendances (`post-confirmation` reste seule dans la stack "function", qui n'a alors
plus aucune dépendance sortante vers `data`). Non testable en CI (le type-check `tsc --noEmit` ne
valide pas l'ordonnancement des stacks CloudFormation) — seule la confirmation d'un `ampx sandbox`
réussi le referme.

## Relation avec le reste des ADR

Complète ADR-0011 (mutation custom conditionnelle) en transposant le même raisonnement à un
runtime différent : quand une écriture a besoin d'une `ConditionExpression` DynamoDB, le chemin
Gen2 n'est jamais la mutation générée — c'était un resolver JS AppSync pour un appel utilisateur,
c'est le SDK DynamoDB pour une exécution planifiée sans identité Cognito. Complète ADR-0015
(étape 1/5) sans le réviser : la matrice de réconciliation y est inchangée, cet ADR n'ajoute que
la branche "un côté n'a jamais répondu". Comme ADR-0004/0005/0015, il assume et documente ses
résidus plutôt que de construire une infrastructure de résilience non demandée pour ce pilote.
