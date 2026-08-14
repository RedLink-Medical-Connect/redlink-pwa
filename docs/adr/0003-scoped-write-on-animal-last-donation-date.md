---
status: accepted
---

# Écriture scopée pour `Animal.lastDonationDate` à la clôture d'une Mission

La Frequency Rule (CONTEXT.md) rend un Animal temporairement inéligible entre deux
dons en comparant `lastDonationDate` et sa `donationFrequency` acceptée
(`satisfiesFrequencyRule`, `eligibility-service.js`) — mais ce champ ne peut jamais
s'écrire en conditions réelles tant qu'aucun événement métier ne le met à jour : sans
cette écriture, la règle reste correcte en théorie mais inerte en pratique, tout
Animal restant éligible indéfiniment après un don réel.

Cet événement déclencheur est la clôture d'une Mission côté vétérinaire (Phase 2.1) :
quand une Mission passe à `COMPLETED` (le donneur s'est bien présenté et le don a eu
lieu), `Animal.lastDonationDate` doit être mis à la date du jour. Sur `NO_SHOW`
(le donneur ne s'est pas présenté), aucun don n'a eu lieu — `Animal` ne doit pas être
touché.

Comme `docs/adr/0002` (validation vétérinaire de `isValidatedDonor`/
`validationExpiresAt`), c'est la même situation : le schéma actuel ne donne aux
Veterinarians qu'un accès en lecture sur `Animal` (règle de type), et ouvrir un accès
en écriture général leur permettrait de modifier des champs saisis par l'Owner (nom,
race, poids...) — hors de ce qu'exige leur workflow. On étend donc exactement le même
mécanisme déclaratif : `@auth` au niveau champ sur `lastDonationDate` (Owner : `read`
seul, Veterinarians : `read, update`), plutôt qu'une nouvelle mutation dédiée adossée à
un Lambda — mêmes arguments qu'ADR-0002 (zéro infrastructure nouvelle, cohérent avec le
reste du schéma qui reste purement déclaratif, vérifiable offline via
`amplify api gql-compile` sans accès AWS live pour cette session).

Côté composable (`useMissionClosure.js`), l'écriture reste néanmoins portée par une
mutation `*Simple` dédiée (`updateAnimalLastDonationDateSimple`) plutôt que la mutation
`updateAnimal` générique, à l'input restreint à `id` + `lastDonationDate` — même
raisonnement que `validateAnimalDonorSimple` : le scoping est appliqué par `@auth` côté
serveur de toute façon, mais une mutation à l'input volontairement étroit empêche un
futur appelant d'élargir l'input par erreur (ex. en y glissant `bloodGroup` ou `weight`)
et de se faire rejeter tardivement par `@auth` plutôt que de rendre l'intention
explicite dans le code.
