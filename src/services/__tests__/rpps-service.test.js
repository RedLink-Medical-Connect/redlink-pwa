import { describe, it, expect } from 'vitest'
import { isValidRpps } from '@/services/rpps-service'

// Deux numéros valides générés en trouvant, pour une base de 10 chiffres, le chiffre de clé
// qui satisfait l'algorithme de Luhn (voir la note dans rpps-service.js) -- pas des numéros
// RPPS réels (aucune garantie/besoin de correspondre à un professionnel existant, seule la
// propriété arithmétique du format est testée ici).
const VALID_RPPS_1 = '12345678903'
const VALID_RPPS_2 = '10101010105'

describe('isValidRpps', () => {
  it('accepte un numéro à 11 chiffres avec une clé de Luhn correcte', () => {
    expect(isValidRpps(VALID_RPPS_1)).toBe(true)
    expect(isValidRpps(VALID_RPPS_2)).toBe(true)
  })

  it('rejette un numéro à 11 chiffres avec une clé de Luhn incorrecte (faute de frappe typique)', () => {
    const wrongKey = VALID_RPPS_1.slice(0, -1) + String((Number(VALID_RPPS_1.at(-1)) + 1) % 10)
    expect(isValidRpps(wrongKey)).toBe(false)
  })

  it('rejette un numéro trop court ou trop long', () => {
    expect(isValidRpps(VALID_RPPS_1.slice(0, -1))).toBe(false)
    expect(isValidRpps(`${VALID_RPPS_1}0`)).toBe(false)
  })

  it('rejette une chaîne contenant des lettres ou un séparateur', () => {
    expect(isValidRpps('1234567890A')).toBe(false)
    expect(isValidRpps('123 456 789 03')).toBe(false)
    expect(isValidRpps('123-456-78903')).toBe(false)
  })

  it('rejette une entrée vide, null, ou non-string', () => {
    expect(isValidRpps('')).toBe(false)
    expect(isValidRpps(null)).toBe(false)
    expect(isValidRpps(undefined)).toBe(false)
    expect(isValidRpps(12345678903)).toBe(false)
  })

  it('tolère les espaces en début/fin (saisie utilisateur), pas au milieu', () => {
    expect(isValidRpps(`  ${VALID_RPPS_1}  `)).toBe(true)
  })
})
