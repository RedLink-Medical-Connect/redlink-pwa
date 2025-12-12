export const createOwnerSimple = /* GraphQL */ `
  mutation CreateOwner($input: CreateOwnerInput!) {
    createOwner(input: $input) {
      id
    }
  }
`;

export const createClinicSimple = /* GraphQL */ `
  mutation CreateClinic($input: CreateClinicInput!) {
    createClinic(input: $input) {
      id
    }
  }
`;

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
`;

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
`;

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
`;

export const createOwnerAvailabilitySimple = /* GraphQL */ `
  mutation CreateOwnerAvailability($input: CreateOwnerAvailabilityInput!) {
    createOwnerAvailability(input: $input) {
      id
    }
  }
`;
