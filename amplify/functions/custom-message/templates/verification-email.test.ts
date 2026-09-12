// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { renderVerificationEmail } from './verification-email'

describe('renderVerificationEmail', () => {
  it('rend le sujet et le HTML en français par défaut (locale absente)', () => {
    const { subject, html } = renderVerificationEmail({ code: '123456', locale: undefined })
    expect(subject).toBe('Confirmez votre adresse email Redlink')
    expect(html).toContain('123456')
    expect(html).toContain('Bienvenue sur Redlink')
  })

  it('rend le sujet et le HTML en anglais quand la locale vaut en', () => {
    const { subject, html } = renderVerificationEmail({ code: '654321', locale: 'en' })
    expect(subject).toBe('Confirm your Redlink email address')
    expect(html).toContain('654321')
    expect(html).toContain('Welcome to Redlink')
  })

  it('referme sur le français pour une locale non reconnue', () => {
    const { subject } = renderVerificationEmail({ code: '111111', locale: 'de' })
    expect(subject).toBe('Confirmez votre adresse email Redlink')
  })
})
