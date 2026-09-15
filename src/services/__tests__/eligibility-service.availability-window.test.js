import { describe, it, expect } from 'vitest'
import { matchesAvailabilityWindow } from '@/services/eligibility-service'

// Alternative "plage horaire" à matchesAvailability() (eligibility-service.availability.test.js)
// pour une Request APPOINTMENT en mode `appointmentWindowStart`/`appointmentWindowEnd` (voir
// amplify/data/resource.ts) -- compare deux INTERVALLES (recouvrement) plutôt qu'un point dans
// un intervalle. Même conventions que le fichier voisin : `dayOfWeek` suit
// Date.prototype.getDay() (0 = dimanche ... 6 = samedi).

describe('matchesAvailabilityWindow', () => {
  // Mercredi 12 août 2026 -- Date.prototype.getDay() === 3.
  const WEDNESDAY_12H = new Date(2026, 7, 12, 12, 0, 0).toISOString()
  const WEDNESDAY_18H = new Date(2026, 7, 12, 18, 0, 0).toISOString()

  it('renvoie false sans planter si windowStart/windowEnd est absent/null/undefined', () => {
    const availabilities = [{ dayOfWeek: 3, startTime: '09:00', endTime: '20:00' }]
    expect(matchesAvailabilityWindow(availabilities, null, WEDNESDAY_18H)).toBe(false)
    expect(matchesAvailabilityWindow(availabilities, WEDNESDAY_12H, undefined)).toBe(false)
    expect(matchesAvailabilityWindow(availabilities, '', '')).toBe(false)
  })

  it('renvoie false si windowStart ou windowEnd est une date invalide', () => {
    const availabilities = [{ dayOfWeek: 3, startTime: '09:00', endTime: '20:00' }]
    expect(matchesAvailabilityWindow(availabilities, 'pas-une-date', WEDNESDAY_18H)).toBe(false)
    expect(matchesAvailabilityWindow(availabilities, WEDNESDAY_12H, 'pas-une-date')).toBe(false)
  })

  it('renvoie false si windowStart >= windowEnd (plage invalide/inversée)', () => {
    const availabilities = [{ dayOfWeek: 3, startTime: '09:00', endTime: '20:00' }]
    expect(matchesAvailabilityWindow(availabilities, WEDNESDAY_18H, WEDNESDAY_12H)).toBe(false)
    expect(matchesAvailabilityWindow(availabilities, WEDNESDAY_12H, WEDNESDAY_12H)).toBe(false)
  })

  it('renvoie true ("toujours disponible" par défaut, même amendement ADR-0005 que matchesAvailability) si availabilities est vide, absent ou n\'est pas un tableau', () => {
    expect(matchesAvailabilityWindow([], WEDNESDAY_12H, WEDNESDAY_18H)).toBe(true)
    expect(matchesAvailabilityWindow(undefined, WEDNESDAY_12H, WEDNESDAY_18H)).toBe(true)
    expect(matchesAvailabilityWindow(null, WEDNESDAY_12H, WEDNESDAY_18H)).toBe(true)
  })

  it('renvoie true si la plage clinique est entièrement contenue dans un créneau Owner', () => {
    const availabilities = [{ dayOfWeek: 3, startTime: '09:00', endTime: '20:00' }]
    expect(matchesAvailabilityWindow(availabilities, WEDNESDAY_12H, WEDNESDAY_18H)).toBe(true)
  })

  it('renvoie true sur un simple recouvrement PARTIEL -- la plage clinique n\'a pas besoin d\'être entièrement contenue dans le créneau Owner', () => {
    // Owner libre 14h-22h, plage clinique 12h-18h : se recouvrent sur 14h-18h seulement.
    const availabilities = [{ dayOfWeek: 3, startTime: '14:00', endTime: '22:00' }]
    expect(matchesAvailabilityWindow(availabilities, WEDNESDAY_12H, WEDNESDAY_18H)).toBe(true)
  })

  it("renvoie false si aucun créneau ne correspond au jour de la semaine de la plage", () => {
    // Créneau un jeudi (4), plage clinique un mercredi (3).
    const availabilities = [{ dayOfWeek: 4, startTime: '09:00', endTime: '20:00' }]
    expect(matchesAvailabilityWindow(availabilities, WEDNESDAY_12H, WEDNESDAY_18H)).toBe(false)
  })

  it('renvoie false si les deux plages ne se recouvrent pas du tout', () => {
    // Owner libre 19h-22h, plage clinique 12h-18h : aucun recouvrement.
    const availabilities = [{ dayOfWeek: 3, startTime: '19:00', endTime: '22:00' }]
    expect(matchesAvailabilityWindow(availabilities, WEDNESDAY_12H, WEDNESDAY_18H)).toBe(false)
  })

  it('renvoie false pour deux plages qui se touchent SANS réellement se superposer (bornes demi-ouvertes)', () => {
    // Owner libre jusqu'à 12h pile, plage clinique à partir de 12h pile.
    const availabilities = [{ dayOfWeek: 3, startTime: '08:00', endTime: '12:00' }]
    expect(matchesAvailabilityWindow(availabilities, WEDNESDAY_12H, WEDNESDAY_18H)).toBe(false)
  })

  it('trouve un créneau valide parmi plusieurs disponibilités, même si les autres ne correspondent pas', () => {
    const availabilities = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '20:00' }, // lundi -- pas le bon jour
      { dayOfWeek: 3, startTime: '19:00', endTime: '22:00' }, // mercredi, mais trop tard
      { dayOfWeek: 3, startTime: '10:00', endTime: '15:00' }, // mercredi, celui qui recouvre
    ]
    expect(matchesAvailabilityWindow(availabilities, WEDNESDAY_12H, WEDNESDAY_18H)).toBe(true)
  })

  it('normalise les formats AWSTime avec secondes/millisecondes ("HH:mm:ss", "HH:mm:ss.SSS")', () => {
    const availabilities = [{ dayOfWeek: 3, startTime: '09:00:00', endTime: '20:00:00.000' }]
    expect(matchesAvailabilityWindow(availabilities, WEDNESDAY_12H, WEDNESDAY_18H)).toBe(true)
  })

  it('ignore une disponibilité avec un startTime/endTime manquant ou mal formé plutôt que de planter', () => {
    const availabilities = [
      { dayOfWeek: 3, startTime: null, endTime: '20:00' },
      { dayOfWeek: 3, startTime: '09:00', endTime: undefined },
      { dayOfWeek: 3 },
    ]
    expect(matchesAvailabilityWindow(availabilities, WEDNESDAY_12H, WEDNESDAY_18H)).toBe(false)
  })

  it('limite assumée : une plage qui déborde sur le jour suivant ne plante pas mais ne matche jamais (comparaison de l\'heure du jour en chaînes "HH:mm", pas de vraie arithmétique de plage) -- cas non censé se produire côté saisie, NewRequestView.vue force la même date calendaire pour windowStart/windowEnd', () => {
    const windowStart = new Date(2026, 7, 12, 23, 0, 0).toISOString()
    const windowEnd = new Date(2026, 7, 13, 1, 0, 0).toISOString()
    const availabilities = [{ dayOfWeek: 3, startTime: '20:00', endTime: '23:30' }]
    expect(matchesAvailabilityWindow(availabilities, windowStart, windowEnd)).toBe(false)
  })
})
