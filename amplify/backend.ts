import { defineBackend } from '@aws-amplify/backend'
import { Duration, Names } from 'aws-cdk-lib'
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { FilterCriteria, FilterRule, StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources'
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2'
import { auth } from './auth/resource'
import { data, MISSION_STATUS_INDEX_NAME, RATING_TARGET_INDEX_NAME } from './data/resource'
import { postConfirmation } from './functions/post-confirmation/resource'
import { missionValidationAutoFinalizer } from './functions/mission-validation-auto-finalizer/resource'
import { ratingAggregation } from './functions/rating-aggregation/resource'

/**
 * Phase 8, sous-tâche 4 (migration Gen1 -> Gen2) : `data` (defineData,
 * `amplify/data/resource.ts`) rejoint `auth`/`postConfirmation` (sous-tâche 3)
 * dans le regroupement de "backend resources" -- voir `amplify/data/resource.ts`
 * pour le détail de la traduction des 8 types `@model`/règles `@auth`.
 */
const backend = defineBackend({
  auth,
  postConfirmation,
  data,
  missionValidationAutoFinalizer,
  ratingAggregation,
})

// Permission IAM de la Lambda PostConfirmation (scopée à `cognito-idp:AdminAddUserToGroup`
// sur ce seul user pool, jamais de wildcard -- voir ADR-0008) : accordée de façon
// déclarative via `access` dans `amplify/auth/resource.ts`, pas ici. Gen1 scopait la
// policy de la même façon (`!GetAtt UserPool Arn` dans
// `redlinkpwa056b43b0056b43b0PostConfirmation-cloudformation-template.json`) mais avec 3
// actions (`AdminAddUserToGroup`, `GetGroup`, `CreateGroup`), nécessaires à la création
// paresseuse des groupes -- devenues inutiles en Gen2 (groupes statiques).

/**
 * Durcissement sécurité Cognito (2026-09-02, audit sécurité -- voir plan
 * "Durcissement sécurité Cognito / Auth", Groupe 1), via l'échappatoire CDK sur
 * les L1 `CfnUserPool`/`CfnUserPoolClient` générés par `defineAuth` -- pas
 * d'équivalent déclaratif dans l'API de `defineAuth` pour ces réglages à ce
 * jour, même famille de pattern que le `passwordPolicy` déjà en place.
 */
const { cfnUserPool, cfnUserPoolClient } = backend.auth.resources.cfnResources

/**
 * Politique de mot de passe (remplace le réglage hérité de Gen1, ADR-0008,
 * qui n'imposait que 8 caractères sans complexité) : 12 caractères minimum,
 * les 4 classes de caractères exigées. Synchronisé avec la validation
 * cliente dans `src/composables/usePassword.js` -- un mot de passe accepté
 * par le formulaire ne doit jamais être rejeté par Cognito.
 */
cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 12,
    requireLowercase: true,
    requireNumbers: true,
    requireSymbols: true,
    requireUppercase: true,
  },
}

/**
 * Advanced Security Features (Threat Protection) -- DÉLIBÉRÉMENT NON activée ici.
 * Revue DevSecOps (2026-09-02) : `cfnUserPool.userPoolAddOns.advancedSecurityMode`
 * ne fonctionne QUE si `userPoolTier` vaut `PLUS` (confirmé dans les types installés,
 * `node_modules/aws-cdk-lib/aws-cognito/lib/user-pool.d.ts`, note explicite sur
 * `standardThreatProtectionMode` -- même contrainte sous-jacente pour la propriété
 * dépréciée `advancedSecurityMode` posée directement sur le L1, les deux exposant la
 * même propriété CloudFormation `UserPoolAddOns.AdvancedSecurityMode`). Un pool
 * nouvellement créé est en tier `ESSENTIALS` par défaut (`CfnUserPoolProps.userPoolTier`),
 * qui n'inclut PAS le Threat Protection -- l'activer sans passer `userPoolTier: 'PLUS'`
 * aurait donc échoué au déploiement ou, pire, réussi silencieusement sans jamais
 * journaliser le moindre signal de risque. `PLUS` est facturé au MAU (contrairement à
 * `ESSENTIALS`/`LITE`) -- décision budget refusée pour l'instant (repo owner,
 * 2026-09-02). Reporté dans le Backlog différé du plan de durcissement
 * (`/home/abbate-titouan/.claude/plans/cozy-dazzling-lagoon.md`) : à ressortir si/quand
 * le budget `PLUS` est validé.
 */

