import { defineBackend } from '@aws-amplify/backend'
import { auth } from './auth/resource'
import { postConfirmation } from './functions/post-confirmation/resource'

/**
 * Phase 8, sous-tâche 3 (migration Gen1 -> Gen2) : Cognito + Lambda
 * PostConfirmation seulement. `data` (defineData, sous-tâche 4) est
 * volontairement absent de cet objet -- `defineBackend` ne l'exige pas
 * (les constructs passés ici sont un simple regroupement de "backend
 * resources", pas un tuple figé) et ajouter un schéma de données factice
 * juste pour faire nombre aurait été plus de code à réécrire/jeter à la
 * sous-tâche suivante qu'à en laisser l'absence.
 */
const backend = defineBackend({
  auth,
  postConfirmation,
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
