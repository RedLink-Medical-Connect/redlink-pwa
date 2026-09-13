import { renderLayout, renderCodeBlock } from './layout'
import { emailMessages, resolveEmailLocale } from '../i18n/messages'

/**
 * Email d'invitation d'un vétérinaire par le référent de sa clinique -- couvre
 * `CustomMessage_AdminCreateUser` (voir `handler.ts`). `code` porte ici le mot de passe
 * temporaire généré par `AdminCreateUserCommand`, pas un code de vérification à 6 chiffres --
 * `renderCodeBlock` reste réutilisable telle quelle (même présentation visuelle), voir le
 * commentaire de `handler.ts` sur ce point.
 */

export interface InviteVeterinarianEmailInput {
  code: string
  username: string
  locale: string | undefined
}

export function renderInviteVeterinarianEmail({ code, username, locale }: InviteVeterinarianEmailInput): {
  subject: string
  html: string
} {
  const resolvedLocale = resolveEmailLocale(locale)
  const t = emailMessages[resolvedLocale].inviteVeterinarian

  const bodyHtml = `
    <p style="margin:0 0 16px; color:#3f3f46; font-size:14px; line-height:1.5;">${t.intro}</p>
    <p style="margin:0 0 4px; color:#71717a; font-size:13px;">${t.usernameLabel}</p>
    <p style="margin:0 0 16px; color:#18181b; font-size:14px; font-weight:600;">${username}</p>
    ${renderCodeBlock(t.codeLabel, code)}
    <p style="margin:16px 0 0; color:#71717a; font-size:13px;">${t.expiry}</p>
  `

  return {
    subject: t.subject,
    html: renderLayout({ locale: resolvedLocale, preheader: t.preheader, heading: t.heading, bodyHtml }),
  }
}
