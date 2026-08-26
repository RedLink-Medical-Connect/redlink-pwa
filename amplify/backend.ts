import { defineBackend } from '@aws-amplify/backend'
import { Names } from 'aws-cdk-lib'
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources'
import { auth } from './auth/resource'
import { data, MISSION_STATUS_INDEX_NAME } from './data/resource'
import { postConfirmation } from './functions/post-confirmation/resource'
import { missionValidationAutoFinalizer } from './functions/mission-validation-auto-finalizer/resource'

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
})

// Permission IAM de la Lambda PostConfirmation (scopée à `cognito-idp:AdminAddUserToGroup`
// sur ce seul user pool, jamais de wildcard -- voir ADR-0008) : accordée de façon
// déclarative via `access` dans `amplify/auth/resource.ts`, pas ici. Gen1 scopait la
// policy de la même façon (`!GetAtt UserPool Arn` dans
// `redlinkpwa056b43b0056b43b0PostConfirmation-cloudformation-template.json`) mais avec 3
// actions (`AdminAddUserToGroup`, `GetGroup`, `CreateGroup`), nécessaires à la création
// paresseuse des groupes -- devenues inutiles en Gen2 (groupes statiques).

/**
 * Politique de mot de passe reproduite à l'identique de Gen1 (voir ADR-0008,
 * section "Politique de mot de passe"), via l'échappatoire CDK sur le
 * `CfnUserPool` L1 généré par `defineAuth` -- pas d'équivalent déclaratif
 * dans l'API de `defineAuth` pour ce réglage à ce jour.
 */
const { cfnUserPool } = backend.auth.resources.cfnResources
cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 8,
    requireLowercase: false,
    requireNumbers: false,
    requireSymbols: false,
    requireUppercase: false,
  },
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

export default backend
