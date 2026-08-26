import { type ClientSchema, a, defineData } from '@aws-amplify/backend'

/**
 * Migration Gen1 -> Gen2 du schéma de données (Phase 8, sous-tâche 4).
 *
 * Source de vérité traduite : `amplify/backend/api/redlinkpwa/schema.graphql` (Gen1,
 * Transformer v1, laissé intact -- ne pas y toucher). Les 8 types `@model`, leurs règles
 * `@auth` (type ET champ) et leurs 5 enums sont recréés ici avec `a.model()`/`a.enum()`.
 *
 * Traduction `@auth` -> `.authorization()`, confirmée via `context7` (`/aws-amplify/amplify-data`)
 * et via la lecture de `SchemaProcessor.mjs`/`Authorization.d.ts` dans
 * `node_modules/@aws-amplify/data-schema` pour cette sous-tâche :
 * - `.authorization()` posé sur un CHAMP précis REMPLACE (ne fusionne pas) la règle de
 *   niveau modèle pour ce champ -- exactement la sémantique Transformer v1 qu'exploitaient déjà
 *   ADR-0002 à 0006. Aucune régression de comportement à la traduction, uniquement un
 *   changement de syntaxe déclarative.
 * - `allow.owner()` = Gen1 `{ allow: owner }` (pas de `ownerField`) ; `allow.ownerDefinedIn(champ)`
 *   = Gen1 `{ allow: owner, ownerField: champ }` ; `allow.group(nom)`/`allow.groups([...])` =
 *   `{ allow: groups, groups: [...] }` ; `allow.authenticated()` = `{ allow: private }` (tout
 *   utilisateur Cognito authentifié, peu importe le groupe -- PAS un mode "private" au sens
 *   anglais courant) ; `.to([...])` = `operations: [...]`.
 * - Pas d'`identityClaim()` custom : environnement Gen2 vierge (aucune donnée Gen1 à
 *   préserver), le format composite `"$sub::$username"` que Gen1 écrivait dans le champ caché
 *   `owner` n'a donc aucune conséquence -- seule la cohérence interne Gen2 écriture/lecture
 *   compte. `allow.owner()` utilise le défaut Gen2 partout où Gen1 utilisait `{ allow: owner }`
 *   sans `ownerField` explicite.
 *
 * Voir `docs/adr/0009-data-schema-gen2-auth-translation.md` (traduction `@auth`, en particulier
 * `ClinicOwnerRelation.ownerDefinedIn` -- le point le plus sensible de cette sous-tâche, lié au
 * bug réel du commit `d27f204`) et `docs/adr/0010-data-schema-gen2-relationships.md` (câblage
 * des relations `hasMany`/`hasOne`/`belongsTo`, y compris deux champs de relation que le
 * validateur de schéma Gen2 impose d'ajouter -- absents de Gen1, voir cet ADR avant de
 * modifier `Request`/`Mission` ci-dessous).
 *
 * Prérequis Phase 8, lot 3/3 sous-tâche 5 : `linkRequestToMission` (section 4 ci-dessous) est
 * une mutation CUSTOM (resolver JS `./resolvers/link-request-to-mission.js`), pas une traduction
 * `a.model()`/`@auth` -- `defineData` Gen2 n'expose pas d'argument `condition` équivalent sur les
 * mutations générées automatiquement. Voir
 * `docs/adr/0011-gen2-custom-mutation-conditional-write.md`.
 */

