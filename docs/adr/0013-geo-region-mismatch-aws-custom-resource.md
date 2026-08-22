---
status: accepted
supersedes: none (voir "Relation avec le reste des ADR" ci-dessous)
---

# `amplify/backend.ts` : Geo -- `CfnPlaceIndex` remplacé par `AwsCustomResource` (région Location Service explicite)

Correctif post-déploiement réel, découvert après l'ouverture de la PR de migration
(ADR-0012) : le repo owner a lancé un premier `npx ampx sandbox` (région du projet :
`eu-west-3`, Paris) et le déploiement CloudFormation a échoué avec

```
Unrecognized resource types: [AWS::Location::PlaceIndex]
```

## 1. Root cause

Amazon Location Service n'est pas disponible en tant que **type de ressource
CloudFormation natif** dans `eu-west-3` -- CloudFormation refuse de synthétiser un
template qui déclare directement une ressource `AWS::Location::PlaceIndex` dans cette
région, indépendamment de la disponibilité de l'API Location Service elle-même dans
une région voisine.

Gen1 avait déjà ce problème et le contournait, vérifié en relisant le template
CloudFormation Gen1 supprimé (`amplify/backend/geo/placeIndex/
placeIndex-cloudformation-template.json`, récupérable via `git show
dc55236~1:amplify/backend/geo/placeIndex/placeIndex-cloudformation-template.json`) :

- Une section `Mappings.RegionMapping` associait chacune des régions de déploiement
  Amplify possibles (20 entrées) à la région où Location Service devait réellement
  être appelé -- `eu-west-3` -> `eu-west-1`, `us-west-1` -> `us-west-2`, etc.
- La ressource elle-même n'était **jamais** un `AWS::Location::PlaceIndex` déclaré
  directement dans le template : c'était un `Custom::LambdaCallout` (`CustomPlaceIndex`)
  backé par une Lambda (`CustomPlaceIndexLambda`, Node.js, `@aws-sdk/client-location`)
  qui exécutait `CreatePlaceIndexCommand`/`UpdatePlaceIndexCommand`/
  `DeletePlaceIndexCommand` avec une **région explicite** (`event.ResourceProperties.region`,
  résolue depuis le mapping ci-dessus) passée au client SDK.

Le mécanisme fonctionne parce que CloudFormation valide le type des ressources
**déclarées directement dans le template** (`Resources.<Nom>.Type`), pas les appels
SDK effectués depuis l'intérieur d'une Lambda -- un appel SDK avec une région
explicite contourne entièrement cette validation, quelle que soit la région de la
stack CloudFormation qui l'exécute.

`c52123b` (première version Gen2 de la migration Geo, ADR-0012) reconstruisait Geo
avec `CfnPlaceIndex` (`aws-cdk-lib/aws-location`) -- un type CDK L1 qui synthétise
directement `AWS::Location::PlaceIndex` dans le template de `geo-stack`. Cette
première version reproduisait donc, sans le savoir, exactement le problème que Gen1
avait déjà résolu -- ADR-0012 documentait fidèlement la config Gen1 (`dataSource`,
`dataSourceConfiguration`, les 4 actions IAM) mais n'avait pas connaissance du
`RegionMapping`/custom resource Gen1, jamais mentionné dans le template au moment où
son propre contenu (les props CDK du `CfnPlaceIndex`) a été extrait -- un vrai essai
de déploiement était nécessaire pour révéler que la forme, pas seulement la config,
devait être reproduite.

## 2. Solution Gen2 : `AwsCustomResource`

`AwsCustomResource` (`aws-cdk-lib/custom-resources`) est l'équivalent CDK direct du
mécanisme Gen1 : une construction de haut niveau qui génère elle-même la Lambda
`Custom::AWS` (type CloudFormation générique, reconnu dans toute région) exécutant un
appel SDK avec une `region` explicite (`AwsSdkCall.region`), vérifié dans les types
installés (`node_modules/aws-cdk-lib/custom-resources/lib/aws-custom-resource/
aws-custom-resource.d.ts`) :

