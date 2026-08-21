// @vitest-environment node
//
// Override obligatoire de l'environnement global (`jsdom`, `vitest.config.js`, posé pour
// les tests de composants/composables front) : `@aws-amplify/backend` refuse explicitement
// de s'exécuter dans un environnement qui ressemble à un navigateur ("This package is for
// backend use only and should not be used in a browser environment.", détecté via la
// présence de globals type `window`/`jsdom`). Ce fichier teste un module `amplify/**/*.ts`
// (backend Gen2, jamais exécuté côté navigateur en réalité), donc `node` est le bon
// environnement ici -- pas un contournement, juste la bonne valeur pour ce fichier précis.
import { describe, it, expect } from 'vitest'
import { schema } from '../resource'

// Équivalent Gen2 de `src/graphql/__tests__/schema.test.js` (Gen1) : celui-ci lit le SDL
// brut via `readFileSync` sur `schema.graphql` et pin par matching de texte des fragments
// `@auth` précis. Ici, il n'existe pas de SDL écrit à la main à lire -- le schéma est
// déclaratif (`a.model()`/`a.schema()`, `amplify/data/resource.ts`) et compilé en SDL par
// le framework lui-même. `schema.transform()` (méthode publique exposée par l'objet
// retourné par `a.schema({...})`, voir `ModelSchema.d.ts`) est le point d'entrée RÉEL :
// c'est exactement ce que `defineData()` appelle en interne pour obtenir le SDL
// (`@aws-amplify/backend-data/lib/convert_schema.js`, `schema.transform()` puis
// `AmplifyDataDefinition.fromString(transformedSchema, ...)`) -- pas un raccourci ad hoc,
// le même chemin que celui emprunté par un vrai `ampx sandbox`/déploiement.
// `.schema` sur le résultat (`DerivedApiDefinition`, `@aws-amplify/data-schema-types`) est
// la chaîne SDL GraphQL compilée, exploitable exactement comme le Gen1
// `readFileSync(...)` ci-dessus l'était.
//
// Portée volontairement limitée (même limite assumée que `schema.test.js`, Gen1) : ce test
// vérifie que le schéma DÉCLARATIF compile en produisant les bonnes règles `@auth`/
// relations, pas qu'AppSync/DynamoDB les appliquent réellement en production -- aucun
// environnement Gen2 live (`ampx sandbox`/déploiement) n'est disponible pour vérifier ça
// autrement dans cette session. Une future édition de `amplify/data/resource.ts` qui
// affaiblirait ou retirerait un de ces points cassera ce test au lieu de régresser
// silencieusement jusqu'au premier déploiement réel.

const compiledSdl = schema.transform().schema

/** Extrait le corps complet d'un type top-level du SDL compilé, jusqu'au prochain `type `. */
function extractType(typeName: string): string {
  const startIdx = compiledSdl.indexOf(`type ${typeName} `)
  if (startIdx === -1) {
    throw new Error(`type ${typeName} introuvable dans le SDL compilé`)
  }
  const nextTypeIdx = compiledSdl.indexOf('\ntype ', startIdx + 1)
  return compiledSdl.slice(startIdx, nextTypeIdx === -1 ? undefined : nextTypeIdx)
}

describe('amplify/data/resource.ts — compilation du schéma Gen2', () => {
  it('schema.transform() ne lève pas et produit un SDL non vide', () => {
    expect(() => schema.transform()).not.toThrow()
    expect(compiledSdl.length).toBeGreaterThan(0)
  })

  it('les 8 types @model (schema.graphql Gen1) compilent tous', () => {
    const modelNames = [
      'Clinic',
      'Veterinarian',
      'Owner',
      'OwnerAvailability',
      'Animal',
      'ClinicOwnerRelation',
      'Request',
      'Mission',
    ]
    for (const modelName of modelNames) {
      expect(extractType(modelName)).toContain('@model')
    }
  })
})

