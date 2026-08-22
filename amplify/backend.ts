import { defineBackend } from '@aws-amplify/backend'
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources'
import { auth } from './auth/resource'
import { data } from './data/resource'
import { postConfirmation } from './functions/post-confirmation/resource'

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

const indexName = 'placeIndex'

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
