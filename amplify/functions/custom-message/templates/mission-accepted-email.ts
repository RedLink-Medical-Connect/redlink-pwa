import { renderLayout } from './layout'
import { escapeHtml } from './email-helpers'

/**
 * Email PERSONNEL (Clinic, vétérinaire référent) -- système de notifications, 2026-09-18.
 * Envoyé par la Lambda `mission-notifier` (flux DynamoDB Streams sur `INSERT` de `Mission` --
 * un Owner vient d'accepter la Request de la clinique, `useOwnerMissions.acceptMission()`).
 * Même patron que les autres templates de ce dossier : `renderLayout()`, locale FR en dur,
 * `escapeHtml()` sur tout contenu utilisateur (`animalName` saisi par l'Owner).
 */
export interface MissionAcceptedEmailData {
  animalName: string
}

export function buildMissionAcceptedEmail(data: MissionAcceptedEmailData): {
  subject: string
  html: string
} {
  const safeName = escapeHtml(data.animalName)
  const subject = `[Redlink] Un donneur a été proposé — ${data.animalName}`

  const bodyHtml = `
    <p style="margin:0 0 16px; color:#3f3f46; font-size:14px; line-height:1.6;">
      Un propriétaire vient de proposer <strong>${safeName}</strong> pour votre demande de don.
      Retrouvez les coordonnées et le suivi de cette mission depuis votre tableau de bord.
    </p>
  `

  return {
    subject,
    html: renderLayout({
      locale: 'fr',
      preheader: `${safeName} a été proposé pour votre demande`,
      heading: 'Nouveau donneur proposé',
      bodyHtml,
    }),
  }
}
