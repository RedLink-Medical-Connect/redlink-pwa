/* eslint-disable */
// this is an auto generated file. This will be overwritten

export const onCreateClinic = /* GraphQL */ `
  subscription OnCreateClinic(
    $filter: ModelSubscriptionClinicFilterInput
    $owner: String
  ) {
    onCreateClinic(filter: $filter, owner: $owner) {
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
export const onUpdateClinic = /* GraphQL */ `
  subscription OnUpdateClinic(
    $filter: ModelSubscriptionClinicFilterInput
    $owner: String
  ) {
    onUpdateClinic(filter: $filter, owner: $owner) {
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
export const onDeleteClinic = /* GraphQL */ `
  subscription OnDeleteClinic(
    $filter: ModelSubscriptionClinicFilterInput
    $owner: String
  ) {
    onDeleteClinic(filter: $filter, owner: $owner) {
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
export const onCreateVeterinarian = /* GraphQL */ `
  subscription OnCreateVeterinarian(
    $filter: ModelSubscriptionVeterinarianFilterInput
    $owner: String
  ) {
    onCreateVeterinarian(filter: $filter, owner: $owner) {
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
export const onUpdateVeterinarian = /* GraphQL */ `
  subscription OnUpdateVeterinarian(
    $filter: ModelSubscriptionVeterinarianFilterInput
    $owner: String
  ) {
    onUpdateVeterinarian(filter: $filter, owner: $owner) {
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
export const onDeleteVeterinarian = /* GraphQL */ `
  subscription OnDeleteVeterinarian(
    $filter: ModelSubscriptionVeterinarianFilterInput
    $owner: String
  ) {
    onDeleteVeterinarian(filter: $filter, owner: $owner) {
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
export const onCreateOwner = /* GraphQL */ `
  subscription OnCreateOwner(
    $filter: ModelSubscriptionOwnerFilterInput
    $owner: String
  ) {
    onCreateOwner(filter: $filter, owner: $owner) {
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
export const onUpdateOwner = /* GraphQL */ `
  subscription OnUpdateOwner(
    $filter: ModelSubscriptionOwnerFilterInput
    $owner: String
  ) {
    onUpdateOwner(filter: $filter, owner: $owner) {
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
export const onDeleteOwner = /* GraphQL */ `
  subscription OnDeleteOwner(
    $filter: ModelSubscriptionOwnerFilterInput
    $owner: String
  ) {
    onDeleteOwner(filter: $filter, owner: $owner) {
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
export const onCreateOwnerAvailability = /* GraphQL */ `
  subscription OnCreateOwnerAvailability(
    $filter: ModelSubscriptionOwnerAvailabilityFilterInput
    $owner: String
  ) {
    onCreateOwnerAvailability(filter: $filter, owner: $owner) {
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
export const onUpdateOwnerAvailability = /* GraphQL */ `
  subscription OnUpdateOwnerAvailability(
    $filter: ModelSubscriptionOwnerAvailabilityFilterInput
    $owner: String
  ) {
    onUpdateOwnerAvailability(filter: $filter, owner: $owner) {
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
export const onDeleteOwnerAvailability = /* GraphQL */ `
  subscription OnDeleteOwnerAvailability(
    $filter: ModelSubscriptionOwnerAvailabilityFilterInput
    $owner: String
  ) {
    onDeleteOwnerAvailability(filter: $filter, owner: $owner) {
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
export const onCreateAnimal = /* GraphQL */ `
  subscription OnCreateAnimal(
    $filter: ModelSubscriptionAnimalFilterInput
    $owner: String
  ) {
    onCreateAnimal(filter: $filter, owner: $owner) {
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
export const onUpdateAnimal = /* GraphQL */ `
  subscription OnUpdateAnimal(
    $filter: ModelSubscriptionAnimalFilterInput
    $owner: String
  ) {
    onUpdateAnimal(filter: $filter, owner: $owner) {
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
export const onDeleteAnimal = /* GraphQL */ `
  subscription OnDeleteAnimal(
    $filter: ModelSubscriptionAnimalFilterInput
    $owner: String
  ) {
    onDeleteAnimal(filter: $filter, owner: $owner) {
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
export const onCreateClinicOwnerRelation = /* GraphQL */ `
  subscription OnCreateClinicOwnerRelation(
    $filter: ModelSubscriptionClinicOwnerRelationFilterInput
    $owner: String
  ) {
    onCreateClinicOwnerRelation(filter: $filter, owner: $owner) {
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
export const onUpdateClinicOwnerRelation = /* GraphQL */ `
  subscription OnUpdateClinicOwnerRelation(
    $filter: ModelSubscriptionClinicOwnerRelationFilterInput
    $owner: String
  ) {
    onUpdateClinicOwnerRelation(filter: $filter, owner: $owner) {
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
export const onDeleteClinicOwnerRelation = /* GraphQL */ `
  subscription OnDeleteClinicOwnerRelation(
    $filter: ModelSubscriptionClinicOwnerRelationFilterInput
    $owner: String
  ) {
    onDeleteClinicOwnerRelation(filter: $filter, owner: $owner) {
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
export const onCreateRequest = /* GraphQL */ `
  subscription OnCreateRequest($filter: ModelSubscriptionRequestFilterInput) {
    onCreateRequest(filter: $filter) {
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
export const onUpdateRequest = /* GraphQL */ `
  subscription OnUpdateRequest($filter: ModelSubscriptionRequestFilterInput) {
    onUpdateRequest(filter: $filter) {
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
export const onDeleteRequest = /* GraphQL */ `
  subscription OnDeleteRequest($filter: ModelSubscriptionRequestFilterInput) {
    onDeleteRequest(filter: $filter) {
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
export const onCreateMission = /* GraphQL */ `
  subscription OnCreateMission(
    $filter: ModelSubscriptionMissionFilterInput
    $owner: String
  ) {
    onCreateMission(filter: $filter, owner: $owner) {
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
export const onUpdateMission = /* GraphQL */ `
  subscription OnUpdateMission(
    $filter: ModelSubscriptionMissionFilterInput
    $owner: String
  ) {
    onUpdateMission(filter: $filter, owner: $owner) {
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
export const onDeleteMission = /* GraphQL */ `
  subscription OnDeleteMission(
    $filter: ModelSubscriptionMissionFilterInput
    $owner: String
  ) {
    onDeleteMission(filter: $filter, owner: $owner) {
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
