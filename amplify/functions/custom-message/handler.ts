import type { CustomMessageTriggerHandler } from 'aws-lambda'
import { renderVerificationEmail } from './templates/verification-email'
import { renderForgotPasswordEmail } from './templates/forgot-password-email'
import { renderInviteVeterinarianEmail } from './templates/invite-veterinarian-email'

/**
 * Trigger Cognito `CustomMessage` -- voir docs/adr/0022-branded-transactional-emails.md.
 * QUATRIÈME trigger Lambda du projet, après `post-confirmation/` (ADR-0008),
 * `mission-validation-auto-finalizer/` (ADR-0016) et `rating-aggregation/` (ADR-0017) --
 * référencé depuis `amplify/auth/resource.ts` comme `post-confirmation`, même famille de
 * pattern (aucune dépendance à `data`, donc pas de `resourceGroupName` nécessaire -- voir le
 * critère complet dans CLAUDE.md).
 *
 * `event.request.codeParameter` est le placeholder `{####}` déjà résolu par Cognito au code
 * réel -- rien à faire ici pour le générer, seulement l'insérer dans le template.
 * `event.request.clientMetadata?.locale` vient de `ClientMetadata` posé par le BFF
 * (`amplify/functions/bff/auth-routes.ts`) sur `SignUpCommand`/`ResendConfirmationCodeCommand`/
 * `ForgotPasswordCommand` -- une valeur absente ou invalide se résout sur `fr` par défaut
 * (`resolveEmailLocale`, `i18n/messages.ts`), jamais ici : ce handler reste un simple
 * dispatcher, la résolution de repli vit à un seul endroit.
 *
 * `CustomMessage_SignUp` et `CustomMessage_ResendCode` partagent le même email (même geste
 * utilisateur du point de vue produit : confirmer son adresse).
 *
 * `CustomMessage_AdminCreateUser` (invitation d'un vétérinaire par le référent de sa clinique,
 * `amplify/functions/bff/clinic-routes.ts`) : `codeParameter` porte ici le MOT DE PASSE
 * TEMPORAIRE généré par `AdminCreateUserCommand` (pas un code à 6 chiffres) --
 * `renderInviteVeterinarianEmail` réutilise `renderCodeBlock` telle quelle, Cognito résout le
 * placeholder de la même façon quel que soit son contenu réel. `usernameParameter` porte
 * l'identifiant de connexion (l'email, `Username` posé explicitement sur `AdminCreateUserCommand`).
 *
 * Les autres `triggerSource` possibles (`UpdateUserAttribute`, `VerifyUserAttribute`,
 * `Authentication`) ne sont déclenchés par aucun flux applicatif de ce repo aujourd'hui --
 * `event` traverse inchangé, Cognito applique alors son template par défaut plutôt qu'un
 * design à moitié fini pour un cas qui ne peut pas se produire.
 */
export const handler: CustomMessageTriggerHandler = async (event) => {
  const locale = event.request.clientMetadata?.locale
  const code = event.request.codeParameter

  switch (event.triggerSource) {
    case 'CustomMessage_SignUp':
    case 'CustomMessage_ResendCode': {
      const { subject, html } = renderVerificationEmail({ code, locale })
      event.response.emailSubject = subject
      event.response.emailMessage = html
      break
    }
    case 'CustomMessage_ForgotPassword': {
      const { subject, html } = renderForgotPasswordEmail({ code, locale })
      event.response.emailSubject = subject
      event.response.emailMessage = html
      break
    }
    case 'CustomMessage_AdminCreateUser': {
      const username = event.request.usernameParameter ?? event.userName
      const { subject, html } = renderInviteVeterinarianEmail({ code, username, locale })
      event.response.emailSubject = subject
      event.response.emailMessage = html
      break
    }
    default:
      break
  }

  return event
}