```
readonly region?: string;
// @default - the region where this custom resource is deployed
```

Remplace `CfnPlaceIndex` dans `amplify/backend.ts` :

1. `locationServiceRegion = 'eu-west-1'` -- constante simple, **pas** de
   reproduction de la table `Mappings.RegionMapping` à 20 entrées de Gen1 : ce projet
   ne déploie que dans `eu-west-3`, une table générique pour toutes les régions AWS
   serait de la sur-ingénierie pour un besoin à une seule entrée réelle. Si ce projet
   devait un jour déployer ailleurs, cette constante (et le commentaire qui
   l'accompagne) devra être revue -- assumé, comme les autres simplifications pilote
   de ce repo (ex. `isPrimaryClinic`, Phase 3).
2. Trois `AwsSdkCall` (`onCreate`/`onUpdate`/`onDelete`), tous avec
   `service: 'Location'` et `region: locationServiceRegion` :
   - `onCreate` : `action: 'createPlaceIndex'`, `parameters: { IndexName,
     DataSource: 'Here', DataSourceConfiguration: { IntendedUse: 'SingleUse' } }`,
     `physicalResourceId: PhysicalResourceId.of('placeIndex')`.
   - `onUpdate` : `action: 'updatePlaceIndex'`, `parameters: { IndexName }`.
   - `onDelete` : `action: 'deletePlaceIndex'`, `parameters: { IndexName }`.
   - Pas de `PricingPlan` dans `onCreate`/`onUpdate` : le shape SDK confirmé
     (`node_modules/@aws-sdk/client-location/dist-types/models/models_0.d.ts`,
     `CreatePlaceIndexRequest`/`UpdatePlaceIndexRequest`) marque ce champ
     `@deprecated`/"No longer used", et il est optionnel -- Gen1 le passait par souci
     de parité avec l'ancien tooling CLI, ici on l'omet plutôt que de reproduire un
     champ déprécié sans effet.
3. `policy: AwsCustomResourcePolicy.fromStatements([...])` -- **pas**
   `fromSdkCalls()`. Vérifié dans les types installés
   (`aws-custom-resource.d.ts`) : `fromSdkCalls(options: SdkCallsPolicyOptions)`
   prend un seul `resources: string[]`, appliqué à **tous** les appels SDK
   configurés sur le même `AwsCustomResource` -- incompatible avec la distinction que
   le template Gen1 fait explicitement dans la policy de son propre Lambda
   custom-resource (`CustomPlaceIndexLambdaServiceRoleDefaultPolicy...`) :
   `geo:CreatePlaceIndex` sur `Resource: "*"` (l'index n'existe pas encore au moment
   de la création, aucun ARN à scoper) séparé de `geo:UpdatePlaceIndex`/
   `geo:DeletePlaceIndex` scopés à l'ARN de l'index une fois créé
   (`arn:aws:geo:${region}:${account}:place-index/${indexName}`). `fromStatements`
   (deux `PolicyStatement` CDK classiques) reproduit cette même distinction plutôt
   que d'accorder un unique `resources: ['*']` à toutes les actions par facilité.

## 3. Policy client (auth/unauth) : ARN reconstruit à la main

`geoAccessPolicy` (les 4 actions `geo:SearchPlaceIndexForPosition/Text/Suggestions`/
`GetPlace`, attachée aux deux rôles IAM `authenticatedUserIamRole`/
`unauthenticatedUserIamRole` -- inchangé dans son principe par rapport à ADR-0012)
ne peut plus lire `placeIndex.attrArn` : il n'y a plus d'objet CDK `CfnPlaceIndex`
qui expose cet attribut, seulement un `AwsCustomResource` générique dont la sortie
n'est pas typée par ressource AWS. L'ARN est donc construit manuellement :

```
const placeIndexArn = `arn:aws:geo:${locationServiceRegion}:${geoStack.account}:place-index/${indexName}`
```

Cette chaîne étant statique (pas un token CDK dérivé de `placeIndex`), CDK ne peut
pas déduire automatiquement l'ordre de création entre `PlaceIndexCustomResource` et
`GeoAccessPolicy`. Sans risque d'échec de déploiement pour autant -- une policy IAM
peut référencer un ARN pas encore existant, IAM ne valide l'ARN qu'à l'appel, pas à
l'attache -- mais un `geoAccessPolicy.node.addDependency(placeIndex)` explicite est
ajouté par rigueur, pour garder l'ordre de déploiement correct en pratique (l'index
doit exister avant que la policy client ne devienne utile).

