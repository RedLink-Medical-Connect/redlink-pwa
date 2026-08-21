import { defineBackend } from '@aws-amplify/backend'
import { CfnPlaceIndex } from 'aws-cdk-lib/aws-location'
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam'
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
 * Config reproduite à l'identique de Gen1
 * (`amplify/backend/geo/placeIndex/parameters.json` et
 * `placeIndex-cloudformation-template.json`, récupérés depuis l'historique git à
 * `dc55236~1` -- voir ADR-0012 pour le détail) : `indexName: "placeIndex"`,
 * `dataSource: "Here"` (le prop CDK s'appelle `dataSource`, pas `dataProvider`
 * malgré le nom du paramètre CLI Gen1), `dataSourceConfiguration.intendedUse:
 * "SingleUse"`, `pricingPlan: "RequestBasedUsage"`. Les 4 actions IAM accordées
 * sont EXACTEMENT celles du template Gen1 (`geo:SearchPlaceIndexForPosition`,
 * `geo:SearchPlaceIndexForText`, `geo:SearchPlaceIndexForSuggestions`,
 * `geo:GetPlace`), scopées à l'ARN de cet index précis -- jamais de wildcard.
 *
 * Accordée aux DEUX rôles IAM (authentifié ET non-authentifié) : le Gen1
 * `parameters.json` référence à la fois `authRoleName` et `unauthRoleName`, et
 * `AddressAutocomplete.vue` est utilisé dans `RegisterOwnerView.vue`/
 * `RegisterClinicView.vue` -- des formulaires remplis avant qu'un compte Cognito
 * existe (donc non-authentifié au sens Identity Pool). Sans la policy sur le rôle
 * non-authentifié, l'autocomplétion resterait cassée sur ces deux vues précises
 * même après la migration. L'accès invité (identités non-authentifiées) est déjà
 * actif par défaut sur l'Identity Pool généré par `defineAuth`
 * (`allowUnauthenticatedIdentities: true` par défaut) -- rien à faire côté
 * `amplify/auth/resource.ts`, confirmé qu'aucun override ne le désactive (voir
 * ADR-0012, qui referme le point laissé ouvert par la sous-tâche 3/ADR-0008).
 */
const geoStack = backend.createStack('geo-stack')

const placeIndex = new CfnPlaceIndex(geoStack, 'PlaceIndex', {
  indexName: 'placeIndex',
  dataSource: 'Here',
  dataSourceConfiguration: {
    intendedUse: 'SingleUse',
  },
  // "No longer used" côté CDK (l'API AWS a cessé de facturer par plan), mais
  // reproduit à l'identique de Gen1 par souci de parité -- valeur autorisée
  // unique de toute façon si le prop est fourni.
  pricingPlan: 'RequestBasedUsage',
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
      resources: [placeIndex.attrArn],
    }),
  ],
})

geoAccessPolicy.attachToRole(backend.auth.resources.authenticatedUserIamRole)
geoAccessPolicy.attachToRole(backend.auth.resources.unauthenticatedUserIamRole)

backend.addOutput({
  geo: {
    aws_region: geoStack.region,
    search_indices: {
      items: [placeIndex.indexName],
      default: placeIndex.indexName,
    },
  },
})

export default backend
