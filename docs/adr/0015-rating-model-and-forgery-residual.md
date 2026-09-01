---
status: accepted
---

# `Rating` : clé composite, notation privée, résidu de forgerie côté client assumé

Plan d'architecture validé avec le repo owner (2026-08-26) pour la double validation de
Mission + notation par étoiles bidirectionnelle privée — cette sous-tâche (étape 1/5) couvre le
schéma/`@auth`/resolver, pas les composables front (prochaine étape). Cet ADR documente le
modèle `Rating` : sa clé composite, son autorisation, et un résidu de sécurité assumé pour ce
pilote, dans le même esprit qu'ADR-0004/ADR-0005 ("résidu connu, non fermé, accepté pour un
pilote à utilisateurs de confiance").

## 1. Clé composite `.identifier(['missionID', 'raterRole'])`

Une Mission clôturée (double validation, voir `amplify/data/resource.ts` section Mission) donne
lieu à AU PLUS deux notations indépendantes : l'Owner note la Clinic, la Clinic note l'Owner.
`.identifier(['missionID', 'raterRole'])` (clé composite, remplace le défaut `id` auto-généré)
empêche mécaniquement une double soumission côté MÊME rôle sur la MÊME Mission — une seconde
`create` avec le même couple `(missionID, raterRole)` échoue nativement (violation de clé
primaire DynamoDB), sans avoir besoin d'une condition d'écriture dédiée comme
`submitMissionValidation`.

