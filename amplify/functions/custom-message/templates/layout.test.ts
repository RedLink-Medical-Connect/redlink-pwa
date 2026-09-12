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
})

describe('renderCodeBlock', () => {
  it('affiche le label et le code fournis', () => {
    const block = renderCodeBlock('Mon label', '123456')
    expect(block).toContain('Mon label')
    expect(block).toContain('123456')
  })
})
