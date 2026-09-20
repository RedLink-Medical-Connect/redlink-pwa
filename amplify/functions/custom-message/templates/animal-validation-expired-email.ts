import { renderLayout } from './layout'
import { escapeHtml } from './email-helpers'

/**
 * Email PERSONNEL (Owner) -- système de notifications, 2026-09-18. Envoyé par la Lambda
 * PLANIFIÉE `animal-validation-expiry-notifier` (aucune écriture native ne signale l'expiration
 * d'une validation, voir son `resource.ts`). Même patron que `animal-validated-email.ts`.
 */
export interface AnimalValidationExpiredEmailData {
  animalName: string
}

export function buildAnimalValidationExpiredEmail(data: AnimalValidationExpiredEmailData): {
  subject: string
  html: string
} {
  const safeName = escapeHtml(data.animalName)
  const subject = `[Redlink] La validation donneur de ${data.animalName} a expiré`

  const bodyHtml = `
    <p style="margin:0 0 16px; color:#3f3f46; font-size:14px; line-height:1.6;">
      La validation vétérinaire de <strong>${safeName}</strong> comme donneur de sang vient
      d'expirer (validité d'un an). Prenez rendez-vous avec votre clinique pour la renouveler et
      continuer à proposer ${safeName} pour des dons.
    </p>
  `

  return {
    subject,
    html: renderLayout({
      locale: 'fr',
      preheader: `La validation de ${safeName} a expiré`,
      heading: 'Validation expirée',
      bodyHtml,
    }),
  }
}
