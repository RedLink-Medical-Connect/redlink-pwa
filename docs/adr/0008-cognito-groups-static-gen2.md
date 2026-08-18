---
status: accepted
supersedes: none (voir "Relation avec le comportement Gen1" ci-dessous)
---

# `defineAuth` Gen2 : groupes statiques + parité de la politique de mot de passe avec Gen1

Deux décisions distinctes mais portées par la même ressource (`amplify/auth/resource.ts`
/ `amplify/backend.ts`), documentées dans un seul ADR plutôt que d'en ouvrir un second :
la création statique des groupes Cognito (supersède le pattern Gen1 de
`add-to-group.js`) et la reproduction à l'identique de la politique de mot de passe
Gen1 via un échappatoire CDK.

## Contexte Gen1

`amplify/backend/auth/redlinkpwa056b43b0056b43b0/cli-inputs.json` déclare
`"userPoolGroups": false` / `"userPoolGroupList": []` : en Gen1, ce projet n'a **jamais**
déclaré les groupes `Veterinarians`/`Owners` de façon statique dans la ressource auth.
Ils étaient créés paresseusement, à la volée, par le trigger PostConfirmation
lui-même (`add-to-group.js`) au tout premier signup de chaque profil, sur chaque
nouvel environnement Amplify (`amplify env add`) :

1. `GetGroupCommand` pour vérifier si le groupe existe déjà.
2. Si absent, `CreateGroupCommand`.
3. `AdminAddUserToGroupCommand` pour rattacher l'utilisateur.

Cette création paresseuse ouvrait une fenêtre de course documentée et corrigée en
Phase 7.3 (R-04, `docs/audit/BACKLOG.md`) : deux signups quasi simultanés sur un
environnement neuf pouvaient tous les deux échouer `GetGroupCommand` ("not found") puis
tenter `CreateGroupCommand` — un seul gagnant, l'autre recevant `GroupExistsException`,
traité comme bénin (retry de l'ajout au groupe) plutôt que comme une vraie erreur.

## Décision Gen2

`amplify/auth/resource.ts` déclare `groups: ['Veterinarians', 'Owners']` dans
`defineAuth(...)`. Les deux groupes Cognito sont donc créés de façon **déterministe,
au déploiement** de l'environnement (CloudFormation/CDK), avant qu'aucun signup ne
puisse avoir lieu. Toute la logique `GetGroupCommand`/`CreateGroupCommand`/gestion de
`GroupExistsException` du handler Gen1 devient un résidu sans objet : le nouveau
handler (`amplify/functions/post-confirmation/handler.ts`) ne fait plus qu'un
`AdminAddUserToGroupCommand` direct, sans vérification d'existence préalable.

Conséquences :

- Policy IAM de la Lambda encore plus restreinte qu'en Gen1 : une seule action
  (`cognito-idp:AdminAddUserToGroup`), toujours scopée au seul user pool de cet
  environnement (`backend.auth.resources.userPool.userPoolArn`, pas de wildcard) —
  `GetGroup`/`CreateGroup` disparaissent entièrement du besoin fonctionnel de cette
  fonction.
- Le comportement fail-loud (rethrow si `AdminAddUserToGroupCommand` échoue, pas de
  `console.error` silencieux) est conservé à l'identique — c'est un choix orthogonal à
  la création statique des groupes, toujours valable : un utilisateur CONFIRMED sans
  groupe doit rester visible en erreur (CloudWatch + erreur remontée au client), pas
  silencieux (Phase 7.3, raisonnement inchangé).
- Le test unitaire correspondant (`handler.test.ts`) n'a donc plus besoin de couvrir
  la fenêtre de course `GroupExistsException` ni la création paresseuse — ces cas
  n'existent structurellement plus côté Gen2. Seuls restent : mapping profil → groupe,
  no-op sur profil non reconnu, propagation de l'échec `AdminAddUserToGroupCommand`.

## Politique de mot de passe

### Contexte Gen1

`amplify/backend/auth/redlinkpwa056b43b0056b43b0/cli-inputs.json` → `cognitoConfig`
déclare explicitement :

- `passwordPolicyMinLength: 8`
- `passwordPolicyCharacters: []` (aucune exigence de casse/chiffre/symbole)
- `defaultPasswordPolicy: false` (donc explicitement **pas** la policy par défaut de
  Cognito, qui exige majuscule/minuscule/chiffre/symbole)

Côté frontend, `src/composables/usePassword.js` ne valide que
`password.length >= 8` — cohérent avec cette policy Gen1 permissive, mais pas avec le
défaut CDK d'un `CfnUserPool` généré sans `policies` explicite (majuscule + minuscule +
chiffre + symbole requis en plus de la longueur). Sans intervention, un mot de passe
jugé valide côté frontend (ex. `password1234`) serait rejeté par Cognito une fois
basculé sur Gen2 — un mot de passe qui passait la validation front échouerait à l'appel
`signUp()`, avec un message d'erreur Cognito générique que `usePassword.js` ne
traduit/anticipe pas.

### Décision Gen2

`amplify/backend.ts` accède à l'échappatoire CDK sur le `CfnUserPool` L1 généré par
`defineAuth` (`backend.auth.resources.cfnResources.cfnUserPool`, type `CfnUserPool` de
`aws-cdk-lib/aws-cognito` — confirmé via les types installés dans
`node_modules/@aws-amplify/plugin-types/lib/auth_resources.d.ts` et
`node_modules/aws-cdk-lib/aws-cognito/lib/cognito.generated.d.ts`, `defineAuth` n'expose
pas ce réglage de façon déclarative) pour réassigner `policies.passwordPolicy` à
l'identique de Gen1 : longueur minimale 8, aucune exigence de casse/chiffre/symbole.

**Ce n'est pas une régression de sécurité volontaire, ni une réouverture du sujet dans
cette phase de migration** : c'est la reproduction exacte d'un choix déjà fait et déjà
en production côté Gen1, pour rester cohérent avec `usePassword.js` sans avoir à
retoucher le composable (hors périmètre de cette sous-tâche — la migration des
composables est la sous-tâche 5). Si la politique de mot de passe doit un jour être
durcie, ça doit être une décision produit explicite (mise à jour concertée du
composable ET de cette policy), pas un effet de bord non maîtrisé de la migration
Gen1 → Gen2.

## Relation avec le reste des ADR

Comme ADR-0004/ADR-0006 : ce nouvel ADR ne modifie pas de décision Gen1 antérieure (il
n'existait pas d'ADR dédié au pattern paresseux Gen1 — seulement un commentaire de code
et l'item R-04 du backlog d'audit), il documente le remplacement de ce pattern par son
équivalent Gen2, structurellement plus simple parce que la plateforme elle-même
supprime la condition qui rendait la gestion de course nécessaire.
