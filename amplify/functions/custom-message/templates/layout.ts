import { emailMessages, type EmailLocale } from '../i18n/messages'

/**
 * Template de base ("héritage") pour tous les emails transactionnels envoyés via le trigger
 * `CustomMessage` -- voir docs/adr/0022-branded-transactional-emails.md. Un seul header/footer
 * de marque, chaque email spécifique (`verification-email.ts`, `forgot-password-email.ts`)
 * n'a qu'à fournir son `bodyHtml`. Tables + CSS inline (pas de `<style>` externe) : forme
 * imposée par la compatibilité email (Outlook/Gmail ignorent tout CSS non inline), pas un
 * choix de style de code.
 *
 * Identité visuelle alignée sur le site réel plutôt qu'inventée (retour repo owner,
 * 2026-09-12) : `#ff3b4e` est la couleur d'accent utilisée partout dans `src/`
 * (`AppHeader.vue`, boutons `RegisterOwnerView.vue`/`ForgotPasswordView.vue`, etc.), et le
 * wordmark "RedLink" (casse exacte, jamais traduit) reproduit tel quel
 * `AppHeader.vue`/`AppFooter.vue` -- nécessaire précisément PARCE QUE l'adresse expéditeur
 * (`no-reply@verificationemail.com`, défaut Cognito) ne peut pas être personnalisée sans
 * domaine SES vérifié (hors périmètre ici) : le contenu est le seul signal de marque
 * disponible pour rassurer le destinataire que l'email vient bien de Redlink.
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
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border-radius:8px; overflow:hidden; border:1px solid #e4e4e7;">
            <!-- Bande de marque : seul signal visible même dans un aperçu tronqué (liste de
                 messagerie, notification) -- avant même que le wordmark ci-dessous ne soit lu. -->
            <tr>
              <td style="background-color:#ff3b4e; height:4px; line-height:4px; font-size:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px; background-color:#ffffff;">
                <!-- Wordmark : casse et couleur reprises à l'identique de AppHeader.vue/
                     AppFooter.vue (src/), jamais traduit -- un logotype ne se traduit pas. -->
                <span style="color:#ff3b4e; font-size:24px; font-weight:700; letter-spacing:-0.02em;">RedLink</span>
                <p style="margin:6px 0 0; color:#71717a; font-size:13px; line-height:1.4;">${messages.tagline}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 32px;">
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
    <p style="margin:0; padding:16px; background-color:#fff1f2; border:1px solid #ffb3bb; border-radius:6px; color:#ff3b4e; font-size:28px; font-weight:700; letter-spacing:6px; font-family:'Courier New', Courier, monospace;">${code}</p>
  </div>`
}
