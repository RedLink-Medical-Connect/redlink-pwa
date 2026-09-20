/**
 * Helpers partagés entre templates d'email (système de notifications, 2026-09-18) -- extraits
 * de `clinic-verification-notification-email.ts` (leur toute première implémentation) : `
 * escapeHtml`/`row` étaient déjà dupliqués une fois avant cette extraction, et le système de
 * notifications en ajoute 7 nouveaux templates qui en ont tous besoin -- même raisonnement que
 * `../../shared/write-notification.ts` (duplication réelle et répétée, pas une abstraction
 * anticipée).
 *
 * `escapeHtml` : NÉCESSAIRE sur tout contenu utilisateur (nom de clinique, nom d'animal...)
 * interpolé dans un email -- contrairement à `renderLayout`/`verification-email.ts`/
 * `forgot-password-email.ts`, qui n'interpolent que des valeurs générées SERVEUR (code Cognito).
 * Voir `clinic-verification-notification-email.ts` (premier usage) pour l'analyse complète du
 * risque (une clinique/un propriétaire qui saisirait `<script>`/balises HTML dans un champ ne
 * doit jamais pouvoir injecter du HTML dans un email lu par un tiers).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Ligne de tableau label/valeur (échappement de la VALEUR uniquement -- le label est toujours
 * un littéral statique du template appelant, jamais une saisie utilisateur). */
export function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 12px; background-color:#fafafa; border-bottom:1px solid #e4e4e7; color:#71717a; font-size:12px; font-weight:600; white-space:nowrap;">${label}</td>
    <td style="padding:8px 12px; border-bottom:1px solid #e4e4e7; color:#18181b; font-size:13px;">${escapeHtml(value)}</td>
  </tr>`
}
