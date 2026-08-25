import { LegalDocumentType } from './enums.js'

// Scaffolding légal/RGPD (2026-08-25, docs/adr/0014) — source de vérité unique pour la
// VERSION actuellement en vigueur de chaque document légal. Le texte lui-même vit hors du
// code (src/legal/*.md, chargé dynamiquement par useLegalDocument.js) ; ce fichier ne porte
// que le numéro de version + sa date de publication, écrits ici en dur PLACEHOLDER — à
// mettre à jour manuellement à chaque publication d'une nouvelle version d'un document (pas
// de mécanisme de versioning automatique, ex. hash de contenu : une version est une décision
// éditoriale/juridique, pas un fait dérivable du texte).
//
// `useRegistrationCompletion.js` écrit CETTE valeur (pas une saisie utilisateur) dans
// `ConsentRecord.documentVersion` au moment de l'inscription — garantit qu'un
// `ConsentRecord` référence toujours une version qui a réellement existé, même si le
// contenu du .md associé change plus tard sans que cette constante soit mise à jour (bug
// de process, pas rattrapable par le code).
export const LEGAL_DOCUMENT_VERSIONS = Object.freeze({
  [LegalDocumentType.CGU]: { version: '1.0', publishedAt: '2026-08-25' },
  [LegalDocumentType.PRIVACY_POLICY]: { version: '1.0', publishedAt: '2026-08-25' },
  [LegalDocumentType.CGV]: { version: '1.0', publishedAt: '2026-08-25' },
})

// Mentions légales : pas de `ConsentRecord` associé (aucun consentement à capturer, page
// purement informative) — versionnée séparément pour rester cohérente avec l'affichage des
// trois autres pages légales (bandeau "version X.Y, publié le ..."), mais volontairement
// PAS dans `LEGAL_DOCUMENT_VERSIONS`/`LegalDocumentType` : ce n'est pas un document que
// quelqu'un "accepte".
export const LEGAL_NOTICE_VERSION = Object.freeze({ version: '1.0', publishedAt: '2026-08-25' })

// Version du texte d'attestation sur l'honneur affiché au vétérinaire à la validation d'un
// donneur (DonorValidationAttestation.attestationVersion, useAnimalValidation.js) — même
// raisonnement que LEGAL_DOCUMENT_VERSIONS ci-dessus, séparée car ce n'est pas un
// `LegalDocumentType` (pas de page dédiée, pas de `ConsentRecord`) : le texte affiché vit
// directement dans ValidationsView.vue (placeholder), pas dans src/legal/*.md.
export const DONOR_VALIDATION_ATTESTATION_VERSION = '1.0'

/**
 * Chemin public (servi tel quel par Vite depuis `public/`, jamais bundlé dans le JS) vers
 * le fichier markdown d'un document légal, dans la locale demandée.
 *
 * @param {string} slug Slug de fichier (`'cgu'`, `'cgv'`, `'privacy-policy'`,
 *   `'legal-notice'`) — PAS forcément une valeur de `LegalDocumentType` (`legal-notice`
 *   n'en est pas une, voir plus haut).
 * @param {string} locale `'fr'`/`'en'` (vue-i18n) — repli sur `'fr'` si la locale n'a pas
 *   de fichier dédié (seules `fr`/`en` existent à ce jour, comme le reste de l'i18n du repo).
 * @returns {string}
 */
export function legalDocumentPath(slug, locale) {
  const supportedLocale = locale === 'en' ? 'en' : 'fr'
  return `/legal/${slug}.${supportedLocale}.md`
}
