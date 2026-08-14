export const createOwnerSimple = /* GraphQL */ `
  mutation CreateOwner($input: CreateOwnerInput!) {
    createOwner(input: $input) {
      id
    }
  }
`

export const createClinicSimple = /* GraphQL */ `
  mutation CreateClinic($input: CreateClinicInput!) {
    createClinic(input: $input) {
      id
    }
  }
`

export const deleteClinicSimple = /* GraphQL */ `
  mutation DeleteClinic($input: DeleteClinicInput!) {
    deleteClinic(input: $input) {
      id
      # On ne demande rien d'autre !
    }
  }
`

export const createVeterinarianSimple = /* GraphQL */ `
  mutation CreateVeterinarian($input: CreateVeterinarianInput!) {
    createVeterinarian(input: $input) {
      id
    }
  }
`

export const updateVeterinarianSimple = /* GraphQL */ `
  mutation UpdateVeterinarian($input: UpdateVeterinarianInput!) {
    updateVeterinarian(input: $input) {
      id
      firstname
      lastname
      email
      updatedAt
    }
  }
`

export const deleteVeterinarianSimple = /* GraphQL */ `
  mutation DeleteVeterinarian($input: DeleteVeterinarianInput!) {
    deleteVeterinarian(input: $input) {
      id
      # On ne demande rien d'autre !
    }
  }
`
export const createAnimalSimple = /* GraphQL */ `
  mutation CreateAnimal($input: CreateAnimalInput!) {
    createAnimal(input: $input) {
      id
    }
  }
`

export const createOwnerAvailabilitySimple = /* GraphQL */ `
  mutation CreateOwnerAvailability($input: CreateOwnerAvailabilityInput!) {
    createOwnerAvailability(input: $input) {
      id
    }
  }
`

export const deleteOwnerAvailabilitySimple = /* GraphQL */ `
  mutation DeleteOwnerAvailability($input: DeleteOwnerAvailabilityInput!) {
    deleteOwnerAvailability(input: $input) {
      id
    }
  }
`

export const createRequestSimple = /* GraphQL */ `
  mutation CreateRequest($input: CreateRequestInput!) {
    createRequest(input: $input) {
      id
      status
    }
  }
`

export const updateRequestStatusSimple = /* GraphQL */ `
  mutation UpdateRequest($input: UpdateRequestInput!) {
    updateRequest(input: $input) {
      id
      status
    }
  }
`

export const createMissionSimple = /* GraphQL */ `
  mutation CreateMission($input: CreateMissionInput!) {
    createMission(input: $input) {
      id
      status
    }
  }
`

// ADR-0001 : l'écriture est conditionnée sur Request.status = OPEN au niveau DynamoDB
// (ConditionExpression généré par le Transformer v1 à partir de ce `condition`), plutôt que
// de faire confiance à un simple re-check préalable côté client — ferme la fenêtre de course
// entre deux Owners qui accepteraient la même Request au même moment (cf. fan-out de
// notifications d'urgence, CdC §2.3).
export const linkRequestToMission = /* GraphQL */ `
  mutation LinkRequestToMission($id: ID!, $activeMissionID: ID!) {
    updateRequest(
      input: { id: $id, activeMissionID: $activeMissionID, status: IN_PROGRESS }
      condition: { status: { eq: OPEN } }
    ) {
      id
      status
      activeMissionID
    }
  }
`

export const deleteMissionSimple = /* GraphQL */ `
  mutation DeleteMission($input: DeleteMissionInput!) {
    deleteMission(input: $input) {
      id
    }
  }
`

// ADR-0002 (amendement 2026-08-12) : écriture Veterinarian sur Animal scopée par @auth au
// niveau champ à EXACTEMENT isValidatedDonor + validationExpiresAt. L'input ne doit donc
// JAMAIS contenir d'autre champ (ex. bloodGroup) sous peine de rejet par @auth — cette
// mutation *Simple existe précisément pour empêcher qu'un appelant élargisse l'input par
// erreur en réutilisant la mutation updateAnimal générique.
export const validateAnimalDonorSimple = /* GraphQL */ `
  mutation UpdateAnimal($input: UpdateAnimalInput!) {
    updateAnimal(input: $input) {
      id
      isValidatedDonor
      validationExpiresAt
    }
  }
`

// Phase 2.1 : clôture d'une Mission côté Veterinarian (COMPLETED ou NO_SHOW). `Mission`
// n'a pas de @auth au niveau champ (voir schema.graphql) — les Veterinarians ont un accès
// en écriture illimité sur ce type au niveau du type lui-même, donc la mutation générée
// `updateMission` aurait été correcte question @auth. On garde malgré tout une mutation
// *Simple dédiée (convention de ce fichier, cf. createMissionSimple/deleteMissionSimple/
// updateRequestStatusSimple) plutôt que la mutation `updateMission` générée : cette
// dernière redemande tout le graphe de relations (request, animal, validatedBy imbriqués,
// voir mutations.js) alors que useMissionClosure.js n'a besoin que de id + status en retour.
export const closeMissionSimple = /* GraphQL */ `
  mutation CloseMission($input: UpdateMissionInput!) {
    updateMission(input: $input) {
      id
      status
    }
  }
`

// ADR-0003 : écriture Veterinarian sur Animal scopée par @auth au niveau champ à
// EXACTEMENT lastDonationDate (même mécanisme qu'ADR-0002/validateAnimalDonorSimple
// ci-dessus). L'input ne doit donc JAMAIS contenir d'autre champ sous peine de rejet par
// @auth — cette mutation *Simple existe précisément pour empêcher qu'un appelant élargisse
// l'input par erreur en réutilisant la mutation updateAnimal générique.
export const updateAnimalLastDonationDateSimple = /* GraphQL */ `
  mutation UpdateAnimalLastDonationDate($input: UpdateAnimalInput!) {
    updateAnimal(input: $input) {
      id
      lastDonationDate
    }
  }
`
