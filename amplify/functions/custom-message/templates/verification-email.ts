import { renderLayout, renderCodeBlock } from './layout'
import { emailMessages, resolveEmailLocale } from '../i18n/messages'

/**
 * Email de confirmation d'inscription -- couvre `CustomMessage_SignUp` ET
 * `CustomMessage_ResendCode` (même contenu, Cognito envoie le même `triggerSource` de contenu
 * pour un renvoi de code que pour l'inscription initiale ; seul le `triggerSource` diffère,
 * voir `handler.ts`).
 */

export interface VerificationEmailInput {
  code: string
  locale: string | undefined
}

export function renderVerificationEmail({ code, locale }: VerificationEmailInput): {
  subject: string
  html: string
} {
  const resolvedLocale = resolveEmailLocale(locale)
  const t = emailMessages[resolvedLocale].verification

  const bodyHtml = `
    <p style="margin:0 0 16px; color:#3f3f46; font-size:14px; line-height:1.5;">${t.intro}</p>
    ${renderCodeBlock(t.codeLabel, code)}
    <p style="margin:16px 0 0; color:#71717a; font-size:13px;">${t.expiry}</p>
  `

  return {
    subject: t.subject,
    html: renderLayout({ locale: resolvedLocale, preheader: t.preheader, heading: t.heading, bodyHtml }),
  }
}
