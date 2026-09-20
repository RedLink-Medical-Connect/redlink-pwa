import { renderLayout } from './layout'
import { escapeHtml } from './email-helpers'

/**
 * Email PERSONNEL (Owner OU Clinic, selon lequel des deux n'a pas encore voté) -- système de
 * notifications, 2026-09-18. Envoyé par la Lambda `mission-notifier` (flux DynamoDB Streams sur
 * `MODIFY` de `Mission`, transition vers `PENDING_VALIDATION` -- un côté de la double
 * validation vient de soumettre son vote, relance l'autre). Un seul fichier pour les deux
 * formulations (`recipientRole`) plutôt que deux templates quasi identiques -- même `bodyHtml`
 * de fond, seul le vocabulaire change ("clinique"/"propriétaire").
 */
export type MissionValidationReminderRecipientRole = 'OWNER' | 'CLINIC'

export interface MissionValidationReminderEmailData {
  animalName: string
  recipientRole: MissionValidationReminderRecipientRole
}

export function buildMissionValidationReminderEmail(data: MissionValidationReminderEmailData): {
  subject: string
  html: string
} {
  const safeName = escapeHtml(data.animalName)
  // Le PARTI qui a DÉJÀ voté est le camp OPPOSÉ au destinataire (sinon la relance n'aurait pas
  // lieu d'être) : `recipientRole: OWNER` -> c'est la Clinic qui a voté ; `CLINIC` -> l'Owner.
  const otherPartyLabel = data.recipientRole === 'OWNER' ? 'La clinique' : 'Le propriétaire'
  const subject = `[Redlink] Confirmez le don — ${data.animalName}`

  const bodyHtml = `
    <p style="margin:0 0 16px; color:#3f3f46; font-size:14px; line-height:1.6;">
      ${otherPartyLabel} a déjà confirmé sa réponse concernant le don de
      <strong>${safeName}</strong>. Il ne manque plus que la vôtre : merci de confirmer si le
      don a bien eu lieu depuis votre tableau de bord.
    </p>
  `

  return {
    subject,
    html: renderLayout({
      locale: 'fr',
      preheader: `Votre confirmation est attendue pour ${safeName}`,
      heading: 'Confirmation attendue',
      bodyHtml,
    }),
  }
}
