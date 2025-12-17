export const getVetWithClinic = /* GraphQL */ `
  query GetVetWithClinic($id: ID!) {
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
      }
    }
  }
`

export const listRequestsByClinic = /* GraphQL */ `
  query ListRequestsByClinic($filter: ModelRequestFilterInput) {
    listRequests(filter: $filter) {
      items {
        id
        requestType
        requiredSpecies
        requiredBloodGroup
        quantity
        status
        createdAt
        updatedAt
        mission {
          id
          status
          animal {
            name
            breed
            weight
            ownerProfile {
              phone
              firstname
              lastname
            }
          }
        }
      }
    }
  }
`

export const listMyAnimalsSimple = /* GraphQL */ `
  query ListMyAnimals {
    listAnimals {
      items {
        id
        name
        species
        bloodGroup
      }
    }
  }
`

export const listMyAvailabilities = /* GraphQL */ `
  query ListMyAvailabilities($filter: ModelOwnerAvailabilityFilterInput) {
    listOwnerAvailabilities(filter: $filter) {
      items {
        id
        dayOfWeek
        startTime
        endTime
      }
    }
  }
`

export const listMyAnimalsMissions = /* GraphQL */ `
  query ListMyAnimalsMissions($ownerID: ID!) {
    listAnimals(filter: { ownerID: { eq: $ownerID } }) {
      items {
        id
        name
        missions {
          items {
            id
            status
            appointmentDatetime
            request {
              id
              requestType
              clinic {
                name
                address
                phone
                latitude
                longitude
              }
            }
          }
        }
      }
    }
  }
`

export const listMyAnimalsByOwnerId = /* GraphQL */ `
  query ListMyAnimalsByOwnerId($ownerID: ID!) {
    listAnimals(filter: { ownerID: { eq: $ownerID } }) {
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
        donationFrequency
        ownerID
        createdAt
        updatedAt
      }
    }
  }
`
