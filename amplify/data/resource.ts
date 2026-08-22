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

export const schema = a.schema({
  // ==========================================================
  // ENUMS -- valeurs identiques à Gen1 (schema.graphql, section 4)
  // ==========================================================
  Species: a.enum(['DOG', 'CAT']),
  DonationFrequency: a.enum(['ASAP', 'TWICE_YEAR', 'ONCE_YEAR']),
  RequestType: a.enum(['EMERGENCY', 'APPOINTMENT']),
  RequestStatus: a.enum(['OPEN', 'IN_PROGRESS', 'CLOSED', 'CANCELLED']),
  MissionStatus: a.enum([
    'ACCEPTED',
    'PENDING_ARRIVAL',
    'EN_ROUTE',
    'ARRIVED',
    'COMPLETED',
    'NO_SHOW',
    'CANCELLED',
  ]),

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

      // Gap préexistant NON corrigé ici (voir docs/adr/0010, section "Gaps préexistants") :
      // le groupe Cognito "Admins" référencé juste en-dessous n'a jamais été provisionné par
      // l'IaC, ni en Gen1 ni dans `amplify/auth/resource.ts` (Gen2, sous-tâche 3). Reproduit
      // à l'identique -- corriger ça changerait le périmètre de la sous-tâche 3, pas de celle-ci.
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
      species: a.ref('Species').required(),
      breed: a.string(),
      // Sexe de l'animal (CdC §2.1) -- informatif uniquement pour ce pilote, PAS un critère
      // d'éligibilité (décision produit) : ne pas le référencer dans eligibility-service.js.
      // Valeur libre plutôt qu'un enum dédié pour ce pilote ('MALE'/'FEMALE', voir AnimalSex
      // dans constants/enums.js) ; pas de `.authorization()` dédiée, hérite des règles de type
      // ci-dessous (même bord Owner que breed/weight).
      sex: a.string(),
      birthDate: a.date(),
      weight: a.float().required(),

      // `.authorization()` de champ (REMPLACE, pour ce champ, les règles de type ci-dessous --
      // voir l'en-tête de fichier). Choix DÉLIBÉRÉMENT différent du pattern ADR-0002/0003 (Owner
      // : [read] seul) : contrairement à lastDonationDate/isValidatedDonor/validationExpiresAt
      // (jamais écrits par l'Owner), bloodGroup EST déjà écrit par l'Owner à la création
      // (AddAnimalView.vue/useAnimals.js createNewAnimal) et en édition (AnimalsView.vue/
      // useAnimals.js updateAnimalDetails) -- une règle Owner restreinte à [read] casserait ces
      // deux écritures existantes. La règle owner reste donc SANS restriction d'opérations.
      // Ajout : Veterinarians en read+update, pour permettre à un vétérinaire de corriger un
      // bloodGroup à UNKNOWN saisi par erreur par l'Owner, avant validation (ADR-0006). Même
      // compromis assumé qu'ADR-0002/0003/0006 : le Transformer ne peut pas conditionner cette
      // règle sur l'état isValidatedDonor de l'Animal -- un Veterinarian pourrait en théorie
      // aussi modifier le bloodGroup d'un Animal DÉJÀ validé sans re-validation automatique.
      // Acceptable pour ce pilote (Veterinarians de confiance) ; côté UI, ValidationsView.vue
      // n'expose la correction que pour les Animals en attente de validation.
      bloodGroup: a
        .string()
        .required()
        .authorization((allow) => [allow.owner(), allow.group('Veterinarians').to(['read', 'update'])]),
      isVaccinated: a.boolean().required(),
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

      status: a.ref('MissionStatus').required(),
      appointmentDatetime: a.datetime(),

      // `.authorization()` de champ (revue graphql-schema-reviewer Gen1, Phase 5) : retirer
      // `update` à la règle owner de niveau modèle (ci-dessous) ne suffisait pas -- `create` y
      // restait, et sans ce scoping un Owner pouvait fabriquer directement un
      // `createMission(status: COMPLETED, validatedByVeterinarianID: "...")`, usurpant une
      // validation vétérinaire dès la création. Ces 5 champs sont par ailleurs inutilisés par
      // tout code applicatif actuel (flow QR-scan abandonné, Stripe hors périmètre V1) : aucune
      // régression possible à les verrouiller entièrement aux Veterinarians. `status` reste hors
      // de ce scoping champ-par-champ (pas de `.authorization()` dessus) : createMissionSimple
      // (Owner, useOwnerMissions.js) doit pouvoir l'écrire à la création
      // (PENDING_ARRIVAL/ACCEPTED). Limite connue, non fermée par la migration : un Owner peut
      // toujours fabriquer un `createMission(status: COMPLETED)` en appelant l'API directement
      // (hors UI) -- voir ADR-0004 pour l'analyse complète de ce résidu, inchangée en Gen2.
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
    })
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
    ]),

  // 4. MUTATIONS CUSTOM (logique non couverte par les mutations générées par défaut)
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