/**
 * TTL des tokens posés explicitement plutôt que de laisser le défaut
 * implicite du `UserPoolClient` généré par `defineAuth` (1h Access/ID, 30j
 * Refresh) -- Access/ID token courts (fenêtre d'exploitation réduite en cas
 * de vol), Refresh token raisonnable (pas de re-connexion trop fréquente).
 * Propriétés confirmées dans les types installés
 * (`CfnUserPoolClient.accessTokenValidity`/`idTokenValidity`/
 * `refreshTokenValidity`/`tokenValidityUnits`).
 */
cfnUserPoolClient.accessTokenValidity = 15
cfnUserPoolClient.idTokenValidity = 15
cfnUserPoolClient.refreshTokenValidity = 7
cfnUserPoolClient.tokenValidityUnits = {
  accessToken: 'minutes',
  idToken: 'minutes',
  refreshToken: 'days',
}

/**
 * Lambda planifiée `mission-validation-auto-finalizer` (2026-08-26, étape 2/5 de la double
 * validation de Mission) : accès DIRECT aux tables DynamoDB managées par `defineData`, avec sa
 * propre identité IAM (jamais un utilisateur Cognito). Voir l'en-tête de
 * `amplify/functions/mission-validation-auto-finalizer/handler.ts` pour POURQUOI ce chemin
 * plutôt que le client Data en mode IAM (`allow.resource()`) -- résumé : les mutations générées
 * n'exposent aucun `condition` DynamoDB (ADR-0011) alors que l'écriture de `Mission.status` en a
 * impérativement besoin, et les règles `@auth` DE CHAMP de `Mission` (qui REMPLACENT celles de
 * niveau modèle, ADR-0009) obligeraient à rouvrir en écriture les champs que l'étape 1/5 vient
 * précisément de verrouiller.
 *
 * `backend.data.resources.tables['<Model>']` : point d'accès aux tables managées (clé = nom du
 * modèle), vérifié dans le paquet installé -- `@aws-amplify/graphql-api-construct`
 * (`amplify-graphql-api.js`, exemple `api.resources.tables["Todo"].tableArn` ; mapping construit
 * par `getGeneratedResources`, `lib/internal/construct-exports.js`).
 *
 * Discipline IAM identique au reste de ce fichier (ADR-0008/0012/0013) : une action par usage
 * RÉEL, sur l'ARN EXACT de chaque table, jamais de wildcard, jamais `dynamodb:*`. En
 * particulier :
 * - `Query` est accordé sur l'ARN de l'INDEX (`<tableArn>/index/<nom du GSI>`), pas sur la
 *   table : une action d'index n'est pas couverte par l'ARN de la table seule. Et la Lambda n'a
 *   PAS `dynamodb:Scan` sur `Mission` -- elle ne peut donc structurellement pas retomber sur un
 *   Scan de table complète si le GSI venait à manquer, elle échouerait bruyamment.
 * - `Request` (5e table, absente du périmètre initial de la sous-tâche) : LECTURE SEULE. Le
 *   modèle `Mission` ne porte pas de `clinicID`, seulement `requestID` -- côté front,
 *   `RequestsView.vue` passe le `clinicID` déjà chargé à `closeMission()`, mais ici personne ne
 *   le fournit : il faut le résoudre pour pouvoir écrire `ClinicOwnerRelation` et les compteurs
 *   de la `Clinic`. Signalé explicitement plutôt qu'ajouté en silence.
 * - `Clinic` : `UpdateItem` seul, sans `GetItem` -- l'incrément des compteurs est atomique
 *   (`if_not_exists(...) + :one`), donc aucune lecture préalable n'est nécessaire (contrairement
 *   à `useMissionClosure.js`, qui lit puis écrit faute de pouvoir faire autrement depuis le
 *   client Data).
 */
