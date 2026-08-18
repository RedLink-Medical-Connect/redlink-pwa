import { defineAuth } from '@aws-amplify/backend'
import { postConfirmation } from '../functions/post-confirmation/resource'

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
  groups: ['Veterinarians', 'Owners'],
  triggers: {
    postConfirmation,
  },
})
