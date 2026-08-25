import { describe, it, expect } from 'vitest'
import { renderLegalMarkdown } from '@/services/legal-content-service.js'

describe('legal-content-service.renderLegalMarkdown', () => {
  it('rend un titre de niveau 2 en <h2>', () => {
    expect(renderLegalMarkdown('## Titre')).toContain('<h2>Titre</h2>')
  })

  it('rend un paragraphe en <p>', () => {
    expect(renderLegalMarkdown('Un paragraphe.')).toContain('<p>Un paragraphe.</p>')
  })

  it('rend une liste à puces en <ul>/<li>', () => {
    const html = renderLegalMarkdown('- premier\n- second')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>premier</li>')
    expect(html).toContain('<li>second</li>')
  })

  it('rend une citation (bandeau "contenu provisoire") en <blockquote>', () => {
    expect(renderLegalMarkdown('> Contenu provisoire.')).toContain('<blockquote>')
  })
})