const missionTable = backend.data.resources.tables['Mission']
const animalTable = backend.data.resources.tables['Animal']
const requestTable = backend.data.resources.tables['Request']
const clinicTable = backend.data.resources.tables['Clinic']
const clinicOwnerRelationTable = backend.data.resources.tables['ClinicOwnerRelation']

const autoFinalizerLambda = backend.missionValidationAutoFinalizer.resources.lambda

autoFinalizerLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:Query'],
    resources: [`${missionTable.tableArn}/index/${MISSION_STATUS_INDEX_NAME}`],
  }),
)
autoFinalizerLambda.addToRolePolicy(
  new PolicyStatement({
    // Écriture conditionnelle du statut final (`ConditionExpression: status = PENDING_VALIDATION`).
    actions: ['dynamodb:UpdateItem'],
    resources: [missionTable.tableArn],
  }),
)
autoFinalizerLambda.addToRolePolicy(
  new PolicyStatement({
    // `GetItem` : Animal.ownerID ; `UpdateItem` : Animal.lastDonationDate (Frequency Rule).
    actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
    resources: [animalTable.tableArn],
  }),
)
autoFinalizerLambda.addToRolePolicy(
  new PolicyStatement({
    // Request.clinicID uniquement -- aucune écriture sur les Requests.
    actions: ['dynamodb:GetItem'],
    resources: [requestTable.tableArn],
  }),
)
autoFinalizerLambda.addToRolePolicy(
  new PolicyStatement({
    // `Scan` (filtré sur ownerID, équivalent exact du `list({ filter })` du client Data : aucun
    // GSI applicatif n'existe sur ClinicOwnerRelation) + `PutItem` pour la relation créée.
    actions: ['dynamodb:Scan', 'dynamodb:PutItem'],
    resources: [clinicOwnerRelationTable.tableArn],
  }),
)
autoFinalizerLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:UpdateItem'],
    resources: [clinicTable.tableArn],
  }),
)

// Noms de tables/index : tokens CDK résolus seulement à la synthèse, donc injectés ici et pas en
// statique dans `defineFunction({ environment })` (qui ne porte que le délai configurable,
// MISSION_VALIDATION_TIMEOUT_DAYS -- seule source de vérité de la durée, voir `resource.ts` de
// la fonction). Le handler ne lit JAMAIS ces noms depuis `amplify/data/resource.ts` : un import
// depuis ce module embarquerait tout `@aws-amplify/backend` dans son bundle esbuild.
backend.missionValidationAutoFinalizer.addEnvironment('MISSION_TABLE_NAME', missionTable.tableName)
backend.missionValidationAutoFinalizer.addEnvironment(
  'MISSION_STATUS_INDEX_NAME',
  MISSION_STATUS_INDEX_NAME,
)
backend.missionValidationAutoFinalizer.addEnvironment('ANIMAL_TABLE_NAME', animalTable.tableName)
backend.missionValidationAutoFinalizer.addEnvironment('REQUEST_TABLE_NAME', requestTable.tableName)
backend.missionValidationAutoFinalizer.addEnvironment(
  'CLINIC_OWNER_RELATION_TABLE_NAME',
  clinicOwnerRelationTable.tableName,
)
backend.missionValidationAutoFinalizer.addEnvironment('CLINIC_TABLE_NAME', clinicTable.tableName)

