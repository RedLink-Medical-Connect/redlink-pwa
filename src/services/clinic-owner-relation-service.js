/**
 * Décide si une `ClinicOwnerRelation` doit être créée pour (clinicID, ownerID), et avec
 * quelle valeur d'`isPrimaryClinic`, à partir de `existingRelations` — la liste COMPLÈTE des
 * relations déjà existantes pour cet Owner (toutes cliniques confondues, telle que renvoyée
 * par `ClinicOwnerRelation.list({ filter: { ownerID: { eq: ownerID } } })`). Fonction pure,
 * testable sans mock GraphQL (même convention que `mapAcceptMissionError`/
 * `mapValidationErrorKey` ailleurs dans ce repo : la décision go/no-go sort du corps async
 * pour rester testable directement).
 *
 * Extraite de `useMissionClosure.js` (Phase 3.1) vers ce service (demande produit
 * 2026-08-23) : la même décision est désormais appelée depuis DEUX déclencheurs distincts —
 * la clôture `COMPLETED` d'une Mission (`useMissionClosure.js`, comportement inchangé) ET la
 * validation vétérinaire d'un Animal comme donneur (`useAnimalValidation.js`, nouveau) —
 * plutôt que dupliquer la même logique de décision dans les deux composables.
 *
 * - Si une relation existe déjà pour CE `clinicID` exact : `null` — no-op, pas de doublon
 *   (un donneur déjà rattaché à cette clinique ne doit pas en récolter une deuxième).
 * - Sinon, à créer : `isPrimaryClinic: true` seulement si `existingRelations` est vide (la
 *   toute première relation de cet Owner, toutes cliniques confondues) ; `false` sinon.
 *   Simplification pilote assumée (voir CLAUDE.md/roadmap Phase 3) : il n'existe aucun
 *   mécanisme en V1 pour changer `isPrimaryClinic` après coup.
 *
 * Course acceptée, non résolue (relevé en Lead Dev review de la Phase 3) : ceci lit
 * `existingRelations` puis décide, sans écriture atomique conditionnelle (contrairement à
 * `acceptMission`, ADR-0001) — pas de contrainte d'unicité composite `(clinicID, ownerID)`
 * au niveau du schéma. Accepté pour ce pilote (scénario mono-vétérinaire à faible fréquence).
 *
 * @param {Array<{clinicID: string, isPrimaryClinic: boolean|null}>} existingRelations
 * @param {string} clinicID
 * @returns {{clinicID: string, isPrimaryClinic: boolean}|null}
 */
export function resolveClinicOwnerRelationUpsert(existingRelations, clinicID) {
  const alreadyLinkedToThisClinic = existingRelations.some((r) => r.clinicID === clinicID)
  if (alreadyLinkedToThisClinic) return null

  return { clinicID, isPrimaryClinic: existingRelations.length === 0 }
}
