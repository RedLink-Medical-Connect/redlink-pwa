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
