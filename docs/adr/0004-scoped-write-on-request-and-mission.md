---
status: accepted
---

# Durcissement `@auth` sur `Request` et `Mission` (revue DevSecOps, Phase 5)

La revue des accès de la Phase 5 (`amplify api gql-compile` + lecture des VTL générés,
pas seulement le texte du schéma) a trouvé que deux règles `@auth` de type, ajoutées
pour un besoin précis, ouvraient en réalité un accès bien plus large que prévu :

- `Mission` : `{ allow: owner }` (sans `operations`) permettait à un Owner authentifié
  d'appeler `updateMission(status: COMPLETED)` directement sur sa propre Mission,
  contournant `useMissionClosure.js` (Phase 2.1) — cassant la garantie centrale de la
  Phase 2 ("l'Owner ne peut pas s'auto-valider sa Mission comme terminée").
- `Request` : `{ allow: private, operations: [read, update] }` (ajoutée pour que
  `linkRequestToMission`, appelée par `acceptMission`, puisse écrire `status`/
  `activeMissionID` en tant qu'Owner) autorisait en réalité l'écriture de N'IMPORTE
  QUEL champ de N'IMPORTE QUELLE Request par N'IMPORTE QUEL Owner authentifié —
  `requiredBloodGroup`, `quantity`, `clinicID`... pas seulement `status`/
  `activeMissionID`.

Comme ADR-0002/0003, on étend le même mécanisme déclaratif plutôt que d'introduire une
nouvelle mutation dédiée adossée à un Lambda : `@auth` au niveau champ, qui remplace
(ne fusionne pas) les règles de type pour les champs concernés.

- `Request` : `requestType`/`requiredSpecies`/`requiredBloodGroup`/`quantity`/
  `createdAt`/`clinicID` passent à Owner `read` seul, Veterinarians `create, read`
  (jamais `update` — aucun code applicatif ne réécrit ces champs après création).
  `status`/`activeMissionID` restent volontairement hors de ce scoping : ce sont les
  deux seuls champs que `linkRequestToMission` doit pouvoir écrire côté Owner.
- `Mission` : la règle de type owner passe à `operations: [create, read, delete]`
  (jamais `update` — `useOwnerMissions.js` n'appelle que `createMissionSimple`/
  `deleteMissionSimple`), la règle Veterinarians à `operations: [read, update]`
  (jamais `create`/`delete` côté Veterinarians). `validationCode`/`scannedAt`/
  `validatedByVeterinarianID`/`stripePaymentIntentId`/`stripePaymentStatus` reçoivent
  en plus un `@auth` de niveau champ (Owner `read` seul, Veterinarians `read, update`)
  : sans lui, retirer `update` à la règle de type owner ne suffisait pas — `create` y
  restait, et un Owner pouvait fabriquer un `createMission(validatedByVeterinarianID:
  "...")` dès la création, usurpant une validation vétérinaire par une autre voie que
  celle qui venait d'être fermée. Ces 5 champs sont par ailleurs inutilisés par tout
  code applicatif actuel (flow QR-scan abandonné, Stripe hors périmètre V1), donc aucune
  régression à les verrouiller entièrement.

**Limites connues, non fermées par cette décision** — le Transformer v1 ne sait
restreindre un champ qu'à un ensemble d'opérations, jamais à un sous-ensemble de
valeurs pour une opération donnée, ni conditionner une règle sur une autre table :

1. `Mission.status` reste écrivable par l'Owner à la création (`create` reste
   nécessaire à `createMissionSimple` pour poser `PENDING_ARRIVAL`/`ACCEPTED`). Un
   Owner peut donc toujours appeler `createMission(status: COMPLETED)` directement en
   GraphQL, hors UI. Impact pratique limité : `Animal.lastDonationDate` et
   `ClinicOwnerRelation` restent des écritures scopées aux Veterinarians séparément
   (ADR-0003, `useMissionClosure.js`), donc cette voie ne contourne ni la Frequency
   Rule ni aucun effet de bord réel — seulement une entrée cosmétiquement fausse dans
   l'historique de l'Owner lui-même.
2. `Request.status`/`activeMissionID`, via la règle `private`, restent écrivables par
   N'IMPORTE QUEL Owner authentifié, pas seulement celui concerné par cette Request
   précise — préexistant, déjà noté dans le commentaire du schéma comme un compromis
   assumé avec l'écriture conditionnelle atomique d'ADR-0001 (un scoping plus fin
   empiéterait dessus). Non traité par cette décision.

Comme ADR-0002 : accepté pour un pilote à faible nombre d'utilisateurs de confiance
(école vétérinaire partenaire). Si ces limites deviennent un vrai risque avant un
déploiement à plus grande échelle, la fermeture complète nécessiterait un résolveur
personnalisé ou un Lambda — une architecture différente, pas dans le périmètre de ce
correctif.
