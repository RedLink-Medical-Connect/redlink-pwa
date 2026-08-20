import { defineBackend } from '@aws-amplify/backend'
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

export default backend
