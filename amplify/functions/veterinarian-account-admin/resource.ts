import { defineFunction } from '@aws-amplify/backend'

/**
 * Opérations Cognito Admin (`AdminCreateUser`/`AdminAddUserToGroup`/`AdminDeleteUser`) pour
 * l'invitation d'un vétérinaire par le référent de sa clinique -- voir
 * `amplify/functions/bff/clinic-routes.ts` (qui invoque cette fonction via `InvokeCommand`,
 * jamais directement) pour le "pourquoi" de cette séparation en DEUX Lambdas.
 *
 * Pas de `resourceGroupName` explicite : rejoint la stack "function" partagée par défaut avec
 * `post-confirmation`/`custom-message`, comme elles. Nécessaire pour obtenir ses permissions
 * IAM via l'`access` déclaratif de `defineAuth` (`amplify/auth/resource.ts`) -- SEULE façon
 * confirmée de ne PAS casser le déploiement du User Pool (`ampx sandbox` réel, 2026-09-13,
 * `[DeploymentError] ... Invalid AttributeDataType input`, obtenu en référençant
 * `userPool.userPoolArn` depuis un Lambda de la stack `data` via `addToRolePolicy` dans
 * `backend.ts` -- toute référence croisée de stack vers `CfnUserPool` semble faire ressortir un
 * bug de sérialisation de son schéma d'attributs). `access()` exige que ce Lambda vive dans la
 * MÊME direction de dépendance que `post-confirmation` (`auth -> function`, déjà établie) --
 * PAS dans la stack `data` (où vit `bff`) : `data -> auth` existe déjà (mode d'authentification
 * AppSync + `COGNITO_USER_POOL_CLIENT_ID`), donc un `access()` ciblant un Lambda de la stack
 * `data` fermerait le cycle `auth -> data -> auth`
 * (`CloudformationStackCircularDependencyError`, confirmé lui aussi par un vrai `ampx sandbox`,
 * 2026-09-13). D'où cette DEUXIÈME Lambda, dans la stack "function" (aucune dépendance
 * `function -> data`/`function -> auth` en sens inverse), plutôt que de simplement déplacer le
 * grant Cognito de `bff` -- `bff` reste dans `data` pour ses propres besoins (accès DynamoDB
 * direct sur `Veterinarian`/`Clinic`, relais GraphQL/AppSync), il invoque juste celle-ci pour la
 * partie Cognito Admin.
 *
 * `userPoolId` n'est PAS une variable d'environnement ici non plus (même piège que ci-dessus,
 * dans l'autre sens : `function -> auth` serait tout aussi neuf) -- transmis par `bff` dans le
 * payload de l'invocation, lui-même déduit du token d'accès de l'appelant (voir
 * `clinic-routes.ts`).
 */
export const veterinarianAccountAdmin = defineFunction({
  name: 'veterinarian-account-admin',
  entry: './handler.ts',
  timeoutSeconds: 10,
})