describe('amplify/data/resource.ts — ClinicOwnerRelation.ownerDefinedIn("ownerID") (ADR-0009, pin test pour d27f204)', () => {
  // Le point le plus sensible de toute la traduction Gen2 (voir docs/adr/0009, section 2) :
  // ces lignes sont TOUJOURS écrites côté Veterinarian (useMissionClosure.js), jamais par
  // l'Owner lui-même. Sans `ownerDefinedIn('ownerID')` explicite, `allow.owner()` se serait
  // appuyé sur le champ caché auto-injecté par défaut (`ownerField: "owner"`, l'identité de
  // qui ÉCRIT la ligne -- toujours le Vet) au lieu du champ `ownerID` du modèle (identité
  // réelle du pet Owner) -- exactement le bug du commit `d27f204`.
  it('compile bien avec ownerField: "ownerID", pas le champ caché par défaut "owner"', () => {
    const clinicOwnerRelationType = extractType('ClinicOwnerRelation')
    expect(clinicOwnerRelationType).toContain('ownerField: "ownerID"')
    expect(clinicOwnerRelationType).not.toContain('ownerField: "owner"')
  })

  it('conserve la seconde règle Veterinarians sans restriction d\'opérations (fidèle à Gen1)', () => {
    const clinicOwnerRelationType = extractType('ClinicOwnerRelation')
    expect(clinicOwnerRelationType).toContain('{allow: groups, groups: ["Veterinarians"]}')
  })

  // Test contrastif : un modèle à `allow.owner()` SIMPLE (sans `ownerDefinedIn`) doit bien
  // compiler avec le champ caché par défaut `ownerField: "owner"` -- pour que le contraste
  // avec ClinicOwnerRelation ci-dessus soit explicite dans le test, pas seulement dans le
  // commentaire. `Clinic` et `Animal` sont deux exemples parmi les six autres modèles à
  // `allow.owner()` simple du schéma.
  it('contraste : Clinic et Animal (allow.owner() simple) compilent avec le défaut ownerField: "owner"', () => {
    expect(extractType('Clinic')).toContain('ownerField: "owner"')
    expect(extractType('Animal')).toContain('ownerField: "owner"')
  })
})

describe('amplify/data/resource.ts — relations ADR-0010 (appariement obligatoire imposé par le validateur de schéma Gen2)', () => {
  // Les 4 relations touchées par ADR-0010 : sans appariement correct des deux côtés (même
  // `references`), `schema.transform()` lèverait une erreur bloquante à la compilation
  // (`Unable to find associated relationship definition in <Model>`, voir
  // `SchemaProcessor.mjs`) -- ce describe capture la vérification manuelle déjà faite
  // pendant l'implémentation de cette sous-tâche, plutôt que de la laisser non testée.
  it('Request.mission compile en belongsTo (pas hasOne comme en Gen1 -- le FK vit sur Request)', () => {
    expect(extractType('Request')).toContain('mission: Mission @belongsTo(references: ["activeMissionID"])')
  })

  it('Mission.activeForRequest (nouveau, absent de Gen1) compile en hasOne, contrepartie de Request.mission', () => {
    expect(extractType('Mission')).toContain('activeForRequest: Request @hasOne(references: ["activeMissionID"])')
  })

  it('Request.missions (nouveau, absent de Gen1) compile en hasMany, contrepartie de Mission.request', () => {
    expect(extractType('Request')).toContain('missions: [Mission] @hasMany(references: ["requestID"])')
  })

  it('Veterinarian.validatedMissions (mort en Gen1, câblé ici) compile en hasMany sur le vrai FK', () => {
    expect(extractType('Veterinarian')).toContain(
      'validatedMissions: [Mission] @hasMany(references: ["validatedByVeterinarianID"])',
    )
  })
})

