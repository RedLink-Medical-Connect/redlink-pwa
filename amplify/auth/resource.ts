import { defineAuth } from '@aws-amplify/backend'
import { postConfirmation } from '../functions/post-confirmation/resource'
import { customMessage } from '../functions/custom-message/resource'
import { veterinarianAccountAdmin } from '../functions/veterinarian-account-admin/resource'

/**
 * Migration Gen1 -> Gen2 de la ressource Cognito (Phase 8, sous-tâche 3).
 * Reprend `amplify/backend/auth/redlinkpwa056b43b0056b43b0/cli-inputs.json` :
 * login par email (`usernameAttributes: ["email"]`, `autoVerifiedAttributes:
 * ["email"]`, `requiredAttributes: ["email"]` en Gen1), attributs `name`/
 * `profile` en lecture/écriture côté client
 * (`userpoolClientWriteAttributes`/`userpoolClientReadAttributes`), groupes
 * `Veterinarians`/`Owners`, trigger PostConfirmation.
 *
 * Décision (judgment call, à faire confirmer par le Lead Dev / une vraie
 * vérification `ampx sandbox` avant tout déploiement -- non vérifiable via
 * `context7` dans cette session, l'outil n'était pas disponible) : la clé
 * `profilePage` ci-dessous est le nom que `@aws-amplify/backend` donne à
 * l'attribut Cognito standard `profile` (le claim OIDC "profile", PAS un
 * attribut personnalisé) -- ce mapping de nom vient de
 * `aws-cdk-lib/aws-cognito` `StandardAttributes` (`profilePage` ->
 * `profile`), sur lequel `@aws-amplify/backend` s'appuie. Confirmé
 * indépendamment côté Gen1 : le template CloudFormation généré du user pool
 * ne déclare jamais `custom:profile` dans son `Schema` (seul `email` y
 * figure) -- si c'était un attribut personnalisé, Amplify CLI l'y aurait
 * nécessairement déclaré avec le préfixe `custom:`. On écarte donc
 * volontairement le repli "attribut custom explicite" évoqué dans la
 * consigne de cette sous-tâche : il aurait été un mauvais choix ici (créer un
 * VRAI attribut personnalisé sur un pool où l'attribut a toujours été
 * standard). `npx tsc --noEmit` valide que `profilePage` est une clé connue
 * du type `userAttributes` de la version installée de `@aws-amplify/backend`
 * -- s'il devait s'avérer que la doc officielle Gen2 utilise un autre nom au
 * moment du premier `ampx sandbox`, c'est une correction locale d'une seule
 * ligne, pas une remise en cause de l'attribut lui-même.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  userAttributes: {
    fullname: {
      mutable: true,
      required: false,
    },
    profilePage: {
      mutable: true,
      required: false,
    },
  },
  // 'Admins' (2026-08-26, double validation de Mission + notation) : ferme le gap
  // préexistant documenté par docs/adr/0010 section 3 ("groupe Cognito Admins jamais
  // provisionné par l'IaC, ni en Gen1 ni ici") -- `Mission`/`Veterinarian`/`Rating`
  // référencent déjà `allow.group('Admins')` côté `amplify/data/resource.ts` (lecture
  // seule pour Mission/Rating, lecture+suppression pour Veterinarian, ce dernier
  // préexistant). Provisioning MANUEL d'un utilisateur dans ce groupe reste hors
  // périmètre (pas d'assignation automatique à l'inscription) -- l'interface admin de
  // résolution des Missions DISPUTED n'est pas construite dans cette sous-tâche non
  // plus (voir amplify/data/resource.ts, section Mission).
  groups: ['Veterinarians', 'Owners', 'Admins'],
  // Durcissement sécurité (audit Cognito/API, 2026-09-02, Groupe 4) : MFA TOTP
  // disponible pour tous les rôles, jamais imposé (`mode: 'OPTIONAL'`, scope
  // confirmé -- pas de garde de navigation ni de blocage dashboard côté frontend).
  // `sms: false` : pas d'expéditeur SNS configuré dans ce projet, TOTP seul suffit
  // (`MFATotpSettings` est un simple booléen, confirmé via `@aws-amplify/backend`
  // -- pas de config supplémentaire nécessaire côté `defineAuth`).
  multifactor: {
    mode: 'OPTIONAL',
    totp: true,
    sms: false,
  },
  // `customMessage` (2026-09-12, docs/adr/0022-branded-transactional-emails.md) : email de
  // marque + i18n pour le code de confirmation et le mot de passe oublié, à la place du
  // template texte brut par défaut de Cognito.
  triggers: {
    postConfirmation,
    customMessage,
  },
  // Revue Lead Dev (cycle Phase 8 sous-tâche 3) : préférer l'API déclarative `access`
  // de defineAuth à l'échappatoire CDK manuel (`addToRolePolicy` dans backend.ts, tel
  // qu'initialement écrit) -- même scope obtenu (une seule action IAM,
  // `cognito-idp:AdminAddUserToGroup`, une seule ressource, ce user pool, jamais de
  // wildcard : voir ADR-0008, section "Groupes attitrés", pour la vérification faite
  // dans `UserPoolAccessPolicyFactory`/`iamActionMap` de `@aws-amplify/backend-auth`).
  // Pas un correctif de sécurité -- le scope manuel était déjà correct -- mais le
  // chemin le plus documenté/éprouvé du framework (même raisonnement que ADR-0007 sur
  // le fait de rester sur le chemin battu pendant une migration déjà risquée).
  //
  // `allow.resource(veterinarianAccountAdmin).to(['createUser', 'addUserToGroup', 'deleteUser'])`
  // (invitation d'un vétérinaire par le référent de sa clinique) : DEUX approches essayées et
  // rejetées avant celle-ci, chacune confirmée en échec par un vrai `ampx sandbox` (2026-09-13) :
  // 1. `addToRolePolicy` manuel dans `backend.ts`, référençant `userPool.userPoolArn`/
  //    `.userPoolId` depuis le Lambda `bff` (stack `data`, `resourceGroupName: 'data'`) --
  //    `[DeploymentError] ... amplifyAuthUserPool ... Invalid AttributeDataType input`. La
  //    moindre référence croisée de stack vers une propriété de `CfnUserPool` (même un simple
  //    `Ref`/`GetAtt`, jamais vers son `Schema`/`userAttributes` eux-mêmes) force apparemment
  //    CloudFormation à retraiter ce UserPool pour la première fois depuis sa création (jamais
  //    mis à jour jusque-là), faisant ressortir un bug de sérialisation de son schéma
  //    d'attributs (`fullname`/`profilePage` ci-dessus) côté CDK/Amplify -- confirmé en retirant
  //    ce bloc précis (redéploiement immédiatement réussi).
  // 2. `access(allow => [allow.resource(bff).to([...])])` ICI, ciblant `bff` DIRECTEMENT (stack
  //    `data`) -- `CloudformationStackCircularDependencyError` entre les stacks `auth`/`data`
  //    (et `wafstack`/`geostack`, entraînées dans le même groupe de nested stacks) : `data`
  //    référence déjà `auth` (mode d'authentification AppSync + `COGNITO_USER_POOL_CLIENT_ID`
  //    sur `bff`) -- ajouter `auth -> data` (le RÔLE de `bff`, importé pour lui attacher la
  //    policy) ferme le cycle `auth -> data -> auth`.
  // La solution : une DEUXIÈME Lambda dédiée, `veterinarianAccountAdmin`
  // (`amplify/functions/veterinarian-account-admin/`), SANS `resourceGroupName` -- rejoint la
  // même stack "function" que `postConfirmation`/`customMessage`, direction déjà établie
  // (`auth -> function`, pour enregistrer les triggers), jamais `function -> data`/
  // `function -> auth` en sens inverse. `bff` reste dans `data` pour ses propres besoins (accès
  // DynamoDB direct, relais GraphQL) et invoque celle-ci via `InvokeCommand`
  // (`amplify/functions/bff/clinic-routes.ts`) pour la seule partie Cognito Admin -- la policy
  // IAM ci-dessous est créée EN LOCAL dans la stack `auth` (référence locale à `userPoolArn`,
  // aucun `Output` cross-stack sur `CfnUserPool` lui-même), seule la référence au RÔLE de
  // `veterinarianAccountAdmin` traverse les stacks, dans la MÊME direction que celle déjà
  // établie pour `postConfirmation` juste au-dessus -- pas une nouvelle.
  //
  // Post-mortem (2026-09-13) : les deux échecs ci-dessus se sont avérés être de la DÉRIVE
  // CLOUDFORMATION accumulée sur le sandbox de dev (jamais mis à jour depuis sa création,
  // des mois plus tôt) -- vérifié après un `ampx sandbox delete` + `ampx sandbox` (sandbox
  // neuf) : la policy `access()` ci-dessous s'est correctement attachée dès ce déploiement
  // propre (confirmé par une lecture IAM directe). La séparation en deux Lambdas reste la
  // bonne architecture (elle évite un vrai risque de cycle `auth -> data -> auth`, indépendant
  // de la dérive), mais `userPoolId` est bien une variable d'environnement normale
  // (`COGNITO_USER_POOL_ID`, `amplify/backend.ts`) sur `bff` -- le contournement par décodage
  // de JWT, temporaire, a été retiré.
  access: (allow) => [
    allow.resource(postConfirmation).to(['addUserToGroup']),
    allow.resource(veterinarianAccountAdmin).to(['createUser', 'addUserToGroup', 'deleteUser']),
  ],
})
