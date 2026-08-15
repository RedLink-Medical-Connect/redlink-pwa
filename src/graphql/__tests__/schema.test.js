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

describe('schema.graphql — Request @auth au niveau champ (durcissement Phase 5, revue DevSecOps)', () => {
  const requestType = extractType('Request')

  // Comme extractFieldBlock, mais scopé au texte du type Request : `clinicID:` existe aussi
  // sur Veterinarian et ClinicOwnerRelation plus haut dans le fichier, et extractFieldBlock
  // fait un indexOf global (premier match du fichier entier) — il aurait donc extrait le
  // mauvais bloc pour ce champ précis.
  function extractRequestFieldBlock(fieldName) {
    const startIdx = requestType.indexOf(`${fieldName}:`)
    if (startIdx === -1) {
      throw new Error(`champ ${fieldName} introuvable dans le type Request`)
    }
    const endIdx = requestType.indexOf('])', startIdx)
    if (endIdx === -1) {
      throw new Error(`bloc @auth introuvable pour Request.${fieldName}`)
    }
    return requestType.slice(startIdx, endIdx + 2)
  }

  it.each([
    'requestType',
    'requiredSpecies',
    'requiredBloodGroup',
    'quantity',
    'appointmentDatetime',
    'createdAt',
    'clinicID',
  ])(
    "%s : l'Owner n'a que 'read' — sans ce scoping, la règle de type " +
      "'{ allow: private, operations: [read, update] }' (nécessaire à linkRequestToMission " +
      "pour status/activeMissionID) aurait permis à N'IMPORTE QUEL Owner authentifié de " +
      "réécrire ce champ sur N'IMPORTE QUELLE Request, y compris d'une autre clinique",
    (fieldName) => {
      const block = extractRequestFieldBlock(fieldName)
      expect(block).toContain('{ allow: private, operations: [read] }')
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
    '%s : les Veterinarians ont create+read (pas update — aucun code applicatif ne réécrit ' +
      'ces champs après création, createRequestSimple seul les écrit)',
    (fieldName) => {
      const block = extractRequestFieldBlock(fieldName)
      expect(block).toContain(
        '{ allow: groups, groups: ["Veterinarians"], operations: [create, read] }',
      )
    },
  )

  // Phase 6.5 (ADR-0005) : appointmentDatetime doit vivre entre quantity et status dans le
  // type Request -- position purement documentaire (regroupé avec les autres champs saisis
  // à la création, avant le couple status/activeMissionID volontairement hors scoping champ),
  // mais un futur ajout de champ mal placé entre appointmentDatetime et son bloc @auth
  // casserait extractRequestFieldBlock() silencieusement pour d'autres tests -- ce test
  // documente l'intention plutôt que de laisser un tel bug de position se glisser sans échec.
  it('appointmentDatetime est bien positionné après quantity et avant status dans le type Request', () => {
    const quantityIdx = requestType.indexOf('quantity: Int!')
    const appointmentIdx = requestType.indexOf('appointmentDatetime: AWSDateTime')
    const statusIdx = requestType.indexOf('status: RequestStatus!')
    expect(quantityIdx).toBeLessThan(appointmentIdx)
    expect(appointmentIdx).toBeLessThan(statusIdx)
  })

  it("status/activeMissionID n'ont AUCUN @auth au niveau champ — ce sont les deux seuls champs que linkRequestToMission (Owner, à l'acceptation) doit pouvoir écrire via la règle de type 'private'", () => {
    const statusIdx = requestType.indexOf('status: RequestStatus!')
    const activeMissionIdIdx = requestType.indexOf('activeMissionID: ID')
    expect(statusIdx).toBeGreaterThan(-1)
    expect(activeMissionIdIdx).toBeGreaterThan(-1)

    // status: rien entre `status: RequestStatus!` et le champ suivant (`createdAt`) qui
    // ressemble à un @auth de niveau champ.
    const createdAtIdx = requestType.indexOf('createdAt: AWSDateTime')
    expect(requestType.slice(statusIdx, createdAtIdx)).not.toContain('@auth(')

    // activeMissionID: rien entre lui et la fin du type (mission: ... est le dernier champ).
    expect(requestType.slice(activeMissionIdIdx)).not.toContain('@auth(')
  })
})

describe("schema.graphql — Mission @auth (re-clôture, Phase 2.1 / useMissionClosure.js ; durcissement Phase 5)", () => {
  const missionType = extractType('Mission')

  it.each(['validationCode', 'scannedAt', 'validatedByVeterinarianID', 'stripePaymentIntentId', 'stripePaymentStatus'])(
    "%s : l'Owner n'a que 'read' (revue graphql-schema-reviewer, Phase 5) — sans ce scoping, " +
      "le retrait d'`update` sur la règle de type owner ne suffisait pas : `create` y restait, " +
      'et sans @auth de niveau champ un Owner pouvait fabriquer directement un ' +
      "createMission(validatedByVeterinarianID: '...') dès la création, usurpant une " +
      "validation vétérinaire plutôt que par une update désormais bloquée",
    (fieldName) => {
      const block = extractFieldBlock(fieldName)
      expect(block).toContain('{ allow: owner, operations: [read] }')
    },
  )

  it.each(['validationCode', 'scannedAt', 'validatedByVeterinarianID', 'stripePaymentIntentId', 'stripePaymentStatus'])(
    '%s : les Veterinarians ont read+update (pas create — ces 5 champs sont inutilisés par ' +
      'tout code applicatif actuel, flow QR-scan abandonné et Stripe hors périmètre V1, aucune ' +
      "régression à leur retirer 'create' même côté Veterinarians)",
    (fieldName) => {
      const block = extractFieldBlock(fieldName)
      expect(block).toContain(
        '{ allow: groups, groups: ["Veterinarians"], operations: [read, update] }',
      )
    },
  )

  it("status/requestID/animalID/appointmentDatetime n'ont AUCUN @auth au niveau champ — createMissionSimple (Owner, à l'acceptation) doit pouvoir écrire status/requestID/animalID à la création ; le Transformer v1 ne sait pas restreindre un champ à un sous-ensemble de valeurs par opération (limite connue, voir le commentaire au-dessus de validationCode dans schema.graphql)", () => {
    const requestIdIdx = missionType.indexOf('requestID: ID!')
    const appointmentIdx = missionType.indexOf('appointmentDatetime: AWSDateTime')
    const validationCodeIdx = missionType.indexOf('validationCode: String')
    expect(requestIdIdx).toBeGreaterThan(-1)
    expect(missionType.indexOf('status: MissionStatus!')).toBeGreaterThan(requestIdIdx)
    expect(validationCodeIdx).toBeGreaterThan(appointmentIdx)
    expect(missionType.slice(requestIdIdx, validationCodeIdx)).not.toContain('@auth(')
  })

  it(
    "la règle de type Veterinarians sur Mission garde 'update' dans ses operations (revue " +
      "DevSecOps, Phase 5, a retiré create/delete — jamais utilisés côté Veterinarians — mais " +
      "PAS update) — pin test pour le raisonnement de useMissionClosure.js : c'est ce qui rend " +
      'une re-clôture (updateMission sur une Mission déjà COMPLETED/NO_SHOW) inoffensive côté ' +
      "serveur, sans ConditionExpression sur `status` ni champ refusé par @auth. Si `update` " +
      "disparaissait un jour de cette liste, la garde réelle contre la re-clôture resterait " +
      "portée par l'UI (bouton visible seulement pour ACCEPTED/PENDING_ARRIVAL) sans que rien " +
      'ici ne le signale — ce test casse plutôt que de laisser cette hypothèse dériver ' +
      'silencieusement.',
    () => {
      const typeAuthStart = schema.indexOf('type Mission @model @auth(')
      const typeAuthEnd = schema.indexOf(']) {', typeAuthStart)
      expect(typeAuthStart).toBeGreaterThan(-1)
      expect(typeAuthEnd).toBeGreaterThan(typeAuthStart)
      const typeAuthBlock = schema.slice(typeAuthStart, typeAuthEnd)

      expect(typeAuthBlock).toContain(
        '{ allow: groups, groups: ["Veterinarians"], operations: [read, update] }',
      )
    },
  )

  it(
    "la règle owner de Mission est restreinte à [create, read, delete] (pas 'update') — " +
      'revue DevSecOps Phase 5 : sans cette restriction, un Owner authentifié pouvait appeler ' +
      "updateMission(status: COMPLETED) (ou écrire validatedByVeterinarianID) directement sur " +
      "sa propre Mission, contournant useMissionClosure.js et cassant la garantie centrale de " +
      "la Phase 2 (\"l'Owner ne peut pas s'auto-valider sa Mission comme terminée\"). L'Owner " +
      "garde 'read' (voit toujours le statut) ; useOwnerMissions.js n'appelle jamais " +
      'updateMission côté Owner (seulement createMissionSimple/deleteMissionSimple), donc ce ' +
      "retrait n'enlève aucune capacité réellement utilisée.",
    () => {
      const typeAuthStart = schema.indexOf('type Mission @model @auth(')
      const typeAuthEnd = schema.indexOf(']) {', typeAuthStart)
      const typeAuthBlock = schema.slice(typeAuthStart, typeAuthEnd)

      expect(typeAuthBlock).toContain(
        '{ allow: owner, operations: [create, read, delete] }',
      )
    },
  )
})

describe(
  'schema.graphql — ClinicOwnerRelation @auth (Phase 3.1, useMissionClosure.js upsert)',
  () => {
    // Pin test pour la justification donnée dans custom-mutations.js
    // (createClinicOwnerRelationSimple) : "ClinicOwnerRelation n'a pas de @auth au niveau
    // champ (le groupe Veterinarians a un accès en écriture illimité sur ce type ...) donc
    // la mutation générée createClinicOwnerRelation aurait été correcte question @auth". Si
    // cette hypothèse cesse d'être vraie (ex. la règle Veterinarians gagne une clause
    // 'operations:' scopée en lecture seule, ou un @auth champ-par-champ apparaît comme sur
    // Animal/ADR-0002), l'upsert best-effort de useMissionClosure.js échouerait *toujours*
    // en silence (avalé par le try/catch, voir upsertClinicOwnerRelation) — un scénario que
    // rien côté composable ne peut détecter puisque l'échec y est volontairement non
    // bloquant. Ce test fait sonner l'alarme côté schéma plutôt que de laisser
    // ClinicOwnerRelation se vider silencieusement en conditions réelles.

    it("la règle de type Veterinarians sur ClinicOwnerRelation n'a pas de clause 'operations:' (accès create/read/update/delete illimité)", () => {
      const typeAuthStart = schema.indexOf('type ClinicOwnerRelation @model @auth(')
      const typeAuthEnd = schema.indexOf(']) {', typeAuthStart)
      expect(typeAuthStart).toBeGreaterThan(-1)
      expect(typeAuthEnd).toBeGreaterThan(typeAuthStart)
      const typeAuthBlock = schema.slice(typeAuthStart, typeAuthEnd)

      expect(typeAuthBlock).toContain('{ allow: groups, groups: ["Veterinarians"] }')
      expect(typeAuthBlock).not.toMatch(/"Veterinarians"\][^}]*operations:/)
    })

    it("ClinicOwnerRelation n'a aucun @auth au niveau champ (contrairement à Animal, ADR-0002/0003) — clinicID/ownerID/isPrimaryClinic sont tous écrits sans scoping champ-par-champ", () => {
      const relationType = extractType('ClinicOwnerRelation')
      const typeHeaderEnd = relationType.indexOf(']) {') + ']) {'.length
      expect(typeHeaderEnd).toBeGreaterThan(-1)
      const relationFieldsOnly = relationType.slice(typeHeaderEnd)
      expect(relationFieldsOnly).not.toContain('@auth(')
    })

    it(
      'la règle owner de ClinicOwnerRelation déclare ownerField: "ownerID" — sans cet ' +
        "override explicite, la règle owner se serait appuyée sur le champ caché " +
        "auto-injecté par Amplify (identité de qui ÉCRIT la ligne, toujours le " +
        'Veterinarian via useMissionClosure.js) au lieu du champ ownerID du schéma ' +
        "(identité réelle du pet Owner) : clinicOwnerRelationsByOwnerID restait vide en " +
        'permanence côté Owner en prod (bug constaté et corrigé, cf. schema.graphql).',
      () => {
        const typeAuthStart = schema.indexOf('type ClinicOwnerRelation @model @auth(')
        const typeAuthEnd = schema.indexOf(']) {', typeAuthStart)
        expect(typeAuthStart).toBeGreaterThan(-1)
        expect(typeAuthEnd).toBeGreaterThan(typeAuthStart)
        const typeAuthBlock = schema.slice(typeAuthStart, typeAuthEnd)

        expect(typeAuthBlock).toContain('{ allow: owner, ownerField: "ownerID" }')
      },
    )
  },
)