// Revue Lead Dev (cycle Phase 8 sous-tâche 4) : deux motifs `.authorization()` de champ
// répétés mot pour mot (7 fois pour le premier, sur Request ; 8 fois pour le second, sur
// Animal/Mission) -- extraits ici pour qu'un futur resserrage/élargissement d'un de ces
// motifs sur un sous-ensemble de champs ne dépende pas d'un copier-coller identique
// partout (risque réel : un champ oublié lors d'une future édition passerait inaperçu).
// Owner lecture seule, écriture réservée aux Veterinarians (create+read) -- Request.
const authenticatedReadOnlyVetCreateRead = (allow: any) => [
  allow.authenticated().to(['read']),
  allow.group('Veterinarians').to(['create', 'read']),
]
// Owner lecture seule, écriture réservée aux Veterinarians (read+update) -- Animal/Mission.
const ownerReadOnlyVetReadUpdate = (allow: any) => [
  allow.owner().to(['read']),
  allow.group('Veterinarians').to(['read', 'update']),
]
// Owner écrit UNE FOIS à la création puis lecture seule (jamais `update`), correction
// réservée aux Veterinarians (read+update) -- Animal, champs médicaux critiques
// (species/bloodGroup/weight/isVaccinated). Demande produit 2026-08-23 : contrairement à
// `ownerReadOnlyVetReadUpdate` ci-dessus (Owner ne les écrit JAMAIS), ces champs sont
// nécessairement saisis par l'Owner à la création d'un Animal (RegisterOwnerView.vue/
// AddAnimalView.vue) -- `.to(['create', 'read'])` couvre ce besoin sans jamais rouvrir
// `update`. Limite assumée, différente de "immuable seulement après validation" demandé
// initialement : `.authorization()` Gen2 ne peut pas conditionner une règle sur la valeur
// d'un autre champ (`isValidatedDonor`, même limite documentée sur ADR-0002 à 0006) --
// verrouiller dès la création plutôt qu'à la validation est le seul équivalent
// déclaratif, cohérent avec le nouveau rôle du vétérinaire lors de sa "première analyse"
// (ValidationsView.vue) : il corrige/confirme ces champs avant de valider, l'Owner ne les
// retouche plus après coup.
const ownerCreateReadOnlyVetReadUpdate = (allow: any) => [
  allow.owner().to(['create', 'read']),
  allow.group('Veterinarians').to(['read', 'update']),
]
// Write-once véritable (contrairement aux deux helpers ci-dessus, qui laissent toujours
// quelqu'un faire `update`) : `create`+`read` seul, jamais `update`/`delete` accordé à QUI
// QUE CE SOIT -- pas même au groupe qui a créé la ligne. Scaffolding légal/RGPD
// (2026-08-25, voir docs/adr/0014) : `ConsentRecord` (consentement CGU/confidentialité) et
// `DonorValidationAttestation` (attestation sur l'honneur du vétérinaire) doivent rester
// des preuves infalsifiables une fois écrites -- une correction ultérieure, même par son
// propre auteur, viderait leur valeur probante en cas de contrôle CNIL/litige (demande
// produit explicite : "ne doit JAMAIS pouvoir être modifié ou supprimé après coup"). Pas de
// paramètre `allow` distinct par modèle : les deux réutilisent la même règle de niveau
// modèle ci-dessous, `.to(['create', 'read'])` posé directement sur `allow.ownerDefinedIn`/
// `allow.group` (pas besoin d'un helper factorisé comme les deux ci-dessus : un seul appel
// chacun, pas de répétition à casser en cas d'oubli).
// Lecture seule des DEUX côtés (variante champ de l'idiome "write-once véritable"
// ci-dessus, qui lui est de niveau MODÈLE) -- double validation de Mission + notation
// (2026-08-26). ÉCART ASSUMÉ par rapport au plan initial de cette sous-tâche, à signaler
// explicitement en revue Lead Dev : le plan ne prévoyait AUCUNE `.authorization()` de champ
// sur `clinicValidationOutcome`/`clinicValidatedAt`/`ownerValidationOutcome`/
// `ownerValidatedAt`/`ownerDisputeReason`, en s'appuyant sur l'héritage des règles de
// niveau modèle de `Mission` (`allow.owner().to(['create', 'read', 'delete'])` /
// `allow.group('Veterinarians').to(['read', 'update'])`) -- avec le raisonnement "ni Owner
// ni Veterinarian n'écrit ces champs via une mutation générée". C'est vrai côté Owner (la
// règle owner de `Mission` n'a jamais eu `update`, ADR-0004), mais FAUX côté Veterinarian :
// sans ce scoping de champ, l'héritage du `update` de niveau modèle aurait donné à N'IMPORTE
// QUEL Veterinarian authentifié un accès `update` DIRECT sur ces 5 champs via
// `client.models.Mission.update()` -- y compris `ownerValidationOutcome`/
// `ownerDisputeReason`, le CÔTÉ DE L'OWNER, qu'un Veterinarian aurait alors pu falsifier
// directement, cassant la garantie centrale de cette sous-tâche (double validation
// MUTUELLE, chaque côté ne peut écrire QUE le sien, uniquement via
// `submitMissionValidation`). D'où ce helper : les deux côtés passent en `[read]` seul au
// niveau champ, la SEULE voie d'écriture réelle restant le resolver custom (bypass complet
// du système `@auth`, comme `linkRequestToMission`/ADR-0011 -- ce scoping de champ protège
// uniquement contre les mutations GÉNÉRÉES, pas contre le resolver lui-même, qui n'en a de
// toute façon pas besoin puisqu'il cible directement la table).
//
// Correctif graphql-schema-reviewer (2026-08-26, ÉLEVÉ) : `Admins` ajouté à cette règle.
// `.authorization()` de champ REMPLACE (ne fusionne pas) la règle de niveau modèle pour ce
// champ précis (ADR-0009) -- sans `Admins` explicitement listé ICI, le groupe perdait purement
// et simplement l'accès en lecture aux 5 champs de double validation malgré
// `allow.group('Admins').to(['read'])` posé au niveau modèle de `Mission` (ajouté
// spécifiquement pour que les Admins puissent voir les Missions DISPUTED) : un Admin aurait pu
// lire `Mission.status = DISPUTED` mais jamais `ownerDisputeReason` ni les deux outcomes qui
// expliquent POURQUOI la Mission est disputée -- la règle de niveau modèle devenait inutile
// pour l'usage même qui l'a motivée.
const missionValidationFieldsReadOnly = (allow: any) => [
  allow.owner().to(['read']),
  allow.group('Veterinarians').to(['read']),
  allow.group('Admins').to(['read']),
]
// Correctif graphql-schema-reviewer (2026-08-26, BLOQUANT) : `Mission.status` n'avait AUCUNE
// `.authorization()` de champ dédiée -- il héritait donc en clair de
// `allow.group('Veterinarians').to(['read', 'update'])` au niveau modèle de `Mission`
// (ci-dessous), permettant à N'IMPORTE QUEL Veterinarian authentifié d'écrire `status`
// directement via `client.models.Mission.update({ id, status: 'COMPLETED' })` -- contournant
// INTÉGRALEMENT `submitMissionValidation` (double validation Owner+Clinic, le coeur de cette
// sous-tâche). Exactement le trou que `missionValidationFieldsReadOnly` ci-dessus prétendait
// fermer pour les 5 AUTRES champs de validation, laissé ouvert sur `status` lui-même par oubli.
//
// PAS `missionValidationFieldsReadOnly` tel quel sur `status` (contrairement à ce qu'une
// première lecture du correctif suggérait) : ce helper n'a JAMAIS eu `create` pour l'Owner --
// correct pour les 5 champs de validation (l'Owner ne les écrit JAMAIS, même pas à la
// création), mais FAUX pour `status` : `createMissionSimple` (Owner, `useOwnerMissions.js`)
// écrit `status: PENDING_ARRIVAL/ACCEPTED` À LA CRÉATION de chaque Mission -- un besoin actif,
// pas un résidu. Réutiliser `missionValidationFieldsReadOnly` tel quel aurait donc retiré
// `create` à l'Owner sur `status` et cassé la création de Mission ENTIÈREMENT (aucun Owner
// n'aurait plus pu accepter de Request) -- une régression bien plus large et non demandée que
// le trou identifié (l'écriture illégitime venait de Veterinarians via `update`, pas de
// l'Owner via `create`). D'où ce second helper dédié, DISTINCT du premier : Owner garde
// `create`+`read` (comme avant ce correctif, AUCUN changement pour lui, y compris le résidu
// déjà documenté par ADR-0004 -- "un Owner peut toujours fabriquer un `createMission(status:
// COMPLETED)`" reste vrai, non fermé par ce correctif, hors périmètre) ; Veterinarians perd
// `update` et ne garde que `read` -- c'est le VRAI trou fermé ici. Conséquence ASSUMÉE et
// VOULUE (confirmée par le reviewer) : `useMissionClosure.js` (`closeMission()`, `client
// .models.Mission.update({ id: missionId, status: outcome })`) va désormais échouer en
// autorisation -- cet appel doit migrer vers `client.mutations.submitMissionValidation(...)`
// à l'étape 4 du plan (composables, hors périmètre de cette sous-tâche schéma). Ce n'est PAS
// un oubli à corriger plus tard : la prochaine sous-tâche DOIT faire cette migration, ce
// correctif casse intentionnellement l'ancien chemin pour forcer la bascule plutôt que de
// laisser cohabiter deux voies d'écriture (une sûre via le resolver, une non sûre via
// `update` direct).
const missionStatusFieldAuth = (allow: any) => [
  allow.owner().to(['create', 'read']),
  allow.group('Veterinarians').to(['read']),
  allow.group('Admins').to(['read']),
]
// Agrégats de notation + modération de `Clinic` (2026-08-26, étape 3/5 -- voir ADR-0017) :
// `averageRatingAsClinic`/`ratingCountAsClinic`/`needsAdminReview`/`needsAdminReviewSince`/
// `accountStatus`. Troisième variante du même idiome de champ, la PLUS restrictive du fichier :
// AUCUN rôle Cognito n'a `create` NI `update`, pas même l'auteur de la ligne -- contrairement à
// `missionStatusFieldAuth` (qui garde `create` pour l'Owner, sans quoi `createMissionSimple`
// casse) et à `missionValidationFieldsReadOnly` (lecture seule, mais pour trois rôles). Ces 5
// champs ne sont JAMAIS écrits via AppSync : leur seule voie d'écriture est la Lambda
// `rating-aggregation` (déclenchée par le flux DynamoDB de `Rating`), qui écrit en direct dans
// la table managée avec sa propre identité IAM -- comme la Lambda de l'étape 2/5 pour
// `Mission.status` (ADR-0016 §3). Un client qui pourrait les écrire pourrait falsifier sa propre
// moyenne ou saboter celle d'un tiers, ce que ni `@auth` ni aucun resolver ne saurait empêcher
// une fois l'opération accordée (limite "l'autorisation ne contraint jamais une VALEUR",
// ADR-0002/0004/0015).
//
// La règle de niveau modèle de `Clinic` est délibérément NON reprise ici -- et c'est le point à
// scruter en revue : elle contient `allow.authenticated().to(['read'])`, c'est-à-dire un accès
// en lecture pour N'IMPORTE QUEL utilisateur Cognito, Owners inclus. L'hériter aurait exposé
// l'état de modération interne d'une clinique (`needsAdminReview`, `accountStatus`,
// `needsAdminReviewSince`) ET sa moyenne à tout Owner consultant son profil, alors que la
// notation est PRIVÉE par construction dans cette feature (ADR-0015 : personne ne peut lister
// les `Rating` d'un autre ; agréger côté serveur ne doit pas rouvrir par la bande ce que le
// modèle `Rating` ferme). `allow.owner()` n'est pas repris non plus : le vétérinaire créateur de
// la ligne appartient de toute façon au groupe `Veterinarians` (PostConfirmation, ADR-0008), donc
// il ne perd rien -- et un `allow.owner()` SANS `.to([...])` lui rouvrirait `update`, exactement
// le trou que ce helper existe pour fermer.
//
// RÉSIDU ASSUMÉ, signalé plutôt que caché (même famille qu'ADR-0015 §2) : `Veterinarians` est un
// scope GLOBAL, pas "ma clinique" -- un vétérinaire de la clinique A peut donc lire la moyenne et
// l'état de modération de la clinique B. Aucune notion de "ma clinique" n'existe dans le système
// d'autorisation Gen2 pour `Clinic` (le seul modèle qui porte ce lien, `ClinicOwnerRelation`, lie
// une clinique à un OWNER, pas un vétérinaire à sa clinique). Le choix est le même que celui déjà
// tranché deux fois sur ce repo : un scope large mais HONNÊTE plutôt qu'un filtre qui simulerait
// une garantie de sécurité que le modèle de données ne porte pas.
const clinicRatingAndModerationFieldsReadOnly = (allow: any) => [
  allow.group('Veterinarians').to(['read']),
  allow.group('Admins').to(['read']),
]
// Pendant du helper ci-dessus pour `Owner` (`averageRatingAsOwner`/`ratingCountAsOwner`), avec
// DEUX différences imposées par la règle de niveau modèle de `Owner`
// (`allow.owner(), allow.group('Veterinarians').to(['read'])`), VÉRIFIÉE dans le SDL compilé
// avant d'écrire ce helper (`schema.transform().schema`, pin-testé dans
// `__tests__/resource.transform.test.ts`) plutôt que supposée :
// 1. `allow.owner()` y est SANS `.to([...])` -> il compile en `{allow: owner}`, c'est-à-dire les
//    QUATRE opérations (create/read/update/delete). Un Owner pouvait donc écrire n'importe quel
//    champ de son propre profil via `client.models.Owner.update()` : exactement le trou de
//    `Mission.status` avant le correctif de l'étape 1/5, transposé ici. D'où `allow.owner()
//    .to(['read'])` : l'Owner VOIT sa moyenne (c'est le besoin produit) mais ne peut plus
//    l'écrire. Pas besoin de garder `create` (contrairement à `missionStatusFieldAuth`) : ces
//    deux champs sont nouveaux, aucun code applicatif ne les envoie à la création d'un `Owner`
//    (`useRegistrationCompletion.js`), et une `@auth` de champ n'est évaluée que sur les champs
//    réellement présents dans l'input.
// 2. `Veterinarians` GARDE `read` (contrairement au helper `Clinic` ci-dessus, où
//    `authenticated()` est retiré) -- ce n'est pas une inattention : la règle de modèle de
//    `Owner` accorde déjà `read` aux seuls Veterinarians (pas à tous les authentifiés), donc le
//    reprendre ne change RIEN au périmètre de lecture existant. Le retirer, en revanche,
//    casserait toute lecture d'un `Owner` par un vétérinaire faite sans `selectionSet` explicite
//    (AppSync renvoie alors une erreur d'autorisation sur le champ, que `throwIfGraphqlError`
//    transforme en exception côté composable). Aucune lecture de ce type n'existe aujourd'hui
//    (`useClinicDonors.js` sélectionne explicitement ses champs), mais l'écart ne se paierait
//    qu'au premier composable qui l'oublierait.
// Pas d'`Admins` ici (contrairement au helper `Clinic`) : la règle de niveau modèle de `Owner`
// n'en accorde aucun -- l'ajouter au niveau CHAMP donnerait au groupe un accès qu'il n'a nulle
// part ailleurs sur ce modèle, ce que cette sous-tâche n'a aucune raison d'introduire.
const ownerRatingAggregateFieldsReadOnly = (allow: any) => [
  allow.owner().to(['read']),
  allow.group('Veterinarians').to(['read']),
]

/**
 * Nom PHYSIQUE du GSI DynamoDB posé sur `Mission.status` (voir `.secondaryIndexes()` sur le
 * modèle `Mission` plus bas). Exporté parce que DEUX consommateurs hors de ce fichier en
 * dépendent et ne doivent pas le recopier en dur :
 * - `amplify/backend.ts` : ARN de la policy IAM (`<tableArn>/index/<nom>`) ET valeur de la
 *   variable d'environnement passée à la Lambda planifiée.
 * - `amplify/functions/mission-validation-auto-finalizer/handler.ts` : `IndexName` du
 *   `QueryCommand` -- lu depuis l'environnement, JAMAIS importé depuis ce fichier (un import
 *   depuis `amplify/data/resource.ts` embarquerait tout `@aws-amplify/backend` dans le bundle
 *   esbuild de la Lambda).
 *
 * Nom EXPLICITE (`.name(...)`) plutôt que le nom auto-généré par le transformer : sans lui, le
 * nom physique du GSI est dérivé par `generateKeyAndQueryNameForConfig`
 * (`@aws-amplify/graphql-index-transformer`) et ne serait pas garanti stable/prévisible côté
 * IAM et côté `IndexName` de la Lambda -- deux endroits qui ont besoin de la valeur EXACTE.
 */
export const MISSION_STATUS_INDEX_NAME = 'missionsByStatus'

