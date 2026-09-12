import { renderLayout, renderCodeBlock } from './layout'
import { emailMessages, resolveEmailLocale } from '../i18n/messages'

/** Email de réinitialisation de mot de passe -- `CustomMessage_ForgotPassword`. */

export interface ForgotPasswordEmailInput {
  code: string
  locale: string | undefined
}

export function renderForgotPasswordEmail({ code, locale }: ForgotPasswordEmailInput): {
  subject: string
  html: string
} {
  const resolvedLocale = resolveEmailLocale(locale)
  const t = emailMessages[resolvedLocale].forgotPassword

  const bodyHtml = `
    <p style="margin:0 0 16px; color:#3f3f46; font-size:14px; line-height:1.5;">${t.intro}</p>
    ${renderCodeBlock(t.codeLabel, code)}
    <p style="margin:16px 0 0; color:#71717a; font-size:13px;">${t.expiry}</p>
    <p style="margin:8px 0 0; color:#71717a; font-size:13px;">${t.ignoreNote}</p>
  `

  return {
    subject: t.subject,
    html: renderLayout({ locale: resolvedLocale, preheader: t.preheader, heading: t.heading, bodyHtml }),
  }
}
