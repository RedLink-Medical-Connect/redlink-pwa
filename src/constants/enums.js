// Centralise ici toutes les valeurs d'énum utilisées côté front
// afin d'éviter les fautes de frappe et garder la cohérence avec le schéma GraphQL.

export const Species = Object.freeze({
  DOG: 'DOG',
  CAT: 'CAT',
})

// Sexe de l'animal (CdC §2.1) — Animal.sex, champ informatif uniquement pour ce pilote,
// PAS un critère d'éligibilité (décision produit, cf. schema.graphql). Pas d'enum
// GraphQL dédié côté schéma (String simple) : ces valeurs sont la seule source de
// vérité côté front pour éviter les fautes de frappe.
export const AnimalSex = Object.freeze({
  MALE: 'MALE',
  FEMALE: 'FEMALE',
})

export const DonationFrequency = Object.freeze({
  ASAP: 'ASAP',
  TWICE_YEAR: 'TWICE_YEAR',
  ONCE_YEAR: 'ONCE_YEAR',
})

export const RequestStatus = Object.freeze({
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
})

export const MissionStatus = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  PENDING_ARRIVAL: 'PENDING_ARRIVAL',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
})

export const RequestType = Object.freeze({
  EMERGENCY: 'EMERGENCY',
  APPOINTMENT: 'APPOINTMENT'
})

// Statut d'affichage "donneur validé" côté Owner (AnimalsView.vue) — dérivé de
// `isValidatedDonor()`/`Animal.isValidatedDonor` (eligibility-service.js), jamais
// persisté tel quel côté schéma.
export const DonorStatus = Object.freeze({
  VALIDATED: 'VALIDATED',
  EXPIRED: 'EXPIRED',
  NEVER_VALIDATED: 'NEVER_VALIDATED',
})

// Groupes sanguins par espèce (non typés côté schéma, mais centralisés ici)
export const BloodGroupsBySpecies = Object.freeze({
  [Species.DOG]: ['DEA 1.1-', 'DEA 1.1+', 'Dal', 'Kai'],
  [Species.CAT]: ['A', 'B', 'AB'],
})

