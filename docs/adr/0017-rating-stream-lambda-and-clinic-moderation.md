---
status: accepted
supersedes: none (complète ADR-0015 et ADR-0016, voir "Relation avec le reste des ADR")
---

# Agrégats de notation : Lambda sur flux DynamoDB, GSI `Rating`, modération clinique

Étape 3/5 de la double validation de Mission + notation (2026-08-26). L'étape 1/5 (ADR-0015,
commits `4282625`/`643b355`) a posé le modèle `Rating` et son `@auth` : la notation est **privée**
— `allow.ownerDefinedIn('raterID')` donne `read` à qui a écrit la ligne, et à personne d'autre
(hors `Admins`). L'étape 2/5 (ADR-0016, commit `4cf287a`) a établi le pattern "Lambda + accès SDK
DynamoDB direct + IAM scopée + fonction pure testée à part", validé par un checkpoint
devsecops-aws.

Cet ADR documente ce que cette étape ajoute : les champs agrégés dénormalisés sur `Clinic`/`Owner`,
le GSI qui les rend calculables, la Lambda déclenchée par le flux DynamoDB de `Rating`, et la
règle de modération clinique.

## 0. Pourquoi une dénormalisation serveur, et pas un calcul côté client

Le besoin produit est : *chaque Clinic/Owner voit SA PROPRE moyenne (nombre d'avis + note
moyenne), jamais les notes individuelles ni qui a noté quoi*.

Aucun client ne **peut** calculer cette moyenne : le `@auth` de `Rating` interdit à quiconque de
lister les notes reçues par une cible — y compris à l'intéressé, délibérément (ADR-0015 §2 : un
`read` de groupe `Veterinarians` aurait ouvert la lecture des notes de **toutes** les cliniques,
faute d'une notion de "ma clinique" dans le modèle). L'agrégat ne peut donc venir que d'un
mécanisme serveur.

Et il ne doit **jamais** être écrit par un client : un Owner ou un vétérinaire qui pourrait écrire
`averageRatingAsClinic`/`ratingCountAsOwner` pourrait falsifier sa propre moyenne ou saboter celle
d'un tiers. `@auth` ne sait pas contraindre une *valeur*, seulement un ensemble d'opérations
(limite documentée depuis ADR-0002) : la seule fermeture réelle est de n'accorder l'écriture à
**personne**.

## 1. DynamoDB Streams : déjà activés sur les tables managées Gen2 (vérifié, pas supposé)

Point le plus incertain de la sous-tâche. Vérifié dans les paquets **installés** puis par une
**synthèse CDK locale** (aucun appel AWS, aucun déploiement) — le MCP `context7` reste
indisponible et `amplify-docs` n'indexe que Gen1 (limitation permanente, `CLAUDE.md`) :

1. `defineData` provisionne ses tables avec la stratégie `AMPLIFY_TABLE`
   (`node_modules/@aws-amplify/backend-data/lib/convert_schema.js:32`,
   `provisionStrategy: 'AMPLIFY_TABLE'`).
2. Le générateur correspondant crée **chaque** table de modèle avec un flux, en dur :
   `stream: StreamViewType.NEW_AND_OLD_IMAGES` dans `createModelTable`
   (`node_modules/@aws-amplify/graphql-api-construct/node_modules/@aws-amplify/graphql-model-transformer/lib/resources/amplify-dynamodb-table/amplify-dynamo-model-resource-generator.js`).
   Le construct sous-jacent n'expose `tableStreamArn` que si ce `stream` est fourni
   (`.../amplify-dynamodb-table/amplify-dynamodb-table-construct/index.js`).
3. `backend.data.resources.tables['Rating']` est l'`ITable` importée par le construct
   (`Table.fromTableAttributes`, clé = nom du modèle) ; son `tableStreamArn` résout en
   `Fn::GetAtt[RatingTable, TableStreamArn]` — obtenu en synthétisant localement un
   `AmplifyGraphqlApi` avec la même stratégie et en lisant le template produit.

**Il n'y a donc rien à activer.** `AmplifyDynamoDbTableWrapper.streamSpecification`
(`backend.data.resources.cfnResources.amplifyDynamoDbTables['Rating']`) existe pour *changer* la
vue du flux ; l'utiliser ici aurait réécrit la valeur déjà posée par le transformer, sans bénéfice.

