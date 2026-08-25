import { describe, it, expect } from 'vitest'
import { resolveClinicOwnerRelationUpsert } from '@/services/clinic-owner-relation-service'

// Déplacé depuis useMissionClosure.test.js (demande produit 2026-08-23) : la fonction pure
// vit désormais dans ce service partagé (voir clinic-owner-relation-service.js), appelée à
// la fois par useMissionClosure.js (clôture COMPLETED) et useAnimalValidation.js (validation
// vétérinaire) -- ces tests suivent leur fonction, comportement inchangé.
describe('resolveClinicOwnerRelationUpsert (fonction pure, testable sans mock GraphQL)', () => {
  it('retourne null si une relation existe déjà pour ce clinicID exact', () => {
    const result = resolveClinicOwnerRelationUpsert(
      [
        { clinicID: 'clinic-1', isPrimaryClinic: true },
        { clinicID: 'clinic-2', isPrimaryClinic: false },
      ],
      'clinic-1',
    )
    expect(result).toBeNull()
  })

  it('retourne isPrimaryClinic: true si existingRelations est vide (toute première relation de cet Owner)', () => {
    const result = resolveClinicOwnerRelationUpsert([], 'clinic-1')
    expect(result).toEqual({ clinicID: 'clinic-1', isPrimaryClinic: true })
  })

  it("retourne isPrimaryClinic: false si l'Owner a déjà au moins une relation, mais avec une AUTRE clinique", () => {
    const result = resolveClinicOwnerRelationUpsert(
      [{ clinicID: 'clinic-OTHER', isPrimaryClinic: true }],
      'clinic-1',
    )
    expect(result).toEqual({ clinicID: 'clinic-1', isPrimaryClinic: false })
  })

  it("retourne null même quand l'Owner a une relation à CETTE clinique MÉLANGÉE avec des relations à d'autres cliniques (le check du clinicID exact doit court-circuiter, peu importe le reste du tableau, quelle que soit sa position — ici testé en 1ère ET en dernière position)", () => {
    const clinicFirst = resolveClinicOwnerRelationUpsert(
      [
        { clinicID: 'clinic-1', isPrimaryClinic: true },
        { clinicID: 'clinic-OTHER-A', isPrimaryClinic: false },
        { clinicID: 'clinic-OTHER-B', isPrimaryClinic: false },
      ],
      'clinic-1',
    )
    expect(clinicFirst).toBeNull()

    const clinicLast = resolveClinicOwnerRelationUpsert(
      [
        { clinicID: 'clinic-OTHER-A', isPrimaryClinic: true },
        { clinicID: 'clinic-OTHER-B', isPrimaryClinic: false },
        { clinicID: 'clinic-1', isPrimaryClinic: false },
      ],
      'clinic-1',
    )
    expect(clinicLast).toBeNull()
  })
})