/**
 * Lambda `rating-aggregation` (2026-08-26, étape 3/5 -- agrégats de notation + modération
 * clinique, voir `amplify/functions/rating-aggregation/` et docs/adr/0017). Même famille que la
 * Lambda planifiée ci-dessus (accès DynamoDB direct, IAM scopée), avec un déclencheur différent :
 * le FLUX DynamoDB Streams de la table `Rating`.
 *
 * POINT VÉRIFIÉ, pas supposé (méthode de l'étape 2/5 : lecture des paquets installés, MCP
 * `context7` indisponible) : il n'y a RIEN à activer côté table. Les tables managées par
 * `defineData` sont provisionnées avec la stratégie `AMPLIFY_TABLE`
 * (`@aws-amplify/backend-data/lib/convert_schema.js`, `provisionStrategy: 'AMPLIFY_TABLE'`), et
 * le générateur de ressources correspondant crée CHAQUE table de modèle avec
 * `stream: StreamViewType.NEW_AND_OLD_IMAGES` en dur
 * (`@aws-amplify/graphql-api-construct/node_modules/@aws-amplify/graphql-model-transformer/lib/
 * resources/amplify-dynamodb-table/amplify-dynamo-model-resource-generator.js`, `createModelTable`).
 * `backend.data.resources.tables['Rating'].tableStreamArn` est donc défini et résout en
 * `Fn::GetAtt[RatingTable, TableStreamArn]` -- confirmé par une synthèse CDK locale hors AWS
 * (aucun déploiement). `AmplifyDynamoDbTableWrapper.streamSpecification`
 * (`backend.data.resources.cfnResources.amplifyDynamoDbTables['Rating']`) existe pour CHANGER
 * cette vue, mais serait ici une réécriture de la valeur déjà posée -- volontairement non
 * utilisée.
 *
 * `DynamoEventSource` (`aws-cdk-lib/aws-lambda-event-sources`) crée l'`EventSourceMapping` ET
 * accorde les permissions de lecture du flux (`table.grantStreamRead(fn)` :
 * `dynamodb:DescribeStream`/`GetRecords`/`GetShardIterator` sur l'ARN EXACT du flux, plus
 * `dynamodb:ListStreams` sur `*` -- ce dernier est codé en dur par le CDK
 * (`aws-cdk-lib/aws-dynamodb/lib/stream-grants.js`, `list()`) parce que l'action `ListStreams`
 * n'accepte pas de ressource nominative côté IAM ; c'est aussi ce que fait la policy managée AWS
 * `AWSLambdaDynamoDBExecutionRole`. C'est la SEULE ressource `*` de cette sous-tâche, sur une
 * action de listage sans lecture de donnée, et elle est signalée ici plutôt que subie).
 *
 * Réglages de l'`EventSourceMapping`, tous explicites parce que les défauts ne conviennent pas :
 * - `filters` : seuls les `INSERT` invoquent la fonction. `Rating` est write-once (ADR-0015),
 *   donc `MODIFY`/`REMOVE` n'existent pas côté applicatif -- ce filtre évite d'invoquer la
 *   Lambda pour une écriture administrative directe. Le handler refait le même filtrage
 *   (défense en profondeur : le filtre d'infrastructure peut être relâché sans que la logique
 *   suive).
 * - `startingPosition: LATEST` -- pas `TRIM_HORIZON` : au premier déploiement, rejouer jusqu'à
 *   24 h d'historique du flux serait inoffensif (recalcul idempotent) mais massif et sans valeur.
 * - `retryAttempts: 3` -- le défaut est -1, c'est-à-dire des rejeux INFINIS jusqu'à expiration
 *   des enregistrements (24 h), pendant lesquels le shard concerné est BLOQUÉ. Le handler
 *   échoue volontairement (fail-loud) sur une erreur d'infrastructure ; borner les rejeux est ce
 *   qui empêche une erreur permanente de figer l'agrégation de toutes les autres cibles. Les
 *   agrégats manqués sont recalculés à la notation suivante (chaque recalcul repart de zéro).
 * - `bisectBatchOnError: true` : sur échec, le lot est coupé en deux -- une seule cible
 *   problématique ne fait pas perdre les autres à l'épuisement des rejeux.
 * - `batchSize`/`maxBatchingWindow` : petit lot, courte fenêtre. Une notation doit se voir
 *   rapidement côté agrégat ; la fenêtre sert surtout à regrouper les notations d'une même cible
 *   (dédoublonnées par le handler) sans faire attendre l'utilisateur.
 * - `reportBatchItemFailures` NON activé : la valeur de retour du handler est donc ignorée par
 *   Lambda (elle sert au test/aux logs), et un échec fait rejouer le lot ENTIER -- sans danger,
 *   toutes les écritures étant idempotentes (voir l'en-tête du handler).
 */
