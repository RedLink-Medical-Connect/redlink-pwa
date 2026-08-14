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

  it("le reste du type Animal (avant ET après lastDonationDate/isValidatedDonor/validationExpiresAt, ex: name, weight, bloodGroup, ownerID, ownerProfile, missions) n'est pas concerné par ce scoping champ-par-champ", () => {
    // Régression : si un @auth au niveau champ était accidentellement ajouté sur un
    // champ saisi par l'Owner (name, breed, weight...) OU sur un champ après
    // validationExpiresAt (ownerID, ownerProfile, missions...), ce test le
    // détecterait. Couvre tout le type, pas seulement le segment name->isValidatedDonor
    // (une revue précédente a signalé que la version initiale ne couvrait pas la
    // fin du type) : on retire uniquement les blocs légitimes (lastDonationDate,
    // ADR-0003, + isValidatedDonor/validationExpiresAt, ADR-0002) et on vérifie qu'aucun
    // '@auth(' ne subsiste ailleurs.
    // On part de `name:`, pas du début du type, pour exclure le bloc @auth
    // *au niveau type* sur `type Animal @model @auth(rules: [...])` lui-même
    // (légitime, ce n'est pas le scoping champ-par-champ qu'on vérifie ici).
    const nameFieldIdx = animalType.indexOf('name: String!')
    const lastDonationDateBlock = extractFieldBlock('lastDonationDate')
    const isValidatedDonorBlock = extractFieldBlock('isValidatedDonor')
    const validationExpiresAtBlock = extractFieldBlock('validationExpiresAt')
    const validationBlocksStart = animalType.indexOf(lastDonationDateBlock)
    const validationBlocksEnd =
      animalType.indexOf(validationExpiresAtBlock) + validationExpiresAtBlock.length
    // Les trois blocs légitimes sont contigus dans le schéma (lastDonationDate juste
    // avant isValidatedDonor/validationExpiresAt) : on vérifie cette hypothèse plutôt que
    // de la supposer silencieusement, sinon le slice ci-dessous retirerait plus/moins que
    // prévu sans que ce test le détecte.
    expect(animalType.indexOf(isValidatedDonorBlock)).toBeGreaterThan(
      validationBlocksStart + lastDonationDateBlock.length - 1,
    )
    const restOfType =
      animalType.slice(nameFieldIdx, validationBlocksStart) +
      animalType.slice(validationBlocksEnd)
    // `@auth(` (avec parenthèse) plutôt que `@auth` seul : le commentaire qui précède
    // isValidatedDonor mentionne "@auth" en prose sans l'appliquer à un champ.
    expect(restOfType).not.toContain('@auth(')
  })
})

describe('schema.graphql — Animal.lastDonationDate (ADR-0003)', () => {
  const animalType = extractType('Animal')

  it('lastDonationDate est nullable (AWSDate, pas AWSDate!)', () => {
    expect(schema).toMatch(/lastDonationDate: AWSDate\n/)
  })

  it("l'Owner n'a que 'read' sur lastDonationDate, jamais d'écriture", () => {
    const block = extractFieldBlock('lastDonationDate')
    expect(block).toContain('{ allow: owner, operations: [read] }')
  })

  it('les Veterinarians ont read+update sur lastDonationDate, scopé au groupe Veterinarians', () => {
    const block = extractFieldBlock('lastDonationDate')
    expect(block).toContain(
      '{ allow: groups, groups: ["Veterinarians"], operations: [read, update] }',
    )
  })

  it('lastDonationDate précède bien isValidatedDonor/validationExpiresAt dans le type Animal (position documentaire, pas fonctionnelle)', () => {
    expect(animalType.indexOf('lastDonationDate:')).toBeLessThan(
      animalType.indexOf('isValidatedDonor:'),
    )
  })
})