/**
 * Portage des guarantees pin-testées par `src/graphql/__tests__/schema.test.js` (Gen1,
 * supprimé Phase 8 sous-tâche 6 -- nettoyage post-migration) qui n'avaient pas encore
 * d'équivalent ici : seules `ClinicOwnerRelation.ownerDefinedIn` (ADR-0009) et les relations
 * ADR-0010/ADR-0011 étaient couvertes ci-dessus. Ce bloc couvre le reste (Animal ADR-0002/0003/
 * ADR-0006, Request/Mission ADR-0004/0005) sur le SDL compilé Gen2 plutôt que le SDL Gen1 lu en
 * texte brut -- mêmes assertions sémantiques, format `@auth(rules: [...])` légèrement différent
 * (ex. terminaison `}])` au lieu de `])`, ordre `operations`/`ownerField` dans la règle owner).
 * Sans ce portage, la suppression de schema.test.js aurait fait perdre silencieusement la
 * détection de régression sur ces règles -- voir la consigne explicite du coordinateur pour
 * cette sous-tâche de nettoyage (ne pas supprimer un pin sans équivalent Gen2).
 */

/** Extrait `<fieldName>: <Type> @auth(rules: [...}])` (jusqu'au premier `}])` après le champ). */
function extractFieldAuthBlock(typeText: string, fieldName: string): string {
  const startIdx = typeText.indexOf(`\n  ${fieldName}:`)
  if (startIdx === -1) {
    throw new Error(`champ ${fieldName} introuvable`)
  }
  const endIdx = typeText.indexOf('}])', startIdx)
  if (endIdx === -1) {
    throw new Error(`bloc @auth introuvable pour ${fieldName}`)
  }
  return typeText.slice(startIdx, endIdx + '}])'.length)
}

describe('amplify/data/resource.ts — Animal.isValidatedDonor / validationExpiresAt (équivalent Gen2 ADR-0002, ex-schema.test.js)', () => {
  const animalType = extractType('Animal')

  it('les deux champs de validation vivent bien dans le type Animal', () => {
    expect(animalType).toContain('isValidatedDonor:')
    expect(animalType).toContain('validationExpiresAt:')
  })

  it('isValidatedDonor est nullable (Boolean, pas Boolean!)', () => {
    expect(animalType).toContain('isValidatedDonor: Boolean @auth(')
  })

  it('validationExpiresAt est nullable (AWSDateTime, pas AWSDateTime!)', () => {
    expect(animalType).toContain('validationExpiresAt: AWSDateTime @auth(')
  })

  it.each(['isValidatedDonor', 'validationExpiresAt'])(
    "%s : l'Owner n'a que 'read', jamais d'écriture",
    (fieldName) => {
      const block = extractFieldAuthBlock(animalType, fieldName)
      expect(block).toContain('{allow: owner, operations: [read]')
    },
  )

  it.each(['isValidatedDonor', 'validationExpiresAt'])(
    '%s : les Veterinarians ont read+update, scopé au groupe Veterinarians',
    (fieldName) => {
      const block = extractFieldAuthBlock(animalType, fieldName)
      expect(block).toContain(
        '{allow: groups, operations: [read, update], groups: ["Veterinarians"]}',
      )
    },
  )
})

describe('amplify/data/resource.ts — Animal.bloodGroup (équivalent Gen2 ADR-0006, ex-schema.test.js)', () => {
  const animalType = extractType('Animal')

  it("bloodGroup reste non-nullable (String!) et écrit par l'Owner à la création/édition -- pas de restriction d'opérations sur la règle owner (contrairement à isValidatedDonor/validationExpiresAt/lastDonationDate)", () => {
    const block = extractFieldAuthBlock(animalType, 'bloodGroup')
    expect(block).toContain('bloodGroup: String! @auth(')
    expect(block).toContain('{allow: owner, ownerField: "owner"}')
    expect(block).not.toContain('{allow: owner, operations: [read]')
  })

  it('les Veterinarians ont read+update sur bloodGroup (corrige un bloodGroup UNKNOWN saisi par erreur)', () => {
    const block = extractFieldAuthBlock(animalType, 'bloodGroup')
    expect(block).toContain(
      '{allow: groups, operations: [read, update], groups: ["Veterinarians"]}',
    )
  })
})