const ratingTable = backend.data.resources.tables['Rating']
const ownerTable = backend.data.resources.tables['Owner']
const ratingAggregationLambda = backend.ratingAggregation.resources.lambda

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

ratingAggregationLambda.addToRolePolicy(
  new PolicyStatement({
    // Toutes les notes reçues par une cible -- sur l'ARN de l'INDEX (une action d'index n'est pas
    // couverte par l'ARN de la table seule). Pas de `dynamodb:Scan` ni de `Query` sur la table
    // elle-même : cette Lambda ne peut structurellement pas parcourir `Rating` autrement que par
    // ce GSI, ni lire une notation par sa clé primaire.
    actions: ['dynamodb:Query'],
    resources: [`${ratingTable.tableArn}/index/${RATING_TARGET_INDEX_NAME}`],
  }),
)
ratingAggregationLambda.addToRolePolicy(
  new PolicyStatement({
    // Agrégats + champs de modération de `Clinic`, agrégats d'`Owner`. `UpdateItem` SEUL : pas de
    // `GetItem` (la condition d'écriture du flag remplace la lecture préalable -- voir
    // `flagClinicForAdminReview`), pas de `PutItem`/`DeleteItem` (cette Lambda ne crée ni ne
    // supprime jamais une Clinic/un Owner ; `attribute_exists(id)` côté handler ferme aussi
    // l'upsert implicite de DynamoDB).
    actions: ['dynamodb:UpdateItem'],
    resources: [clinicTable.tableArn, ownerTable.tableArn],
  }),
)

// Mêmes tokens CDK que pour la Lambda planifiée ci-dessus : injectés ici, jamais importés depuis
// `amplify/data/resource.ts` par le handler (ça embarquerait tout `@aws-amplify/backend` dans son
// bundle esbuild). Les deux SEULES valeurs statiques de cette fonction (les seuils de modération)
// vivent dans `defineFunction({ environment })`, pas ici.
backend.ratingAggregation.addEnvironment('RATING_TABLE_NAME', ratingTable.tableName)
backend.ratingAggregation.addEnvironment('RATING_TARGET_INDEX_NAME', RATING_TARGET_INDEX_NAME)
backend.ratingAggregation.addEnvironment('CLINIC_TABLE_NAME', clinicTable.tableName)
backend.ratingAggregation.addEnvironment('OWNER_TABLE_NAME', ownerTable.tableName)

/**
 * Geo (Amazon Location Service place index) -- prérequis découvert tardivement en
 * revue Lead Dev finale de la Phase 8 (voir ADR-0012) : `dc55236` (sous-tâche 6,
 * nettoyage Gen1) a supprimé `amplify/backend/geo/placeIndex/` sans équivalent
 * Gen2, alors qu'`AddressAutocomplete.vue` (`Geo.searchByText()`, `@aws-amplify/geo`)
 * en dépend pour dériver `latitude`/`longitude` (consommées par le critère de
 * proximité géographique du moteur d'éligibilité). `defineData`/`defineAuth` n'ont
 * pas d'équivalent Gen2 de première classe pour Geo -- échappatoire CDK, même
 * famille de pattern que la mutation custom conditionnelle (ADR-0011) et la
 * politique de mot de passe ci-dessus (ADR-0008).
 *
 * Correctif post-déploiement réel (voir ADR-0013) : un premier `ampx sandbox`
 * (région du projet : `eu-west-3`, Paris) a échoué avec
 * `Unrecognized resource types: [AWS::Location::PlaceIndex]` -- Amazon Location
 * Service n'est pas reconnu comme type de ressource CloudFormation natif dans
 * `eu-west-3`. Gen1 avait déjà ce problème et le contournait (`amplify/backend/
 * geo/placeIndex/placeIndex-cloudformation-template.json`, récupéré depuis
 * l'historique git à `dc55236~1`) via un `Mappings.RegionMapping` (`eu-west-3`
 * -> `eu-west-1`) et un custom resource CloudFormation backé par une Lambda
 * appelant le SDK Location avec une région explicite -- CloudFormation ne
 * valide jamais le type d'un appel SDK fait depuis l'intérieur d'une Lambda,
 * seulement celui d'une ressource déclarée directement dans le template.
 * `AwsCustomResource` (`aws-cdk-lib/custom-resources`) est l'équivalent CDK de
 * ce même mécanisme (`AwsSdkCall.region` explicite par appel).
 */
