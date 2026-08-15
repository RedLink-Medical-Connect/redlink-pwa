---
status: accepted
---

# Câblage du flux rendez-vous / non-urgence sur `OwnerAvailability` (Phase 6.5)

## Contexte

Le CdC définit deux piliers pour `RequestType` : `EMERGENCY` (urgence) et `APPOINTMENT`
(rendez-vous planifié). Le premier fonctionne de bout en bout. Le second existait dans
l'UI mais n'avait aucun effet réel (audit du 2026-08-15, roadmap Phase 6.5) :

- Les créneaux `OwnerAvailability` qu'un Owner renseigne (`AvailabilityView.vue`,
  `useOwnerAvailability.js`) n'étaient lus par AUCUNE logique de matching — zéro
  occurrence dans `eligibility-service.js`/`useMatchingRequests.js`.
- `NewRequestView.vue` collectait `patientName`/`breed`/`weight`/`date`/`details` dans
  son formulaire, mais `handleSubmit` n'en envoyait que `type`/`species`/`bloodGroup`/
  `quantity` à `createNewRequest()` — ces champs n'existaient même pas dans `type
  Request` du schéma. Tout était jeté silencieusement.

Décision produit actée avec le repo owner : câbler ce flux a minima plutôt que de le
retirer du périmètre du pilote (contrairement à Stripe/push/QR, jamais explicitement
mis hors périmètre dans la roadmap — un vrai oubli, pas une simplification assumée).

## Décision

### 1. Schéma : `Request.appointmentDatetime: AWSDateTime`

Seul champ ajouté au schéma — c'est la seule donnée strictement nécessaire pour
confronter une Request `APPOINTMENT` aux créneaux `OwnerAvailability` d'un Owner
(`dayOfWeek` + `startTime`/`endTime`). `notes` (le champ `details` du formulaire) n'a
délibérément **pas** été ajouté dans ce lot : aucun consommateur actuel n'en a besoin
(ni le matching, ni une vue clinique qui l'afficherait en retour), et rester strict sur
"le nécessaire pour câbler le matching" limite la surface de ce changement de schéma.
Purement additif si un besoin réel apparaît plus tard (même `@auth` de champ que
`appointmentDatetime`).

`patientName`/`breed`/`weight`, également collectés par `NewRequestView.vue` mais
jamais envoyés, restent volontairement hors du schéma `Request` : ce sont des
attributs de l'`Animal` matché (CONTEXT.md), pas de la `Request` elle-même — les y
ajouter serait une erreur de modélisation qui dupliquerait des données déjà portées
par `Animal`, pas juste combler un oubli. Le formulaire actuel les collecte par erreur
de conception initiale (audit 2026-08-15) ; les laisser non envoyés est correct.

`@auth` de champ : **exactement** la même règle que ses voisins directs
(`requestType`/`requiredSpecies`/`requiredBloodGroup`/`quantity`) — Owner `read` seul,
Veterinarians `create, read` (jamais `update`, aucun code applicatif ne réécrit ce champ
après création). Vérifié avec `npx amplify api gql-compile` : `appointmentDatetime`
apparaît bien dans la liste `allowedFields` du groupe `Veterinarians` générée pour
`Mutation.createRequest` (`build/resolvers/Mutation.createRequest.auth.1.req.vtl`), au
même titre que ses voisins — pas seulement dans le texte déclaratif du schéma.

Nommage identique (mais sans lien) à `Mission.appointmentDatetime`, champ déjà existant
avant ce lot : ce dernier est horodaté à "maintenant" au moment où l'Owner accepte la
Mission (`useOwnerMissions.js`), pas la date de RDV souhaitée par la clinique à la
création de la Request. Deux champs distincts, sur deux types distincts, avec des
sémantiques différentes malgré le même nom — noté explicitement en commentaire dans
`schema.graphql` pour éviter toute confusion future.

### 2. Filtre d'Eligibility supplémentaire, EXCLUSIF, séparé de `checkEligibility()`

`checkEligibility()` (`eligibility-service.js`) documente et applique les 5 critères
hiérarchisés de l'Eligibility (CONTEXT.md), une hiérarchie fixe et universelle,
**indépendante du type de Request**. La disponibilité de l'Owner à un créneau donné
n'est pas l'un de ces 5 critères (CONTEXT.md distingue explicitement "Frequency Rule"
de "Disponibilité" — deux concepts différents) et ne s'applique de toute façon qu'aux
Requests `APPOINTMENT`, jamais `EMERGENCY`.

Décision : une fonction pure séparée, `matchesAvailability(availabilities,
appointmentDatetime)` (`eligibility-service.js`, deep module — convention
CLAUDE.md/`.cursorrules`), **jamais appelée depuis `checkEligibility()`**. Appelée
uniquement par `useMatchingRequests.searchMatches()`, en plus, uniquement quand
`request.requestType === RequestType.APPOINTMENT`, une fois que `checkEligibility()` a
déjà rendu son verdict pour le couple (Animal, Request) considéré.

Le critère est **exclusif** (contrairement à Clinic Priority, non-exclusif) : un RDV
que l'Owner ne peut structurellement pas honorer (créneau hors de ses disponibilités
déclarées) n'est pas un vrai match, cohérent avec le sens métier. `matchesAvailability`
renvoie `false` (donc exclut la Request de ce couple animal/Request) si :
`appointmentDatetime` est absent/invalide, l'Owner n'a aucune `OwnerAvailability`
renseignée, ou aucun créneau ne couvre le jour de la semaine + l'heure de
`appointmentDatetime`.

**Alternative écartée** : insérer ce check comme un 6ᵉ critère dans
`checkEligibility()`. Rejetée pour deux raisons — (a) les 5 critères actuels sont
documentés dans CONTEXT.md comme universels, une disponibilité n'a de sens que pour un
sous-ensemble de Requests (`APPOINTMENT`) et y introduirait une branche conditionnelle
`if (request.requestType === APPOINTMENT)` à l'intérieur d'un module qui n'a
aujourd'hui aucune connaissance du type de Request ; (b) `checkEligibility()` est un
seam pur, sans accès GraphQL — lui faire porter une notion qui dépend d'une lecture
séparée (`OwnerAvailability`, indépendante de l'Animal) aurait mélangé deux
responsabilités que ce fichier sépare déjà proprement (Eligibility vs. disponibilité,
CONTEXT.md).

### 3. Lecture `OwnerAvailability` : fail-closed, pas de repli neutre

Convention CLAUDE.md "lecture secondaire non-exclusive isolée" (try/catch dédié, repli
sur une valeur neutre comme `ownerClinicIds = []` pour Clinic Priority) **ne s'applique
pas ici telle quelle** : elle suppose un critère non-exclusif, où un repli neutre ne
fait que dégrader un tri. Ici le critère est exclusif — un repli qui INCLURAIT par
défaut une Request `APPOINTMENT` en cas d'échec de lecture serait un faux positif (un
Owner verrait un "match" pour un créneau qu'il n'a jamais confirmé pouvoir honorer),
pire qu'un faux négatif.

Décision : pas de try/catch dédié dans `useMatchingRequests.js` pour cette lecture.
`fetchAvailabilities()` (`useOwnerAvailability.js`, composable réutilisé tel quel,
même query `listMyAvailabilities`) n'expose déjà aucune erreur — elle l'avale en
interne (`console.error`, jamais de `throw`). En cas d'échec réseau,
`ownerAvailabilities.value` retombe simplement sur son état par défaut (`[]` au premier
appel), jamais réassigné par l'échec. `matchesAvailability(..., [])` renvoie toujours
`false` : le comportement fail-closed recherché émerge naturellement du contrat déjà
posé par `useOwnerAvailability.js`, sans code de repli dupliqué dans ce composable.

La lecture n'est déclenchée que si au moins une Request ouverte est `APPOINTMENT`
(`allRequests.some(...)`) — évite un aller-retour GraphQL inutile pour les Owners qui
ne voient que des urgences (cas le plus fréquent pour ce pilote).

## Limites assumées pour ce pilote

1. **Fuseau horaire** : `matchesAvailability()` compare heure/minute en fuseau horaire
   LOCAL du navigateur des deux côtés (celui qui saisit ses disponibilités via
   `AvailabilityView.vue`, celui dont le navigateur exécute le matching), sans stocker
   ni convertir de fuseau horaire explicite. Cohérent avec le reste du repo
   (`AvailabilityView.vue` stocke déjà `startTime`/`endTime` en heure locale non
   qualifiée, sans offset), mais suppose un seul fuseau horaire pour tous les
   utilisateurs — hypothèse raisonnable pour un pilote en école vétérinaire française,
   pas généralisable telle quelle à un déploiement multi-fuseaux.
2. **Granularité minute, comparaison inclusive** : un rendez-vous exactement à l'heure
   de début ou de fin d'un créneau (`timeOfDay >= start && timeOfDay <= end`) est
   considéré dans le créneau. Pas de marge de battement (ex. 15 min de tolérance) ; non
   demandé par le CdC, non ajouté ici.
3. **Pas de re-validation à l'acceptation** : `acceptMission()` (`useOwnerMissions.js`)
   re-valide déjà 3 des 5 critères d'Eligibility (Validated Donor, compatibilité
   sanguine, Frequency Rule) au moment de l'acceptation, mais ne re-valide ni la
   distance ni la disponibilité — `matchesAvailability()` n'est appelée QUE dans
   `useMatchingRequests.js`. Un Owner dont les disponibilités changeraient entre
   l'affichage du radar et le clic sur "J'accepte d'aider" ne serait donc pas
   re-bloqué à l'acceptation. Même classe de limite que la distance (déjà non
   re-validée à l'acceptation avant ce lot) — cohérent avec l'existant, pas une
   régression introduite ici, mais pas fermé non plus. Hors périmètre explicite de
   cette sous-tâche (le brief l'a scopée à `useMatchingRequests.js`).
4. **`notes` non modélisé** (voir section 1) : si un vrai besoin apparaît (ex. la
   clinique veut préciser un contexte au RDV, visible par l'Owner ou re-consulté côté
   clinique), l'ajout est purement additif au schéma, même `@auth` de champ.
5. **Résidu Transformer v1 déjà connu (ADR-0004)** : comme documenté pour les autres
   champs Veterinarian-writable de `Request`/`Mission`, le Transformer v1 ne restreint
   jamais une VALEUR au niveau serveur, seulement un ensemble d'opérations —
   `appointmentDatetime` n'échappe pas à cette limite. Un Veterinarian peut écrire
   n'importe quelle valeur à la création (y compris une date passée, ou une valeur
   renseignée sur une Request `EMERGENCY` où elle n'a pas de sens) sans contrainte
   serveur, seule une garde côté client existe
   (`useClinicRequest.js`, `formData.type === 'appointment'`). Impact limité : confirmé
   à la revue schéma (2026-08-15) que `matchesAvailability()` n'exploite que
   jour-de-semaine/heure, pas la date calendaire complète, donc une valeur fantaisiste
   ne casse pas le matching ; `Request.appointmentDatetime` n'est jamais affiché brut à
   l'Owner. Même modèle "pilote à utilisateurs de confiance" qu'ADR-0002/0003/0004,
   pas une régression propre à ce lot.