## 4. `aws_region` de `backend.addOutput` : bug latent corrigé au passage

La première version Gen2 (ADR-0012) exposait `aws_region: geoStack.region` dans
`amplify_outputs.json`. `geoStack.region` vaut `eu-west-3` (la région de déploiement
de la stack CloudFormation elle-même), **pas** `eu-west-1` (la région où l'index
existe réellement une fois cette correction appliquée). Si cette valeur n'était pas
corrigée en même temps que le reste, `Geo.searchByText()` côté frontend
(`AddressAutocomplete.vue`, `src/main.js` via `Amplify.configure(outputs)`)
interrogerait l'API Location Service dans la mauvaise région et ne trouverait jamais
l'index, même une fois le déploiement CloudFormation réussi -- un deuxième bug latent
qui serait resté invisible jusqu'à un test manuel de l'autocomplétion d'adresse après
déploiement. `aws_region` est désormais `locationServiceRegion` (`'eu-west-1'`).

## 5. Ce qui n'a pas été fait, volontairement

- Pas de table de mapping générique (voir section 2.1) -- une seule région réelle de
  déploiement pour ce projet.
- Pas de test Vitest dédié : même raisonnement qu'ADR-0012 -- construction
  déclarative CDK, vérifiable par `tsc --noEmit` (types) ou un vrai déploiement
  (comportement runtime), pas par une fonction pure testable en isolation.
- **Pas de vérification par un vrai `ampx sandbox`** : aucun agent ne déploie. La
  rigueur de vérification s'est donc portée sur les types/signatures installés
  (`aws-cdk-lib/custom-resources`, `@aws-sdk/client-location`) plutôt que sur un essai
  de déploiement réel -- un deuxième échec coûterait cher en temps au repo owner. À
  confirmer par le prochain `ampx sandbox` réel.

## 6. Confirmé par un vrai déploiement, nettoyage mineur en retour

`npx ampx sandbox` (région `eu-west-3`) a réussi avec cette version : `Deployment
completed`, `amplify_outputs.json` généré. Le point resté non vérifiable offline
(section 5) est donc confirmé -- `AwsCustomResource` fonctionne bien en pratique pour
contourner l'indisponibilité régionale de Location Service.