const geoStack = backend.createStack('geo-stack')

/**
 * Bug réel post-déploiement n°3 (2026-08-25) : `indexName` était en dur
 * (`'placeIndex'`), donc partagé par TOUS les environnements (sandbox local,
 * `main`, toute future branche) puisqu'un nom de Place Index est unique par
 * compte + région AWS, pas par stack CloudFormation. Le premier vrai
 * déploiement de `main` a échoué avec `Place index already exists:
 * placeIndex` (le sandbox local en avait déjà créé un), qui a ensuite fait
 * échouer le rollback de toute la stack (tables DynamoDB refusant de se
 * supprimer) -- même classe de risque que la collision déjà identifiée pour
 * `AwsCustomResource` (ADR-0013), non traitée à l'époque faute d'un deuxième
 * environnement réel pour la révéler.
 *
 * `Names.uniqueResourceName` (CDK, pas une solution maison) dérive un nom
 * unique par stack parente non imbriquée (donc par branche/sandbox) --
 * mêmes contraintes de charset que Gen1 n'avait pas à gérer (pas de Place
 * Index dans son mapping). `maxLength: 64` : marge large sous la limite
 * Location Service (100 caractères), le suffixe de hash CDK inclus.
 */
const indexName = Names.uniqueResourceName(geoStack, {
  maxLength: 64,
  separator: '-',
  allowedSpecialCharacters: '-_',
})

/**
 * Constante simple plutôt que la table `Mappings.RegionMapping` à 20 entrées
 * de Gen1 : ce projet ne déploie que dans `eu-west-3`, reproduire une table
 * générique pour toutes les régions AWS serait de la sur-ingénierie pour un
 * besoin à une seule entrée réelle -- voir ADR-0013.
 */
const locationServiceRegion = 'eu-west-1'

const placeIndexArn = `arn:aws:geo:${locationServiceRegion}:${geoStack.account}:place-index/${indexName}`

/**
 * Équivalent Gen2 du custom resource Lambda Gen1 : CloudFormation ne voit ici
 * que le type générique du custom resource (`Custom::AWS`, reconnu dans toute
 * région), jamais `AWS::Location::PlaceIndex` -- la Lambda sous-jacente
 * (managée par CDK) exécute l'appel SDK dans `locationServiceRegion` via
 * `AwsSdkCall.region`. `DataSourceConfiguration.IntendedUse: "SingleUse"`
 * reproduit la config Gen1. Pas de `PricingPlan` : champ marqué "No longer
 * used" côté SDK (`@aws-sdk/client-location`) -- Gen1 le passait par souci de
 * parité, ici on l'omet plutôt que de reproduire un champ optionnel déprécié
 * (ADR-0013).
 */
const placeIndex = new AwsCustomResource(geoStack, 'PlaceIndexCustomResource', {
  onCreate: {
    service: 'Location',
    action: 'createPlaceIndex',
    parameters: {
      IndexName: indexName,
      DataSource: 'Here',
      DataSourceConfiguration: {
        IntendedUse: 'SingleUse',
      },
    },
    region: locationServiceRegion,
    physicalResourceId: PhysicalResourceId.of(indexName),
  },
  onUpdate: {
    service: 'Location',
    action: 'updatePlaceIndex',
    parameters: {
      IndexName: indexName,
    },
    region: locationServiceRegion,
    physicalResourceId: PhysicalResourceId.of(indexName),
  },
  onDelete: {
    service: 'Location',
    action: 'deletePlaceIndex',
    parameters: {
      IndexName: indexName,
    },
    region: locationServiceRegion,
  },
  // Policy IAM du Lambda custom-resource lui-même (PAS celle des rôles
  // auth/unauth client ci-dessous) -- même distinction que le template Gen1
  // supprimé (`CustomPlaceIndexLambdaServiceRoleDefaultPolicy...` dans
  // `dc55236~1`) : `geo:CreatePlaceIndex` ne peut pas être scopé à l'ARN
  // (l'index n'existe pas encore au moment de la création), `geo:
  // UpdatePlaceIndex`/`geo:DeletePlaceIndex` le sont une fois l'index créé.
  // `AwsCustomResourcePolicy.fromSdkCalls()` applique la même liste de
  // `resources` à TOUS les appels SDK configurés sur ce custom resource --
  // insuffisant pour garder cette distinction, d'où `fromStatements` avec
  // deux `PolicyStatement` séparées plutôt qu'un wildcard partout par
  // facilité.
  policy: AwsCustomResourcePolicy.fromStatements([
    new PolicyStatement({
      actions: ['geo:CreatePlaceIndex'],
      resources: ['*'],
    }),
    new PolicyStatement({
      actions: ['geo:UpdatePlaceIndex', 'geo:DeletePlaceIndex'],
      resources: [placeIndexArn],
    }),
  ]),
})

