import { marked } from 'marked'

// Scaffolding légal/RGPD (2026-08-25, docs/adr/0014) — fonction pure (convention "Services
// (deep modules)", CLAUDE.md : aucune réactivité Vue, aucun appel réseau, aucun accès DOM),
// le `fetch()` du fichier .md lui-même reste dans `useLegalDocument.js` (composable). `marked`
// (nouvelle dépendance, 2026-08-25) plutôt qu'un parseur markdown maison : les documents
// légaux/l'attestation vétérinaire sont des textes réglementaires, un rendu markdown
// partiel/buggé (ex. une liste mal fermée) y est plus risqué qu'ailleurs dans ce repo — une
// dépendance mature et testée l'emporte ici sur "pas de dépendance de plus" (CLAUDE.md
// n'interdit pas les dépendances, seulement les abstractions non nécessaires).
//
// Pas de sanitization (DOMPurify ou équivalent) : le contenu vient exclusivement de
// `src/legal/*.md`, écrit par l'équipe elle-même (jamais une saisie utilisateur, jamais une
// donnée distante) — même modèle de confiance que n'importe quel autre `.vue` de ce repo,
// qui interpole déjà librement des chaînes i18n via `v-html` nulle part ailleurs il est
// vrai, mais aucune de ces chaînes n'est non plus une entrée utilisateur.

/**
 * Rend le markdown d'un document légal en HTML.
 *
 * @param {string} markdown
 * @returns {string} HTML, à injecter via `v-html`.
 */
export function renderLegalMarkdown(markdown) {
  return marked.parse(markdown, { async: false })
}