Câblage, dans `amplify/backend.ts` (échappatoire CDK — `defineFunction` n'expose que `schedule`,
aucun déclencheur "flux DynamoDB" ; même famille que Geo/ADR-0012-0013 et que la policy IAM de
l'étape 2/5) :

```ts
ratingAggregationLambda.addEventSource(
  new DynamoEventSource(ratingTable, {
    startingPosition: StartingPosition.LATEST,
    batchSize: 25,
    maxBatchingWindow: Duration.seconds(10),
    retryAttempts: 3,
    bisectBatchOnError: true,
    filters: [FilterCriteria.filter({ eventName: FilterRule.isEqual('INSERT') })],
  }),
)
```

Chaque réglage est explicite parce que le défaut ne convient pas :

| Réglage                       | Défaut CDK       | Retenu             | Pourquoi                                                                                       |
| ----------------------------- | ---------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `startingPosition`            | (obligatoire)    | `LATEST`           | `TRIM_HORIZON` rejouerait 24 h d'historique au 1er déploiement — inoffensif mais inutile         |
| `retryAttempts`               | `-1` (infini)    | `3`                | rejeu infini = **shard bloqué jusqu'à 24 h** sur une erreur permanente                          |
| `bisectBatchOnError`          | `false`          | `true`             | une cible problématique ne fait pas perdre les autres                                            |
| `filters`                     | aucun            | `eventName=INSERT` | `Rating` est write-once (ADR-0015) : `MODIFY`/`REMOVE` n'existent pas côté applicatif            |
| `reportBatchItemFailures`     | `false`          | `false` (inchangé) | le rejeu du lot entier est sans danger, toutes les écritures étant idempotentes (§3)             |

## 2. GSI `(targetID, targetRole)` sur `Rating`

La clé primaire de `Rating` répond à *"qui a noté sur cette Mission ?"* (`missionID` + `raterRole`,
ADR-0015 §1). La Lambda pose la question inverse : *"toutes les notes reçues par cette cible"*.
Sans index, la seule réponse serait un `Scan` complet de `Rating` **à chaque notation** — pire que
le cas de l'étape 2/5, qui n'était qu'une exécution planifiée quotidienne.

```ts
.secondaryIndexes((index) => [
  index('targetID').sortKeys(['targetRole']).name(RATING_TARGET_INDEX_NAME).queryField(null),
])
```

- **Sort key `targetRole`** plutôt qu'un index sur `targetID` seul : `targetID` porte tantôt un
  `Clinic.id`, tantôt un `Owner.id`, et ce schéma fabrique déjà la collision d'espaces
  d'identifiants (`Clinic.id === Veterinarian.id` à l'inscription, résidu Phase -1). La requête est
  exacte plutôt que "probablement sans collision", pour zéro complexité côté handler.
- **Un `a.ref()` d'enum est accepté comme clé de tri**, pas seulement comme clé de partition
  (ADR-0016 §1) : la validation runtime itère sur `[partitionKey, ...sortKeys]` avec le même test
  (`transformedSecondaryIndexesForModel`, `SchemaProcessor.mjs`). À ne pas confondre avec la limite
  inverse de `.identifier()` (ADR-0015 §1) — deux validateurs différents.
- **`queryField(null)`**, même écart assumé qu'à l'étape 2/5, avec une raison plus forte ici :
  générer `listRatingByTargetIDAndTargetRole` ajouterait à l'API publique exactement le point
  d'entrée que le `@auth` de `Rating` a été conçu pour ne pas offrir ("les notes reçues par X"), en
  s'en remettant au seul filtre d'autorisation pour qu'il ne fuite rien. Réversible sans coût :
  `queryField` ne touche que l'API GraphQL, pas la structure du GSI.