const geoAccessPolicy = new Policy(geoStack, 'GeoAccessPolicy', {
  statements: [
    new PolicyStatement({
      actions: [
        'geo:SearchPlaceIndexForPosition',
        'geo:SearchPlaceIndexForText',
        'geo:SearchPlaceIndexForSuggestions',
        'geo:GetPlace',
      ],
      resources: [placeIndexArn],
    }),
  ],
})

// Pas d'ordonnancement explicite `node.addDependency()` ici (retiré après un
// premier déploiement réel, voir ADR-0013 §5) : IAM n'a jamais eu besoin de
// cette dépendance pour fonctionner (une policy peut référencer un ARN qui
// n'existe pas encore, non validé à l'attache -- seulement à l'appel réel,
// déjà confirmé par la revue DevSecOps AWS avant le premier déploiement) --
// et cet appel ajoutait du bruit (avertissements de dépréciation CDK internes,
// répétés à chaque ressource L1 des deux constructs) sans bénéfice réel.
// Bug réel post-déploiement (voir ADR-0013 §7) : `authenticatedUserIamRole` est le
// rôle IAM générique de l'Identity Pool, mais `defineAuth({ groups: [...] })`
// (amplify/auth/resource.ts) crée un rôle IAM DÉDIÉ par groupe Cognito
// (`backend.auth.resources.groups[nom].role`) -- c'est CE rôle que l'Identity Pool
// fait réellement assumer à un utilisateur membre d'un groupe (mapping "rôle depuis
// le token"), pas le rôle authentifié générique. Puisque PostConfirmation ajoute
// systématiquement chaque utilisateur à Veterinarians ou Owners, le rôle générique
// n'est en pratique jamais utilisé une fois authentifié -- confirmé en production
// (403 AccessDeniedException sur `amplifyAuthOwnersGroupRole...`, jamais sur
// `authenticatedUserIamRole`). Accordée aux deux rôles de groupe en plus du rôle
// générique (gardé par défense en profondeur, ex. un utilisateur PostConfirmation
// pas encore assigné à un groupe) et du rôle non-authentifié (formulaires
// d'inscription, remplis avant qu'un compte existe).
geoAccessPolicy.attachToRole(backend.auth.resources.authenticatedUserIamRole)
geoAccessPolicy.attachToRole(backend.auth.resources.unauthenticatedUserIamRole)
geoAccessPolicy.attachToRole(backend.auth.resources.groups['Veterinarians'].role)
geoAccessPolicy.attachToRole(backend.auth.resources.groups['Owners'].role)

backend.addOutput({
  geo: {
    // `locationServiceRegion` ('eu-west-1'), où l'index EXISTE réellement --
    // PAS `geoStack.region` ('eu-west-3', la région de déploiement de la
    // stack CloudFormation elle-même). Sinon `Geo.searchByText()` côté
    // frontend interrogerait l'API Location Service dans la mauvaise région
    // et ne trouverait jamais l'index, même une fois déployé (ADR-0013).
    aws_region: locationServiceRegion,
    search_indices: {
      items: [indexName],
      default: indexName,
    },
  },
})

