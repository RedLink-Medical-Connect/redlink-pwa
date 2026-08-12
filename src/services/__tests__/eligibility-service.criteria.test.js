import { describe, it, expect } from 'vitest'
import {
  isValidatedDonor,
  satisfiesFrequencyRule,
  MIN_DAYS_BETWEEN_DONATIONS,
  hasClinicPriority,
  checkEligibility,
} from '@/services/eligibility-service'
import { DonationFrequency } from '@/constants/enums'

// Tests des 3 critères ajoutés au moteur d'Eligibility (CONTEXT.md) qui n'étaient pas
// couverts par eligibility-service.test.js (celui-ci ne couvrait historiquement que
// calculateDistance / isBloodCompatible, cf. geolocation-service.js d'origine) :
// Validated Donor (critère 1), Frequency Rule (critère 3), Clinic Priority (critère 5),
// ainsi que le seam composite checkEligibility qui orchestre les 5 critères.

const NOW = new Date('2026-08-12T12:00:00.000Z')

describe('eligibility-service — nouveaux critères', () => {
  describe('isValidatedDonor', () => {
    it('est false si isValidatedDonor est absent/false', () => {
      expect(isValidatedDonor({ isValidatedDonor: false, validationExpiresAt: '2027-01-01' }, NOW)).toBe(false)
      expect(isValidatedDonor({ validationExpiresAt: '2027-01-01' }, NOW)).toBe(false)
    })

    it('est false si validationExpiresAt est absent, même si isValidatedDonor est true', () => {
      expect(isValidatedDonor({ isValidatedDonor: true, validationExpiresAt: null }, NOW)).toBe(false)
      expect(isValidatedDonor({ isValidatedDonor: true }, NOW)).toBe(false)
    })

    it('est false si validationExpiresAt est expiré', () => {
      expect(
        isValidatedDonor({ isValidatedDonor: true, validationExpiresAt: '2026-01-01T00:00:00.000Z' }, NOW),
      ).toBe(false)
    })

    it('est false si validationExpiresAt expire exactement maintenant (strictement après requis)', () => {
      expect(
        isValidatedDonor({ isValidatedDonor: true, validationExpiresAt: NOW.toISOString() }, NOW),
      ).toBe(false)
    })

    it('est true si isValidatedDonor et validationExpiresAt dans le futur', () => {
      expect(
        isValidatedDonor({ isValidatedDonor: true, validationExpiresAt: '2027-01-01T00:00:00.000Z' }, NOW),
      ).toBe(true)
    })

    it('est false si validationExpiresAt est une date invalide', () => {
      expect(
        isValidatedDonor({ isValidatedDonor: true, validationExpiresAt: 'not-a-date' }, NOW),
      ).toBe(false)
    })
  })

  describe('satisfiesFrequencyRule', () => {
    it("est true si l'animal n'a jamais donné (lastDonationDate absent)", () => {
      expect(satisfiesFrequencyRule({ lastDonationDate: null, donationFrequency: DonationFrequency.ONCE_YEAR }, NOW)).toBe(true)
      expect(satisfiesFrequencyRule({ donationFrequency: DonationFrequency.ONCE_YEAR }, NOW)).toBe(true)
    })

    it('est false si le dernier don est trop récent pour ONCE_YEAR (365j)', () => {
      const last = new Date(NOW.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString()
      expect(
        satisfiesFrequencyRule({ lastDonationDate: last, donationFrequency: DonationFrequency.ONCE_YEAR }, NOW),
      ).toBe(false)
    })

    it('est true si le dernier don dépasse le seuil ONCE_YEAR (365j)', () => {
      const last = new Date(NOW.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString()
      expect(
        satisfiesFrequencyRule({ lastDonationDate: last, donationFrequency: DonationFrequency.ONCE_YEAR }, NOW),
      ).toBe(true)
    })

    it('applique le seuil TWICE_YEAR (182j)', () => {
      const justUnder = new Date(NOW.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString()
      const justOver = new Date(NOW.getTime() - 190 * 24 * 60 * 60 * 1000).toISOString()
      expect(
        satisfiesFrequencyRule({ lastDonationDate: justUnder, donationFrequency: DonationFrequency.TWICE_YEAR }, NOW),
      ).toBe(false)
      expect(
        satisfiesFrequencyRule({ lastDonationDate: justOver, donationFrequency: DonationFrequency.TWICE_YEAR }, NOW),
      ).toBe(true)
    })

    it('ASAP ne rajoute aucun délai (0j) : un don d\'hier redevient éligible', () => {
      const yesterday = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString()
      expect(
        satisfiesFrequencyRule({ lastDonationDate: yesterday, donationFrequency: DonationFrequency.ASAP }, NOW),
      ).toBe(true)
    })

    it('traite une donationFrequency non reconnue ou absente comme le cas le plus strict (ONCE_YEAR) — fail-safe', () => {
      const last = new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString()
      expect(
        satisfiesFrequencyRule({ lastDonationDate: last, donationFrequency: 'NOT_A_REAL_FREQUENCY' }, NOW),
      ).toBe(false)
      expect(satisfiesFrequencyRule({ lastDonationDate: last }, NOW)).toBe(false)

      // Confirme explicitement que ONCE_YEAR est bien la valeur utilisée par le fallback.
      expect(MIN_DAYS_BETWEEN_DONATIONS[DonationFrequency.ONCE_YEAR]).toBe(365)
    })
  })

  describe('hasClinicPriority', () => {
    it('est true si la clinique de la Request fait partie des clinics liées à l\'Owner', () => {
      expect(hasClinicPriority(['clinic-1', 'clinic-2'], 'clinic-2')).toBe(true)
    })

    it("est false (sans jamais exclure) si la clinique n'est pas dans la liste", () => {
      expect(hasClinicPriority(['clinic-1'], 'clinic-99')).toBe(false)
    })

    it('gère une liste vide/absente sans planter', () => {
      expect(hasClinicPriority([], 'clinic-1')).toBe(false)
      expect(hasClinicPriority(undefined, 'clinic-1')).toBe(false)
    })
  })

  describe('checkEligibility (seam composite)', () => {
    const baseAnimal = {
      isValidatedDonor: true,
      validationExpiresAt: '2027-01-01T00:00:00.000Z',
      species: 'DOG',
      bloodGroup: 'DEA 1.1+',
      lastDonationDate: null,
      donationFrequency: DonationFrequency.ONCE_YEAR,
    }

    const baseRequest = {
      requiredSpecies: 'DOG',
      requiredBloodGroup: 'DEA 1.1+',
      clinic: { id: 'clinic-1', latitude: 48.8566, longitude: 2.3522 },
    }

    const baseParams = {
      animal: baseAnimal,
      request: baseRequest,
      ownerLatitude: 48.8566,
      ownerLongitude: 2.3522,
      maxTravelDistance: 50,
      ownerClinicIds: [],
      now: NOW,
    }

    it('est eligible quand les 4 critères exclusifs passent, reason est null', () => {
      const result = checkEligibility(baseParams)
      expect(result.eligible).toBe(true)
      expect(result.reason).toBeNull()
      expect(result.distanceKM).toBeCloseTo(0, 5)
    })

    it('échoue sur NOT_VALIDATED_DONOR en priorité sur tout le reste (validation expirée)', () => {
      const result = checkEligibility({
        ...baseParams,
        animal: { ...baseAnimal, validationExpiresAt: '2020-01-01T00:00:00.000Z' },
      })
      expect(result.eligible).toBe(false)
      expect(result.reason).toBe('NOT_VALIDATED_DONOR')
      expect(result.distanceKM).toBeNull()
    })

    it('échoue sur BLOOD_INCOMPATIBLE quand le groupe animal ne correspond pas', () => {
      const result = checkEligibility({
        ...baseParams,
        animal: { ...baseAnimal, bloodGroup: 'DEA 1.1-' },
      })
      expect(result.eligible).toBe(false)
      expect(result.reason).toBe('BLOOD_INCOMPATIBLE')
    })

    it('la Request UNKNOWN reste universellement compatible (ne bloque pas sur le groupe)', () => {
      const result = checkEligibility({
        ...baseParams,
        request: { ...baseRequest, requiredBloodGroup: 'UNKNOWN' },
        animal: { ...baseAnimal, bloodGroup: 'DEA 1.1-' },
      })
      expect(result.eligible).toBe(true)
      expect(result.reason).toBeNull()
    })

    it("un animal sans groupe sanguin renseigné (UNKNOWN) échoue même si la Request est UNKNOWN n'entre pas en jeu ici — reste BLOOD_INCOMPATIBLE dès que la Request demande un groupe précis", () => {
      const result = checkEligibility({
        ...baseParams,
        animal: { ...baseAnimal, bloodGroup: 'UNKNOWN' },
      })
      expect(result.eligible).toBe(false)
      expect(result.reason).toBe('BLOOD_INCOMPATIBLE')
    })

    it('échoue sur FREQUENCY_RULE quand le dernier don est trop récent', () => {
      const result = checkEligibility({
        ...baseParams,
        animal: {
          ...baseAnimal,
          lastDonationDate: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        },
      })
      expect(result.eligible).toBe(false)
      expect(result.reason).toBe('FREQUENCY_RULE')
    })

    it('lastDonationDate null passe toujours la Frequency Rule (jamais donné)', () => {
      const result = checkEligibility({ ...baseParams, animal: { ...baseAnimal, lastDonationDate: null } })
      expect(result.reason).not.toBe('FREQUENCY_RULE')
    })

    it('échoue sur TOO_FAR quand la distance dépasse maxTravelDistance', () => {
      const result = checkEligibility({
        ...baseParams,
        request: { ...baseRequest, clinic: { id: 'clinic-1', latitude: 45.764, longitude: 4.8357 } }, // Lyon, ~390km
        maxTravelDistance: 50,
      })
      expect(result.eligible).toBe(false)
      expect(result.reason).toBe('TOO_FAR')
      expect(result.distanceKM).toBeGreaterThan(50)
    })

    it("hasClinicPriority ne cause JAMAIS l'exclusion, même à false — l'animal reste eligible", () => {
      const result = checkEligibility({ ...baseParams, ownerClinicIds: ['some-other-clinic'] })
      expect(result.eligible).toBe(true)
      expect(result.hasClinicPriority).toBe(false)
    })

    it('hasClinicPriority est true quand la clinique de la Request est dans ownerClinicIds, sans changer eligible', () => {
      const result = checkEligibility({ ...baseParams, ownerClinicIds: ['clinic-1'] })
      expect(result.eligible).toBe(true)
      expect(result.hasClinicPriority).toBe(true)
    })

    it('hasClinicPriority est calculé même quand un critère exclusif échoue (ex : NOT_VALIDATED_DONOR)', () => {
      const result = checkEligibility({
        ...baseParams,
        animal: { ...baseAnimal, isValidatedDonor: false },
        ownerClinicIds: ['clinic-1'],
      })
      expect(result.eligible).toBe(false)
      expect(result.hasClinicPriority).toBe(true)
    })
  })
})
