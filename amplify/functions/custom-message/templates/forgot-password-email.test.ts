// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { renderForgotPasswordEmail } from './forgot-password-email'

describe('renderForgotPasswordEmail', () => {
  it('rend le sujet et le HTML en français par défaut (locale absente), avec la note "si vous n\'êtes pas à l\'origine"', () => {
    const { subject, html } = renderForgotPasswordEmail({ code: '123456', locale: undefined })
    expect(subject).toBe('Réinitialisation de votre mot de passe Redlink')
    expect(html).toContain('123456')
    expect(html).toContain("Si vous n'êtes pas à l'origine de cette demande")
  })

  it('rend le sujet et le HTML en anglais quand la locale vaut en', () => {
    const { subject, html } = renderForgotPasswordEmail({ code: '654321', locale: 'en' })
    expect(subject).toBe('Reset your Redlink password')
    expect(html).toContain('654321')
    expect(html).toContain("If you didn't request this")
  })
})
