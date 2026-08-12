---
status: accepted
---

# Écriture scopée pour la validation vétérinaire d'un Animal

Le CdC exige qu'un Animal soit validé par un vétérinaire (durée 1 an, renouvelable en
consultation) avant d'entrer dans le pool de donneurs — un statut porté par de
nouveaux champs sur `Animal` (`isValidatedDonor`, `validationExpiresAt`). Le schéma
actuel ne donne aux Veterinarians qu'un accès en lecture sur `Animal`. Plutôt que
d'ouvrir un accès en écriture général (ce qui permettrait à un vétérinaire de modifier
des champs saisis par l'Owner — nom, race, poids...), l'écriture des Veterinarians sur
`Animal` reste scopée à ces deux seuls champs.

## Implémentation (amendement, 2026-08-12)

La décision initiale envisageait une mutation GraphQL dédiée (`validateAnimalAsDonor`),
adossée à un Lambda custom (`@function`) pour restreindre l'écriture à ces deux champs.
Implémenté finalement via `@auth` au niveau champ sur `isValidatedDonor` et
`validationExpiresAt` (Owner : `read` seul, Veterinarians : `read, update`), au lieu
d'une mutation séparée — le vétérinaire appelle `updateAnimal` comme n'importe quel
autre composable du projet. Ça atteint le même objectif (scoping des champs, pas
d'accès en écriture général) de façon purement déclarative :

- Zéro infrastructure nouvelle (pas de Lambda, pas de rôle IAM, pas de variable d'env
  pour le nom de table DynamoDB) — moins de surface à faire vivre dans le temps pour
  une règle qui tient en un `@auth`.
- Cohérent avec le reste du schéma, qui n'utilise que des règles `@auth` déclaratives,
  jamais de résolveur custom.
- Non testable en amont d'un vrai déploiement AWS (aucun accès AWS live pour cette
  session) — un Lambda mal câblé ne se serait révélé qu'au prochain `amplify push` de
  l'utilisateur.

**Compromis assumé** : la règle métier "un Animal ne peut être validé que si
`bloodGroup !== 'UNKNOWN'`" n'est pas imposée au niveau du schéma/DB (`@auth` ne sait
pas conditionner sur la valeur d'un autre champ) — elle sera vérifiée côté client dans
`useAnimalValidation.js` (Phase 1). Acceptable pour ce pilote : les Veterinarians sont
des utilisateurs de confiance (personnel de l'école vétérinaire partenaire), pas un
public multi-tenant hostile.
