import { renderLayout } from './layout'
import { escapeHtml } from './email-helpers'

/**
 * Email PERSONNEL (Owner) -- système de notifications, 2026-09-18. Envoyé par la Lambda
 * `request-matcher-notifier` (flux DynamoDB Streams sur `INSERT` de `Request`) quand un des
 * Animals de l'Owner est compatible avec une nouvelle demande de don (espèce/groupe/distance/
 * Frequency Rule/disponibilité RDV le cas échéant -- voir `amplify/functions/shared/
 * eligibility.ts`). Même patron que les autres templates de ce dossier : `renderLayout()`,
 * locale FR en dur, `escapeHtml()` sur `clinicName` (saisi par la Clinic à l'inscription).
 */
export interface NewCompatibleRequestEmailData {
  clinicName: string
  requiredSpecies: string
  requiredBloodGroup: string
}

const SPECIES_LABELS: Record<string, string> = { DOG: 'chien', CAT: 'chat' }

export function buildNewCompatibleRequestEmail(data: NewCompatibleRequestEmailData): {
  subject: string
  html: string
} {
  const safeClinicName = escapeHtml(data.clinicName)
  const speciesLabel = SPECIES_LABELS[data.requiredSpecies] || data.requiredSpecies
  const subject = `[Redlink] Nouvelle demande de don compatible — ${data.clinicName}`

  const bodyHtml = `
    <p style="margin:0 0 16px; color:#3f3f46; font-size:14px; line-height:1.6;">
      <strong>${safeClinicName}</strong> recherche un donneur de sang
      ${speciesLabel} (groupe ${escapeHtml(data.requiredBloodGroup)}) et l'un de vos animaux est
      compatible. Connectez-vous à votre tableau de bord pour proposer votre don.
    </p>
  `

  return {
    subject,
    html: renderLayout({
      locale: 'fr',
      preheader: `${safeClinicName} recherche un donneur ${speciesLabel} compatible`,
      heading: 'Nouvelle demande compatible',
      bodyHtml,
    }),
  }
}
