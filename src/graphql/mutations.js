/* eslint-disable */
// this is an auto generated file. This will be overwritten

export const createClinic = /* GraphQL */ `
  mutation CreateClinic(
    $input: CreateClinicInput!
    $condition: ModelClinicConditionInput
  ) {
    createClinic(input: $input, condition: $condition) {
      id
      name
      rpps
      email
      phone
      address
      latitude
      longitude
      hasEmergencyService
      transfusionsDone
      donorOwnersCount
      veterinarians {
        nextToken
        __typename
      }
      availabilities {
        nextToken
        __typename
      }
      requests {
        nextToken
        __typename
      }
      clients {
        nextToken
        __typename
      }
      createdAt
      updatedAt
      __typename
    }
  }
`;
export const updateClinic = /* GraphQL */ `
  mutation UpdateClinic(
    $input: UpdateClinicInput!
    $condition: ModelClinicConditionInput
  ) {
    updateClinic(input: $input, condition: $condition) {
      id
      name
      rpps
      email
      phone
      address
      latitude
      longitude
      hasEmergencyService
      transfusionsDone
      donorOwnersCount
      veterinarians {
        nextToken
        __typename
      }
      availabilities {
        nextToken
        __typename
      }
      requests {
        nextToken
        __typename
      }
      clients {
        nextToken
        __typename
      }
      createdAt
      updatedAt
      __typename
    }
  }
`;
export const deleteClinic = /* GraphQL */ `
  mutation DeleteClinic(
    $input: DeleteClinicInput!
    $condition: ModelClinicConditionInput
  ) {
    deleteClinic(input: $input, condition: $condition) {
      id
      name
      rpps
      email
      phone
      address
      latitude
      longitude
      hasEmergencyService
      transfusionsDone
      donorOwnersCount
      veterinarians {
        nextToken
        __typename
      }
      availabilities {
        nextToken
        __typename
      }
      requests {
        nextToken
        __typename
      }
      clients {
        nextToken
        __typename
      }
      createdAt
      updatedAt
      __typename
    }
  }
`;
export const createClinicAvailability = /* GraphQL */ `
  mutation CreateClinicAvailability(
    $input: CreateClinicAvailabilityInput!
    $condition: ModelClinicAvailabilityConditionInput
  ) {
    createClinicAvailability(input: $input, condition: $condition) {
      id
      dayOfWeek
      startTime
      endTime
      clinicID
      clinic {
        id
        name
        rpps
        email
        phone
        address
        latitude
        longitude
        hasEmergencyService
        transfusionsDone
        donorOwnersCount
        createdAt
        updatedAt
        __typename
      }
      createdAt
      updatedAt
      clinicAvailabilitiesId
      __typename
    }
  }
`;
export const updateClinicAvailability = /* GraphQL */ `
  mutation UpdateClinicAvailability(
    $input: UpdateClinicAvailabilityInput!
    $condition: ModelClinicAvailabilityConditionInput
  ) {
    updateClinicAvailability(input: $input, condition: $condition) {
      id
      dayOfWeek
      startTime
      endTime
      clinicID
      clinic {
        id
        name
        rpps
        email
        phone
        address
        latitude
        longitude
        hasEmergencyService
        transfusionsDone
        donorOwnersCount
        createdAt
        updatedAt
        __typename
      }
      createdAt
      updatedAt
      clinicAvailabilitiesId
      __typename
    }
  }
`;
export const deleteClinicAvailability = /* GraphQL */ `
  mutation DeleteClinicAvailability(
    $input: DeleteClinicAvailabilityInput!
    $condition: ModelClinicAvailabilityConditionInput
  ) {
    deleteClinicAvailability(input: $input, condition: $condition) {
      id
      dayOfWeek
      startTime
      endTime
      clinicID
      clinic {
        id
        name
        rpps
        email
        phone
        address
        latitude
        longitude
        hasEmergencyService
        transfusionsDone
        donorOwnersCount
        createdAt
        updatedAt
        __typename
      }
      createdAt
      updatedAt
      clinicAvailabilitiesId
      __typename
    }
  }
`;
export const createVeterinarian = /* GraphQL */ `
  mutation CreateVeterinarian(
    $input: CreateVeterinarianInput!
    $condition: ModelVeterinarianConditionInput
  ) {
    createVeterinarian(input: $input, condition: $condition) {
      id
      firstname
      lastname
      email
      clinicID
      clinic {
        id
        name
        rpps
        email
        phone
        address
        latitude
        longitude
        hasEmergencyService
        transfusionsDone
        donorOwnersCount
        createdAt
        updatedAt
        __typename
      }
      validatedMissions {
        nextToken
        __typename
      }
      createdAt
      updatedAt
      clinicVeterinariansId
      owner
      __typename
    }
  }
`;
export const updateVeterinarian = /* GraphQL */ `
  mutation UpdateVeterinarian(
    $input: UpdateVeterinarianInput!
    $condition: ModelVeterinarianConditionInput
  ) {
    updateVeterinarian(input: $input, condition: $condition) {
      id
      firstname
      lastname
      email
      clinicID
      clinic {
        id
        name
        rpps
        email
        phone
        address
        latitude
        longitude
        hasEmergencyService
        transfusionsDone
        donorOwnersCount
        createdAt
        updatedAt
        __typename
      }
      validatedMissions {
        nextToken
        __typename
      }
      createdAt
      updatedAt
      clinicVeterinariansId
      owner
      __typename
    }
  }
`;
export const deleteVeterinarian = /* GraphQL */ `
  mutation DeleteVeterinarian(
    $input: DeleteVeterinarianInput!
    $condition: ModelVeterinarianConditionInput
  ) {
    deleteVeterinarian(input: $input, condition: $condition) {
      id
      firstname
      lastname
      email
      clinicID
      clinic {
        id
        name
        rpps
        email
        phone
        address
        latitude
        longitude
        hasEmergencyService
        transfusionsDone
        donorOwnersCount
        createdAt
        updatedAt
        __typename
      }
      validatedMissions {
        nextToken
        __typename
      }
      createdAt
      updatedAt
      clinicVeterinariansId
      owner
      __typename
    }
  }
`;
export const createOwner = /* GraphQL */ `
  mutation CreateOwner(
    $input: CreateOwnerInput!
    $condition: ModelOwnerConditionInput
  ) {
    createOwner(input: $input, condition: $condition) {
      id
      firstname
      lastname
      email
      phone
      address
      latitude
      longitude
      maxTravelDistance
      totalDonations
      animals {
        nextToken
        __typename
      }
      availabilities {
        nextToken
        __typename
      }
      myClinics {
        nextToken
        __typename
      }
      createdAt
      updatedAt
      owner
      __typename
    }
  }
`;
export const updateOwner = /* GraphQL */ `
  mutation UpdateOwner(
    $input: UpdateOwnerInput!
    $condition: ModelOwnerConditionInput
  ) {
    updateOwner(input: $input, condition: $condition) {
      id
      firstname
      lastname
      email
      phone
      address
      latitude
      longitude
      maxTravelDistance
      totalDonations
      animals {
        nextToken
        __typename
      }
      availabilities {
        nextToken
        __typename
      }
      myClinics {
        nextToken
        __typename
      }
      createdAt
      updatedAt
      owner
      __typename
    }
  }
`;
export const deleteOwner = /* GraphQL */ `
  mutation DeleteOwner(
    $input: DeleteOwnerInput!
    $condition: ModelOwnerConditionInput
  ) {
    deleteOwner(input: $input, condition: $condition) {
      id
      firstname
      lastname
      email
      phone
      address
      latitude
      longitude
      maxTravelDistance
      totalDonations
      animals {
        nextToken
        __typename
      }
      availabilities {
        nextToken
        __typename
      }
      myClinics {
        nextToken
        __typename
      }
      createdAt
      updatedAt
      owner
      __typename
    }
  }
`;
export const createOwnerAvailability = /* GraphQL */ `
  mutation CreateOwnerAvailability(
    $input: CreateOwnerAvailabilityInput!
    $condition: ModelOwnerAvailabilityConditionInput
  ) {
    createOwnerAvailability(input: $input, condition: $condition) {
      id
      dayOfWeek
      startTime
      endTime
      ownerID
      owner {
        id
        firstname
        lastname
        email
        phone
        address
        latitude
        longitude
        maxTravelDistance
        totalDonations
        createdAt
        updatedAt
        owner
        __typename
      }
      createdAt
      updatedAt
      ownerAvailabilitiesId
      __typename
    }
  }
`;
export const updateOwnerAvailability = /* GraphQL */ `
  mutation UpdateOwnerAvailability(
    $input: UpdateOwnerAvailabilityInput!
    $condition: ModelOwnerAvailabilityConditionInput
  ) {
    updateOwnerAvailability(input: $input, condition: $condition) {
      id
      dayOfWeek
      startTime
      endTime
      ownerID
      owner {
        id
        firstname
        lastname
        email
        phone
        address
        latitude
        longitude
        maxTravelDistance
        totalDonations
        createdAt
        updatedAt
        owner
        __typename
      }
      createdAt
      updatedAt
      ownerAvailabilitiesId
      __typename
    }
  }
`;
export const deleteOwnerAvailability = /* GraphQL */ `
  mutation DeleteOwnerAvailability(
    $input: DeleteOwnerAvailabilityInput!
    $condition: ModelOwnerAvailabilityConditionInput
  ) {
    deleteOwnerAvailability(input: $input, condition: $condition) {
      id
      dayOfWeek
      startTime
      endTime
      ownerID
      owner {
        id
        firstname
        lastname
        email
        phone
        address
        latitude
        longitude
        maxTravelDistance
        totalDonations
        createdAt
        updatedAt
        owner
        __typename
      }
      createdAt
      updatedAt
      ownerAvailabilitiesId
      __typename
    }
  }
`;
export const createAnimal = /* GraphQL */ `
  mutation CreateAnimal(
    $input: CreateAnimalInput!
    $condition: ModelAnimalConditionInput
  ) {
    createAnimal(input: $input, condition: $condition) {
      id
      name
      species
      breed
      birthDate
      weight
      bloodGroup
      isVaccinated
      isSterilized
      lastDonationDate
      donationFrequency
      ownerID
      owner {
        id
        firstname
        lastname
        email
        phone
        address
        latitude
        longitude
        maxTravelDistance
        totalDonations
        createdAt
        updatedAt
        owner
        __typename
      }
      missions {
        nextToken
        __typename
      }
      createdAt
      updatedAt
      ownerAnimalsId
      __typename
    }
  }
`;
export const updateAnimal = /* GraphQL */ `
  mutation UpdateAnimal(
    $input: UpdateAnimalInput!
    $condition: ModelAnimalConditionInput
  ) {
    updateAnimal(input: $input, condition: $condition) {
      id
      name
      species
      breed
      birthDate
      weight
      bloodGroup
      isVaccinated
      isSterilized
      lastDonationDate
      donationFrequency
      ownerID
      owner {
        id
        firstname
        lastname
        email
        phone
        address
        latitude
        longitude
        maxTravelDistance
        totalDonations
        createdAt
        updatedAt
        owner
        __typename
      }
      missions {
        nextToken
        __typename
      }
      createdAt
      updatedAt
      ownerAnimalsId
      __typename
    }
  }
`;
export const deleteAnimal = /* GraphQL */ `
  mutation DeleteAnimal(
    $input: DeleteAnimalInput!
    $condition: ModelAnimalConditionInput
  ) {
    deleteAnimal(input: $input, condition: $condition) {
      id
      name
      species
      breed
      birthDate
      weight
      bloodGroup
      isVaccinated
      isSterilized
      lastDonationDate
      donationFrequency
      ownerID
      owner {
        id
        firstname
        lastname
        email
        phone
        address
        latitude
        longitude
        maxTravelDistance
        totalDonations
        createdAt
        updatedAt
        owner
        __typename
      }
      missions {
        nextToken
        __typename
      }
      createdAt
      updatedAt
      ownerAnimalsId
      __typename
    }
  }
`;
export const createClinicOwnerRelation = /* GraphQL */ `
  mutation CreateClinicOwnerRelation(
    $input: CreateClinicOwnerRelationInput!
    $condition: ModelClinicOwnerRelationConditionInput
  ) {
    createClinicOwnerRelation(input: $input, condition: $condition) {
      id
      clinicID
      clinic {
        id
        name
        rpps
        email
        phone
        address
        latitude
        longitude
        hasEmergencyService
        transfusionsDone
        donorOwnersCount
        createdAt
        updatedAt
        __typename
      }
      ownerID
      owner {
        id
        firstname
        lastname
        email
        phone
        address
        latitude
        longitude
        maxTravelDistance
        totalDonations
        createdAt
        updatedAt
        owner
        __typename
      }
      isPrimaryClinic
      createdAt
      updatedAt
      clinicClientsId
      ownerMyClinicsId
      __typename
    }
  }
`;
export const updateClinicOwnerRelation = /* GraphQL */ `
  mutation UpdateClinicOwnerRelation(
    $input: UpdateClinicOwnerRelationInput!
    $condition: ModelClinicOwnerRelationConditionInput
  ) {
    updateClinicOwnerRelation(input: $input, condition: $condition) {
      id
      clinicID
      clinic {
        id
        name
        rpps
        email
        phone
        address
        latitude
        longitude
        hasEmergencyService
        transfusionsDone
        donorOwnersCount
        createdAt
        updatedAt
        __typename
      }
      ownerID
      owner {
        id
        firstname
        lastname
        email
        phone
        address
        latitude
        longitude
        maxTravelDistance
        totalDonations
        createdAt
        updatedAt
        owner
        __typename
      }
      isPrimaryClinic
      createdAt
      updatedAt
      clinicClientsId
      ownerMyClinicsId
      __typename
    }
  }
`;
export const deleteClinicOwnerRelation = /* GraphQL */ `
  mutation DeleteClinicOwnerRelation(
    $input: DeleteClinicOwnerRelationInput!
    $condition: ModelClinicOwnerRelationConditionInput
  ) {
    deleteClinicOwnerRelation(input: $input, condition: $condition) {
      id
      clinicID
      clinic {
        id
        name
        rpps
        email
        phone
        address
        latitude
        longitude
        hasEmergencyService
        transfusionsDone
        donorOwnersCount
        createdAt
        updatedAt
        __typename
      }
      ownerID
      owner {
        id
        firstname
        lastname
        email
        phone
        address
        latitude
        longitude
        maxTravelDistance
        totalDonations
        createdAt
        updatedAt
        owner
        __typename
      }
      isPrimaryClinic
      createdAt
      updatedAt
      clinicClientsId
      ownerMyClinicsId
      __typename
    }
  }
`;
export const createRequest = /* GraphQL */ `
  mutation CreateRequest(
    $input: CreateRequestInput!
    $condition: ModelRequestConditionInput
  ) {
    createRequest(input: $input, condition: $condition) {
      id
      requestType
      requiredSpecies
      requiredBloodGroup
      quantity
      status
      createdAt
      clinicID
      clinic {
        id
        name
        rpps
        email
        phone
        address
        latitude
        longitude
        hasEmergencyService
        transfusionsDone
        donorOwnersCount
        createdAt
        updatedAt
        __typename
      }
      mission {
        id
        requestID
        animalID
        status
        appointmentDatetime
        stripePaymentIntentId
        stripePaymentStatus
        validationCode
        scannedAt
        validatedByVeterinarianID
        createdAt
        updatedAt
        veterinarianValidatedMissionsId
        animalMissionsId
        owner
        __typename
      }
      updatedAt
      clinicRequestsId
      requestMissionId
      __typename
    }
  }
`;
export const updateRequest = /* GraphQL */ `
  mutation UpdateRequest(
    $input: UpdateRequestInput!
    $condition: ModelRequestConditionInput
  ) {
    updateRequest(input: $input, condition: $condition) {
      id
      requestType
      requiredSpecies
      requiredBloodGroup
      quantity
      status
      createdAt
      clinicID
      clinic {
        id
        name
        rpps
        email
        phone
        address
        latitude
        longitude
        hasEmergencyService
        transfusionsDone
        donorOwnersCount
        createdAt
        updatedAt
        __typename
      }
      mission {
        id
        requestID
        animalID
        status
        appointmentDatetime
        stripePaymentIntentId
        stripePaymentStatus
        validationCode
        scannedAt
        validatedByVeterinarianID
        createdAt
        updatedAt
        veterinarianValidatedMissionsId
        animalMissionsId
        owner
        __typename
      }
      updatedAt
      clinicRequestsId
      requestMissionId
      __typename
    }
  }
`;
export const deleteRequest = /* GraphQL */ `
  mutation DeleteRequest(
    $input: DeleteRequestInput!
    $condition: ModelRequestConditionInput
  ) {
    deleteRequest(input: $input, condition: $condition) {
      id
      requestType
      requiredSpecies
      requiredBloodGroup
      quantity
      status
      createdAt
      clinicID
      clinic {
        id
        name
        rpps
        email
        phone
        address
        latitude
        longitude
        hasEmergencyService
        transfusionsDone
        donorOwnersCount
        createdAt
        updatedAt
        __typename
      }
      mission {
        id
        requestID
        animalID
        status
        appointmentDatetime
        stripePaymentIntentId
        stripePaymentStatus
        validationCode
        scannedAt
        validatedByVeterinarianID
        createdAt
        updatedAt
        veterinarianValidatedMissionsId
        animalMissionsId
        owner
        __typename
      }
      updatedAt
      clinicRequestsId
      requestMissionId
      __typename
    }
  }
`;
export const createMission = /* GraphQL */ `
  mutation CreateMission(
    $input: CreateMissionInput!
    $condition: ModelMissionConditionInput
  ) {
    createMission(input: $input, condition: $condition) {
      id
      requestID
      animalID
      animal {
        id
        name
        species
        breed
        birthDate
        weight
        bloodGroup
        isVaccinated
        isSterilized
        lastDonationDate
        donationFrequency
        ownerID
        createdAt
        updatedAt
        ownerAnimalsId
        __typename
      }
      status
      appointmentDatetime
      stripePaymentIntentId
      stripePaymentStatus
      validationCode
      scannedAt
      validatedByVeterinarianID
      validatedBy {
        id
        firstname
        lastname
        email
        clinicID
        createdAt
        updatedAt
        clinicVeterinariansId
        owner
        __typename
      }
      createdAt
      updatedAt
      veterinarianValidatedMissionsId
      animalMissionsId
      owner
      __typename
    }
  }
`;
export const updateMission = /* GraphQL */ `
  mutation UpdateMission(
    $input: UpdateMissionInput!
    $condition: ModelMissionConditionInput
  ) {
    updateMission(input: $input, condition: $condition) {
      id
      requestID
      animalID
      animal {
        id
        name
        species
        breed
        birthDate
        weight
        bloodGroup
        isVaccinated
        isSterilized
        lastDonationDate
        donationFrequency
        ownerID
        createdAt
        updatedAt
        ownerAnimalsId
        __typename
      }
      status
      appointmentDatetime
      stripePaymentIntentId
      stripePaymentStatus
      validationCode
      scannedAt
      validatedByVeterinarianID
      validatedBy {
        id
        firstname
        lastname
        email
        clinicID
        createdAt
        updatedAt
        clinicVeterinariansId
        owner
        __typename
      }
      createdAt
      updatedAt
      veterinarianValidatedMissionsId
      animalMissionsId
      owner
      __typename
    }
  }
`;
export const deleteMission = /* GraphQL */ `
  mutation DeleteMission(
    $input: DeleteMissionInput!
    $condition: ModelMissionConditionInput
  ) {
    deleteMission(input: $input, condition: $condition) {
      id
      requestID
      animalID
      animal {
        id
        name
        species
        breed
        birthDate
        weight
        bloodGroup
        isVaccinated
        isSterilized
        lastDonationDate
        donationFrequency
        ownerID
        createdAt
        updatedAt
        ownerAnimalsId
        __typename
      }
      status
      appointmentDatetime
      stripePaymentIntentId
      stripePaymentStatus
      validationCode
      scannedAt
      validatedByVeterinarianID
      validatedBy {
        id
        firstname
        lastname
        email
        clinicID
        createdAt
        updatedAt
        clinicVeterinariansId
        owner
        __typename
      }
      createdAt
      updatedAt
      veterinarianValidatedMissionsId
      animalMissionsId
      owner
      __typename
    }
  }
`;
