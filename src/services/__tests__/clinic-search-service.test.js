import { describe, it, expect } from 'vitest'
import { filterClinics, normalizeSearchText } from '@/services/clinic-search-service'

const clinics = [
  { id: 'c2', name: 'Clinique St-Bernard', address: '12 rue des Lilas, 75011 Paris' },
  { id: 'c1', name: 'Clinique Vétérinaire des Alpes', address: '3 av. Jean Jaurès, Grenoble' },
  { id: 'c3', name: 'AniCura Lyon', address: null },
]

describe('normalizeSearchText', () => {
  it('passe en minuscules et retire les accents', () => {
    expect(normalizeSearchText('  Vétérinaire ÉCOLE ')).toBe('veterinaire ecole')
  })

  it('tolère null/undefined', () => {
    expect(normalizeSearchText(null)).toBe('')
    expect(normalizeSearchText(undefined)).toBe('')
  })
})

describe('filterClinics', () => {
  it('requête vide : toutes les cliniques, triées par nom', () => {
    expect(filterClinics(clinics, '').map((c) => c.id)).toEqual(['c3', 'c2', 'c1'])
    expect(filterClinics(clinics, '   ').map((c) => c.id)).toEqual(['c3', 'c2', 'c1'])
  })

  it('cherche dans le nom, sans tenir compte des accents ni de la casse', () => {
    expect(filterClinics(clinics, 'veterinaire').map((c) => c.id)).toEqual(['c1'])
  })

  it("cherche aussi dans l'adresse (ville)", () => {
    expect(filterClinics(clinics, 'grenoble').map((c) => c.id)).toEqual(['c1'])
  })

  it('plusieurs mots : tous doivent correspondre, dans un ordre libre', () => {
    expect(filterClinics(clinics, 'paris bernard').map((c) => c.id)).toEqual(['c2'])
    expect(filterClinics(clinics, 'paris alpes')).toEqual([])
  })

  it('adresse absente : ne plante pas, cherche dans le nom seul', () => {
    expect(filterClinics(clinics, 'lyon').map((c) => c.id)).toEqual(['c3'])
  })

  it("ne modifie pas le tableau d'entrée", () => {
    const copy = [...clinics]
    filterClinics(clinics, '')
    expect(clinics).toEqual(copy)
  })
})
