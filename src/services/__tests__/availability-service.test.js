import { describe, it, expect } from 'vitest'
import { TIME_PRESETS, mergeConsecutiveHourRanges } from '@/services/availability-service'

describe('availability-service.TIME_PRESETS', () => {
  it('bornes validées avec le repo owner (2026-08-17) : 8h-12h / 12h-18h / 18h-22h, dans cet ordre', () => {
    expect(TIME_PRESETS).toEqual([
      { key: 'morning', startHour: 8, endHour: 12 },
      { key: 'afternoon', startHour: 12, endHour: 18 },
      { key: 'evening', startHour: 18, endHour: 22 },
    ])
  })
})

describe('availability-service.mergeConsecutiveHourRanges', () => {
  it('un seul preset sélectionné : un seul groupe, non fusionné', () => {
    expect(mergeConsecutiveHourRanges(['morning'])).toEqual([{ startHour: 8, endHour: 12 }])
  })

  it('matin + après-midi (consécutifs) : fusionnés en un seul créneau 8h-18h', () => {
    expect(mergeConsecutiveHourRanges(['morning', 'afternoon'])).toEqual([
      { startHour: 8, endHour: 18 },
    ])
  })

  it('après-midi + soir (consécutifs) : fusionnés en un seul créneau 12h-22h', () => {
    expect(mergeConsecutiveHourRanges(['afternoon', 'evening'])).toEqual([
      { startHour: 12, endHour: 22 },
    ])
  })

  it('matin + après-midi + soir (les trois, tous consécutifs) : fusionnés en un seul créneau 8h-22h', () => {
    expect(mergeConsecutiveHourRanges(['morning', 'afternoon', 'evening'])).toEqual([
      { startHour: 8, endHour: 22 },
    ])
  })

  it("matin + soir SANS après-midi (trou dans la sélection) : reste DEUX créneaux distincts, pas de fusion à travers un preset non coché", () => {
    expect(mergeConsecutiveHourRanges(['morning', 'evening'])).toEqual([
      { startHour: 8, endHour: 12 },
      { startHour: 18, endHour: 22 },
    ])
  })

  it("l'ordre de selectedKeys en entrée n'a pas d'importance : le résultat suit toujours l'ordre de TIME_PRESETS (startHour croissant)", () => {
    expect(mergeConsecutiveHourRanges(['evening', 'morning', 'afternoon'])).toEqual([
      { startHour: 8, endHour: 22 },
    ])
  })

  it('liste vide : aucun groupe', () => {
    expect(mergeConsecutiveHourRanges([])).toEqual([])
  })

  it('clé inconnue ignorée silencieusement (filtrée par TIME_PRESETS, jamais de groupe fantôme)', () => {
    expect(mergeConsecutiveHourRanges(['morning', 'not-a-real-preset'])).toEqual([
      { startHour: 8, endHour: 12 },
    ])
  })
})