describe('amplify/data/resource.ts — Animal.lastDonationDate (équivalent Gen2 ADR-0003, ex-schema.test.js)', () => {
  const animalType = extractType('Animal')

  it('lastDonationDate est nullable (AWSDate, pas AWSDate!)', () => {
    expect(animalType).toContain('lastDonationDate: AWSDate @auth(')
  })

  it("l'Owner n'a que 'read' sur lastDonationDate, jamais d'écriture", () => {
    const block = extractFieldAuthBlock(animalType, 'lastDonationDate')
    expect(block).toContain('{allow: owner, operations: [read]')
  })

  it('les Veterinarians ont read+update sur lastDonationDate', () => {
    const block = extractFieldAuthBlock(animalType, 'lastDonationDate')
    expect(block).toContain(
      '{allow: groups, operations: [read, update], groups: ["Veterinarians"]}',
    )
  })
})

describe('amplify/data/resource.ts — Request @auth au niveau champ (équivalent Gen2 ADR-0004/0005, durcissement Phase 5, ex-schema.test.js)', () => {
  const requestType = extractType('Request')

  it.each([
    'requestType',
    'requiredSpecies',
    'requiredBloodGroup',
    'quantity',
    'appointmentDatetime',
    'createdAt',
    'clinicID',
  ])(
    "%s : l'Owner (règle 'private'/allow.authenticated()) n'a que 'read' -- sans ce scoping, la " +
      "règle de type ('read'+'update', nécessaire à linkRequestToMission) aurait permis à " +
      "N'IMPORTE QUEL Owner authentifié de réécrire ce champ sur N'IMPORTE QUELLE Request",
    (fieldName) => {
      const block = extractFieldAuthBlock(requestType, fieldName)
      expect(block).toContain('{allow: private, operations: [read]}')
    },
  )

  it.each([
    'requestType',
    'requiredSpecies',
    'requiredBloodGroup',
    'quantity',
    'appointmentDatetime',
    'createdAt',
    'clinicID',
  ])(
    '%s : les Veterinarians ont create+read (pas update)',
    (fieldName) => {
      const block = extractFieldAuthBlock(requestType, fieldName)
      expect(block).toContain(
        '{allow: groups, operations: [create, read], groups: ["Veterinarians"]}',
      )
    },
  )

  it("status/activeMissionID n'ont AUCUN @auth au niveau champ -- ce sont les deux seuls champs que linkRequestToMission (Owner, à l'acceptation) doit pouvoir écrire via la règle de type", () => {
    expect(requestType).toContain('status: RequestStatus!\n')
    expect(requestType).toContain('activeMissionID: ID\n')
  })

  it("la règle de type porte bien 'private'/read+update (nécessaire à linkRequestToMission) et 'Veterinarians' sans restriction d'opérations", () => {
    const typeAuthStart = compiledSdl.indexOf('type Request @model @auth(')
    const typeAuthEnd = compiledSdl.indexOf('])\n{', typeAuthStart)
    const typeAuthBlock = compiledSdl.slice(typeAuthStart, typeAuthEnd)
    expect(typeAuthBlock).toContain('{allow: groups, groups: ["Veterinarians"]}')
    expect(typeAuthBlock).toContain('{allow: private, operations: [read, update]}')
  })
})

