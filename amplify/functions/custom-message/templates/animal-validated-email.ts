import { renderLayout } from './layout'
import { escapeHtml } from './email-helpers'

/**
 * Email PERSONNEL (Owner) -- système de notifications, 2026-09-18. Envoyé par la Lambda
 * `animal-donor-notifier` (flux DynamoDB Streams sur `MODIFY` de `Animal`, transition
 * `isValidatedDonor` vers `true`). Même famille de patron que
 * `clinic-verification-notification-email.ts` : `renderLayout()` pour la bande de marque,
 * locale FR codée en dur (aucune locale stockée sur `Owner`, voir ce fichier pour le
 * raisonnement complet).
 *
 * `escapeHtml(animalName)` : `Animal.name` est saisi par l'Owner à la création -- input externe
 * non fiable, même raison que `clinicName` dans le template de vérification RPPS.
 */
export interface AnimalValidatedEmailData {
  animalName: string
}

export function buildAnimalValidatedEmail(data: AnimalValidatedEmailData): {
  subject: string
  html: string
} {
  const safeName = escapeHtml(data.animalName)
  const subject = `[Redlink] ${data.animalName} est maintenant donneur validé`

  const bodyHtml = `
    <p style="margin:0 0 16px; color:#3f3f46; font-size:14px; line-height:1.6;">
      Bonne nouvelle : un vétérinaire vient de valider <strong>${safeName}</strong> comme
      donneur de sang sur Redlink. Cette validation est valable un an — ${safeName} peut
      désormais être proposé pour les demandes de dons compatibles.
    </p>
  `

  return {
    subject,
    html: renderLayout({
      locale: 'fr',
      preheader: `${safeName} est validé comme donneur pour un an`,
      heading: 'Donneur validé',
      bodyHtml,
    }),
  }
}
