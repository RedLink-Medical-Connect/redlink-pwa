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

// Phase 3.1 : `clinicID` (sur Request) et `mission.animal.ownerID` sont sélectionnés en plus
// depuis cette sous-tâche — RequestsView.vue (seul appelant de cette query, via
// useClinicRequest.js) en a besoin pour passer clinicID/ownerID à closeMission() sans aller
// les re-chercher par un aller-retour GraphQL dédié : cette query tourne déjà à chaque
// affichage de la liste, les deux champs n'existaient simplement pas encore dans la
// sélection.
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
        clinicID
        mission {
          id
          status
          animalID
          animal {
            name
            breed
            weight
            ownerID
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
        isValidatedDonor
        validationExpiresAt
        lastDonationDate
        donationFrequency
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

export const listOpenRequestsWithClinic = /* GraphQL */ `
  query ListOpenRequestsWithClinic($filter: ModelRequestFilterInput) {
    listRequests(filter: $filter) {
      items {
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
        updatedAt
        __typename
      }
      nextToken
      __typename
    }
  }
`

// Phase 1.1 (ADR-0002) : liste des Animals "en attente de validation vétérinaire"
// (useAnimalValidation.js). Volontairement GLOBALE, pas de filtre `ownerID` ni
// `clinicID` — `Animal` n'accorde de toute façon aux Veterinarians qu'un accès `read`
// global (pas de scoping par clinique dans le schéma actuel, cf. schema.graphql). Un vrai
// filtrage par clinique est possible (clinicOwnerRelationsByClinicID existe déjà en
// généré) mais n'a jamais été composé avec une liste d'Animals dans ce repo — pas construit
// ici, filtrer côté client sans lui donnerait l'illusion d'une frontière de sécurité par
// clinique qui n'existe pas réellement.
export const listAnimalsForValidation = /* GraphQL */ `
  query ListAnimalsForValidation {
    listAnimals {
      items {
        id
        name
        species
        breed
        bloodGroup
        isValidatedDonor
        validationExpiresAt
        ownerID
        ownerProfile {
          firstname
          lastname
        }
      }
    }
  }
`

// Phase 3.2 : annuaire des donneurs d'une clinique (DonorsView.vue via
// useClinicDonors.js). Traverse ClinicOwnerRelation -> ownerProfile -> animals en UNE
// seule requête imbriquée (Owner.animals @hasMany, cf. schema.graphql) plutôt qu'une
// boucle N+1 par Owner — la traversée est possible en un seul aller-retour parce que
// clinicOwnerRelationsByClinicID (index généré) expose déjà `ownerProfile`, lui-même
// relié à `animals` par @hasMany. Le composable aplatit ensuite en une ligne par
// (animal, owner) et filtre aux seuls Validated Donor courants (isValidatedDonor(),
// eligibility-service.js) — cette query renvoie donc aussi les animaux non/plus
// validés, volontairement : le filtre "Validated Donor courant" dépend de l'heure de
// lecture (validationExpiresAt expiré ou non), pas d'un état stable en base, donc il
// n'a pas sa place dans le filtre GraphQL lui-même.
export const listClinicDonorsByClinicID = /* GraphQL */ `
  query ListClinicDonorsByClinicID($clinicID: ID!) {
    clinicOwnerRelationsByClinicID(clinicID: $clinicID) {
      items {
        ownerID
        ownerProfile {
          id
          firstname
          lastname
          phone
          address
          latitude
          longitude
          animals {
            items {
              id
              name
              species
              breed
              bloodGroup
              isValidatedDonor
              validationExpiresAt
              lastDonationDate
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
        isValidatedDonor
        validationExpiresAt
        lastDonationDate
        ownerID
        createdAt
        updatedAt
      }
    }
  }
`
