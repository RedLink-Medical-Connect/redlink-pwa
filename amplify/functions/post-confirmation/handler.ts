import type { PostConfirmationTriggerHandler } from 'aws-lambda'
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider'

const client = new CognitoIdentityProviderClient()

// Mapping repris tel quel du handler Gen1
// (amplify/backend/function/redlinkpwa056b43b0056b43b0PostConfirmation/src/add-to-group.js) :
// 'vet' -> Veterinarians, 'owner' -> Owners, toute autre valeur (ou absente) -> no-op.
const PROFILE_TO_GROUP: Record<string, string> = {
  vet: 'Veterinarians',
  owner: 'Owners',
}

/**
 * Trigger Cognito PostConfirmation (Gen2). Remplace
 * `add-to-group.js` (Gen1) — voir ADR-0008 pour le détail de ce qui change.
 *
 * Simplification volontaire par rapport à Gen1 : plus de `GetGroupCommand`/
 * `CreateGroupCommand`/gestion de `GroupExistsException`. En Gen1 les groupes
 * n'étaient pas déclarés statiquement (cli-inputs.json de la ressource auth
 * avait `userPoolGroups: false`) et étaient créés paresseusement au premier
 * signup, avec une fenêtre de course entre deux signups quasi simultanés
 * (Phase 7.3, R-04). En Gen2, `defineAuth({ groups: [...] })`
 * (`amplify/auth/resource.ts`) crée les deux groupes de façon déterministe au
 * déploiement, avant qu'aucun signup ne puisse avoir lieu -- cette classe de
 * bug n'existe donc plus structurellement, pas seulement corrigée.
 *
 * Comportement fail-loud conservé à l'identique (Phase 7.3, toujours valable
 * en Gen2) : si `AdminAddUserToGroupCommand` échoue, on relance l'erreur au
 * lieu de l'avaler dans un simple `console.error`. PostConfirmation est
 * invoqué de façon synchrone par Cognito APRÈS que l'utilisateur soit passé
 * CONFIRMED : un throw ici ne défait pas cette confirmation, mais fait
 * échouer l'appel ConfirmSignUp/AdminConfirmSignUp côté client (erreur
 * remontée à l'appelant) et apparaît comme une erreur d'invocation Lambda
 * dans CloudWatch/Amplify -- donc monitorable, plutôt qu'un utilisateur
 * CONFIRMED mais silencieusement sans groupe (donc sans autorisation
 * fonctionnelle).
 *
 * Attribut `profile` : en Gen1, le handler lisait `custom:profile` en
 * priorité avec repli sur `profile` "par prudence", faute de certitude sur la
 * forme exacte de l'attribut au moment où ce code a été écrit. Vérifié pour
 * cette migration : le template CloudFormation généré du user pool Gen1
 * (`amplify/backend/auth/.../build/*-cloudformation-template.json`) ne
 * déclare JAMAIS `custom:profile` dans le `Schema` du user pool (seul `email`
 * y figure, comme attribut requis) -- si `profile` avait été un attribut
 * personnalisé, Amplify CLI aurait nécessairement dû l'y déclarer avec le
 * préfixe `custom:`. `profile` est donc bien l'attribut standard Cognito
 * (claim OIDC "profile"), jamais un attribut personnalisé -- on ne garde que
 * cette forme ici, sans repli.
 */
export const handler: PostConfirmationTriggerHandler = async (event) => {
  const profile = event.request.userAttributes.profile
  const groupName = profile ? PROFILE_TO_GROUP[profile] : undefined

  if (!groupName) {
    console.log(`Aucun profil valide ('vet' ou 'owner') trouvé pour cet utilisateur : ${profile}`)
    return event
  }

  try {
    await client.send(
      new AdminAddUserToGroupCommand({
        GroupName: groupName,
        UserPoolId: event.userPoolId,
        Username: event.userName,
      }),
    )
    console.log(`Utilisateur ajouté au groupe ${groupName}`)
  } catch (error) {
    console.error(`Erreur lors de l'ajout de l'utilisateur au groupe ${groupName} :`, error)
    throw error
  }

  return event
}