/**
 * Nom PHYSIQUE du GSI DynamoDB posé sur `Rating` (partition `targetID`, tri `targetRole` -- voir
 * `.secondaryIndexes()` sur le modèle `Rating` plus bas). Exporté pour les mêmes DEUX
 * consommateurs hors de ce fichier que `MISSION_STATUS_INDEX_NAME` ci-dessus, avec la même
 * raison de ne pas le recopier en dur :
 * - `amplify/backend.ts` : ARN de la policy IAM (`<tableArn>/index/<nom>`) ET valeur de la
 *   variable d'environnement passée à la Lambda `rating-aggregation`.
 * - `amplify/functions/rating-aggregation/handler.ts` : `IndexName` du `QueryCommand` -- lu
 *   depuis l'environnement, JAMAIS importé depuis ce fichier (un import depuis
 *   `amplify/data/resource.ts` embarquerait tout `@aws-amplify/backend` dans le bundle esbuild
 *   de la Lambda).
 */
export const RATING_TARGET_INDEX_NAME = 'ratingsByTarget'

export const schema = a.schema({
  // ==========================================================
  // ENUMS -- valeurs identiques à Gen1 (schema.graphql, section 4)
  // ==========================================================
  Species: a.enum(['DOG', 'CAT']),
  DonationFrequency: a.enum(['ASAP', 'TWICE_YEAR', 'ONCE_YEAR']),
  RequestType: a.enum(['EMERGENCY', 'APPOINTMENT']),
  RequestStatus: a.enum(['OPEN', 'IN_PROGRESS', 'CLOSED', 'CANCELLED']),
  // 'PENDING_VALIDATION'/'COMPLETED_AUTO'/'DISPUTED' (2026-08-26, double validation de
  // Mission) : les valeurs existantes ne changent PAS de sens. 'PENDING_VALIDATION' est le
  // statut intermédiaire une fois qu'un des deux côtés (Owner/Clinic) a soumis sa validation
  // via `submitMissionValidation` mais pas l'autre (voir la mutation custom, section 5, et
  // son resolver `amplify/data/resolvers/submit-mission-validation-*.js`) -- succède à
  // `ARRIVED`/`PENDING_ARRIVAL` dans le cycle de vie réel, pas câblé ici dans une machine à
  // états formelle (aucune des valeurs `MissionStatus` existantes ne l'était déjà).
  // 'COMPLETED_AUTO' n'est écrit par AUCUN code de cette sous-tâche -- réservé à une future
  // Lambda planifiée (délai de 7 jours sans réponse d'un des deux côtés), volontairement non
  // implémentée ici (voir l'en-tête de `submit-mission-validation-write-side.js`). 'DISPUTED'
  // est calculé par le resolver quand les deux côtés ont validé mais ne sont pas d'accord
  // (un CONFIRMED + un DENIED) -- visible en lecture seule par le groupe `Admins` (règle de
  // type ci-dessous), aucune interface de résolution admin n'est construite dans cette
  // sous-tâche.
  MissionStatus: a.enum([
    'ACCEPTED',
    'PENDING_ARRIVAL',
    'EN_ROUTE',
    'ARRIVED',
    'COMPLETED',
    'NO_SHOW',
    'CANCELLED',
    'PENDING_VALIDATION',
    'COMPLETED_AUTO',
    'DISPUTED',
  ]),
  // Scaffolding légal/RGPD (2026-08-25, docs/adr/0014) -- ConsentRecord.userRole : ni Owner
  // ni Veterinarian ne portent de champ "role" explicite aujourd'hui (le rôle se déduit du
  // MODÈLE lui-même, jamais d'un champ) ; ConsentRecord réutilise UN seul modèle pour les
  // deux côtés (userID générique, pas de relation polymorphe formelle), donc a besoin de cet
  // enum pour savoir de quel côté vient chaque ligne -- seul endroit du schéma où cette
  // distinction doit être portée par une valeur plutôt que par le modèle cible.
  AccountRole: a.enum(['OWNER', 'VETERINARIAN']),
  // CGV incluse dès maintenant (page prévue par la demande produit, item 1) même si non
  // capturée à l'inscription (item 2 -- Stripe non implémenté, hors périmètre V1 selon
  // CONTEXT.md, donc pas de case CGV obligatoire tant qu'aucun paiement n'existe réellement)
  // : réutilisable telle quelle le jour où CGV devient un consentement requis.
  LegalDocumentType: a.enum(['CGU', 'PRIVACY_POLICY', 'CGV']),
  // DonorValidationAttestation.eventType -- ATTESTATION à la validation d'un donneur,
  // REVOCATION si une validation est un jour annulée (schéma prêt pour ce cas, voir
  // commentaire du modèle plus bas -- aucune UI de révocation n'existe encore dans ce repo,
  // écrit en prévision plutôt qu'en réaction à un besoin actuel constaté).
  DonorValidationEventType: a.enum(['ATTESTATION', 'REVOCATION']),

  // Double validation de Mission + notation par étoiles bidirectionnelle privée
  // (2026-08-26) -- plan d'architecture validé avec le repo owner avant tout code, cette
  // sous-tâche couvre le schéma/`@auth`/resolver (étape 1/5), pas les composables front ni
  // la Lambda planifiée `COMPLETED_AUTO` (étapes suivantes, hors périmètre ici).
  //
  // 'PENDING' est l'état INITIAL implicite (aucune valeur écrite -- voir
  // `submit-mission-validation-write-side.js` pour pourquoi un champ jamais écrit EST
  // 'PENDING' côté logique, sans `.default()` de schéma) ; seuls 'CONFIRMED'/'DENIED' sont
  // des soumissions valides via `submitMissionValidation`, rejeté explicitement sinon.
  MissionValidationOutcome: a.enum(['PENDING', 'CONFIRMED', 'DENIED']),
  // Distingue les deux côtés d'une `Rating` (voir section 3, modèle `Rating` plus bas) --
  // même rôle structurel qu'`AccountRole` pour `ConsentRecord` (docs/adr/0014) : ni Owner ni
  // Veterinarian ne porte de champ "role" natif, le modèle cible seul ne suffit pas à
  // distinguer "qui note qui" sur une ligne `Rating` qui réutilise un seul modèle pour les
  // deux sens de notation.
  RatingParticipantRole: a.enum(['OWNER', 'CLINIC']),
  // Déclaré à l'étape 1/5 (schéma) sans qu'aucun champ ne le consomme encore -- provisionné en
  // avance de l'usage (même statut que `Veterinarian.validatedMissions`/
  // `DonorValidationAttestation.revokedAttestationID`, ADR-0010/0014).
  // DÉSORMAIS CONSOMMÉ (étape 3/5, 2026-08-26) par `Clinic.accountStatus`, écrit par la Lambda
  // `rating-aggregation` quand la moyenne glissante d'une clinique passe sous le seuil de
  // modération (docs/adr/0017). Le champ reste purement INFORMATIF à ce jour : aucune règle
  // `@auth`, aucun garde-fou applicatif ne lit `UNDER_REVIEW` -- pas d'exclusion automatique,
  // décision produit explicite.
  ClinicAccountStatus: a.enum(['ACTIVE', 'UNDER_REVIEW']),

  // 1. CLINIQUE & VÉTÉRINAIRES
  // ---------------------------------------------------------

  Clinic: a
    .model({
      name: a.string().required(),
      rpps: a.string().required(),
      email: a.string().required(),
      phone: a.string().required(),
      address: a.string().required(),
      latitude: a.float(),
      longitude: a.float(),
      hasEmergencyService: a.boolean().required(),

      transfusionsDone: a.integer(),
      donorOwnersCount: a.integer(),

      // Agrégats DÉNORMALISÉS des notations reçues EN TANT QUE CLINIC (`Rating.targetRole =
      // CLINIC`, section 3) + état de modération associé -- 2026-08-26, étape 3/5, voir
      // docs/adr/0017. Dénormalisés et non calculés à la lecture : le `@auth` de `Rating`
      // (ADR-0015) interdit délibérément à une clinique de LISTER les notes qu'elle a reçues
      // (seul le rater voit sa propre ligne), donc aucun client ne PEUT calculer sa propre
      // moyenne -- elle ne peut venir que d'un mécanisme serveur. Écrits EXCLUSIVEMENT par la
      // Lambda `rating-aggregation` (flux DynamoDB Streams de la table `Rating`, SDK direct,
      // hors AppSync) ; `.authorization(clinicRatingAndModerationFieldsReadOnly)` ferme
      // l'écriture à TOUS les rôles Cognito et retire au passage la lecture accordée par
      // `allow.authenticated()` au niveau modèle -- voir ce helper en tête de fichier pour le
      // raisonnement complet et le résidu assumé (scope `Veterinarians` global, pas "ma
      // clinique").
      //
      // `needsAdminReviewSince` est posé UNE SEULE FOIS, au premier franchissement du seuil
      // (écriture conditionnelle côté Lambda), et n'est jamais réécrit par les notes suivantes :
      // c'est la date d'ENTRÉE en revue, pas la date de la dernière mauvaise note. Aucun
      // mécanisme n'efface ces trois champs de modération : la sortie de revue est une décision
      // ADMIN (interface non construite ici, comme pour les Missions `DISPUTED`), pas un
      // automatisme qui effacerait la trace dès qu'une bonne note fait remonter la moyenne.
      averageRatingAsClinic: a.float().authorization(clinicRatingAndModerationFieldsReadOnly),
      ratingCountAsClinic: a.integer().authorization(clinicRatingAndModerationFieldsReadOnly),
      needsAdminReview: a.boolean().authorization(clinicRatingAndModerationFieldsReadOnly),
      needsAdminReviewSince: a.datetime().authorization(clinicRatingAndModerationFieldsReadOnly),
      // Premier champ à consommer l'enum `ClinicAccountStatus` (déclaré à l'étape 1/5 en avance
      // de l'usage, voir son commentaire plus haut). PAS d'exclusion automatique : passer
      // `UNDER_REVIEW` ne coupe AUCUN accès aujourd'hui (aucune règle `@auth`, aucun garde-fou
      // de routeur ni de composable ne lit ce champ -- décision produit explicite du plan :
      // "juste le flag, une interface admin future tranchera").
      accountStatus: a.ref('ClinicAccountStatus').authorization(clinicRatingAndModerationFieldsReadOnly),

      veterinarians: a.hasMany('Veterinarian', 'clinicID'),
      requests: a.hasMany('Request', 'clinicID'),
      clients: a.hasMany('ClinicOwnerRelation', 'clinicID'),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.group('Veterinarians').to(['create', 'read', 'update']),
      allow.authenticated().to(['read']),
    ]),

  Veterinarian: a
    .model({
      // id = Cognito sub (convention applicative, Gen1 comme Gen2 -- pas une contrainte
      // imposée par `@model`/`a.model()` lui-même, portée par le composable qui appelle
      // `create` avec `id: cognitoUserId`, hors périmètre de cette sous-tâche).
      firstname: a.string().required(),
      lastname: a.string().required(),
      email: a.string().required(),

      clinicID: a.id().required(),
      clinic: a.belongsTo('Clinic', 'clinicID'),

      // Gap préexistant DÉSORMAIS FERMÉ (revue graphql-schema-reviewer, correctif du
      // 2026-08-26 sur la sous-tâche double validation de Mission + notation) : le groupe
      // Cognito "Admins" référencé juste en-dessous est maintenant provisionné par l'IaC
      // (`amplify/auth/resource.ts`, `groups: [..., 'Admins']`), fermant le gap documenté par
      // docs/adr/0010 ("Gaps préexistants" -- resté vrai de Gen1 jusqu'à ce correctif). Effet
      // de bord RÉEL à assumer consciemment, pas seulement un texte de commentaire à corriger
      // en passant : `allow.group('Admins').to(['read', 'delete'])` ci-dessous, déclaré depuis
      // Gen1 mais jusqu'ici INATTEIGNABLE (aucun utilisateur ne pouvait appartenir à un groupe
      // qui n'existait pas), devient pour la première fois une règle VIVANTE -- tout
      // utilisateur Cognito placé manuellement dans `Admins` (provisioning manuel, aucune
      // assignation automatique à l'inscription) peut désormais lire ET SUPPRIMER n'importe
      // quel `Veterinarian`. Comportement inchangé par rapport à ce que Gen1 déclarait déjà
      // (règle reproduite à l'identique depuis le début de la migration Gen2, sous-tâche 4) --
      // seule sa RÉELLE atteignabilité change avec ce correctif, pas la règle elle-même.
      //
      // `validatedMissions` : en Gen1, `@hasMany` sans `indexName`/`fields` explicites --
      // jamais réellement câblé (le commentaire Gen1 le disait lui-même : "ajoutez @index(name:
      // "byVet") ici"). Grep applicatif (`grep -rn "validatedMissions" src/`) : uniquement dans
      // les fichiers auto-générés (`src/graphql/{queries,mutations,subscriptions}.js`), jamais
      // un composable/service -- champ mort côté applicatif. Reproduit ici avec le vrai FK qui
      // existe déjà sur Mission (`validatedByVeterinarianID`) plutôt que de laisser un champ
      // caché implicite -- correction MÉCANIQUE de traduction (le validateur de schéma Gen2
      // rejette une relation non appariée, voir docs/adr/0010), PAS une nouvelle fonctionnalité.
      validatedMissions: a.hasMany('Mission', 'validatedByVeterinarianID'),
      // Contrepartie obligatoire de `DonorValidationAttestation.veterinarian` (`belongsTo`
      // plus bas, voir docs/adr/0010 pour la raison mécanique) -- comme
      // `validatedMissions` ci-dessus, aucun composable applicatif actuel ne le consomme
      // (pas de vue "historique de mes attestations" à ce jour).
      donorValidationAttestations: a.hasMany('DonorValidationAttestation', 'veterinarianID'),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.group('Admins').to(['read', 'delete']),
      allow.authenticated().to(['read']),
    ]),

  // 2. PROPRIÉTAIRES & ANIMAUX
  // ---------------------------------------------------------

  Owner: a
    .model({
      firstname: a.string().required(),
      lastname: a.string().required(),
      email: a.string().required(),
      phone: a.string().required(),
      address: a.string().required(),
      latitude: a.float(),
      longitude: a.float(),
      maxTravelDistance: a.integer().required(),
      totalDonations: a.integer(),

      // Pendant Owner des agrégats de `Clinic` ci-dessus : notations reçues EN TANT QU'OWNER
      // (`Rating.targetRole = OWNER`), écrites par la même Lambda `rating-aggregation`
      // (docs/adr/0017). AUCUNE logique de modération de ce côté (hors périmètre du plan : le
      // besoin exprimé ne porte que sur la modération des cliniques) -- pas de `needsAdminReview`
      // ni d'`accountStatus` sur `Owner`, délibérément, plutôt qu'une symétrie décorative que
      // rien ne consommerait.
      // `.authorization(ownerRatingAggregateFieldsReadOnly)` : voir ce helper en tête de fichier
      // -- l'Owner voit sa propre moyenne mais ne peut plus l'écrire (la règle de niveau modèle
      // `allow.owner()`, sans `.to([...])`, lui donnait les 4 opérations, donc `update`).
      averageRatingAsOwner: a.float().authorization(ownerRatingAggregateFieldsReadOnly),
      ratingCountAsOwner: a.integer().authorization(ownerRatingAggregateFieldsReadOnly),

      animals: a.hasMany('Animal', 'ownerID'),
      availabilities: a.hasMany('OwnerAvailability', 'ownerID'),
      myClinics: a.hasMany('ClinicOwnerRelation', 'ownerID'),
    })
    .authorization((allow) => [allow.owner(), allow.group('Veterinarians').to(['read'])]),

  OwnerAvailability: a
    .model({
      dayOfWeek: a.integer().required(),
      startTime: a.time().required(),
      endTime: a.time().required(),

      ownerID: a.id().required(),
      ownerProfile: a.belongsTo('Owner', 'ownerID'),
    })
    .authorization((allow) => [allow.owner(), allow.group('Veterinarians').to(['read'])]),

  Animal: a
    .model({
      name: a.string().required(),
      // `.authorization()` de champ (REMPLACE, pour ces quatre champs -- species/bloodGroup/
      // weight/isVaccinated -- les règles de type ci-dessous) : demande produit 2026-08-23,
      // amende ADR-0006. Owner : `create+read` (les saisit à la création d'un Animal,
      // RegisterOwnerView.vue/AddAnimalView.vue) mais plus jamais `update` -- avant ce
      // correctif, `bloodGroup` restait aussi ouvert en édition Owner (AnimalsView.vue), ce
      // qui permettait de défaire silencieusement une correction vétérinaire. Veterinarians :
      // `read+update`, pour corriger/confirmer ces champs lors de la "première analyse"
      // précédant la validation (ValidationsView.vue, étendu pour couvrir les quatre plutôt
      // que `bloodGroup` seul). Voir `ownerCreateReadOnlyVetReadUpdate` en tête de fichier
      // pour la limite assumée (verrouillage dès la création, pas seulement après
      // validation -- `.authorization()` ne peut pas conditionner sur `isValidatedDonor`).
      species: a.ref('Species').required().authorization(ownerCreateReadOnlyVetReadUpdate),
      breed: a.string(),
      // Sexe de l'animal (CdC §2.1) -- informatif uniquement pour ce pilote, PAS un critère
      // d'éligibilité (décision produit) : ne pas le référencer dans eligibility-service.js.
      // Valeur libre plutôt qu'un enum dédié pour ce pilote ('MALE'/'FEMALE', voir AnimalSex
      // dans constants/enums.js) ; pas de `.authorization()` dédiée, hérite des règles de type
      // ci-dessous (même bord Owner que breed).
      sex: a.string(),
      birthDate: a.date(),
      weight: a.float().required().authorization(ownerCreateReadOnlyVetReadUpdate),

      bloodGroup: a.string().required().authorization(ownerCreateReadOnlyVetReadUpdate),
      isVaccinated: a.boolean().required().authorization(ownerCreateReadOnlyVetReadUpdate),
      isSterilized: a.boolean(),

      // `.authorization()` de champ (REMPLACE, pour ce champ, les règles de type ci-dessous) :
      // Owner en lecture seule, écriture réservée aux Veterinarians. Même mécanisme
      // qu'isValidatedDonor/validationExpiresAt ci-dessous (ADR-0002) : la clôture d'une Mission
      // en COMPLETED doit pouvoir écrire cette date sans ouvrir un accès en écriture général sur
      // Animal aux Veterinarians (ce qui leur permettrait de modifier des champs saisis par
      // l'Owner -- nom, race, poids...). Voir docs/adr/0003.
      lastDonationDate: a
        .date()
        .authorization(ownerReadOnlyVetReadUpdate),
      donationFrequency: a.ref('DonationFrequency'),

      // `.authorization()` de champ (REMPLACE, pour ces deux champs uniquement, les règles de
      // type ci-dessous) : Owner en lecture seule, écriture réservée aux Veterinarians. Voir
      // docs/adr/0002 (amendement 2026-08-12).
      isValidatedDonor: a
        .boolean()
        .authorization(ownerReadOnlyVetReadUpdate),
      validationExpiresAt: a
        .datetime()
        .authorization(ownerReadOnlyVetReadUpdate),

      ownerID: a.id().required(),
      ownerProfile: a.belongsTo('Owner', 'ownerID'),
      missions: a.hasMany('Mission', 'animalID'),
      // Contrepartie obligatoire de `DonorValidationAttestation.animal` (`belongsTo` plus
      // bas) -- même raison mécanique que `missions` ci-dessus (docs/adr/0010).
      validationAttestations: a.hasMany('DonorValidationAttestation', 'animalID'),
    })
    .authorization((allow) => [allow.owner(), allow.group('Veterinarians').to(['read'])]),

  ClinicOwnerRelation: a
    .model({
      clinicID: a.id().required(),
      clinic: a.belongsTo('Clinic', 'clinicID'),
      ownerID: a.id().required(),
      ownerProfile: a.belongsTo('Owner', 'ownerID'),
      isPrimaryClinic: a.boolean(),
    })
    // `ownerDefinedIn("ownerID")` explicite -- traduction Gen2 du `ownerField: "ownerID"` Gen1,
    // POINT LE PLUS SENSIBLE de cette sous-tâche (voir docs/adr/0009 pour le détail complet).
    // Ces lignes sont TOUJOURS écrites côté Veterinarian (useMissionClosure.js), jamais par
    // l'Owner lui-même. Sans `ownerDefinedIn`, `allow.owner()` se serait appuyé sur le champ
    // caché auto-injecté par le Transformer (identité de qui ÉCRIT la ligne, donc toujours le
    // Vet) au lieu du champ `ownerID` du modèle (identité réelle du pet Owner) -- exactement le
    // bug du commit `d27f204` : la query `clinicOwnerRelationsByOwnerID` serait restée vide en
    // permanence côté Owner.
    .authorization((allow) => [allow.ownerDefinedIn('ownerID'), allow.group('Veterinarians')]),

  // 3. OPÉRATIONS
  // ---------------------------------------------------------

  Request: a
    .model({
      // `.authorization()` de champ (REMPLACE, pour ces champs, les règles de type ci-dessous) :
      // Owner en lecture seule, écriture réservée aux Veterinarians (create : createRequestSimple
      // à la création de la Request ; update non inclus, aucun code applicatif ne réécrit ces
      // champs après création -- à étendre si un futur besoin d'édition apparaît). `status`/
      // `activeMissionID` restent volontairement HORS de cette liste (pas de `.authorization()`
      // sur ces deux champs plus bas) : ce sont les deux seuls champs que linkRequestToMission
      // (Owner, à l'acceptation) doit pouvoir écrire, via la règle `allow.authenticated()` de
      // niveau modèle ci-dessous (`.to(['read', 'update'])`).
      requestType: a
        .ref('RequestType')
        .required()
        .authorization(authenticatedReadOnlyVetCreateRead),
      requiredSpecies: a
        .ref('Species')
        .required()
        .authorization(authenticatedReadOnlyVetCreateRead),
      requiredBloodGroup: a
        .string()
        .required()
        .authorization(authenticatedReadOnlyVetCreateRead),
      quantity: a
        .integer()
        .required()
        .authorization(authenticatedReadOnlyVetCreateRead),
      // Phase 6.5 (ADR-0005) : date/heure de RDV souhaitée par la clinique pour une Request
      // APPOINTMENT (null/absent pour EMERGENCY). Même `.authorization()` que ses voisins
      // ci-dessus. ⚠️ Nommage identique à Mission.appointmentDatetime (existant, non lié) : ce
      // dernier est horodaté à "maintenant" au moment où l'Owner accepte la Mission
      // (useOwnerMissions.js), pas la date de RDV souhaitée par la clinique à la création de la
      // Request -- deux champs distincts, sur deux types distincts, sémantiques différentes.
      appointmentDatetime: a
        .datetime()
        .authorization(authenticatedReadOnlyVetCreateRead),
      // Hors scoping champ, délibérément : ce sont les deux seuls champs (avec activeMissionID
      // plus bas) que `linkRequestToMission` doit pouvoir écrire côté Owner. Sans `update` sur la
      // règle `allow.authenticated()` de niveau modèle, l'acceptation d'une Mission par un Owner
      // échouerait au niveau auth. NB : un scoping plus fin (mutation dédiée ne touchant que le
      // statut) empiéterait sur l'écriture conditionnelle atomique d'ADR-0001 -- volontairement
      // hors périmètre ici, comme en Gen1.
      status: a.ref('RequestStatus').required(),
      createdAt: a
        .datetime()
        .authorization(authenticatedReadOnlyVetCreateRead),

      clinicID: a
        .id()
        .required()
        .authorization(authenticatedReadOnlyVetCreateRead),
      clinic: a.belongsTo('Clinic', 'clinicID'),

      // Hors scoping champ (voir `status` ci-dessus, même raison).
      activeMissionID: a.id(),
      // Gen1 déclarait `mission: Mission @hasOne(fields: ["activeMissionID"])` -- un hasOne dont
      // le champ de référence (`activeMissionID`) vit sur CE modèle (Request), pas sur Mission.
      // Le validateur de schéma Gen2 (`SchemaProcessor.mjs`, `getModelRelationship`) exige que le
      // champ de référence d'un `hasOne` soit défini sur le modèle CIBLE (Mission) -- ce qui
      // n'est pas notre cas ici : le FK est physiquement stocké sur Request. Traduction correcte
      // en Gen2 : `belongsTo` (le champ de référence vit sur le modèle qui le déclare), apparié
      // au nouveau `Mission.activeForRequest` ci-dessous. Comportement applicatif inchangé
      // (`request.mission.animal.ownerProfile...`, RequestsView.vue/useClinicHistory.js, résout
      // toujours de la même façon) -- seule la direction de la déclaration change, imposée par le
      // framework. Voir docs/adr/0010 pour le détail complet de cette décision.
      mission: a.belongsTo('Mission', 'activeMissionID'),
      // NOUVEAU côté schéma (absent de Gen1) : le validateur de schéma Gen2 exige un `hasMany`/
      // `hasOne` en contrepartie de `Mission.request` (`belongsTo` via `requestID`, ci-dessous) --
      // Gen1 le laissait unidirectionnel sans jamais valider ce couplage. `hasMany` (pas
      // `hasOne`) parce qu'une Request peut avoir plusieurs Missions dans le temps (une Mission
      // NO_SHOW/CANCELLED suivie d'une nouvelle Mission pour la même Request) -- `mission`
      // ci-dessus reste le seul pointeur vers la Mission ACTIVE, `missions` est l'historique
      // complet. Correction MÉCANIQUE de traduction, comme `Veterinarian.validatedMissions`
      // ci-dessus -- aucun composable applicatif actuel n'utilise ce champ (sous-tâche 5).
      missions: a.hasMany('Mission', 'requestID'),
    })
    .authorization((allow) => [
      allow.group('Veterinarians'),
      // "update" est requis ici : linkRequestToMission (appelée par acceptMission) fait un
      // update en tant qu'Owner pour passer la Request en IN_PROGRESS. Sans cette règle,
      // l'acceptation d'une Mission par un Owner échoue au niveau auth. Champ-par-champ
      // ci-dessus (revue DevSecOps Gen1, Phase 5) : sans ce second niveau, cette règle
      // autoriserait n'importe quel Owner authentifié à réécrire N'IMPORTE QUEL champ de
      // N'IMPORTE QUELLE Request via un update direct -- pas seulement status/activeMissionID.
      allow.authenticated().to(['read', 'update']),
    ]),

  Mission: a
    .model({
      requestID: a.id().required(),
      request: a.belongsTo('Request', 'requestID'),

      animalID: a.id().required(),
      animal: a.belongsTo('Animal', 'animalID'),

      // `.authorization(missionStatusFieldAuth)` (correctif graphql-schema-reviewer, BLOQUANT,
      // 2026-08-26 -- voir ce helper en tête de fichier pour le détail complet). AVANT ce
      // correctif, `status` ne portait AUCUNE `.authorization()` de champ et héritait donc de
      // `allow.group('Veterinarians').to(['read', 'update'])` au niveau modèle -- un
      // Veterinarian pouvait écrire `status` directement (`client.models.Mission.update({ id,
      // status: 'COMPLETED' })`), contournant intégralement `submitMissionValidation` (double
      // validation Owner+Clinic). `createMissionSimple` (Owner, `useOwnerMissions.js`) garde
      // `create` sur ce champ (`missionStatusFieldAuth` distinct de
      // `missionValidationFieldsReadOnly` précisément pour ça) ; Veterinarians perd `update`.
      // Résidu ADR-0004 inchangé, non fermé par ce correctif (hors périmètre) : un Owner peut
      // toujours fabriquer un `createMission(status: COMPLETED)` à la création.
      status: a.ref('MissionStatus').required().authorization(missionStatusFieldAuth),
      appointmentDatetime: a.datetime(),

      // `.authorization()` de champ (revue graphql-schema-reviewer Gen1, Phase 5) : retirer
      // `update` à la règle owner de niveau modèle (ci-dessous) ne suffisait pas -- `create` y
      // restait, et sans ce scoping un Owner pouvait fabriquer directement un
      // `createMission(status: COMPLETED, validatedByVeterinarianID: "...")`, usurpant une
      // validation vétérinaire dès la création. Ces 5 champs sont par ailleurs inutilisés par
      // tout code applicatif actuel (flow QR-scan abandonné, Stripe hors périmètre V1) : aucune
      // régression possible à les verrouiller entièrement aux Veterinarians.
      validationCode: a
        .string()
        .authorization(ownerReadOnlyVetReadUpdate),
      scannedAt: a
        .datetime()
        .authorization(ownerReadOnlyVetReadUpdate),

      validatedByVeterinarianID: a
        .id()
        .authorization(ownerReadOnlyVetReadUpdate),
      validatedBy: a.belongsTo('Veterinarian', 'validatedByVeterinarianID'),

      stripePaymentIntentId: a
        .string()
        .authorization(ownerReadOnlyVetReadUpdate),
      stripePaymentStatus: a
        .string()
        .authorization(ownerReadOnlyVetReadUpdate),

      // Contrepartie obligatoire de `Request.mission` (`belongsTo` ci-dessus) -- voir le
      // commentaire détaillé sur `Request.mission`. Jamais consommé par un composable applicatif
      // (Gen1 non plus : aucun champ réciproque n'existait sur Mission) ; nom choisi pour rester
      // lisible dans le client généré si un futur besoin apparaît, sans laisser un champ anonyme.
      activeForRequest: a.hasOne('Request', 'activeMissionID'),

      // Double validation de Mission (2026-08-26) -- écrits UNIQUEMENT par la mutation custom
      // `submitMissionValidation` (section 5, resolver `submit-mission-validation-*.js`, bypass
      // `@auth` comme `linkRequestToMission`/ADR-0011). `.authorization()` de champ
      // (`missionValidationFieldsReadOnly`, voir ce helper en tête de fichier pour l'écart
      // assumé par rapport au plan initial) : Owner ET Veterinarians en lecture seule sur les
      // 5 champs, aucune mutation générée (`client.models.Mission.update()`) ne peut les
      // écrire, côté Owner comme côté Veterinarian.
      clinicValidationOutcome: a.ref('MissionValidationOutcome').authorization(missionValidationFieldsReadOnly),
      clinicValidatedAt: a.datetime().authorization(missionValidationFieldsReadOnly),
      ownerValidationOutcome: a.ref('MissionValidationOutcome').authorization(missionValidationFieldsReadOnly),
      ownerValidatedAt: a.datetime().authorization(missionValidationFieldsReadOnly),
      ownerDisputeReason: a.string().authorization(missionValidationFieldsReadOnly),

      // Contrepartie obligatoire de `Rating.mission` (`belongsTo` plus bas, voir docs/adr/0010
      // pour la raison mécanique de cet appariement) -- notation par étoiles bidirectionnelle
      // privée (2026-08-26). Historique complet des notations liées à cette Mission (au plus
      // deux lignes, une par `RatingParticipantRole`, contrainte portée par
      // `Rating.identifier(['missionID', 'raterRole'])`, pas ici).
      ratings: a.hasMany('Rating', 'missionID'),
    })
    // GSI sur `status` (2026-08-26, étape 2/5 de la double validation de Mission). AJOUT
    // STRICTEMENT ADDITIF, découvert nécessaire seulement en construisant la Lambda planifiée
    // de finalisation automatique (`amplify/functions/mission-validation-auto-finalizer/`) --
    // pas à l'étape 1/5 (schéma + resolver), qui n'accédait jamais aux Missions autrement que
    // par leur clé primaire (`ddb.get`/`ddb.update` sur `{ id: missionId }`, les 3 fonctions du
    // pipeline `submitMissionValidation`). La Lambda, elle, a besoin de la question INVERSE :
    // "quelles Missions sont actuellement en `PENDING_VALIDATION` ?" -- sans index, la seule
    // réponse possible est un Scan COMPLET de la table Mission à chaque exécution planifiée
    // (coût et latence croissant indéfiniment avec l'historique des Missions clôturées, alors
    // que l'ensemble réellement recherché reste minuscule).
    //
    // API vérifiée dans les types INSTALLÉS (pas devinée, MCP context7 indisponible dans cette
    // session -- même méthode de vérification que `.identifier()`/ADR-0015) :
    // `node_modules/@aws-amplify/data-schema/dist/esm/ModelType.d.ts` (méthode
    // `secondaryIndexes((index) => [...])`, exemple JSDoc `index('type').sortKeys(['sort'])`) et
    // `ModelIndex.d.ts` (`.name()`/`.queryField()`/`.projection()`). Point NON évident vérifié
    // spécifiquement, parce que `.identifier()` a précisément le défaut inverse (ADR-0015 : un
    // champ `a.ref()` d'enum y est REFUSÉ) : un champ `a.ref()` d'enum EST éligible comme clé de
    // partition d'un index secondaire -- `ExtractSecondaryIndexIRFields` (ModelType.d.ts, "3.
    // RefType that refers to a top level defined EnumType") et la validation runtime
    // correspondante dans `transformedSecondaryIndexesForModel` (`SchemaProcessor.mjs`, qui lève
    // explicitement si le `a.ref()` ne pointe PAS vers un enum). `status` reste donc
    // `a.ref('MissionStatus')`, aucun changement de type à faire pour l'indexer.
    //
    // `.queryField(null)` -- écart ASSUMÉ par rapport au défaut du framework (qui générerait
    // une query GraphQL `listMissionByStatus`), à scruter en revue : le SEUL consommateur de cet
    // index est la Lambda planifiée, qui interroge la table DynamoDB EN DIRECT via le SDK (elle
    // n'a pas d'identité Cognito et bypasse AppSync, comme les resolvers custom bypassent
    // `@auth`). Générer une query publique sans aucun appelant élargirait la surface d'API pour
    // rien -- et cette query hériterait des règles de NIVEAU MODÈLE de `Mission`
    // (`allow.group('Veterinarians').to(['read'])`, sans notion de "ma clinique"), donnant à
    // n'importe quel Veterinarian un chemin plus commode pour lister les Missions de TOUTES les
    // cliniques par statut. Rien de nouveau en droit (`listMissions` le permet déjà), mais aucun
    // besoin de l'ajouter. Réversible sans coût si une future interface admin des Missions
    // `DISPUTED` en a besoin : `queryField` ne touche QUE l'API GraphQL (resolvers), pas la
    // structure du GSI -- le rétablir plus tard ne provoque aucune mise à jour de table.
    //
    // Pas de sort key ni de projection restreinte (défaut `ALL`) : aucun champ du modèle ne
    // porte l'échéance (choix d'architecture délibéré -- pas de `validationDeadline`, la Lambda
    // la dérive de `MIN(clinicValidatedAt, ownerValidatedAt)` + N jours), donc aucun candidat
    // sort key ne permettrait de filtrer côté DynamoDB plutôt que côté Lambda. `ALL` évite au
    // handler un GetItem de rattrapage par Mission (il consomme animalID/requestID/les 4 champs
    // de validation) ; une projection `INCLUDE` figerait la liste exacte des champs lus dans
    // l'infrastructure, au prix d'une mise à jour de GSI (déploiement itératif) à chaque champ
    // supplémentaire lu plus tard.
    .secondaryIndexes((index) => [index('status').name(MISSION_STATUS_INDEX_NAME).queryField(null)])
    .authorization((allow) => [
      // Restreint aux opérations réellement utilisées (revue DevSecOps Gen1, Phase 5) : sans ce
      // `.to([...])`, la règle owner à elle seule autoriserait un Owner authentifié à appeler
      // update(status: COMPLETED) (ou écrire validatedByVeterinarianID) directement sur sa propre
      // Mission -- contournant useMissionClosure.js et cassant la garantie centrale de la Phase 2
      // ("l'Owner ne peut pas s'auto-valider sa Mission comme terminée"). L'Owner voit toujours le
      // statut (read) mais ne peut plus l'écrire ; seuls create/delete (jamais update) sont
      // appelés côté Owner (useOwnerMissions.js -- createMissionSimple/deleteMissionSimple).
      allow.owner().to(['create', 'read', 'delete']),
      allow.group('Veterinarians').to(['read', 'update']),
      // Double validation de Mission (2026-08-26) -- visibilité admin en LECTURE SEULE sur les
      // Missions (en particulier `DISPUTED`, calculée par `submitMissionValidation`) : ferme le
      // gap `Admins` documenté par docs/adr/0010 section 3 (groupe désormais provisionné,
      // `amplify/auth/resource.ts`). Pas d'`update` : l'interface admin de résolution des
      // litiges n'est pas construite dans cette sous-tâche (mentionné dans le plan comme hors
      // périmètre), lecture seule uniquement pour l'instant.
      allow.group('Admins').to(['read']),
    ]),

  // Notation par étoiles bidirectionnelle PRIVÉE (2026-08-26) -- une Mission clôturée (double
  // validation ci-dessus) donne lieu à AU PLUS deux notations : l'Owner note la Clinic, la
  // Clinic note l'Owner, chacune indépendante de l'autre. `.identifier(['missionID',
  // 'raterRole'])` (clé composite, PAS le défaut `id` auto-généré) empêche mécaniquement une
  // double soumission côté MÊME rôle sur la MÊME Mission -- une seconde `create` avec le même
  // couple échoue nativement (contrainte de clé primaire DynamoDB), sans avoir besoin d'une
  // condition d'écriture dédiée comme `submitMissionValidation` ci-dessus. Vérifié pour cette
  // sous-tâche (pas deviné) : `.identifier([...])` est bien l'API réelle installée
  // (`node_modules/@aws-amplify/data-schema/dist/esm/ModelType.d.ts`, JSDoc et exemple
  // `.identifier(['name', 'email'])` correspondant exactement à l'usage ici).
  //
  // L'agrégation par Clinic/Owner, annoncée ici comme "prochaine sous-tâche" à l'étape 1/5,
  // EXISTE depuis l'étape 3/5 (2026-08-26) : dénormalisée sur `Clinic`
  // (`averageRatingAsClinic`/`ratingCountAsClinic` + les 3 champs de modération) et sur `Owner`
  // (`averageRatingAsOwner`/`ratingCountAsOwner`), avec leurs propres `.authorization()` de
  // champ (voir ces modèles plus haut et docs/adr/0017). Rien ne change ICI pour autant : le
  // modèle `Rating` reste inchangé côté `@auth`, et c'est justement parce que PERSONNE ne peut
  // lister les notes reçues par un tiers que l'agrégat doit être calculé et écrit côté SERVEUR
  // (Lambda `rating-aggregation`, sur le flux DynamoDB de cette table), jamais par un client.
  // `Veterinarians` n'a délibérément PAS `read` dans la règle ci-dessous : seul
  // `allow.ownerDefinedIn('raterID')` donne `read` à qui a ÉCRIT la ligne (donc au Veterinarian
  // qui vient de noter, sur SA PROPRE notation) -- un `allow.group('Veterinarians').to(['read'])`
  // supplémentaire aurait permis à N'IMPORTE QUEL Veterinarian authentifié de LISTER les notes
  // reçues par N'IMPORTE QUELLE AUTRE clinique (fuite cross-clinique, aucune notion de
  // "ma clinique" dans le système d'autorisation Gen2 pour ce modèle -- `ClinicOwnerRelation`
  // n'aide pas ici, `Rating` n'a pas de FK vers `Clinic`). Notation reste donc PRIVÉE : chaque
  // rater voit sa propre notation (`ownerDefinedIn`), personne d'autre ne peut lister celles des
  // autres, sauf `Admins` (lecture seule, modération future -- non construite ici).
  //
  // Résidu ASSUMÉ, documenté en détail dans `docs/adr/0015-rating-model-and-forgery-residual.md`
  // (même format qu'ADR-0004/0005) : un Veterinarian peut soumettre `raterID`/`targetID`
  // ARBITRAIRES côté CLINIC (`allow.group('Veterinarians').to(['create'])` ci-dessous n'impose
  // aucune contrainte sur la VALEUR de ces deux champs, même limite `@auth` que partout ailleurs
  // dans ce fichier -- pas de contrainte serveur possible sur la valeur d'un champ, seulement sur
  // l'ensemble d'opérations). Mitigation UNIQUEMENT côté client, dans le futur composable qui
  // dérivera `raterID` du `clinicID` du Veterinarian authentifié plutôt que de faire confiance à
  // un paramètre libre -- voir l'ADR pour l'analyse complète et l'alternative écartée (mutation
  // custom dédiée, jugée disproportionnée pour ce pilote).
  Rating: a
    .model({
      missionID: a.id().required(),
      mission: a.belongsTo('Mission', 'missionID'),
      raterID: a.id().required(),
      // ÉCART DÉCOUVERT (vérifié, pas deviné) par rapport au plan initial -- qui prévoyait
      // `a.ref('RatingParticipantRole').required()` ici, comme `targetRole` juste en dessous.
      // `npx tsc --noEmit` ne l'a PAS attrapé (types valides), mais `schema.transform()` lève à
      // l'exécution : "Invalid identifier definition. Field raterRole cannot be used in the
      // identifier. Identifiers must reference required or DB-generated fields" --
      // `validateNullableIdentifiers` (`node_modules/@aws-amplify/data-schema/src/
      // SchemaProcessor.ts`) ne lit QUE `fieldDef.data.required` (positionné par
      // `ModelField.required()`, ex. `a.id().required()`/`a.string().required()`) pour décider
      // si un champ peut entrer dans `.identifier([...])` -- `RefType.required()` (un champ
      // `a.ref(...)`, donc tout champ d'enum) positionne `data.valueRequired`, une propriété
      // DIFFÉRENTE que ce validateur ne connaît pas. Résultat : AUCUN champ `a.ref()` d'enum ne
      // peut faire partie d'une clé composite `.identifier()` avec la version installée de
      // `@aws-amplify/data-schema`, quelle que soit sa déclaration -- pas un cas particulier de
      // `RatingParticipantRole`. `raterRole` passe donc en `a.string().required()` UNIQUEMENT
      // pour satisfaire cette contrainte du validateur ; `targetRole` (qui n'entre PAS dans
      // l'identifiant) reste `a.ref('RatingParticipantRole').required()` sans ce problème.
      // Résidu ASSUMÉ, documenté dans docs/adr/0015 : contrairement à `targetRole`, la valeur de
      // `raterRole` n'est plus validée par le système de type GraphQL (un enum rejette une
      // valeur hors énumération AU NIVEAU du schéma, une `String` non) -- seule mitigation :
      // le futur composable n'enverra jamais que 'OWNER'/'CLINIC' (les valeurs de
      // `RatingParticipantRole`), jamais une valeur arbitraire construite dynamiquement.
      raterRole: a.string().required(),
      targetID: a.id().required(),
      targetRole: a.ref('RatingParticipantRole').required(),
      stars: a.integer().required(),
      comment: a.string(),
    })
    .identifier(['missionID', 'raterRole'])
    // GSI `(targetID, targetRole)` -- partition `targetID`, tri `targetRole` (2026-08-26, étape
    // 3/5, docs/adr/0017). La clé PRIMAIRE de `Rating` répond à "qui a noté sur CETTE Mission ?"
    // (`missionID` + `raterRole`) ; cet index répond à la question INVERSE, la seule dont la
    // Lambda d'agrégation a besoin : "toutes les notes reçues par CETTE cible". Sans lui, la
    // seule réponse possible serait un `Scan` complet de la table `Rating` à CHAQUE notation --
    // pire que le cas de l'étape 2/5 (exécution planifiée quotidienne), puisque déclenché par le
    // flux DynamoDB à chaque écriture.
    //
    // Sort key `targetRole` plutôt qu'un index sur `targetID` seul : `targetID` porte tantôt un
    // `Clinic.id`, tantôt un `Owner.id` (deux espaces d'identifiants distincts, mais ce schéma en
    // fabrique déjà la collision -- `Clinic.id === Veterinarian.id` à l'inscription, résidu connu
    // de la Phase -1). Le tri sur `targetRole` rend la requête EXACTE (`targetID = :id AND
    // targetRole = :role`) plutôt que "probablement sans collision", au prix d'aucune complexité
    // côté handler.
    //
    // API vérifiée dans les paquets INSTALLÉS, pas devinée (même méthode qu'ADR-0015/0016, MCP
    // `context7` toujours indisponible) : `index(pk).sortKeys([...])` existe bien
    // (`node_modules/@aws-amplify/data-schema/dist/esm/ModelIndex.d.ts`, méthode `sortKeys`), et
    // un champ `a.ref()` d'enum est accepté AUSSI BIEN en clé de partition qu'en clé de tri d'un
    // index secondaire -- la validation runtime (`transformedSecondaryIndexesForModel`,
    // `SchemaProcessor.mjs`) itère sur `[partitionKey, ...sortKeys]` avec le MÊME test (le `ref`
    // doit pointer vers un enum). `targetRole` reste donc `a.ref('RatingParticipantRole')`,
    // contrairement à `raterRole` que `.identifier()` a forcé en `a.string()` (ADR-0015) : deux
    // validateurs différents, deux contraintes différentes -- ne pas généraliser l'un à l'autre.
    //
    // `.queryField(null)` -- même écart assumé qu'à l'étape 2/5 (`MISSION_STATUS_INDEX_NAME`) :
    // le SEUL consommateur est la Lambda, qui interroge la table en DIRECT via le SDK (pas
    // d'identité Cognito, bypass d'AppSync). Ici la raison est même plus forte que pour
    // `Mission.status` : générer une query `listRatingByTargetIDAndTargetRole` ajouterait à
    // l'API publique le point d'entrée exact que le `@auth` de `Rating` a été conçu pour ne pas
    // offrir ("les notes reçues par X"), en s'en remettant au seul filtre d'autorisation de
    // niveau modèle pour qu'il ne fuite rien. Réversible sans coût si une interface admin de
    // modération en a besoin un jour : `queryField` ne touche QUE l'API GraphQL, pas la
    // structure du GSI.
    //
    // Projection par défaut (`ALL`), comme le GSI de l'étape 2/5 et pour la même raison : une
    // projection `INCLUDE ['stars']` collerait au besoin actuel du handler (qui ne lit QUE
    // `stars`, via `ProjectionExpression`), mais figerait la liste des champs lisibles dans
    // l'INFRASTRUCTURE -- toute lecture supplémentaire ultérieure (répartition des notes,
    // dernier commentaire...) imposerait une mise à jour de GSI sur une table managée. Le
    // sur-fetch est déjà évité là où il coûte, côté requête.
    .secondaryIndexes((index) => [
      index('targetID').sortKeys(['targetRole']).name(RATING_TARGET_INDEX_NAME).queryField(null),
    ])
    .authorization((allow) => [
      allow.ownerDefinedIn('raterID').to(['create', 'read']),
      allow.group('Veterinarians').to(['create']),
      allow.group('Admins').to(['read']),
    ]),

  // 4. LÉGAL / CONFORMITÉ (RGPD, attestation vétérinaire)
  // ---------------------------------------------------------
  // Scaffolding technique (2026-08-25, docs/adr/0014) -- contenu des documents eux-mêmes
  // (texte CGU/CGV/confidentialité, texte d'attestation) volontairement PAS ici : ces deux
  // modèles ne stockent qu'une PREUVE d'acceptation/d'attestation (qui, quand, quelle
  // version), jamais le texte lui-même (voir src/legal/*.md, src/constants/legal.js).

  // Une ligne par (utilisateur, type de document, version) -- PAS un champ sur Owner/Clinic
  // (option écartée, voir docs/adr/0014) : un champ unique serait écrasé par un futur
  // re-consentement (CGU mises à jour), perdant tout historique -- exactement ce que la
  // demande produit "traçabilité CNIL/litige, infalsifiable" interdit. `userID` générique
  // (pas de relation `belongsTo` formelle vers Owner OU Veterinarian -- Gen2 n'a pas de
  // relation polymorphe, et une relation dédiée par côté serait un couplage inutile pour un
  // simple horodatage) : porte le `cognitoUserId`, identique à `Owner.id`/`Veterinarian.id`
  // sur ce schéma. `userRole` (AccountRole) distingue les deux côtés puisque `userID` seul
  // ne suffit pas à savoir dans quelle table chercher le profil correspondant.
  // `documentVersion` : la version EXACTE acceptée (pas juste un booléen "a accepté") --
  // permet de répondre à "quelle version des CGU cet Owner a-t-il acceptée le 12/03 ?".
  // `createdAt` (auto, non déclaré ci-dessous) sert d'horodatage d'acceptation : posé par
  // AppSync côté serveur au moment de l'écriture, jamais fourni par le client -- pas besoin
  // d'un champ dédié. Léger décalage assumé avec l'instant réel du clic sur la case à cocher
  // (le flux d'inscription confirme d'abord le code Cognito avant d'écrire cette ligne, voir
  // useRegistrationCompletion.js) : documenté ici plutôt que construit une infrastructure de
  // timestamp signé côté client pour un besoin non exprimé par la demande produit (qui ne
  // demande un timestamp SERVEUR strict que pour l'attestation vétérinaire ci-dessous, pas
  // pour le consentement RGPD).
  ConsentRecord: a
    .model({
      userID: a.id().required(),
      userRole: a.ref('AccountRole').required(),
      documentType: a.ref('LegalDocumentType').required(),
      documentVersion: a.string().required(),
    })
    // `ownerDefinedIn('userID')` (pas `allow.owner()` par défaut) -- même raison que
    // `ClinicOwnerRelation` plus haut (docs/adr/0009) : la ligne est toujours créée par
    // l'utilisateur lui-même juste après la création de son propre profil
    // (`completeOwnerRegistration`/`completeVetRegistration`,
    // useRegistrationCompletion.js), donc dans ce cas précis `allow.owner()` par défaut
    // aurait suffi (auteur de la ligne = sujet du consentement) -- mais `ownerDefinedIn`
    // explicite documente l'intention sans dépendre du champ caché auto-injecté, cohérent
    // avec le seul autre modèle de ce schéma qui a le même besoin sémantique ("le champ
    // ownerID/userID EST la source de vérité de qui possède cette ligne"). `.to(['create',
    // 'read'])` seul : write-once, voir le commentaire de tête de fichier.
    .authorization((allow) => [allow.ownerDefinedIn('userID').to(['create', 'read'])]),

  // Attestation sur l'honneur du vétérinaire à la validation d'un Animal comme donneur --
  // enregistrement DISTINCT de `Animal.isValidatedDonor`/`validationExpiresAt` (ADR-0002) :
  // ceux-ci restent le statut opérationnel courant (peuvent en théorie être corrigés par un
  // vétérinaire qui se serait trompé de ligne, voir `correctCriticalFields`,
  // useAnimalValidation.js), alors que CETTE ligne est la preuve immuable de l'acte
  // d'attestation lui-même, jamais réécrite. `eventType` distingue l'attestation initiale
  // (`ATTESTATION`, écrite par `validateAnimal`) d'une éventuelle révocation
  // (`REVOCATION`) -- demande produit explicite : "si la validation est un jour
  // annulée/révoquée, ne supprime jamais l'attestation d'origine, crée un nouvel
  // enregistrement à côté". Champ prêt (`revokedAttestationID`/`revocationReason`) mais
  // AUCUNE UI de révocation n'existe encore dans ce repo (grep confirmé, 2026-08-25) : rien
  // dans `useAnimalValidation.js`/`ValidationsView.vue`/`DonorsView.vue` ne permet
  // aujourd'hui d'annuler une validation -- même statut que
  // `Veterinarian.validatedMissions`/`Mission.activeForRequest` (ADR-0010) : câblage
  // mécanique en avance sur l'usage, pas une fonctionnalité livrée dans cette PR.
  DonorValidationAttestation: a
    .model({
      animalID: a.id().required(),
      animal: a.belongsTo('Animal', 'animalID'),
      veterinarianID: a.id().required(),
      veterinarian: a.belongsTo('Veterinarian', 'veterinarianID'),
      // Dénormalisé (pas de belongsTo dédié) : la clinique du vétérinaire AU MOMENT de
      // l'attestation -- un vétérinaire qui change de clinique plus tard ne doit pas voir
      // ses attestations passées se réattribuer silencieusement. Optionnel
      // (`fetchVetClinicId()` peut légitimement renvoyer `null`, voir
      // useAnimalValidation.js) : ne doit jamais bloquer l'attestation elle-même, qui est
      // la partie critique.
      clinicID: a.id(),
      eventType: a.ref('DonorValidationEventType').required(),
      // Version EXACTE du texte d'attestation affiché au vétérinaire au moment où il a
      // coché la case (src/constants/legal.js) -- même raisonnement que
      // `ConsentRecord.documentVersion`. `createdAt` (auto) sert d'horodatage SERVEUR,
      // exigence explicite de la demande produit ("timestamp serveur, pas côté client") --
      // déjà garanti par AppSync sans champ dédié, voir le commentaire de `ConsentRecord`
      // ci-dessus pour le mécanisme.
      attestationVersion: a.string().required(),
      // Renseignés uniquement sur une ligne `REVOCATION` (voir doc du modèle ci-dessus) --
      // pas de contrainte de schéma les rendant obligatoires seulement dans ce cas (Gen2 ne
      // sait pas conditionner un `.required()` sur la valeur d'un autre champ, même limite
      // que partout ailleurs dans ce schéma) : à la charge du futur code applicatif qui
      // écrira une révocation.
      revokedAttestationID: a.id(),
      revocationReason: a.string(),
    })
    // `.to(['create', 'read'])` seul : write-once, voir le commentaire de tête de fichier --
    // "jamais modifié ou supprimé après coup, y compris par le vétérinaire lui-même" est une
    // exigence produit explicite, appliquée ici au niveau `@auth`, pas seulement dans l'UI.
    .authorization((allow) => [allow.group('Veterinarians').to(['create', 'read'])]),

  // 5. MUTATIONS CUSTOM (logique non couverte par les mutations générées par défaut)
  // ---------------------------------------------------------

  // Prérequis Phase 8, lot 3/3 sous-tâche 5 (voir
  // docs/adr/0011-gen2-custom-mutation-conditional-write.md) : `defineData` Gen2 n'expose
  // AUCUN argument `condition` équivalent sur les mutations générées automatiquement
  // (`client.models.Request.update()`) -- vérifié dans les types installés
  // (`node_modules/@aws-amplify/data-schema-types/dist/esm/client/index.d.ts`, aucune trace de
  // `condition`/`ConditionCheck`). Le Gen1 `linkRequestToMission` (`src/graphql/
  // custom-mutations.js`) s'appuie pourtant sur un `updateRequest` conditionné
  // (`condition: { status: { eq: OPEN } }`, Transformer v1 auto-généré) comme SEULE garde réelle
  // contre la course concurrente entre deux Owners qui accepteraient la même Request d'urgence
  // en même temps (ADR-0001, CdC §2.3 -- fan-out de notifications à plusieurs Owners
  // compatibles). Une traduction mécanique naïve (`client.models.Request.update({...})` sans
  // condition) réintroduirait cette fenêtre de course -- un vrai bug de correction métier.
  //
  // Mutation custom + resolver JS (`./resolvers/link-request-to-mission.js`) ciblant la table
  // DynamoDB managée du modèle `Request` lui-même via `dataSource: a.ref('Request')` (pas une
  // table externe) : `a.handler.custom({ dataSource, entry })` documente explicitement ce cas
  // ("Can reference a model in the schema with a.ref('ModelName')",
  // `node_modules/@aws-amplify/data-schema/src/Handler.ts`). Le resolver reproduit exactement la
  // condition et les deux champs écrits par le Gen1 `linkRequestToMission` (voir ce fichier pour
  // le détail : `ddb.update()` avec `condition: { status: { eq: 'OPEN' } }`).
  //
  // `.authorization(allow => [allow.authenticated()])` -- PAS `allow.authenticated().to([...])`
  // (une mutation custom n'a pas d'ensemble d'opérations CRUD à restreindre, `.to()` n'existe
  // même pas sur `AllowModifierForCustomOperation`, vérifié dans `Authorization.d.ts`). Choisi en
  // relisant le raisonnement déjà écrit ci-dessus sur la règle de type `Request`
  // (`allow.authenticated().to(['read', 'update'])`, commentaire "'update' est requis ici") :
  // c'est exactement le même niveau qu'en Gen1 (`{ allow: private }` = tout utilisateur Cognito
  // authentifié, peu importe le groupe). Point à vérifier soi-même plutôt qu'à recopier
  // aveuglément : une mutation custom dont le resolver cible directement la table managée d'un
  // modèle (`dataSource: a.ref('Request')`) BYPASSE entièrement les règles `@auth`
  // (type ET champ) de ce modèle -- confirmé en lisant `CustomOperation.d.ts`
  // (`AllowModifierForCustomOperation`, un builder d'autorisation entièrement distinct de celui
  // des modèles). Contrairement au Gen1 (où le scoping champ-par-champ de `Request` ci-dessus --
  // `status`/`activeMissionID` volontairement hors `.authorization()` de champ -- ET la règle de
  // type `allow.authenticated().to(['read','update'])` coopéraient pour autoriser précisément
  // cette écriture), ici la seule garde d'autorisation est celle posée directement sur CETTE
  // mutation. Le resolver n'écrit que `status`/`activeMissionID` (jamais un champ arbitraire
  // fourni par l'appelant -- les arguments sont `id`/`activeMissionID` uniquement, pas un input
  // générique), donc le risque qu'un `update` générique aurait posé (n'importe quel champ
  // réécrit) ne s'applique pas ici : la mutation elle-même ne PEUT physiquement écrire que ces
  // deux champs, quel que soit l'appelant authentifié.
  linkRequestToMission: a
    .mutation()
    .arguments({ id: a.id().required(), activeMissionID: a.id().required() })
    .returns(a.ref('Request'))
    .authorization((allow) => [allow.authenticated()])
    .handler(
      a.handler.custom({ dataSource: a.ref('Request'), entry: './resolvers/link-request-to-mission.js' }),
    ),

  // Double validation de Mission (2026-08-26) -- même famille de pattern que
  // `linkRequestToMission` ci-dessus (mutation custom, `dataSource: a.ref('Mission')`, bypass
  // complet du système `@auth` de `Mission`, voir docs/adr/0011) mais avec un besoin métier que
  // linkRequestToMission n'avait pas : écrire conditionnellement le côté de L'APPELANT PUIS
  // dériver/écrire un second champ (`status`) à partir d'un état qui n'est connu qu'APRÈS cette
  // première écriture. Un seul appel `ddb.update()` (unit resolver, un seul aller-retour vers la
  // source de données par invocation) ne suffit pas -- `.handler([...])` prend ici un TABLEAU de
  // 3 `a.handler.custom({...})`, compilé en un vrai resolver AppSync `kind: PIPELINE` (vérifié,
  // pas deviné -- voir l'en-tête dense de
  // `amplify/data/resolvers/submit-mission-validation-write-side.js` pour le détail complet :
  // pourquoi un pipeline plutôt que le unit resolver du plan initial, pourquoi 3 fonctions et
  // pas 2, la condition d'écriture optimiste anti-course de la 3e fonction). Les 3 fichiers,
  // dans l'ordre d'exécution du pipeline :
  // 1. `submit-mission-validation-write-side.js` -- détermine le rôle via `ctx.identity.groups`
  //    (jamais un argument client), écrit le côté de l'appelant (write-once, conditionnel).
  // 2. `submit-mission-validation-read-mission.js` -- relit la Mission à jour (les deux côtés).
  // 3. `submit-mission-validation-finalize-status.js` -- calcule et écrit `Mission.status`
  //    (matrice PENDING_VALIDATION/COMPLETED/NO_SHOW/DISPUTED), condition optimiste anti-course.
  //
  // `.authorization((allow) => [allow.authenticated()])` -- même niveau que
  // `linkRequestToMission` juste au-dessus (tout utilisateur Cognito authentifié, peu importe le
  // groupe) : le rôle RÉEL (Veterinarian vs Owner) est vérifié DANS le resolver (fonction 1),
  // jamais fait confiance à un argument. `disputeReason` optionnel (`a.string()`, pas
  // `.required()`) -- uniquement pertinent côté Owner sur un `outcome: DENIED`, jamais imposé
  // au niveau schéma (même limite `@auth`/validation de valeur que partout ailleurs ici).
  submitMissionValidation: a
    .mutation()
    .arguments({
      missionId: a.id().required(),
      outcome: a.ref('MissionValidationOutcome').required(),
      disputeReason: a.string(),
    })
    .returns(a.ref('Mission'))
    .authorization((allow) => [allow.authenticated()])
    .handler([
      a.handler.custom({
        dataSource: a.ref('Mission'),
        entry: './resolvers/submit-mission-validation-write-side.js',
      }),
      a.handler.custom({
        dataSource: a.ref('Mission'),
        entry: './resolvers/submit-mission-validation-read-mission.js',
      }),
      a.handler.custom({
        dataSource: a.ref('Mission'),
        entry: './resolvers/submit-mission-validation-finalize-status.js',
      }),
    ]),
})

export type Schema = ClientSchema<typeof schema>

export const data = defineData({
  schema,
  // Seul mode utilisé côté Gen1 (`generateClient() + authMode: 'userPool'` partout, aucune
  // règle `public`/`apiKey` dans le schéma actuel) -- reproduit à l'identique.
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
})
