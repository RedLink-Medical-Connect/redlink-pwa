export const getVetWithClinic = /* GraphQL */ `
  query GetVetWithClinic {
    listVeterinarians {
      items {
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
