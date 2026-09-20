import { renderLayout } from './layout'
import { escapeHtml, row } from './email-helpers'

/**
 * Email ADMIN (broadcast, pas un email transactionnel envoyé à un utilisateur final) --
 * système de notifications, 2026-09-18. Envoyé par la Lambda `mission-notifier` (flux DynamoDB
 * Streams sur `MODIFY` de `Mission`, transition vers `DISPUTED` -- les deux côtés de la double
 * validation ont voté en désaccord). Même famille que
 * `clinic-verification-notification-email.ts` (le premier email admin de ce genre) : locale FR
 * en dur, `escapeHtml()` sur `ownerDisputeReason` (texte libre saisi par l'Owner).
 *
 * Aucune interface admin de résolution des litiges n'existe (docs/adr/0016 §6) -- cet email
 * pointe vers l'`id` de la Mission (console AppSync/DynamoDB), comme
 * `clinic-verification-notification-email.ts` pointe vers `approveClinicVerification`.
 */
export interface MissionDisputedEmailData {
  missionId: string
  disputeReason: string | null
}

export function buildMissionDisputedEmail(data: MissionDisputedEmailData): {
  subject: string
  html: string
} {
  const subject = `[Redlink] Litige sur une mission — ${data.missionId}`

  const bodyHtml = `
    <p style="margin:0 0 16px; color:#3f3f46; font-size:14px; line-height:1.6;">
      Une Mission vient de passer en litige : les deux parties ont soumis leur validation, en
      désaccord sur le déroulement du don.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px; border:1px solid #e4e4e7; border-radius:6px; overflow:hidden;">
      ${row('ID Mission', data.missionId)}
      ${row('Motif (propriétaire)', data.disputeReason || '(non renseigné)')}
    </table>
    <p style="margin:0; color:#71717a; font-size:13px; line-height:1.5;">
      Consultez la fiche <code style="background-color:#fff1f2; padding:2px 4px; border-radius:3px;">Mission</code>
      (console AppSync/DynamoDB, id
      <code style="background-color:#fff1f2; padding:2px 4px; border-radius:3px;">${escapeHtml(data.missionId)}</code>)
      pour investiguer.
    </p>
  `

  return {
    subject,
    html: renderLayout({
      locale: 'fr',
      preheader: `Litige à examiner sur la mission ${data.missionId}`,
      heading: 'Litige sur une mission',
      bodyHtml,
    }),
  }
}
