/**
 * Requêtes GraphQL avec pagination optimisée
 * Phase 1 Sprint 1.3 - Performance Critique
 */

// ===========================================
// REQUÊTES PAGINÉES OPTIMISÉES
// ===========================================

export const listRequestsPaginated = /* GraphQL */ `
  query ListRequestsPaginated(
    $filter: ModelRequestFilterInput
    $limit: Int = 20
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
        clinic {
          id
          name
          address
          latitude
          longitude
        }
        mission {
          id
          status
          animal {
            id
            name
            breed
            weight
            ownerProfile {
              id
              firstname
              lastname
              phone
            }
          }
        }
      }
      nextToken
      __typename
    }
  }
`

export const listAnimalsPaginated = /* GraphQL */ `
  query ListAnimalsPaginated(
    $filter: ModelAnimalFilterInput
    $limit: Int = 20
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
        donationFrequency
        lastDonationDate
        ownerID
        createdAt
        updatedAt
      }
      nextToken
      __typename
    }
  }
`

export const listOwnersPaginated = /* GraphQL */ `
  query ListOwnersPaginated($filter: ModelOwnerFilterInput, $limit: Int = 20, $nextToken: String) {
    listOwners(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        id
        firstname
        lastname
        address
        latitude
        longitude
        maxTravelDistance
        totalDonations
        # email et phone exclus pour les vétérinaires (sécurité)
      }
      nextToken
      __typename
    }
  }
`

export const listMissionsPaginated = /* GraphQL */ `
  query ListMissionsPaginated(
    $filter: ModelMissionFilterInput
    $limit: Int = 20
    $nextToken: String
  ) {
    listMissions(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        id
        status
        appointmentDatetime
        requestID
        animalID
        request {
          id
          requestType
          requiredSpecies
          requiredBloodGroup
          clinic {
            id
            name
            address
            phone
          }
        }
        animal {
          id
          name
          species
          breed
          weight
          bloodGroup
        }
        createdAt
        updatedAt
      }
      nextToken
      __typename
    }
  }
`

// ===========================================
// REQUÊTES OPTIMISÉES PAR CAS D'USAGE
// ===========================================

export const listOpenRequestsForMatching = /* GraphQL */ `
  query ListOpenRequestsForMatching($limit: Int = 10, $nextToken: String) {
    listRequests(filter: { status: { eq: OPEN } }, limit: $limit, nextToken: $nextToken) {
      items {
        id
        requestType
        requiredSpecies
        requiredBloodGroup
        quantity
        createdAt
        clinic {
          id
          name
          address
          latitude
          longitude
          hasEmergencyService
        }
      }
      nextToken
      __typename
    }
  }
`

export const listMyAnimalsOptimized = /* GraphQL */ `
  query ListMyAnimalsOptimized($ownerID: ID!, $limit: Int = 10, $nextToken: String) {
    listAnimals(filter: { ownerID: { eq: $ownerID } }, limit: $limit, nextToken: $nextToken) {
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
        lastDonationDate
        ownerID
        # Missions récentes seulement
        missions(limit: 5) {
          items {
            id
            status
            appointmentDatetime
            request {
              id
              requestType
              clinic {
                name
              }
            }
          }
        }
      }
      nextToken
      __typename
    }
  }
`

export const listClinicRequestsOptimized = /* GraphQL */ `
  query ListClinicRequestsOptimized($clinicID: ID!, $limit: Int = 15, $nextToken: String) {
    listRequests(filter: { clinicID: { eq: $clinicID } }, limit: $limit, nextToken: $nextToken) {
      items {
        id
        requestType
        requiredSpecies
        requiredBloodGroup
        quantity
        status
        createdAt
        # Mission active seulement si elle existe
        mission {
          id
          status
          appointmentDatetime
          animal {
            id
            name
            breed
            weight
            bloodGroup
            ownerProfile {
              id
              firstname
              lastname
              phone
            }
          }
        }
      }
      nextToken
      __typename
    }
  }
`

// ===========================================
// REQUÊTES DE RECHERCHE OPTIMISÉES
// ===========================================

export const searchCompatibleAnimals = /* GraphQL */ `
  query SearchCompatibleAnimals(
    $species: Species!
    $bloodGroup: String!
    $limit: Int = 20
    $nextToken: String
  ) {
    listAnimals(
      filter: {
        and: [
          { species: { eq: $species } }
          { bloodGroup: { eq: $bloodGroup } }
          { isVaccinated: { eq: true } }
        ]
      }
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        name
        species
        breed
        weight
        bloodGroup
        lastDonationDate
        donationFrequency
        ownerProfile {
          id
          firstname
          lastname
          address
          latitude
          longitude
          maxTravelDistance
        }
      }
      nextToken
      __typename
    }
  }
`

export const searchNearbyOwners = /* GraphQL */ `
  query SearchNearbyOwners($limit: Int = 50, $nextToken: String) {
    listOwners(limit: $limit, nextToken: $nextToken) {
      items {
        id
        firstname
        lastname
        latitude
        longitude
        maxTravelDistance
        animals(filter: { isVaccinated: { eq: true } }) {
          items {
            id
            name
            species
            bloodGroup
            weight
            lastDonationDate
          }
        }
      }
      nextToken
      __typename
    }
  }
`

// ===========================================
// REQUÊTES DE STATISTIQUES LÉGÈRES
// ===========================================

export const getClinicStats = /* GraphQL */ `
  query GetClinicStats($clinicID: ID!) {
    getClinic(id: $clinicID) {
      id
      name
      transfusionsDone
      donorOwnersCount
      # Requêtes récentes seulement
      requests(limit: 5, sortDirection: DESC) {
        items {
          id
          status
          createdAt
        }
      }
    }
  }
`

export const getOwnerStats = /* GraphQL */ `
  query GetOwnerStats($ownerID: ID!) {
    getOwner(id: $ownerID) {
      id
      firstname
      lastname
      totalDonations
      # Animaux avec missions récentes
      animals {
        items {
          id
          name
          species
          missions(limit: 3, sortDirection: DESC) {
            items {
              id
              status
              appointmentDatetime
            }
          }
        }
      }
    }
  }
`
