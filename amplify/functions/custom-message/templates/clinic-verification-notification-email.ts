import { renderLayout } from './layout'

/**
 * Email de notification ADMIN (pas un email transactionnel envoyé à un utilisateur final,
 * contrairement aux deux autres fichiers de ce dossier) -- vérification d'identité
 * vétérinaire (RPPS + numéro d'ordre) avant activation d'une nouvelle Clinic, plan de
 * durcissement sécurité "Différé 1" (ré-audit 2026-09-04). Envoyé par la Lambda
 * `clinic-verification-notifier` (flux DynamoDB Streams sur `INSERT` de `Clinic`), pas par le
 * trigger Cognito `CustomMessage` -- réutilise `renderLayout` (même bande de marque, même
 * footer) pour rester dans "un seul système de templates", voir CLAUDE.md ("Référence pour
 * tout futur email transactionnel : ajouter un fichier dans templates/, pas un nouveau
 * système").
 *
 * PAS de champs du Veterinarian référent (numéro d'ordre notamment) : à l'instant de
 * l'`INSERT` sur `Clinic`, le handler ne lit QUE le `NewImage` de cet enregistrement (pas de
 * requête DynamoDB supplémentaire, voir `../../clinic-verification-notifier/handler.ts`) --
 * `Veterinarian.numeroOrdre` vit sur une AUTRE table, créée par un second appel séquentiel de
 * `useRegistrationCompletion.js` (`completeVetRegistration`), donc pas garanti disponible/pas
 * fiable à interroger sans un GSI nommé explicitement sur `clinicID` (aucun n'existe à ce jour
 * pour `Veterinarian`, contrairement à `MISSION_STATUS_INDEX_NAME`/`RATING_TARGET_INDEX_NAME`
 * dans `amplify/data/resource.ts`). L'email renvoie donc l'admin vers la fiche `Veterinarian`
 * (via `clinicID`) plutôt que de dupliquer une requête supplémentaire pour ce champ seul --
 * décision de simplicité assumée pour ce premier jet, à revoir si ce point de friction se
 * confirme à l'usage réel.
 *
 * Locale FR codée en dur (pas de `clientMetadata.locale` ici : ce n'est pas un email envoyé à
 * un utilisateur qui a choisi une langue, c'est une notification interne pour un seul
 * destinataire francophone connu -- voir `resolveEmailLocale`/`DEFAULT_EMAIL_LOCALE` dans
 * `../i18n/messages.ts` pour le mécanisme complet côté emails utilisateur, non réutilisé ici
 * volontairement).
 *
 * ÉCHAPPEMENT HTML NÉCESSAIRE, contrairement à `renderLayout`/`verification-email.ts`/
 * `forgot-password-email.ts` : `clinicName`/`clinicRpps` sont saisis par la CLINIQUE
 * elle-même au formulaire d'inscription -- un input externe non fiable, contrairement au code
 * de vérification Cognito (généré serveur) que les deux autres templates interpolent sans
 * échappement. Une clinique qui saisirait `<script>`/balises HTML dans son nom ne doit pas
 * pouvoir injecter du HTML dans l'email lu par l'admin.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface ClinicVerificationNotificationEmailData {
  clinicId: string
  clinicName: string
  clinicRpps: string
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 12px; background-color:#fafafa; border-bottom:1px solid #e4e4e7; color:#71717a; font-size:12px; font-weight:600; white-space:nowrap;">${label}</td>
    <td style="padding:8px 12px; border-bottom:1px solid #e4e4e7; color:#18181b; font-size:13px;">${escapeHtml(value)}</td>
  </tr>`
}

export function buildClinicVerificationNotificationEmail(
  data: ClinicVerificationNotificationEmailData,
): { subject: string; html: string } {
  const subject = `[Redlink] Nouvelle clinique à valider — ${data.clinicName}`

  const bodyHtml = `
    <p style="margin:0 0 16px; color:#3f3f46; font-size:14px; line-height:1.6;">
      Une nouvelle clinique vient de s'inscrire sur Redlink et attend une vérification
      manuelle du RPPS de la clinique et du numéro d'ordre du vétérinaire référent, auprès de
      l'Ordre National des Vétérinaires, avant activation de son compte.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px; border:1px solid #e4e4e7; border-radius:6px; overflow:hidden;">
      ${row('Clinique', data.clinicName)}
      ${row('RPPS (clinique)', data.clinicRpps)}
      ${row('ID Clinic', data.clinicId)}
    </table>
    <p style="margin:0 0 16px; color:#71717a; font-size:13px; line-height:1.5;">
      Le nom, l'email et le numéro d'ordre du vétérinaire référent sont sur la fiche
      <code style="background-color:#fff1f2; padding:2px 4px; border-radius:3px;">Veterinarian</code>
      rattachée à cette Clinic (console AppSync/DynamoDB, filtrer par
      <code style="background-color:#fff1f2; padding:2px 4px; border-radius:3px;">clinicID</code>).
    </p>
    <p style="margin:0; color:#71717a; font-size:13px; line-height:1.5;">
      Une fois la vérification faite, approuvez le compte via la mutation GraphQL
      <code style="background-color:#fff1f2; padding:2px 4px; border-radius:3px;">approveClinicVerification(id: "${escapeHtml(data.clinicId)}")</code>
      (groupe Cognito <code style="background-color:#fff1f2; padding:2px 4px; border-radius:3px;">Admins</code> requis).
    </p>
  `

  return {
    subject,
    html: renderLayout({
      locale: 'fr',
      // escapeHtml() ici aussi -- `renderLayout` interpole `preheader` sans échappement
      // (conçu pour les deux autres templates, dont le contenu est toujours statique/généré
      // serveur, voir son en-tête), et `data.clinicName` est un input externe non fiable
      // (même raison que `row()` ci-dessus). Repéré par handler.test.ts, pas en relecture.
      preheader: `${escapeHtml(data.clinicName)} attend une vérification RPPS/numéro d'ordre`,
      heading: 'Nouvelle clinique à valider',
      bodyHtml,
    }),
  }
}
