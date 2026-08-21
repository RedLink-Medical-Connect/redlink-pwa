---
status: accepted
supersedes: none (voir "Relation avec le reste des ADR" ci-dessous)
---

# `amplify/backend.ts` : Geo (Amazon Location Service place index) via l'échappatoire CDK, Gen2

Prérequis découvert tardivement, hors périmètre de toute sous-tâche planifiée de la
Phase 8 : une revue Lead Dev finale (juste avant l'ouverture de la PR de migration)
a trouvé que le nettoyage Gen1 (`dc55236`, sous-tâche 6) a supprimé
`amplify/backend/geo/placeIndex/` (Amplify Geo/Location Service Gen1) sans jamais lui
donner d'équivalent Gen2 -- aucune des 6 sous-tâches planifiées de la Phase 8 ne
mentionnait Geo. Or `src/components/common/AddressAutocomplete.vue`
(`Geo.searchByText(...)`, `@aws-amplify/geo`) est un composant partagé actif, utilisé
par `RegisterOwnerView.vue`/`RegisterClinicView.vue` (inscription) et les vues de
profil pour saisir une adresse et en dériver `latitude`/`longitude` -- des champs
consommés directement par `eligibility-service.js` (critère de proximité
géographique). Sans cette ressource, l'autocomplétion d'adresse serait cassée sur
tout le backend Gen2, sans qu'aucun composable ni test existant ne le détecte (aucun
test ne couvre `AddressAutocomplete.vue`, cf. `CLAUDE.md` -- un seul test de
composant `.vue` dans tout le repo, et ce n'est pas celui-ci).

Le repo owner a tranché : migrer Geo vers Gen2 maintenant, avant l'ouverture de la
PR, plutôt que de la traiter comme un ticket de suivi séparé -- la Phase 8 n'est pas
considérée terminée tant qu'un composant partagé actif dépend d'une ressource
supprimée sans remplacement.

## 1. Pas de première-classe Gen2 pour Geo -- échappatoire CDK

Contrairement à `auth`/`data`, `@aws-amplify/backend` n'expose aucun `defineGeo()`.
Confirmé via `context7` (`/aws-amplify/docs`, page "Setup Location Search Index with
Amplify Geo") : le chemin documenté officiel est l'échappatoire CDK dans
`amplify/backend.ts`, même famille de pattern que la mutation custom conditionnelle
(ADR-0011) et la politique de mot de passe (ADR-0008) -- une ressource AWS qui
n'a pas d'équivalent déclaratif dans `defineAuth`/`defineData` se construit
directement en CDK sur la `Backend` retournée par `defineBackend()`.

Trois pièces, toutes dans `amplify/backend.ts` :

1. `backend.createStack('geo-stack')` -- une stack CDK dédiée, séparée des stacks
   `auth`/`data` générées par le framework (pattern déjà utilisé implicitement par
   `defineAuth`/`defineData` elles-mêmes ; `createStack` est la méthode de premier
   niveau que `BackendBase` expose pour ce cas).
2. `new CfnPlaceIndex(geoStack, 'PlaceIndex', {...})` (`aws-cdk-lib/aws-location`)
   pour la ressource elle-même, plus une `Policy`/`PolicyStatement`
   (`aws-cdk-lib/aws-iam`) accordant les 4 actions `geo:*` nécessaires, attachée
   aux deux rôles IAM générés par `defineAuth`
   (`backend.auth.resources.authenticatedUserIamRole` ET
   `unauthenticatedUserIamRole` -- voir section 3 sur pourquoi les deux).
3. `backend.addOutput({ geo: {...} })` -- expose l'index dans `amplify_outputs.json`
   généré au déploiement, seul moyen pour `Geo.searchByText()` côté frontend
   (`@aws-amplify/geo`, via `Amplify.configure(outputs)` dans `src/main.js`) de le
   trouver.

## 2. Config reproduite à l'identique de Gen1

Récupérée depuis l'historique git (`amplify/backend/geo/placeIndex/parameters.json`
et `placeIndex-cloudformation-template.json` à `dc55236~1`, avant leur suppression) :

- `indexName: "placeIndex"`.
- `dataSource: "Here"` -- le prop CDK du `CfnPlaceIndex` L1
  (`aws-cdk-lib/aws-location`, vérifié en lisant les types installés,
  `node_modules/aws-cdk-lib/aws-location/lib/location.generated.d.ts`) s'appelle
  bien `dataSource`, pas `dataProvider` malgré le nom du paramètre CLI Gen1
  (`parameters.json` déclarait `"dataProvider": "Here"` -- un nom propre à
  l'ancien tooling CLI Gen1, pas au CDK L1 sous-jacent).
- `dataSourceConfiguration: { intendedUse: "SingleUse" }`.
- `pricingPlan: "RequestBasedUsage"` -- reproduit par souci de parité malgré le
  commentaire du type CDK ("No longer used. If included, the only allowed value is
  `RequestBasedUsage`") : l'API AWS a cessé de facturer par plan mais accepte
  encore le champ, avec cette unique valeur possible.
- 4 actions IAM, ni plus ni moins, extraites du template CloudFormation Gen1 supprimé
  (`git show dc55236~1:amplify/backend/geo/placeIndex/placeIndex-cloudformation-template.json`) :
  `geo:SearchPlaceIndexForPosition`, `geo:SearchPlaceIndexForText`,
  `geo:SearchPlaceIndexForSuggestions`, `geo:GetPlace` -- scopées à l'ARN de cet
  index précis (`placeIndex.attrArn`), jamais de wildcard. C'est le seul
  sous-ensemble réellement utilisé : `AddressAutocomplete.vue` n'appelle que
  `Geo.searchByText()` (confirmé -- seul fichier du repo qui importe
  `@aws-amplify/geo`), mais le template Gen1 accordait déjà ces 4 actions
  ensemble (pas seulement `SearchPlaceIndexForText`), donc reproduites à
  l'identique plutôt que réduites unilatéralement à une seule -- une réduction du
  scope IAM par rapport à Gen1 serait une décision de sécurité distincte, hors
  périmètre de cette migration à comportement observable identique.

## 3. Accès accordé aux deux rôles IAM (authentifié ET non-authentifié)

Point vérifié, pas supposé : le Gen1 `parameters.json` référence à la fois
`authRoleName` ET `unauthRoleName`, et le template CloudFormation Gen1 confirmé plus
haut liste les deux rôles (`Roles: [{ Ref: authRoleName }, { Ref: unauthRoleName }]`)
sur la même policy IAM -- l'accès Gen1 était donc accordé aux deux, pas seulement à
l'utilisateur authentifié.

C'est structurellement nécessaire : `AddressAutocomplete.vue` est utilisé dans
`RegisterOwnerView.vue`/`RegisterClinicView.vue`, des formulaires remplis **avant**
que l'utilisateur ait un compte Cognito confirmé (donc non-authentifié au sens
Identity Pool au moment de la saisie). Sans la policy sur le rôle non-authentifié,
l'autocomplétion resterait cassée précisément sur ces deux vues, même une fois le
reste de la migration Geo posé -- une régression discrète (aucune erreur bloquante
visible ailleurs dans l'app, juste des suggestions d'adresse vides pendant
l'inscription).

Conséquence vérifiée côté `defineAuth` : l'Identity Pool généré par `defineAuth` a
`allowUnauthenticatedIdentities: true` par défaut (confirmé via `context7`,
`/aws-amplify/docs`, page "Disable Guest Access" -- il faut explicitement le
désactiver via `cfnIdentityPool.allowUnauthenticatedIdentities = false` pour le
retirer, jamais l'inverse). `amplify/auth/resource.ts` (sous-tâche 3, ADR-0008) ne
contient aucun override qui désactiverait cet accès invité -- ce point avait été
noté "non reproduit, pas de dépendance fonctionnelle trouvée" par le Senior Dev de
la sous-tâche 3, un jugement raisonnable à l'époque puisque cette dépendance Geo
n'était pas encore identifiée. Il s'avère qu'il n'y avait en réalité **rien à
faire** : le défaut Gen2 couvre déjà ce besoin, sans qu'aucune action ne soit
nécessaire dans `amplify/auth/resource.ts`. Ce point est donc refermé ici plutôt que
laissé flottant entre deux ADR.

## 4. Ce qui n'a pas été fait, volontairement

- Pas de `CfnMap`/support carte dans `backend.addOutput` : `AddressAutocomplete.vue`
  n'utilise que `Geo.searchByText()`, jamais de composant carte. La dépendance
  `maplibre-gl-js-amplify` présente dans `package.json` semble inutilisée -- non
  investiguée ici, hors périmètre de cet ADR (signalée pour un futur audit de
  dépendances, pas un constat nouveau de cette migration).
- Aucune modification de `amplify/auth/resource.ts` : la vérification de la section
  3 n'a rien trouvé à corriger.
- Aucune modification de composable/composant : `AddressAutocomplete.vue` consomme
  déjà `Geo.searchByText()` sans changement de code nécessaire, une fois
  `amplify_outputs.json` correctement peuplé par un vrai déploiement (`ampx
  sandbox`, action du repo owner, aucun agent ne déploie).
- Pas de test Vitest dédié à `amplify/backend.ts` : même choix que pour
  `amplify/auth/resource.ts`/`amplify/data/resource.ts` (ADR-0008/ADR-0009/ADR-0010)
  -- construction déclarative CDK, vérifiable uniquement par `tsc --noEmit` (types)
  ou un vrai déploiement (comportement runtime), pas par une fonction pure
  testable en isolation. `resource.transform.test.ts` (schéma `defineData`) n'a pas
  d'équivalent pour Geo : il n'y a pas de `.transform()`/SDL compilé à pin-tester
  ici, seulement des props CDK directement lisibles dans le fichier.

## Relation avec le reste des ADR

Comme ADR-0009/ADR-0010/ADR-0011 : cet ADR ne modifie aucune décision de fond
préexistante (Geo n'avait pas d'ADR dédié en Gen1 -- seulement la ressource
`amplify/backend/geo/placeIndex/` elle-même, gérée par le tooling CLI). Il
documente la reconstruction Gen2 d'une ressource dont le nettoyage Gen1 avait
supprimé l'infrastructure sans que la migration applicative ne l'ait anticipée --
un vrai trou de planification de la Phase 8, pas une simplification assumée
(contrairement aux items explicitement hors périmètre V1, ex. Stripe/push/QR).
Referme aussi, au passage, le point `allowUnauthenticatedIdentities` laissé ouvert
par la sous-tâche 3/ADR-0008 (section 3 ci-dessus).
