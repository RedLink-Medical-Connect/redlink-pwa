import { renderLayout } from './layout'
import { escapeHtml, row } from './email-helpers'

/**
 * Email ADMIN (broadcast) -- système de notifications, 2026-09-18. Envoyé par la Lambda
 * `rating-aggregation` (déjà existante, ADR-0017 -- écrit `Clinic.needsAdminReview`/
 * `accountStatus: UNDER_REVIEW` quand la moyenne d'une clinique franchit le seuil de
 * modération) quand elle SIGNALE une clinique pour la première fois. Même famille que
 * `clinic-verification-notification-email.ts`/`mission-disputed-email.ts` : locale FR en dur,
 * pointe vers la fiche `Clinic` (aucune interface admin de sortie de revue n'existe, docs/adr/
 * 0017 §4).
 */
export interface ClinicUnderReviewEmailData {
  clinicId: string
  clinicName: string
  average: number
  count: number
}

export function buildClinicUnderReviewEmail(data: ClinicUnderReviewEmailData): {
  subject: string
  html: string
} {
  const subject = `[Redlink] Clinique signalée à la modération — ${data.clinicName}`

  const bodyHtml = `
    <p style="margin:0 0 16px; color:#3f3f46; font-size:14px; line-height:1.6;">
      La moyenne des notations reçues par cette clinique vient de franchir le seuil de
      modération.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px; border:1px solid #e4e4e7; border-radius:6px; overflow:hidden;">
      ${row('Clinique', data.clinicName)}
      ${row('Moyenne', `${data.average.toFixed(1)} / 5`)}
      ${row("Nombre d'avis", String(data.count))}
      ${row('ID Clinic', data.clinicId)}
    </table>
    <p style="margin:0; color:#71717a; font-size:13px; line-height:1.5;">
      Consultez la fiche <code style="background-color:#fff1f2; padding:2px 4px; border-radius:3px;">Clinic</code>
      (console AppSync/DynamoDB, id
      <code style="background-color:#fff1f2; padding:2px 4px; border-radius:3px;">${escapeHtml(data.clinicId)}</code>)
      pour investiguer.
    </p>
  `

  return {
    subject,
    html: renderLayout({
      locale: 'fr',
      preheader: `${escapeHtml(data.clinicName)} vient d'être signalée à la modération`,
      heading: 'Clinique signalée',
      bodyHtml,
    }),
  }
}
