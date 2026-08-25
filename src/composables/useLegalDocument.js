import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { legalDocumentPath } from '@/constants/legal.js'
import { renderLegalMarkdown } from '@/services/legal-content-service.js'

/**
 * Charge et rend en HTML le markdown d'un document légal (`src/legal/*.md`, servi tel quel
 * depuis `public/legal/`) — scaffolding légal/RGPD (2026-08-25, docs/adr/0014). Utilisé par
 * les 4 vues légales (CGUView/CGVView/PrivacyPolicyView/LegalNoticeView.vue).
 *
 * Un simple `fetch()` d'un fichier statique, PAS un appel GraphQL (`client.models.*`) :
 * `throwIfGraphqlError`/`resolveOrThrowOnFailure` (graphql-error-service.js) ne
 * s'appliquent pas ici, la gestion d'erreur reste un `try/catch` direct sur la réponse
 * `fetch()`. Ref `loadError` dédiée quand même (même convention que le reste du repo, voir
 * CLAUDE.md "un chargement dont l'échec doit être visible à l'écran a besoin d'un ref
 * d'erreur dédié") : un 404 sur le .md (fichier renommé/déplacé sans mettre à jour
 * `legalDocumentPath`, erreur de process plausible vu que le contenu vit hors du code) ne
 * doit pas laisser la page silencieusement vide.
 *
 * Re-fetch réactif sur changement de langue (`locale`, vue-i18n) : un document légal existe
 * en fr ET en, contrairement au reste de l'i18n du repo (clés dans le même fichier
 * fr.json/en.json, pas de fetch réseau séparé par langue) — sans ce `watch`, changer de
 * langue en cours de lecture laisserait affiché le contenu de l'ancienne langue.
 *
 * @param {string} slug Voir `legalDocumentPath` (constants/legal.js).
 */
export function useLegalDocument(slug) {
  const { locale } = useI18n()

  const html = ref('')
  const isLoading = ref(false)
  const loadError = ref(false)

  const fetchDocument = async () => {
    isLoading.value = true
    loadError.value = false
    try {
      const response = await fetch(legalDocumentPath(slug, locale.value))
      if (!response.ok) {
        throw new Error(`Document légal introuvable : ${slug} (${response.status})`)
      }
      const markdown = await response.text()
      html.value = renderLegalMarkdown(markdown)
    } catch (e) {
      console.error(`Erreur chargement du document légal "${slug}" :`, e)
      loadError.value = true
    } finally {
      isLoading.value = false
    }
  }

  watch(locale, fetchDocument, { immediate: true })

  return { html, isLoading, loadError, fetchDocument }
}
