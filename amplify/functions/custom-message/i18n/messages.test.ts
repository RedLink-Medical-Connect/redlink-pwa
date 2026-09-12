// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { resolveEmailLocale, DEFAULT_EMAIL_LOCALE, emailMessages } from './messages'

describe('resolveEmailLocale', () => {
  it("renvoie 'en' quand la locale brute vaut exactement 'en'", () => {
    expect(resolveEmailLocale('en')).toBe('en')
  })

  it("referme sur la locale par défaut (fr) quand la locale brute est absente", () => {
    expect(resolveEmailLocale(undefined)).toBe(DEFAULT_EMAIL_LOCALE)
  })

  it("referme sur la locale par défaut (fr) pour toute valeur non reconnue (pas seulement une string vide)", () => {
    expect(resolveEmailLocale('de')).toBe(DEFAULT_EMAIL_LOCALE)
    expect(resolveEmailLocale('EN')).toBe(DEFAULT_EMAIL_LOCALE)
    expect(resolveEmailLocale('')).toBe(DEFAULT_EMAIL_LOCALE)
  })
})

describe('emailMessages', () => {
  it('fournit les deux locales supportées par le front (fr/en, src/i18n.js)', () => {
    expect(Object.keys(emailMessages).sort()).toEqual(['en', 'fr'])
  })

  it('footerRights interpole bien l\'année reçue (pas une valeur figée)', () => {
    expect(emailMessages.fr.footerRights(2030)).toContain('2030')
    expect(emailMessages.en.footerRights(2030)).toContain('2030')
  })
})