Vérifié pour cette sous-tâche (pas deviné) : `.identifier([...])` est bien l'API réelle de la
version installée de `@aws-amplify/backend`
(`node_modules/@aws-amplify/data-schema/dist/esm/ModelType.d.ts`, JSDoc et exemple
`.identifier(['name', 'email'])` correspondant exactement à l'usage ici).

### Écart découvert : `raterRole` ne peut pas être un champ `a.ref()` d'enum

Le plan initial prévoyait `raterRole: a.ref('RatingParticipantRole').required()`, symétrique à
`targetRole` juste en dessous. `npx tsc --noEmit` ne l'a pas signalé (types valides), mais
`schema.transform()` lève à l'exécution : *"Invalid identifier definition. Field raterRole
cannot be used in the identifier. Identifiers must reference required or DB-generated fields"*.

Cause, identifiée en lisant `validateNullableIdentifiers`
(`node_modules/@aws-amplify/data-schema/src/SchemaProcessor.ts`) : ce validateur ne lit QUE
`fieldDef.data.required` pour décider si un champ peut entrer dans `.identifier([...])` — cette
propriété est positionnée par `ModelField.required()` (`a.id().required()`, `a.string()
.required()`, etc.). `RefType.required()` (tout champ `a.ref(...)`, donc tout champ d'énum)
positionne une propriété DIFFÉRENTE, `data.valueRequired`, que ce validateur ne connaît pas.
Conséquence générale, pas spécifique à `RatingParticipantRole` : **aucun champ `a.ref()` d'enum
ne peut faire partie d'une clé composite `.identifier()`** avec la version installée de
`@aws-amplify/data-schema`, quelle que soit sa déclaration.

Décision : `raterRole` passe en `a.string().required()` (`ModelField`, pas `RefType`)
UNIQUEMENT pour satisfaire cette contrainte du validateur. `targetRole` (qui n'entre pas dans
l'identifiant) reste `a.ref('RatingParticipantRole').required()`, sans ce problème — les valeurs
valides de `RatingParticipantRole` (`OWNER`/`CLINIC`) restent la référence documentée pour les
deux champs, seul le mécanisme de validation diffère désormais entre eux (voir section 3,
résidu 3).

## 2. Autorisation : notation PRIVÉE, `Veterinarians` n'a délibérément pas `read`

```ts
.authorization((allow) => [
  allow.ownerDefinedIn('raterID').to(['create', 'read']),
  allow.group('Veterinarians').to(['create']),
  allow.group('Admins').to(['read']),
])
```

Pas de `.authorization()` séparée pour lire/écrire une éventuelle MOYENNE de notes par
Clinic/Owner : cette agrégation n'existe pas encore (dénormalisation probable sur
`Clinic`/`Owner`, prochaine sous-tâche du plan — hors périmètre schéma de cette étape 1/5).

`allow.group('Veterinarians').to(['create'])` **sans** `read` : c'est délibéré, pas un oubli.
Un `allow.group('Veterinarians').to(['read'])` supplémentaire aurait permis à N'IMPORTE QUEL
Veterinarian authentifié de LISTER toutes les notes reçues par N'IMPORTE QUELLE AUTRE clinique
(fuite cross-clinique) — `Rating` n'a pas de FK vers `Clinic`, et le système d'autorisation
Gen2 de ce schéma n'a aucune notion de "ma clinique" applicable ici (contrairement à
`ClinicOwnerRelation`, qui existe justement pour porter cette relation ailleurs dans le schéma,
mais que `Rating` ne référence pas). Seul `allow.ownerDefinedIn('raterID')` donne `read` — à qui
a ÉCRIT la ligne, donc au Veterinarian qui vient de noter, sur SA PROPRE notation uniquement, pas
sur celles de ses collègues ni d'une autre clinique. Même réflexe que le précédent déjà tranché
sur ce repo consistant à préférer un scope honnête (large mais réel) à un filtre qui simulerait
une garantie de sécurité absente du modèle de données — ici dans le sens inverse : retirer
l'accès `read` plutôt que d'en faker un scopé "par clinique" qui n'existe pas réellement dans
`Rating` (pas de FK vers `Clinic`).

## 3. Résidu assumé, documenté explicitement (comme ADR-0004/0005)

Un Veterinarian peut soumettre `raterID`/`targetID` **arbitraires** côté CLINIC —
`allow.group('Veterinarians').to(['create'])` n'impose aucune contrainte sur la VALEUR de ces
deux champs, seulement sur l'ensemble d'opérations (même limite `@auth` que partout ailleurs
dans ce schéma, documentée depuis ADR-0002 : Gen2 ne sait pas contraindre la valeur d'un champ au
niveau `@auth`, seulement un ensemble d'opérations). Concrètement : un Veterinarian authentifié
pourrait, en appelant l'API directement (hors UI), créer une `Rating` avec un `raterID` qui n'est
pas le sien, ou un `targetID` qui ne correspond à aucun Owner réel lié à sa clinique.

Mitigation **uniquement côté client**, dans le futur composable (prochaine sous-tâche) : dériver
`raterID` du `clinicID`/de l'identité Cognito du Veterinarian authentifié plutôt que de faire
confiance à un paramètre libre passé en argument. Alternative écartée : une mutation custom
dédiée (sur le modèle de `linkRequestToMission`/`submitMissionValidation`) qui dériverait
`raterID` côté serveur depuis `ctx.identity` — jugée disproportionnée pour ce pilote (`Rating`
est une écriture non critique du point de vue intégrité métier, contrairement au statut de
Mission ou à l'acceptation d'une Request ADR-0001 ; une notation forgée par un Veterinarian de
confiance, dans un pilote école vétérinaire partenaire, n'a pas le même impact qu'une Mission
COMPLETED forgée). Signalé explicitement ici pour que le Lead Dev tranche si ce compromis reste
acceptable au moment où `Rating` sort du pilote.

Second résidu, découvert en implémentant la clé composite (section 1) : `raterRole` n'a plus la
validation de valeur GRATUITE qu'offre le système de type GraphQL sur un champ `enum` (un enum
rejette nativement toute valeur hors énumération, une `String` non) — contrairement à
`targetRole`, resté `a.ref('RatingParticipantRole')`. Un client qui enverrait un `raterRole`
arbitraire (ni `'OWNER'` ni `'CLINIC'`) ne serait bloqué par AUCUNE règle serveur. Mitigation
identique : le futur composable n'enverra jamais que les deux valeurs de
`RatingParticipantRole` (front, `src/constants/enums.js`), jamais une valeur construite
dynamiquement à partir d'une entrée utilisateur.

## Relation avec le reste des ADR

Comme ADR-0004/ADR-0005 : accepté pour un pilote à faible nombre d'utilisateurs de confiance
(école vétérinaire partenaire). Si ces résidus deviennent un vrai risque avant un déploiement à
plus grande échelle, leur fermeture complète nécessiterait une mutation custom dédiée (dérivation
serveur de `raterID` depuis `ctx.identity`) — hors périmètre de cette sous-tâche. Comme
ADR-0009/ADR-0010/ADR-0011 : introduit un écart de forme découvert pendant l'implémentation
(limite du validateur `.identifier()` sur les champs `a.ref()`), pas une révision d'une décision
de fond déjà actée.
