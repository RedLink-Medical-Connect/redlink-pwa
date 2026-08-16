---
status: accepted
---

# Écriture Veterinarian sur `Animal.bloodGroup`, un champ déjà écrit par l'Owner

Un vétérinaire qui valide un Animal comme donneur (`ValidationsView.vue`, ADR-0002)
peut aujourd'hui repérer un `bloodGroup` visiblement erroné (`UNKNOWN`, ou une valeur
saisie par erreur par l'Owner à la création de l'Animal) mais n'a aucun moyen de le
corriger — seul recours : contacter l'Owner et attendre qu'il corrige lui-même, ce qui
bloque la validation sans raison technique (roadmap Phase 6 section B).

## Différence avec ADR-0002/0003/0004/0005

Le pattern "Écriture Veterinarian scopée sur `Animal`/`Request`/`Mission`" déjà utilisé
quatre fois (`isValidatedDonor`/`validationExpiresAt`, `lastDonationDate`,
`Request`/`Mission`, `appointmentDatetime`) repose systématiquement sur la même
hypothèse : le champ concerné n'est **jamais** écrit par l'Owner, donc restreindre sa
règle `owner` à `operations: [read]` au niveau du champ ne casse aucun flux existant.

`bloodGroup` casse cette hypothèse : c'est un champ `String!` obligatoire que l'Owner
écrit déjà à la fois à la création de l'Animal (`AddAnimalView.vue` →
`createNewAnimal`) et en édition (`AnimalsView.vue` → `updateAnimalDetails`). Le
Transformer v1 **remplace** la règle de type par la règle de champ pour un champ donné
(ne les fusionne pas — c'est justement le mécanisme qu'exploitent ADR-0002 à 0005).
Copier le pattern existant tel quel (`{ allow: owner, operations: [read] }`) aurait donc
silencieusement cassé la création et l'édition d'un Animal par son propriétaire.

## Décision

La règle `owner` sur `Animal.bloodGroup` reste **sans restriction d'opérations**
(comportement identique à la règle de type d'origine), et une règle `Veterinarians`
supplémentaire est ajoutée en `[read, update]` :

```graphql
bloodGroup: String!
  @auth(rules: [
    { allow: owner },
    { allow: groups, groups: ["Veterinarians"], operations: [read, update] }
  ])
```

Côté composable (`useAnimalValidation.js#correctBloodGroup`), l'écriture passe par une
mutation `*Simple` dédiée (`updateAnimalBloodGroupSimple`, input restreint à `id` +
`bloodGroup`) — même raisonnement que `validateAnimalDonorSimple`/
`updateAnimalLastDonationDateSimple` : le scoping réel vient de `@auth` côté serveur,
mais un input étroit rend l'intention explicite et évite qu'un futur appelant élargisse
la mutation par erreur.

## Limite résiduelle assumée

Le Transformer v1 ne peut pas conditionner une règle de champ sur la valeur d'un autre
champ (même limitation que ADR-0002/0003) : un Veterinarian peut donc, via un appel
GraphQL direct hors UI, réécrire `bloodGroup` sur un Animal **déjà validé**
(`isValidatedDonor: true`), sans que la validation soit invalidée en retour. Ce résidu
n'est pas nouveau en nature (même classe de compromis que les ADR précédents), mais sa
conséquence métier est plus tangible ici qu'ailleurs : un groupe sanguin modifié sans
re-déclenchement de validation pourrait affecter la sécurité transfusionnelle si le
gap était exploité. Accepté pour ce pilote sous la même hypothèse de confiance que le
reste du schéma (Veterinarians de l'école vétérinaire partenaire, pas un public
multi-tenant hostile — voir ADR-0002) ; mitigé côté UI uniquement
(`ValidationsView.vue` n'expose l'éditeur que pour les Animaux `pendingAnimals`, jamais
déjà validés) et documenté par des tests dédiés (`schema.test.js`,
`useAnimalValidation.test.js`) plutôt que masqué. À reconsidérer si le pilote s'élargit
à des cliniques externes moins contrôlées.
