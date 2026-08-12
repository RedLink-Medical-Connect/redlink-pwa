import { describe, it, expect } from 'vitest'
import { calculateDistance, isBloodCompatible } from '@/services/eligibility-service'

// Ces deux fonctions sont au coeur du moteur d'Eligibility (critères "proximité
// géographique" et "compatibilité sanguine") consommé par
// useMatchingRequests.searchMatches(). C'est la logique qui était silencieusement
// jamais atteinte avant le fix (cf. src/composables/__tests__/useMatchingRequests.test.js).

describe('eligibility-service', () => {
  describe('calculateDistance', () => {
    it('renvoie 0 pour deux points identiques', () => {
      expect(calculateDistance(48.8566, 2.3522, 48.8566, 2.3522)).toBeCloseTo(0, 5)
    })

    it('calcule une distance plausible entre Paris et Lyon (~390km)', () => {
      // Paris
      const parisLat = 48.8566
      const parisLon = 2.3522
      // Lyon
      const lyonLat = 45.764
      const lyonLon = 4.8357

      const dist = calculateDistance(parisLat, parisLon, lyonLat, lyonLon)
      expect(dist).toBeGreaterThan(380)
      expect(dist).toBeLessThan(400)
    })

    it.each([
      [null, 2.35, 48.85, 2.35],
      [48.85, null, 48.85, 2.35],
      [48.85, 2.35, null, 2.35],
      [48.85, 2.35, 48.85, null],
      [undefined, 2.35, 48.85, 2.35],
      [0, 2.35, 48.85, 2.35], // 0 est falsy -> traité comme "non renseigné"
    ])(
      'renvoie Infinity si une coordonnée est manquante (%s, %s, %s, %s)',
      (lat1, lon1, lat2, lon2) => {
        expect(calculateDistance(lat1, lon1, lat2, lon2)).toBe(Infinity)
      },
    )
  })

  describe('isBloodCompatible', () => {
    it('est incompatible si les espèces diffèrent', () => {
      expect(isBloodCompatible('DOG', 'DEA 1.1-', 'CAT', 'DEA 1.1-')).toBe(false)
    })

    it('est compatible si la Request est UNKNOWN (indifférent / urgence absolue), quel que soit le groupe animal', () => {
      expect(isBloodCompatible('DOG', 'UNKNOWN', 'DOG', 'DEA 1.1+')).toBe(true)
    })

    it("est incompatible si l'animal n'a pas de groupe sanguin renseigné", () => {
      expect(isBloodCompatible('DOG', 'DEA 1.1-', 'DOG', null)).toBe(false)
      expect(isBloodCompatible('DOG', 'DEA 1.1-', 'DOG', undefined)).toBe(false)
    })

    it("est incompatible si le groupe sanguin de l'animal est UNKNOWN alors que la Request demande un groupe précis", () => {
      expect(isBloodCompatible('DOG', 'DEA 1.1-', 'DOG', 'UNKNOWN')).toBe(false)
    })

    it('est compatible pour une stricte égalité de groupe (MVP: pas de matrice donneur universel)', () => {
      expect(isBloodCompatible('CAT', 'A', 'CAT', 'A')).toBe(true)
    })

    it('est incompatible pour des groupes différents dans la même espèce', () => {
      expect(isBloodCompatible('CAT', 'A', 'CAT', 'B')).toBe(false)
    })
  })
})
