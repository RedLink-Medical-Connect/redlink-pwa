import { emailMessages, type EmailLocale } from '../i18n/messages'

/**
 * Template de base ("héritage") pour tous les emails transactionnels envoyés via le trigger
 * `CustomMessage` -- voir docs/adr/0022-branded-transactional-emails.md. Un seul header/footer
 * de marque, chaque email spécifique (`verification-email.ts`, `forgot-password-email.ts`)
 * n'a qu'à fournir son `bodyHtml`. Tables + CSS inline (pas de `<style>` externe) : forme
 * imposée par la compatibilité email (Outlook/Gmail ignorent tout CSS non inline), pas un
 * choix de style de code.
 *
 * Pas d'échappement HTML sur les chaînes interpolées : tout le contenu (`heading`,
 * `preheader`, `bodyHtml`, le code Cognito lui-même) vient exclusivement de
 * `i18n/messages.ts` ou de `event.request.codeParameter` (généré par Cognito, jamais une
 * saisie utilisateur) -- aucune de ces valeurs n'est un input externe à échapper.
 */

export interface RenderLayoutOptions {
  locale: EmailLocale
  preheader: string
  heading: string
  bodyHtml: string
}

export function renderLayout({ locale, preheader, heading, bodyHtml }: RenderLayoutOptions): string {
  const messages = emailMessages[locale]
  const year = new Date().getFullYear()

  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${heading}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border-radius:8px; overflow:hidden;">
            <tr>
              <td style="background-color:#b91c1c; padding:24px 32px;">
                <span style="color:#ffffff; font-size:20px; font-weight:700; letter-spacing:0.5px;">${messages.brandName}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px; color:#18181b; font-size:20px;">${heading}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px; background-color:#fafafa; border-top:1px solid #e4e4e7;">
                <p style="margin:0; color:#71717a; font-size:12px;">${messages.footerNote}</p>
                <p style="margin:8px 0 0; color:#a1a1aa; font-size:12px;">${messages.footerRights(year)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/** Bloc code partagé par tous les emails qui affichent un code Cognito (`codeParameter`). */
export function renderCodeBlock(label: string, code: string): string {
  return `<div style="margin:24px 0; text-align:center;">
    <p style="margin:0 0 8px; color:#71717a; font-size:13px;">${label}</p>
    <p style="margin:0; padding:16px; background-color:#fafafa; border:1px solid #e4e4e7; border-radius:6px; color:#18181b; font-size:28px; font-weight:700; letter-spacing:6px; font-family:'Courier New', Courier, monospace;">${code}</p>
  </div>`
}
