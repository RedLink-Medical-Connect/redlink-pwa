// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  calculateDistance,
  isBloodCompatible,
  isValidatedDonor,
  satisfiesFrequencyRule,
  matchesAvailability,
  matchesAvailabilityWindow,
} from './eligibility'

// Port TS de `src/services/eligibility-service.js` pour `request-matcher-notifier` -- ce test
// vérifie que le PORT reproduit fidèlement le comportement de l'original sur les cas qui
// comptent (pas un décalque exhaustif des tests frontend existants, voir l'en-tête du module).

describe('calculateDistance', () => {
  it('renvoie Infinity si une coordonnée manque (même repli que le service frontend)', () => {
    expect(calculateDistance(null, 2, 3, 4)).toBe(Infinity)
    expect(calculateDistance(1, 2, undefined, 4)).toBe(Infinity)
  })

  it('calcule une distance Haversine positive et cohérente (Paris -> Lyon ~390km)', () => {
    const distance = calculateDistance(48.8566, 2.3522, 45.75, 4.85)
    expect(distance).toBeGreaterThan(380)
    expect(distance).toBeLessThan(400)
  })

  it('distance nulle pour deux points identiques', () => {
    expect(calculateDistance(48.85, 2.35, 48.85, 2.35)).toBeCloseTo(0, 5)
  })
})

describe('isBloodCompatible', () => {
  it('espèces différentes -> incompatible', () => {
    expect(isBloodCompatible('DOG', 'A', 'CAT', 'A')).toBe(false)
  })

  it("groupe demandé UNKNOWN -> toujours compatible (même espèce)", () => {
    expect(isBloodCompatible('DOG', 'UNKNOWN', 'DOG', 'DEA 1.1+')).toBe(true)
  })

  it("groupe de l'animal UNKNOWN/absent -> incompatible (sécurité)", () => {
    expect(isBloodCompatible('DOG', 'DEA 1.1+', 'DOG', 'UNKNOWN')).toBe(false)
    expect(isBloodCompatible('DOG', 'DEA 1.1+', 'DOG', null)).toBe(false)
  })

  it('comparaison stricte : même groupe requis', () => {
    expect(isBloodCompatible('CAT', 'A', 'CAT', 'A')).toBe(true)
    expect(isBloodCompatible('CAT', 'A', 'CAT', 'B')).toBe(false)
  })
})

describe('isValidatedDonor', () => {
  const now = new Date('2026-09-18T00:00:00.000Z')

  it("false si le flag brut n'est pas true", () => {
    expect(isValidatedDonor({ isValidatedDonor: false, validationExpiresAt: '2027-01-01' }, now)).toBe(
      false,
    )
  })

  it('false si validationExpiresAt absent (fail-safe)', () => {
    expect(isValidatedDonor({ isValidatedDonor: true }, now)).toBe(false)
  })

  it('true si la validation est encore valide', () => {
    expect(
      isValidatedDonor({ isValidatedDonor: true, validationExpiresAt: '2027-01-01' }, now),
    ).toBe(true)
  })

  it('false si la validation a expiré', () => {
    expect(
      isValidatedDonor({ isValidatedDonor: true, validationExpiresAt: '2026-01-01' }, now),
    ).toBe(false)
  })
})

describe('satisfiesFrequencyRule', () => {
  const now = new Date('2026-09-18T00:00:00.000Z')

  it('jamais donné -> toujours satisfaite', () => {
    expect(satisfiesFrequencyRule({}, now)).toBe(true)
  })

  it('ONCE_YEAR : refuse un don trop récent (< 365j)', () => {
    expect(
      satisfiesFrequencyRule(
        { lastDonationDate: '2026-06-01', donationFrequency: 'ONCE_YEAR' },
        now,
      ),
    ).toBe(false)
  })

  it('ONCE_YEAR : accepte au-delà de 365j', () => {
    expect(
      satisfiesFrequencyRule(
        { lastDonationDate: '2025-01-01', donationFrequency: 'ONCE_YEAR' },
        now,
      ),
    ).toBe(true)
  })

  it('donationFrequency inconnue -> traitée comme ONCE_YEAR (le plus strict)', () => {
    expect(
      satisfiesFrequencyRule({ lastDonationDate: '2026-06-01', donationFrequency: 'BOGUS' }, now),
    ).toBe(false)
  })
})

describe('matchesAvailability', () => {
  it('aucun créneau renseigné -> toujours disponible (amendement ADR-0005)', () => {
    expect(matchesAvailability([], '2026-09-21T10:00:00.000Z')).toBe(true)
  })

  it('appointmentDatetime absent -> false', () => {
    expect(matchesAvailability([{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }], null)).toBe(
      false,
    )
  })
})

describe('matchesAvailabilityWindow', () => {
  it('aucun créneau renseigné -> toujours disponible', () => {
    expect(
      matchesAvailabilityWindow([], '2026-09-21T10:00:00.000Z', '2026-09-21T12:00:00.000Z'),
    ).toBe(true)
  })

  it('windowStart >= windowEnd -> false (plage invalide)', () => {
    expect(
      matchesAvailabilityWindow(
        [{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }],
        '2026-09-21T12:00:00.000Z',
        '2026-09-21T10:00:00.000Z',
      ),
    ).toBe(false)
  })
})