/**
 * WAF devant AppSync (2026-09-02, audit sécurité -- plan "Durcissement
 * sécurité Cognito / Auth", Groupe 1) : ce projet n'a pas d'API Gateway (voir
 * CLAUDE.md) -- AppSync est le seul point d'entrée réseau, et n'a pas de rate
 * limiting de première classe. Une `CfnWebACLAssociation` (`aws-cdk-lib/
 * aws-wafv2`) est le seul chemin CDK pour associer un Web ACL à une API
 * AppSync -- même famille d'échappatoire CDK que Geo/passwordPolicy ci-dessus.
 *
 * Stack séparée SANS override de région (contrairement à `geoStack` ci-dessus,
 * volontairement forcé en `eu-west-1`) : une association WAF `REGIONAL`
 * (seule portée valide pour AppSync -- `CLOUDFRONT` est réservé à CloudFront
 * et exige `us-east-1`) doit être dans la MÊME région que la ressource
 * associée, donc la région de déploiement par défaut du projet (où AppSync
 * est réellement créé), pas `eu-west-1`.
 */
const wafStack = backend.createStack('waf-stack')

const { cfnGraphqlApi } = backend.data.resources.cfnResources

/**
 * Une seule règle managée AWS (`AWSManagedRulesCommonRuleSet`, protections
 * génériques OWASP) + une règle de rate-limiting basée sur l'IP source (seul
 * point de la checklist sécurité sans mécanisme dédié dans ce projet, faute
 * d'API Gateway). `limit: 2000` sur une fenêtre de 5 min (défaut
 * `evaluationWindowSec`, minimum WAF autorisé 100) : marge large au-dessus
 * d'un usage normal (formulaires, dashboard), pensée pour absorber un usage
 * légitime en rafale (ex. chargement du dashboard clinique avec plusieurs
 * requêtes parallèles) sans faux positif, tout en coupant un scraping/
 * credential-stuffing soutenu.
 *
 * `AWSManagedRulesCommonRuleSet` posée en `overrideAction: { count: {} }`, pas en
 * blocage réel (revue DevSecOps, 2026-09-02) : ce jeu de règles inspecte le corps des
 * requêtes (`CrossSiteScripting_BODY`, `GenericRFI_BODY`, etc.), et ce projet manipule
 * des champs texte libre (notes médicales animales, descriptions) susceptibles de
 * déclencher un faux positif -- une mutation légitime bloquée renverrait un 403 HTTP
 * brut, pas une réponse `{ data, errors }` GraphQL (absorbé sans crash par les
 * `try/catch` déjà en place, mais avec un message d'erreur générique et aucune
 * visibilité sur la cause réelle, faute d'outil de suivi d'erreurs). Même philosophie
 * que le mode `AUDIT` déjà utilisé ailleurs dans ce projet : observer les métriques
 * CloudWatch (`redlink-appsync-common-rule-set`) avant de passer en blocage réel --
 * `RateLimitPerIp` reste en blocage direct (`action: { block: {} }`), son mode de
 * détection (comptage de requêtes) n'ayant pas ce risque de faux positif sur du
 * contenu métier légitime.
 */
const webAcl = new CfnWebACL(wafStack, 'AppSyncWebAcl', {
  defaultAction: { allow: {} },
  scope: 'REGIONAL',
  visibilityConfig: {
    sampledRequestsEnabled: true,
    cloudWatchMetricsEnabled: true,
    metricName: 'redlink-appsync-webacl',
  },
  rules: [
    {
      name: 'AWSManagedRulesCommonRuleSet',
      priority: 0,
      overrideAction: { count: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesCommonRuleSet',
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'redlink-appsync-common-rule-set',
      },
    },
    {
      name: 'RateLimitPerIp',
      priority: 1,
      action: { block: {} },
      statement: {
        rateBasedStatement: {
          aggregateKeyType: 'IP',
          limit: 2000,
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'redlink-appsync-rate-limit',
      },
    },
  ],
})

new CfnWebACLAssociation(wafStack, 'AppSyncWebAclAssociation', {
  resourceArn: cfnGraphqlApi.attrArn,
  webAclArn: webAcl.attrArn,
})

export default backend