describe('amplify/data/resource.ts — Mission @auth (équivalent Gen2 ADR-0004, durcissement Phase 5, ex-schema.test.js)', () => {
  const missionType = extractType('Mission')

  it.each([
    'validationCode',
    'scannedAt',
    'validatedByVeterinarianID',
    'stripePaymentIntentId',
    'stripePaymentStatus',
  ])("%s : l'Owner n'a que 'read'", (fieldName) => {
    const block = extractFieldAuthBlock(missionType, fieldName)
    expect(block).toContain('{allow: owner, operations: [read]')
  })

  it.each([
    'validationCode',
    'scannedAt',
    'validatedByVeterinarianID',
    'stripePaymentIntentId',
    'stripePaymentStatus',
  ])('%s : les Veterinarians ont read+update (pas create)', (fieldName) => {
    const block = extractFieldAuthBlock(missionType, fieldName)
    expect(block).toContain(
      '{allow: groups, operations: [read, update], groups: ["Veterinarians"]}',
    )
  })

  it("status/requestID/animalID/appointmentDatetime n'ont AUCUN @auth au niveau champ -- createMissionSimple (Owner, à l'acceptation) doit pouvoir écrire status/requestID/animalID à la création", () => {
    expect(missionType).toContain('status: MissionStatus!\n')
    expect(missionType).toContain('requestID: ID!\n')
    expect(missionType).toContain('animalID: ID!\n')
  })

  it("la règle de type Veterinarians garde 'update' -- rend une re-clôture (updateMission sur une Mission déjà COMPLETED/NO_SHOW) inoffensive côté serveur", () => {
    const typeAuthStart = compiledSdl.indexOf('type Mission @model @auth(')
    const typeAuthEnd = compiledSdl.indexOf('])\n{', typeAuthStart)
    const typeAuthBlock = compiledSdl.slice(typeAuthStart, typeAuthEnd)
    expect(typeAuthBlock).toContain(
      '{allow: groups, operations: [read, update], groups: ["Veterinarians"]}',
    )
  })

  it("la règle owner de Mission est restreinte à [create, read, delete] (pas 'update') -- un Owner ne peut pas s'auto-valider sa Mission comme terminée", () => {
    const typeAuthStart = compiledSdl.indexOf('type Mission @model @auth(')
    const typeAuthEnd = compiledSdl.indexOf('])\n{', typeAuthStart)
    const typeAuthBlock = compiledSdl.slice(typeAuthStart, typeAuthEnd)
    expect(typeAuthBlock).toContain('{allow: owner, operations: [create, read, delete]')
  })
})

describe('amplify/data/resource.ts — ClinicOwnerRelation, aucun @auth au niveau champ (complément ADR-0009, ex-schema.test.js)', () => {
  it('clinicID/ownerID/isPrimaryClinic sont tous écrits sans scoping champ-par-champ', () => {
    const relationType = extractType('ClinicOwnerRelation')
    const typeHeaderEnd = relationType.indexOf('\n{') + '\n{'.length
    const relationFieldsOnly = relationType.slice(typeHeaderEnd)
    expect(relationFieldsOnly).not.toContain('@auth(')
  })
})

describe('amplify/data/resource.ts — linkRequestToMission (prérequis Phase 8, lot 3/3 sous-tâche 5, ADR-0011)', () => {
  // Portée volontairement limitée, comme le reste de ce fichier (voir l'en-tête) : ce test
  // vérifie que la mutation custom compile avec les bons arguments/type de retour/règle
  // d'autorisation déclarative -- pas que le resolver JS (`./resolvers/link-request-to-mission.js`,
  // runtime AppSync JS, pas Node) applique réellement la condition DynamoDB en production. Voir
  // docs/adr/0011, section 4, pour ce choix de portée.
  it('compile en tant que mutation custom (arguments id/activeMissionID, retourne Request)', () => {
    const mutationType = extractType('Mutation')
    expect(mutationType).toContain('linkRequestToMission(id: ID!, activeMissionID: ID!): Request')
  })

  it('autorisation @aws_cognito_user_pools SANS restriction de groupe (équivalent Gen1 `{allow: private}`)', () => {
    const mutationType = extractType('Mutation')
    // `allow.authenticated()` (pas `allow.group('Veterinarians')`) -- reproduit le même niveau
    // que la règle de type Gen1 `Request` (`allow: private` = tout utilisateur Cognito
    // authentifié, peu importe le groupe), nécessaire pour que l'Owner puisse accepter une
    // Mission. Contraste avec une règle de groupe, qui compilerait en
    // `@aws_auth(cognito_groups: [...])` plutôt qu'un simple `@aws_cognito_user_pools` sans
    // arguments -- voir docs/adr/0011, section 3.2.
    expect(mutationType).toContain('linkRequestToMission(id: ID!, activeMissionID: ID!): Request @aws_cognito_user_pools')
    expect(mutationType).not.toContain('@aws_auth')
  })
})