Le déploiement a fait remonter des centaines d'avertissements CDK répétés
(`CfnResource#addDependency is deprecated`). Vérifié après coup (`grep` dans
`node_modules`) : la quasi-totalité vient des paquets internes du framework Amplify
Gen2 lui-même (`@aws-amplify/graphql-transformer-core`,
`@aws-amplify/graphql-model-transformer`, `@aws-amplify/auth-construct` -- le câblage
interne des dépendances entre les 8 tables DynamoDB, les résolveurs GraphQL et
Cognito), pas du code de ce repo -- rien à corriger ici, ça se résoudra avec une
future version de ces paquets AWS. La seule ligne de `amplify/backend.ts` qui aurait
pu y contribuir (`geoAccessPolicy.node.addDependency(placeIndex)`, ajoutée par
rigueur en section 3 ci-dessus) a été retirée : DevSecOps AWS avait déjà confirmé
avant le déploiement qu'IAM ne valide jamais l'existence d'un ARN référencé à
l'attache d'une policy (seulement à l'appel réel) -- cette dépendance n'était donc
pas nécessaire à la correction du déploiement, seulement à un ordonnancement
"esthétique" qui coûtait plus en bruit qu'il n'apportait.

Un deuxième avertissement Amplify (`owners may reassign ownership for the following
model(s)...`) est apparu au déploiement -- avertissement standard du CLI Gen2 pour
tout modèle utilisant `allow.owner()` sans restriction supplémentaire sur le champ
caché `owner`/`ownerID` (n'importe quel propriétaire actuel d'une ligne peut en
théorie réassigner sa propre ligne à quelqu'un d'autre, perdant ainsi son propre
accès). Ce n'est pas un bug ni une régression de cette Phase 8 : c'est le
comportement Transformer standard, déjà accepté comme résidu assumé pour ce pilote
(même logique que les limites déjà documentées dans ADR-0004/ADR-0005 -- Veterinarians/
Owners de confiance, pas de garde-fou supplémentaire jugé nécessaire à ce stade).
Non traité dans cette PR.

## 7. Bug réel post-déploiement n°2 : mauvais rôle IAM ciblé

Test de bout en bout sur le backend déployé (autocomplétion d'adresse, `ProfileView.vue`,
Owner déjà authentifié) : `403 AccessDeniedException` sur `geo:SearchPlaceIndexForText`,
pour le rôle `arn:aws:sts::...:assumed-role/amplify-redlinkpwa-...-amplifyAuthOwnersGroupRol-...`
-- PAS `authenticatedUserIamRole` (auquel la policy avait été accordée, section 3).

Root cause : `defineAuth({ groups: ['Veterinarians', 'Owners'] })` (`amplify/auth/
resource.ts`, ADR-0008) crée un rôle IAM DÉDIÉ par groupe Cognito
(`backend.auth.resources.groups[nom].role`, confirmé dans
`node_modules/@aws-amplify/plugin-types/lib/auth_resources.d.ts`) -- c'est ce rôle que
l'Identity Pool fait réellement assumer à un utilisateur membre d'un groupe (mapping
"rôle depuis le token"), pas `authenticatedUserIamRole` (le rôle authentifié
générique, utilisé seulement par un utilisateur authentifié n'appartenant à AUCUN
groupe). Puisque le trigger PostConfirmation (ADR-0008) ajoute systématiquement
chaque utilisateur confirmé à `Veterinarians` ou `Owners`, le rôle générique n'est en
pratique jamais utilisé une fois authentifié dans cette application -- accorder la
policy Geo uniquement à `authenticatedUserIamRole` la rendait donc inopérante pour
TOUT utilisateur authentifié réel.

Corrigé : `geoAccessPolicy` attachée en plus aux deux rôles de groupe
(`backend.auth.resources.groups['Veterinarians'].role`,
`backend.auth.resources.groups['Owners'].role`). Le rôle générique et le rôle
non-authentifié restent accordés (défense en profondeur / formulaires
d'inscription pré-authentification, section 3).

## Relation avec le reste des ADR

Amende la **forme** d'ADR-0012 (Geo reste un échappatoire CDK dans `amplify/
backend.ts`, même famille de pattern que la mutation custom conditionnelle
(ADR-0011) et la politique de mot de passe (ADR-0008)) sans changer son
raisonnement de fond -- ADR-0012 n'est pas marqué "superseded" : ses sections 1
(pas de `defineGeo()` Gen2), 3 (accès invité) et 4 (pas de `CfnMap`) restent
valides telles quelles. Seule sa section 2 (`new CfnPlaceIndex(...)`) est
remplacée par la section 2 de cet ADR. Même logique que la relation ADR-0004/
ADR-0006 déjà présente dans ce repo : un ADR ultérieur peut corriger la forme
d'un ADR antérieur sans que celui-ci devienne caduc dans son ensemble.
