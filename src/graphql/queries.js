/* eslint-disable */
// this is an auto generated file. This will be overwritten

export const getClinic = /* GraphQL */ `
  query GetClinic($id: ID!) {
    getClinic(id: $id) {
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
      owner
      __typename
    }
  }
`;
export const listClinics = /* GraphQL */ `
  query ListClinics(
    $filter: ModelClinicFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listClinics(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
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
        owner
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const getVeterinarian = /* GraphQL */ `
  query GetVeterinarian($id: ID!) {
    getVeterinarian(id: $id) {
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
        owner
        __typename
      }
      validatedMissions {
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
export const listVeterinarians = /* GraphQL */ `
  query ListVeterinarians(
    $filter: ModelVeterinarianFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listVeterinarians(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        id
        firstname
        lastname
        email
        clinicID
        createdAt
        updatedAt
        owner
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const getOwner = /* GraphQL */ `
  query GetOwner($id: ID!) {
    getOwner(id: $id) {
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
export const listOwners = /* GraphQL */ `
  query ListOwners(
    $filter: ModelOwnerFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listOwners(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
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
      nextToken
      __typename
    }
  }
`;
export const getOwnerAvailability = /* GraphQL */ `
  query GetOwnerAvailability($id: ID!) {
    getOwnerAvailability(id: $id) {
      id
      dayOfWeek
      startTime
      endTime
      ownerID
      ownerProfile {
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
      owner
      __typename
    }
  }
`;
export const listOwnerAvailabilities = /* GraphQL */ `
  query ListOwnerAvailabilities(
    $filter: ModelOwnerAvailabilityFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listOwnerAvailabilities(
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        dayOfWeek
        startTime
        endTime
        ownerID
        createdAt
        updatedAt
        ownerAvailabilitiesId
        owner
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const getAnimal = /* GraphQL */ `
  query GetAnimal($id: ID!) {
    getAnimal(id: $id) {
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
      ownerProfile {
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
      owner
      __typename
    }
  }
`;
export const listAnimals = /* GraphQL */ `
  query ListAnimals(
    $filter: ModelAnimalFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listAnimals(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
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
        owner
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const getClinicOwnerRelation = /* GraphQL */ `
  query GetClinicOwnerRelation($id: ID!) {
    getClinicOwnerRelation(id: $id) {
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
        owner
        __typename
      }
      ownerID
      ownerProfile {
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
      owner
      __typename
    }
  }
`;
export const listClinicOwnerRelations = /* GraphQL */ `
  query ListClinicOwnerRelations(
    $filter: ModelClinicOwnerRelationFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listClinicOwnerRelations(
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        clinicID
        ownerID
        isPrimaryClinic
        createdAt
        updatedAt
        clinicClientsId
        ownerMyClinicsId
        owner
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const getRequest = /* GraphQL */ `
  query GetRequest($id: ID!) {
    getRequest(id: $id) {
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
        owner
        __typename
      }
      activeMissionID
      mission {
        id
        requestID
        animalID
        status
        appointmentDatetime
        validationCode
        scannedAt
        validatedByVeterinarianID
        stripePaymentIntentId
        stripePaymentStatus
        createdAt
        updatedAt
        veterinarianValidatedMissionsId
        animalMissionsId
        owner
        __typename
      }
      updatedAt
      clinicRequestsId
      __typename
    }
  }
`;
export const listRequests = /* GraphQL */ `
  query ListRequests(
    $filter: ModelRequestFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listRequests(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        id
        requestType
        requiredSpecies
        requiredBloodGroup
        quantity
        status
        createdAt
        clinicID
        activeMissionID
        updatedAt
        clinicRequestsId
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const getMission = /* GraphQL */ `
  query GetMission($id: ID!) {
    getMission(id: $id) {
      id
      requestID
      request {
        id
        requestType
        requiredSpecies
        requiredBloodGroup
        quantity
        status
        createdAt
        clinicID
        activeMissionID
        updatedAt
        clinicRequestsId
        __typename
      }
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
        owner
        __typename
      }
      status
      appointmentDatetime
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
        owner
        __typename
      }
      stripePaymentIntentId
      stripePaymentStatus
      createdAt
      updatedAt
      veterinarianValidatedMissionsId
      animalMissionsId
      owner
      __typename
    }
  }
`;
export const listMissions = /* GraphQL */ `
  query ListMissions(
    $filter: ModelMissionFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listMissions(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        id
        requestID
        animalID
        status
        appointmentDatetime
        validationCode
        scannedAt
        validatedByVeterinarianID
        stripePaymentIntentId
        stripePaymentStatus
        createdAt
        updatedAt
        veterinarianValidatedMissionsId
        animalMissionsId
        owner
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const veterinariansByClinicID = /* GraphQL */ `
  query VeterinariansByClinicID(
    $clinicID: ID!
    $sortDirection: ModelSortDirection
    $filter: ModelVeterinarianFilterInput
    $limit: Int
    $nextToken: String
  ) {
    veterinariansByClinicID(
      clinicID: $clinicID
      sortDirection: $sortDirection
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        firstname
        lastname
        email
        clinicID
        createdAt
        updatedAt
        owner
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const ownerAvailabilitiesByOwnerID = /* GraphQL */ `
  query OwnerAvailabilitiesByOwnerID(
    $ownerID: ID!
    $sortDirection: ModelSortDirection
    $filter: ModelOwnerAvailabilityFilterInput
    $limit: Int
    $nextToken: String
  ) {
    ownerAvailabilitiesByOwnerID(
      ownerID: $ownerID
      sortDirection: $sortDirection
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        dayOfWeek
        startTime
        endTime
        ownerID
        createdAt
        updatedAt
        ownerAvailabilitiesId
        owner
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const animalsByOwnerID = /* GraphQL */ `
  query AnimalsByOwnerID(
    $ownerID: ID!
    $sortDirection: ModelSortDirection
    $filter: ModelAnimalFilterInput
    $limit: Int
    $nextToken: String
  ) {
    animalsByOwnerID(
      ownerID: $ownerID
      sortDirection: $sortDirection
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
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
        owner
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const clinicOwnerRelationsByClinicID = /* GraphQL */ `
  query ClinicOwnerRelationsByClinicID(
    $clinicID: ID!
    $sortDirection: ModelSortDirection
    $filter: ModelClinicOwnerRelationFilterInput
    $limit: Int
    $nextToken: String
  ) {
    clinicOwnerRelationsByClinicID(
      clinicID: $clinicID
      sortDirection: $sortDirection
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        clinicID
        ownerID
        isPrimaryClinic
        createdAt
        updatedAt
        clinicClientsId
        ownerMyClinicsId
        owner
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const clinicOwnerRelationsByOwnerID = /* GraphQL */ `
  query ClinicOwnerRelationsByOwnerID(
    $ownerID: ID!
    $sortDirection: ModelSortDirection
    $filter: ModelClinicOwnerRelationFilterInput
    $limit: Int
    $nextToken: String
  ) {
    clinicOwnerRelationsByOwnerID(
      ownerID: $ownerID
      sortDirection: $sortDirection
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        clinicID
        ownerID
        isPrimaryClinic
        createdAt
        updatedAt
        clinicClientsId
        ownerMyClinicsId
        owner
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const requestsByClinicID = /* GraphQL */ `
  query RequestsByClinicID(
    $clinicID: ID!
    $sortDirection: ModelSortDirection
    $filter: ModelRequestFilterInput
    $limit: Int
    $nextToken: String
  ) {
    requestsByClinicID(
      clinicID: $clinicID
      sortDirection: $sortDirection
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        requestType
        requiredSpecies
        requiredBloodGroup
        quantity
        status
        createdAt
        clinicID
        activeMissionID
        updatedAt
        clinicRequestsId
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const missionsByRequestID = /* GraphQL */ `
  query MissionsByRequestID(
    $requestID: ID!
    $sortDirection: ModelSortDirection
    $filter: ModelMissionFilterInput
    $limit: Int
    $nextToken: String
  ) {
    missionsByRequestID(
      requestID: $requestID
      sortDirection: $sortDirection
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        requestID
        animalID
        status
        appointmentDatetime
        validationCode
        scannedAt
        validatedByVeterinarianID
        stripePaymentIntentId
        stripePaymentStatus
        createdAt
        updatedAt
        veterinarianValidatedMissionsId
        animalMissionsId
        owner
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const missionsByAnimalID = /* GraphQL */ `
  query MissionsByAnimalID(
    $animalID: ID!
    $sortDirection: ModelSortDirection
    $filter: ModelMissionFilterInput
    $limit: Int
    $nextToken: String
  ) {
    missionsByAnimalID(
      animalID: $animalID
      sortDirection: $sortDirection
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        requestID
        animalID
        status
        appointmentDatetime
        validationCode
        scannedAt
        validatedByVeterinarianID
        stripePaymentIntentId
        stripePaymentStatus
        createdAt
        updatedAt
        veterinarianValidatedMissionsId
        animalMissionsId
        owner
        __typename
      }
      nextToken
      __typename
    }
  }
`;
