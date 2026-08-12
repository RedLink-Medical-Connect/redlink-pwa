---
status: accepted
---

# Mutation dédiée pour la validation vétérinaire d'un Animal

Le CdC exige qu'un Animal soit validé par un vétérinaire (durée 1 an, renouvelable en
consultation) avant d'entrer dans le pool de donneurs — un statut porté par de
nouveaux champs sur `Animal` (`isValidatedDonor`, `validationExpiresAt`). Le schéma
actuel ne donne aux Veterinarians qu'un accès en lecture sur `Animal`. Plutôt que
d'ouvrir un accès en écriture général (ce qui permettrait à un vétérinaire de modifier
des champs saisis par l'Owner — nom, race, poids...), la validation passe par une
mutation dédiée qui ne touche que le statut de validation.