- **Projection par défaut (`ALL`)**, comme le GSI de l'étape 2/5 : une projection `INCLUDE
  ['stars']` collerait au besoin actuel mais figerait la liste des champs lisibles dans
  l'infrastructure (toute lecture supplémentaire ultérieure = mise à jour de GSI sur une table
  managée). Le sur-fetch est évité là où il coûte, côté requête (`ProjectionExpression: '#stars'`)
  — ce qui garantit au passage qu'aucun `comment` (texte libre) ne transite par cette Lambda.

## 3. Écriture des agrégats : inconditionnelle, et pourquoi c'est défendable ici

Écart **délibéré** avec l'étape 2/5, à scruter en revue. `Mission.status` y est écrit sous
condition (`status = PENDING_VALIDATION`) parce qu'écraser une finalisation concurrente est une
régression permanente sur une donnée médicale terminale. Un agrégat n'a aucune de ces propriétés :
c'est une valeur **dérivée**, recalculée intégralement depuis la source de vérité à chaque
notation. Les deux champs sont donc écrits en valeur absolue, sans condition d'état — la seule
condition posée est `attribute_exists(id)` (anti-upsert, §5).

Désordre possible, assumé : deux notations d'une même cible ont des clés de partition différentes
(`missionID`), donc peuvent tomber dans des **shards** différents traités en parallèle. La valeur
écrite en dernier peut alors provenir d'un instantané plus ancien, et l'agrégat afficher un avis de
retard — jusqu'à la notation suivante, qui repart de zéro. Auto-réparateur.

Alternative envisagée puis écartée : une condition de monotonie
(`attribute_not_exists(ratingCountAsClinic) OR ratingCountAsClinic <= :count`). Elle fermerait ce
désordre, au prix d'un chemin d'échec conditionnel de plus à distinguer d'une vraie erreur —
disproportionné pour une valeur d'affichage au volume d'un pilote. **À reconsidérer si les agrégats
servent un jour à autre chose qu'à de l'affichage** (ex. une exclusion automatique).

Ce recalcul intégral (jamais un `+1` ni une moyenne glissante incrémentale) est aussi ce qui rend
l'invocation **idempotente**, donc le rejeu de lot du §1 sans effet de bord — la propriété centrale
de ce handler, et la raison pour laquelle il peut se permettre d'échouer bruyamment.

## 4. Modération clinique : flag posé une seule fois, jamais retiré automatiquement

Règle produit : **sous 3 étoiles ET minimum 5 avis reçus en tant que CLINIC** →
`needsAdminReview = true`, `needsAdminReviewSince = now`, `accountStatus = UNDER_REVIEW`.
Traduite avec ses deux bornes dissymétriques, pin-testées : `average < seuil` (strict — 3,0 pile
n'est pas "sous 3") et `count >= volume` (inclusif — 5 avis suffisent). Le seuil de volume est
évalué en premier : aucune moyenne, si basse soit-elle, ne le contourne (*"2 mauvais avis isolés ne
doivent rien déclencher"*).

Les deux seuils sont des **variables d'environnement** (`CLINIC_MODERATION_AVERAGE_THRESHOLD`,
`CLINIC_MODERATION_MIN_RATING_COUNT`), seule source de vérité, sans valeur de repli :
`resolveModerationThresholds()` **lève** si l'une manque ou est hors domaine — même arbitrage que
`resolveTimeoutDays()` (ADR-0016 §2) et pour la même raison (ces chiffres ne sont pas calibrés avec
l'école vétérinaire partenaire, même statut que `MIN_DAYS_BETWEEN_DONATIONS`).

L'écriture du flag est **conditionnelle** :
`attribute_exists(id) AND (attribute_not_exists(needsAdminReview) OR needsAdminReview = :false)`.
Choisi plutôt que la lecture préalable (`GetItem`) que le plan mentionnait comme alternative : la
condition est évaluée par DynamoDB au moment de l'écriture, donc `needsAdminReviewSince` porte la
date du **premier** franchissement même si deux invocations concurrentes franchissent le seuil en
même temps — ce qu'un couple lire-puis-écrire ne garantit pas. Sans elle, chaque note sous le seuil
ferait glisser la date et rendrait le champ inutilisable ("depuis quand cette clinique est-elle en
revue ?"). Bénéfice IAM au passage : la Lambda n'a **pas** `dynamodb:GetItem`.

**Aucun chemin ne remet ces champs à `false`/`ACTIVE`.** Une clinique dont la moyenne remonte reste
signalée jusqu'à décision **admin** (interface non construite, comme pour les Missions `DISPUTED`) :
effacer automatiquement la trace supprimerait l'information même que la modération doit examiner.
Et `UNDER_REVIEW` ne coupe **aucun** accès aujourd'hui — pas d'exclusion automatique, décision
produit explicite ; aucune règle `@auth`, aucun garde-fou de routeur ne lit ce champ.

Hors périmètre, délibérément : la modération **côté Owner** (le plan ne la demande pas — pas de
symétrie décorative que rien ne consommerait) et l'**alerte tableau de bord clinique** (sous 3,5
étoiles avec au moins 3 avis), qui est un simple calcul de lecture sur les deux champs agrégés, à
faire côté composable à l'étape 4/5.

## 5. `@auth` des champs agrégés : la règle la plus restrictive du schéma

| Modèle   | Champs                                                                                                     | Règle de champ                                              |
| -------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `Clinic` | `averageRatingAsClinic`, `ratingCountAsClinic`, `needsAdminReview`, `needsAdminReviewSince`, `accountStatus` | `Veterinarians [read]` + `Admins [read]` — **rien d'autre**  |
| `Owner`  | `averageRatingAsOwner`, `ratingCountAsOwner`                                                                 | `owner [read]` + `Veterinarians [read]`                     |

Troisième idiome de champ du fichier, après `missionStatusFieldAuth` (qui garde `create` pour
l'Owner) et `missionValidationFieldsReadOnly` (lecture seule à trois rôles) : ici **aucun rôle
Cognito n'a `create` ni `update`**. La seule voie d'écriture est la Lambda, via le SDK, hors
AppSync.

Deux décisions à scruter :

- **`Clinic` : la règle `allow.authenticated().to(['read'])` de niveau modèle est délibérément NON
  reprise.** L'hériter aurait exposé l'état de modération d'une clinique (et sa moyenne) à
  n'importe quel Owner consultant son profil — la notation est privée par construction, agréger
  côté serveur ne doit pas rouvrir par la bande ce que `Rating` ferme. `allow.owner()` n'est pas
  repris non plus : le vétérinaire créateur appartient de toute façon au groupe `Veterinarians`, et
  un `allow.owner()` **sans** `.to([...])` lui rouvrirait `update` — exactement le trou à fermer.
- **`Owner` : le trou existait bel et bien**, vérifié dans le SDL compilé avant d'écrire la règle
  (`{allow: owner, ownerField: "owner"}`, **sans** `operations` = les 4 opérations) : un Owner
  pouvait écrire n'importe quel champ de son profil via `client.models.Owner.update()`, donc sa
  propre moyenne. Même trou que `Mission.status` avant le correctif de l'étape 1/5. `Veterinarians`
  **garde** `read` ici (contrairement au cas `Clinic`) : c'est exactement le périmètre déjà accordé
  par la règle de modèle, et le retirer casserait toute lecture d'un `Owner` par un vétérinaire
  faite sans `selectionSet` explicite (AppSync renvoie une erreur d'autorisation sur le champ, que
  `throwIfGraphqlError` transforme en exception). Aucune lecture de ce type n'existe aujourd'hui —
  l'écart ne se paierait qu'au premier composable qui l'oublierait.

Contrainte induite pour l'étape 4/5 (composables) : **un Owner ne doit jamais sélectionner les 5
champs de `Clinic`**. Toutes les lectures imbriquées actuelles posent un `selectionSet` explicite
(`useMatchingRequests.js` ne prend que `clinic.id/name/latitude/longitude`), donc rien n'est cassé
aujourd'hui ; une future lecture d'une `Clinic` par un Owner *sans* `selectionSet` échouerait.

Policy IAM de la Lambda (`amplify/backend.ts`), même discipline qu'à l'étape 2/5 — une action par
usage réel, sur l'ARN exact :

| Ressource                    | Actions                                                        | Usage                                    |
| ---------------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| `Rating` (flux)              | `DescribeStream`, `GetRecords`, `GetShardIterator`             | consommation du flux (via `grantStreamRead`) |
| `*`                          | `ListStreams`                                                  | idem — voir ci-dessous                    |
| `Rating` (index `ratingsByTarget`) | `Query`                                                  | toutes les notes reçues par une cible     |
| `Clinic`, `Owner`            | `UpdateItem`                                                   | agrégats + flag de modération             |

`dynamodb:ListStreams` sur `*` est la **seule** ressource non nominative de cette sous-tâche :
elle est codée en dur par le CDK (`aws-cdk-lib/aws-dynamodb/lib/stream-grants.js`, `list()`) parce
que l'action n'accepte pas de ressource nominative côté IAM — c'est aussi ce que fait la policy
managée AWS `AWSLambdaDynamoDBExecutionRole`. Action de listage, sans lecture de donnée. Signalée
ici plutôt que subie. Par ailleurs la Lambda n'a **ni** `Scan` **ni** `Query` sur la table `Rating`
elle-même (uniquement sur le GSI), **ni** `GetItem` (la condition d'écriture remplace la lecture),
**ni** `PutItem`/`DeleteItem` — elle ne peut structurellement pas créer un `Clinic`/`Owner`, et
`attribute_exists(id)` ferme en plus l'upsert implicite de DynamoDB (même piège que celui documenté
dans `submit-mission-validation-write-side.js`).

## 6. Cible inexistante : anomalie de donnée, jamais un échec

Si `attribute_exists(id)` n'est pas satisfaite, c'est que la `Rating` pointe vers un `Clinic`/
`Owner` qui n'existe pas : compte supprimé entre-temps, ou `targetID` **forgé** — résidu
explicitement assumé d'ADR-0015 §3 (un Veterinarian peut soumettre `raterID`/`targetID`
arbitraires, `@auth` ne contraignant pas les valeurs). Ce cas est logué et compté à part, **jamais**
transformé en échec : rejouer n'y changerait rien, et faire échouer l'invocation bloquerait le shard
en rejeu jusqu'à expiration des enregistrements — une seule ligne forgée suffirait alors à geler
l'agrégation de toutes les autres cibles. C'est le lien direct entre le résidu d'ADR-0015 et la
robustesse de cette Lambda.

## 7. Résidus assumés

- **Scope `Veterinarians` global** sur les 5 champs de `Clinic` : un vétérinaire de la clinique A
  peut lire la moyenne et l'état de modération de la clinique B. Aucune notion de "ma clinique"
  n'existe dans le système d'autorisation pour `Clinic`. Même arbitrage qu'ADR-0015 §2 : un scope
  large mais **honnête** plutôt qu'un filtre simulant une garantie que le modèle ne porte pas.
- **Agrégat en retard d'un avis** en cas de traitement concurrent (§3) — auto-réparateur.
- **Aucune notification** quand une clinique passe `UNDER_REVIEW` : ni email (Phase 4.2 en
  stand-by), ni écran admin (non construit). Un `console.warn` est le seul signal, et ce dépôt n'a
  aucun outil de suivi d'erreurs (trou d'observabilité connu, roadmap Phase 5). Le flag est donc
  visible seulement pour qui va le chercher — même statut que les Missions `DISPUTED` (ADR-0016 §6).
- **Rejeu et blocage de shard** : le handler échoue bruyamment sur une erreur d'infrastructure
  (seul signal réellement visible), donc le lot est rejoué et le shard bloqué pendant ce temps.
  Borné par `retryAttempts: 3` + `bisectBatchOnError` ; au-delà, les enregistrements sont
  abandonnés et l'agrégat concerné reste périmé **jusqu'à la notation suivante**, qui le recalcule
  intégralement. C'est le pendant, pour un déclencheur de flux, du "retry EventBridge par défaut"
  signalé sur l'étape 2/5 — traité ici explicitement plutôt que laissé au défaut.
- **Seuils dupliqués entre serveur et client à venir** : le seuil d'alerte du tableau de bord (3,5
  / 3 avis, étape 4/5) vivra côté front, tandis que le seuil de modération (3 / 5 avis) vit en
  variable d'environnement Lambda. Deux règles distinctes, volontairement — mais deux endroits à
  garder cohérents si le produit décide un jour de les aligner.

## Relation avec le reste des ADR

Complète **ADR-0016** en transposant son pattern (Lambda + SDK DynamoDB direct + IAM scopée +
module pur testé) à un troisième type de déclencheur : après le trigger Cognito (ADR-0008) et le
planificateur (ADR-0016), le flux DynamoDB. La différence de fond est le traitement de la
concurrence : l'étape 2/5 écrit sous condition d'état parce qu'un statut de Mission est terminal,
cette étape écrit une valeur dérivée recalculable — un écart argumenté (§3), pas un relâchement.
Complète **ADR-0015** sans le réviser : le `@auth` de `Rating` est inchangé, et c'est justement
parce qu'il interdit à quiconque de lire les notes d'un tiers que l'agrégat doit être serveur. Le
résidu de forgerie d'ADR-0015 §3 trouve ici sa première conséquence opérationnelle concrète (§6).
Comme ADR-0004/0005/0015/0016 : les résidus sont documentés et assumés plutôt que traités par une
infrastructure de résilience non demandée pour ce pilote.
