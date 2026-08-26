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

// PENDING_VALIDATION/COMPLETED_AUTO/DISPUTED (2026-08-26, double validation de Mission,
// amplify/data/resource.ts) ajoutés en miroir du schéma -- EN_ROUTE/ARRIVED existent côté
// schéma (amplify/data/resource.ts, MissionStatus) mais n'avaient déjà pas d'équivalent ici
// avant ce lot (gap préexistant, hors périmètre de cette sous-tâche, non ajouté ici pour ne
// pas élargir le diff au-delà de ce qui est demandé). COMPLETED_AUTO n'est écrit par aucun
// code applicatif à ce jour (réservé à une future Lambda planifiée, non implémentée) ;
// exposé ici pour que le front puisse déjà le reconnaître en lecture (ex. libellé d'état)
// sans attendre cette Lambda.
export const MissionStatus = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  PENDING_ARRIVAL: 'PENDING_ARRIVAL',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
  CANCELLED: 'CANCELLED',
  PENDING_VALIDATION: 'PENDING_VALIDATION',
  COMPLETED_AUTO: 'COMPLETED_AUTO',
  DISPUTED: 'DISPUTED',
})

// Miroir front de `MissionValidationOutcome` (amplify/data/resource.ts) -- même convention
// que `AccountRole`/`LegalDocumentType` ci-dessus : seul endroit où le front a besoin de
// connaître ces valeurs (soumission de `submitMissionValidation`, prochaine sous-tâche —
// composables non implémentés dans cette étape 1/5, schéma uniquement). 'PENDING' est l'état
// initial implicite (jamais écrit explicitement côté resolver, voir
// amplify/data/resolvers/submit-mission-validation-write-side.js) — un champ non encore
// validé apparaît comme `null`/absent côté client, pas littéralement 'PENDING'.
export const MissionValidationOutcome = Object.freeze({
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  DENIED: 'DENIED',
})

// Miroir front de `RatingParticipantRole` (amplify/data/resource.ts) -- distingue les deux
// côtés d'une `Rating` (Owner note la Clinic, Clinic note l'Owner). Voir
// docs/adr/0015-rating-model-and-forgery-residual.md.
export const RatingParticipantRole = Object.freeze({
  OWNER: 'OWNER',
  CLINIC: 'CLINIC',
})

export const RequestType = Object.freeze({
  EMERGENCY: 'EMERGENCY',
  APPOINTMENT: 'APPOINTMENT'
})

// Scaffolding légal/RGPD (2026-08-25) — miroir front de `AccountRole`/`LegalDocumentType`
// (amplify/data/resource.ts). Owner/Veterinarian n'ont pas de champ "role" côté schéma (le
// rôle se déduit du modèle) : ces valeurs ne servent qu'à `ConsentRecord.userRole`, seul
// endroit qui a besoin de le porter explicitement (voir docs/adr/0014).
export const AccountRole = Object.freeze({
  OWNER: 'OWNER',
  VETERINARIAN: 'VETERINARIAN',
})

// CGV incluse même si non capturée à l'inscription aujourd'hui (Stripe hors périmètre V1,
// voir src/constants/legal.js) — même raison que côté schéma.
export const LegalDocumentType = Object.freeze({
  CGU: 'CGU',
  PRIVACY_POLICY: 'PRIVACY_POLICY',
  CGV: 'CGV',
})

// Statut d'affichage "donneur validé" côté Owner (AnimalsView.vue) — dérivé de
// `isValidatedDonor()`/`Animal.isValidatedDonor` (eligibility-service.js), jamais
// persisté tel quel côté schéma.
export const DonorStatus = Object.freeze({
  VALIDATED: 'VALIDATED',
  EXPIRED: 'EXPIRED',
  NEVER_VALIDATED: 'NEVER_VALIDATED',
})

// Groupes sanguins par espèce (non typés côté schéma, mais centralisés ici).
// Source : Recap_Don_Sang_Veterinaire.pdf (repo owner, vérifié 2026-08-23) — DEA 1.1 est
// le seul groupe canin réellement typé en pratique courante (le plus sensible
// cliniquement, ~30% des chiens) ; DEA 4 est le donneur universel canin (présent chez
// ~98% des chiens). Les autres groupes DEA (1.2, 3, 5, 6, 7, Dal, Kai...) entraînent des
// réactions moins sévères et ne sont pas typés en routine — volontairement absents de
// cette liste plutôt que de fragmenter le matching sur des groupes que personne ne teste
// (isBloodCompatible fait une comparaison stricte, sans matrice de compatibilité).
// Système félin AB : A (90%), B (10%), AB (<1%) — déjà correct, inchangé.
// 'UNKNOWN' explicite dans les deux listes (Phase "Beta hardening") : un Owner qui ignore
// réellement le groupe sanguin de son animal doit pouvoir le déclarer plutôt que de forcer
// une valeur au hasard — `bloodGroup` reste un champ obligatoire (sous-tâche 6.1), mais
// "je ne sais pas" en est désormais une réponse valide et explicite. `isValidatedDonor`
// refuse toujours la validation vétérinaire tant que ce groupe reste 'UNKNOWN'
// (useAnimalValidation.js).
export const BloodGroupsBySpecies = Object.freeze({
  [Species.DOG]: ['DEA 1.1+', 'DEA 1.1-', 'DEA 4', 'UNKNOWN'],
  [Species.CAT]: ['A', 'B', 'AB', 'UNKNOWN'],
})

/**
 * Libellé affiché pour une valeur de `BloodGroupsBySpecies` — seule 'UNKNOWN' a besoin
 * d'une traduction (les autres valeurs, ex. 'DEA 1.1+'/'A', sont la même notation partout).
 * Prend le libellé déjà traduit en paramètre plutôt que d'appeler `useI18n()` ici : cette
 * fonction est utilisée dans des slots de template (`#value`/`#option` de `Select`), pas
 * dans un composable — même raisonnement que `mapValidationErrorKey` (composables/) pour
 * rester une fonction pure, testable sans monter de composant.
 *
 * @param {string} value
 * @param {string} unknownLabel Le résultat déjà traduit de `$t('dashboard.owner.animals.form.blood_group_unknown_option')`.
 * @returns {string}
 */
export const formatBloodGroupLabel = (value, unknownLabel) =>
  value === 'UNKNOWN' ? unknownLabel : value

