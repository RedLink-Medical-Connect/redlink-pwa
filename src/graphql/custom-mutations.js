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

export const createVeterinarianSimple = /* GraphQL */ `
  mutation CreateVeterinarian($input: CreateVeterinarianInput!) {
    createVeterinarian(input: $input) {
      id
    }
  }
`;

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
