import { describe, it, expect } from 'vitest'
import { matchesAvailability } from '@/services/eligibility-service'

// Phase 6.5 (ADR-0005) : matchesAvailability() est un filtre EXCLUSIF supplémentaire pour
// les Requests APPOINTMENT, volontairement SÉPARÉ des 5 critères hiérarchisés de
// checkEligibility() (voir eligibility-service.criteria.test.js pour ces derniers) — ce
// fichier teste donc matchesAvailability() en isolation totale, jamais via le composite.
//
// `dayOfWeek` suit la convention Date.prototype.getDay() (0 = dimanche ... 6 = samedi),
// identique à src/constants/date-constants.js / AvailabilityView.vue.

describe('matchesAvailability', () => {
  // Mercredi 12 août 2026, 10h30 (heure locale) -- Date.prototype.getDay() === 3.
  const WEDNESDAY_10_30 = new Date(2026, 7, 12, 10, 30, 0).toISOString()

  it("renvoie false sans planter si appointmentDatetime est absent/null/undefined", () => {
    const availabilities = [{ dayOfWeek: 3, startTime: '09:00', endTime: '12:00' }]
    expect(matchesAvailability(availabilities, null)).toBe(false)
    expect(matchesAvailability(availabilities, undefined)).toBe(false)
    expect(matchesAvailability(availabilities, '')).toBe(false)
  })

  it('renvoie false si appointmentDatetime est une date invalide', () => {
    const availabilities = [{ dayOfWeek: 3, startTime: '09:00', endTime: '12:00' }]
    expect(matchesAvailability(availabilities, 'pas-une-date')).toBe(false)
  })

  it("renvoie true (\"toujours disponible\" par défaut, amendement ADR-0005 2026-08-17) si availabilities est vide, absent ou n'est pas un tableau", () => {
    expect(matchesAvailability([], WEDNESDAY_10_30)).toBe(true)
    expect(matchesAvailability(undefined, WEDNESDAY_10_30)).toBe(true)
    expect(matchesAvailability(null, WEDNESDAY_10_30)).toBe(true)
  })

  it("renvoie true si le rendez-vous tombe dans un créneau du bon jour", () => {
    const availabilities = [{ dayOfWeek: 3, startTime: '09:00', endTime: '12:00' }]
    expect(matchesAvailability(availabilities, WEDNESDAY_10_30)).toBe(true)
  })

  it("renvoie false si aucun créneau ne correspond au jour de la semaine du rendez-vous", () => {
    // Créneau un jeudi (4), rendez-vous un mercredi (3).
    const availabilities = [{ dayOfWeek: 4, startTime: '09:00', endTime: '12:00' }]
    expect(matchesAvailability(availabilities, WEDNESDAY_10_30)).toBe(false)
  })

  it("renvoie false si le bon jour a un créneau mais l'heure du rendez-vous tombe en dehors", () => {
    // Mercredi, mais le créneau se termine avant 10h30.
    const availabilities = [{ dayOfWeek: 3, startTime: '07:00', endTime: '09:00' }]
    expect(matchesAvailability(availabilities, WEDNESDAY_10_30)).toBe(false)
  })

  it('applique les bornes de façon inclusive : exactement à startTime et exactement à endTime matchent toutes les deux', () => {
    const startBoundary = new Date(2026, 7, 12, 9, 0, 0).toISOString()
    const endBoundary = new Date(2026, 7, 12, 12, 0, 0).toISOString()
    const availabilities = [{ dayOfWeek: 3, startTime: '09:00', endTime: '12:00' }]

    expect(matchesAvailability(availabilities, startBoundary)).toBe(true)
    expect(matchesAvailability(availabilities, endBoundary)).toBe(true)
  })

  it('renvoie false pour un rendez-vous juste avant/juste après le créneau (limites strictes)', () => {
    const justBefore = new Date(2026, 7, 12, 8, 59, 0).toISOString()
    const justAfter = new Date(2026, 7, 12, 12, 1, 0).toISOString()
    const availabilities = [{ dayOfWeek: 3, startTime: '09:00', endTime: '12:00' }]

    expect(matchesAvailability(availabilities, justBefore)).toBe(false)
    expect(matchesAvailability(availabilities, justAfter)).toBe(false)
  })

  it('trouve un créneau valide parmi plusieurs disponibilités, même si les autres ne correspondent pas', () => {
    const availabilities = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }, // lundi -- pas le bon jour
      { dayOfWeek: 3, startTime: '14:00', endTime: '18:00' }, // mercredi, mais trop tard pour 10h30
      { dayOfWeek: 3, startTime: '09:00', endTime: '12:00' }, // mercredi, celui qui matche
    ]
    expect(matchesAvailability(availabilities, WEDNESDAY_10_30)).toBe(true)
  })

  it("normalise les formats AWSTime avec secondes/millisecondes (\"HH:mm:ss\", \"HH:mm:ss.SSS\") comme le fait déjà AvailabilityView.vue (slot.startTime.substring(0, 5))", () => {
    const availabilities = [{ dayOfWeek: 3, startTime: '09:00:00', endTime: '12:00:00.000' }]
    expect(matchesAvailability(availabilities, WEDNESDAY_10_30)).toBe(true)
  })

  it('ignore une disponibilité avec un startTime/endTime manquant ou mal formé plutôt que de planter', () => {
    const availabilities = [
      { dayOfWeek: 3, startTime: null, endTime: '12:00' },
      { dayOfWeek: 3, startTime: '09:00', endTime: undefined },
      { dayOfWeek: 3 },
    ]
    expect(matchesAvailability(availabilities, WEDNESDAY_10_30)).toBe(false)
  })
})
