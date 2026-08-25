import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import i18n from '@/i18n'
import { useLegalDocument } from '@/composables/useLegalDocument.js'

// Même pattern que usePassword.test.js (`withSetup`) : useLegalDocument() appelle
// useI18n() (pour `locale`, réactif -- voir la doc du composable), donc a besoin d'un
// contexte de composant Vue actif avec le plugin vue-i18n installé.
const withSetup = (composable) => {
  let result
  const app = createApp({
    setup() {
      result = composable()
      return () => null
    },
  })
  app.use(i18n)
  const el = document.createElement('div')
  app.mount(el)
  return { result, unmount: () => app.unmount() }
}

describe('useLegalDocument', () => {
  let fetchMock

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // Locale par défaut de `i18n` (singleton importé) dépendante de `navigator.language`
    // (voir src/i18n.js) -- jsdom résout systématiquement en 'en-US', pas 'fr' : fixée ici
    // explicitement pour un point de départ déterministe, indépendant de l'environnement de
    // test.
    i18n.global.locale.value = 'fr'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('charge et rend le markdown au montage (immediate)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('## Titre') })

    const { result, unmount } = withSetup(() => useLegalDocument('cgu'))
    await vi.waitFor(() => expect(result.isLoading.value).toBe(false))

    expect(fetchMock).toHaveBeenCalledWith('/legal/cgu.fr.md')
    expect(result.html.value).toContain('<h2>Titre</h2>')
    expect(result.loadError.value).toBe(false)
    unmount()
  })

  it('passe loadError à true sur une réponse non-ok (ex. 404), sans laisser isLoading bloqué', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 })

    const { result, unmount } = withSetup(() => useLegalDocument('cgu'))
    await vi.waitFor(() => expect(result.isLoading.value).toBe(false))

    expect(result.loadError.value).toBe(true)
    expect(result.html.value).toBe('')
    unmount()
  })

  it('passe loadError à true si fetch lève (erreur réseau)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    const { result, unmount } = withSetup(() => useLegalDocument('cgu'))
    await vi.waitFor(() => expect(result.isLoading.value).toBe(false))

    expect(result.loadError.value).toBe(true)
    unmount()
  })

  it('re-fetch sur changement de locale, avec le bon chemin par langue', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve('contenu') })

    const { result, unmount } = withSetup(() => useLegalDocument('privacy-policy'))
    await vi.waitFor(() => expect(result.isLoading.value).toBe(false))
    expect(fetchMock).toHaveBeenLastCalledWith('/legal/privacy-policy.fr.md')

    i18n.global.locale.value = 'en'
    await nextTick()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/legal/privacy-policy.en.md'))

    i18n.global.locale.value = 'fr'
    unmount()
  })
})
