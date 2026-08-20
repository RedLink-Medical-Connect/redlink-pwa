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
    expect(clinicOwnerRelationType).not.toContain('ownerField: "owner"}')
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
