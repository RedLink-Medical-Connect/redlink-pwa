/**
 * Dictionnaire i18n dédié aux emails transactionnels (trigger `CustomMessage`, voir
 * docs/adr/0022-branded-transactional-emails.md). Volontairement séparé de
 * `src/locales/{fr,en}.json` : ce code tourne dans un runtime Lambda distinct de la SPA (pas
 * de `vue-i18n` ici), et ses clés ne sont consommées que par les templates de
 * `amplify/functions/custom-message/templates/`.
 *
 * Seules les deux locales déjà supportées par le front (`src/i18n.js`, `fr`/`en`) sont
 * couvertes. `resolveEmailLocale` referme sur `fr` (langue principale des cliniques
 * partenaires, cf. CLAUDE.md) pour toute valeur absente ou non reconnue -- pas de
 * `fallbackLocale: 'en'` comme côté front : contrairement à `src/i18n.js`, la locale ne vient
 * jamais d'un `navigator.language` fiable, seulement d'un `clientMetadata.locale` optionnel
 * posé par le BFF (`amplify/functions/bff/auth-routes.ts`) depuis la valeur envoyée par le
 * client -- un repli côté serveur, indépendant du choix de repli du front.
 */

export type EmailLocale = 'fr' | 'en'

export const DEFAULT_EMAIL_LOCALE: EmailLocale = 'fr'

export function resolveEmailLocale(rawLocale: string | undefined): EmailLocale {
  return rawLocale === 'en' ? 'en' : DEFAULT_EMAIL_LOCALE
}

interface EmailMessages {
  brandName: string
  footerNote: string
  footerRights: (year: number) => string
  verification: {
    subject: string
    preheader: string
    heading: string
    intro: string
    codeLabel: string
    expiry: string
  }
  forgotPassword: {
    subject: string
    preheader: string
    heading: string
    intro: string
    codeLabel: string
    expiry: string
    ignoreNote: string
  }
}

export const emailMessages: Record<EmailLocale, EmailMessages> = {
  fr: {
    brandName: 'Redlink',
    footerNote: 'Cet email vous a été envoyé automatiquement, merci de ne pas y répondre.',
    footerRights: (year) => `© ${year} Redlink. Tous droits réservés.`,
    verification: {
      subject: 'Confirmez votre adresse email Redlink',
      preheader: 'Voici votre code de confirmation Redlink',
      heading: 'Bienvenue sur Redlink',
      intro: 'Merci de vous être inscrit·e. Utilisez le code ci-dessous pour confirmer votre adresse email :',
      codeLabel: 'Votre code de confirmation',
      expiry: 'Ce code expire dans 24 heures.',
    },
    forgotPassword: {
      subject: 'Réinitialisation de votre mot de passe Redlink',
      preheader: 'Voici votre code de réinitialisation Redlink',
      heading: 'Réinitialisation du mot de passe',
      intro:
        'Vous avez demandé la réinitialisation de votre mot de passe. Utilisez le code ci-dessous pour en choisir un nouveau :',
      codeLabel: 'Votre code de réinitialisation',
      expiry: 'Ce code expire dans 1 heure.',
      ignoreNote: "Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.",
    },
  },
  en: {
    brandName: 'Redlink',
    footerNote: 'This email was sent automatically, please do not reply to it.',
    footerRights: (year) => `© ${year} Redlink. All rights reserved.`,
    verification: {
      subject: 'Confirm your Redlink email address',
      preheader: 'Your Redlink confirmation code',
      heading: 'Welcome to Redlink',
      intro: 'Thanks for signing up. Use the code below to confirm your email address:',
      codeLabel: 'Your confirmation code',
      expiry: 'This code expires in 24 hours.',
    },
    forgotPassword: {
      subject: 'Reset your Redlink password',
      preheader: 'Your Redlink reset code',
      heading: 'Password reset',
      intro: 'You requested a password reset. Use the code below to choose a new one:',
      codeLabel: 'Your reset code',
      expiry: 'This code expires in 1 hour.',
      ignoreNote: "If you didn't request this, you can safely ignore this email.",
    },
  },
}
