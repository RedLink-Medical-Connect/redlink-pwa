import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Pin test pour docs/adr/0002-dedicated-mutation-for-vet-validation.md
// (amendement 2026-08-12) : la validation vétérinaire d'un Animal
// (isValidatedDonor / validationExpiresAt) doit rester une écriture *scopée* à
// ces deux seuls champs via @auth au niveau champ — jamais un accès en écriture
// général sur Animal pour les Veterinarians (ce qui leur permettrait de modifier
// des champs saisis par l'Owner : nom, race, poids...).
//
// Portée volontairement limitée : ceci vérifie le texte du schéma déclaratif
// (schema.graphql), pas l'application réelle de la règle par AppSync/Cognito.
// Il n'y a aucun environnement AWS live pour cette session (voir ADR-0002) —
// un test qui mockerait un client GraphQL pour "prouver" qu'un Owner est
// rejeté donnerait un faux sentiment de sécurité, la sémantique @auth réelle
// n'étant appliquée que par le Transformer au déploiement. Ce test garantit
// seulement qu'une future édition du schéma qui affaiblirait ou retirerait ce
// scoping casse la suite au lieu de régresser silencieusement jusqu'au
// prochain `amplify push`.

// process.cwd() is the repo root when run via `npm run test:run` / vitest
// (root: repo root in vitest.config.js).
const schemaPath = resolve(
  process.cwd(),
  'amplify/backend/api/redlinkpwa/schema.graphql'
)
const schema = readFileSync(schemaPath, 'utf-8')

/** Extrait le corps complet d'un type top-level, jusqu'au prochain `type `. */
function extractType(typeName) {
  const startIdx = schema.indexOf(`type ${typeName} `)
  if (startIdx === -1) {
    throw new Error(`type ${typeName} introuvable dans schema.graphql`)
  }
  const nextTypeIdx = schema.indexOf('\ntype ', startIdx + 1)
  return schema.slice(startIdx, nextTypeIdx === -1 ? undefined : nextTypeIdx)
}

/** Extrait `<fieldName>: <Type>` + son directive @auth (jusqu'au `])` qui la ferme). */
function extractFieldBlock(fieldName) {
  const startIdx = schema.indexOf(`${fieldName}:`)
  if (startIdx === -1) {
    throw new Error(`champ ${fieldName} introuvable dans schema.graphql`)
  }
  const endIdx = schema.indexOf('])', startIdx)
  if (endIdx === -1) {
    throw new Error(`bloc @auth introuvable pour ${fieldName}`)
  }
  return schema.slice(startIdx, endIdx + 2)
}

describe('schema.graphql — Animal.isValidatedDonor / validationExpiresAt (ADR-0002)', () => {
  const animalType = extractType('Animal')

  it('les deux champs de validation vivent bien dans le type Animal', () => {
    expect(animalType).toContain('isValidatedDonor:')
    expect(animalType).toContain('validationExpiresAt:')
  })

  it('isValidatedDonor est nullable (Boolean, pas Boolean!) — les Owners ne l\'envoient jamais', () => {
    expect(schema).toMatch(/isValidatedDonor: Boolean\n/)
  })

  it('validationExpiresAt est nullable (AWSDateTime, pas AWSDateTime!)', () => {
    expect(schema).toMatch(/validationExpiresAt: AWSDateTime\n/)
  })

  it.each(['isValidatedDonor', 'validationExpiresAt'])(
    "%s : l'Owner n'a que 'read', jamais d'écriture",
    (fieldName) => {
      const block = extractFieldBlock(fieldName)
      expect(block).toContain('{ allow: owner, operations: [read] }')
    }
  )

  it.each(['isValidatedDonor', 'validationExpiresAt'])(
    '%s : les Veterinarians ont read+update, scopé au groupe Veterinarians',
    (fieldName) => {
      const block = extractFieldBlock(fieldName)
      expect(block).toContain(
        '{ allow: groups, groups: ["Veterinarians"], operations: [read, update] }'
      )
    }
  )

  it("le reste du type Animal (ex: name, weight, bloodGroup) n'est pas concerné par ce scoping champ-par-champ", () => {
    // Régression : si un @auth au niveau champ était accidentellement ajouté sur un
    // champ saisi par l'Owner (name, breed, weight...), ce test le détecterait — le
    // seul segment de animalType contenant '@auth' hors du directive de type doit
    // être celui d'isValidatedDonor/validationExpiresAt.
    const nameFieldIdx = animalType.indexOf('name: String!')
    const isValidatedDonorIdx = animalType.indexOf('isValidatedDonor:')
    const betweenNameAndValidation = animalType.slice(nameFieldIdx, isValidatedDonorIdx)
    // `@auth(` (avec parenthèse) plutôt que `@auth` seul : le commentaire qui précède
    // isValidatedDonor mentionne "@auth" en prose sans l'appliquer à un champ.
    expect(betweenNameAndValidation).not.toContain('@auth(')
  })
})
