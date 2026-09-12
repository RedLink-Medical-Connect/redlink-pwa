// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { renderLayout, renderCodeBlock } from './layout'

describe('renderLayout', () => {
  it('inclut la marque, le heading, le preheader et le bodyHtml fournis', () => {
    const html = renderLayout({
      locale: 'fr',
      preheader: 'Mon preheader',
      heading: 'Mon titre',
      bodyHtml: '<p>Contenu du corps</p>',
    })

    expect(html).toContain('Redlink')
    expect(html).toContain('Mon titre')
    expect(html).toContain('Mon preheader')
    expect(html).toContain('<p>Contenu du corps</p>')
    expect(html).toContain('lang="fr"')
  })

  it("pose bien l'attribut lang selon la locale (en)", () => {
    const html = renderLayout({ locale: 'en', preheader: 'p', heading: 'h', bodyHtml: '<p>b</p>' })
    expect(html).toContain('lang="en"')
  })

  it("inclut l'année courante dans le footer (pas une valeur en dur)", () => {
    const html = renderLayout({ locale: 'fr', preheader: 'p', heading: 'h', bodyHtml: '<p>b</p>' })
    expect(html).toContain(String(new Date().getFullYear()))
  })

  // Retour repo owner (2026-09-12) : l'adresse expéditeur (défaut Cognito) ne peut pas être
  // personnalisée -- le wordmark et la couleur d'accent doivent donc reprendre exactement
  // l'identité visuelle du site (AppHeader.vue/AppFooter.vue), pas une charte inventée.
  it('reprend le wordmark "RedLink" (casse exacte du site) et la couleur d\'accent #ff3b4e', () => {
    const html = renderLayout({ locale: 'fr', preheader: 'p', heading: 'h', bodyHtml: '<p>b</p>' })
    expect(html).toContain('>RedLink<')
    expect(html).toContain('#ff3b4e')
  })

  it('affiche la tagline du site sous le wordmark', () => {
    const html = renderLayout({ locale: 'fr', preheader: 'p', heading: 'h', bodyHtml: '<p>b</p>' })
    expect(html).toContain("Relie les cliniques vétérinaires aux propriétaires volontaires")
  })
})

describe('renderCodeBlock', () => {
  it('affiche le label et le code fournis', () => {
    const block = renderCodeBlock('Mon label', '123456')
    expect(block).toContain('Mon label')
    expect(block).toContain('123456')
  })
})
