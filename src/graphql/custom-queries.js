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
// Phase 3.3 : `mission.createdAt`/`mission.updatedAt` sélectionnés en plus pour
// HistoryView.vue (via useClinicHistory.js, qui réutilise useClinicRequest.js plutôt que
// d'écrire une seconde query scopée clinique) — nécessaires pour dater les événements
// MISSION_ACCEPTED (mission.createdAt) et MISSION_COMPLETED/MISSION_NO_SHOW
// (mission.updatedAt, cf. useClinicHistory.js pour l'hypothèse documentée derrière ce choix).
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
          createdAt
          updatedAt
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
        species
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

// Phase 6.5 (roadmap V1, ADR-0005) : `appointmentDatetime` sélectionné en plus depuis cette
// sous-tâche -- useMatchingRequests.js en a besoin pour évaluer matchesAvailability()
// (eligibility-service.js) sur les Requests de type APPOINTMENT (null/absent pour EMERGENCY,
// ignoré par matchesAvailability() dans ce cas).
export const listOpenRequestsWithClinic = /* GraphQL */ `
  query ListOpenRequestsWithClinic($filter: ModelRequestFilterInput) {
    listRequests(filter: $filter) {
      items {
        id
        requestType
        requiredSpecies
        requiredBloodGroup
        quantity
        appointmentDatetime
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

// Sous-tâche "wire Clinic Priority (critère 5) dans searchMatches" (roadmap, suite de la
// Phase 3.1/3.2) : useMatchingRequests.js a besoin de la liste des `clinicID` déjà liés à
// l'Owner courant (via `ClinicOwnerRelation`) pour passer `ownerClinicIds` à
// checkEligibility() (eligibility-service.js). La query générée
// `clinicOwnerRelationsByOwnerID` (queries.js) renvoie tout le graphe d'une relation
// (id, ownerID, isPrimaryClinic, createdAt, updatedAt, owner, __typename) alors qu'on n'a
// besoin que de `clinicID` ici — même raisonnement que closeMissionSimple/
// createClinicOwnerRelationSimple dans custom-mutations.js : éviter de sur-fetcher un champ
// scalaire unique.
export const myClinicRelationsByOwnerID = /* GraphQL */ `
  query MyClinicRelationsByOwnerID($ownerID: ID!) {
    clinicOwnerRelationsByOwnerID(ownerID: $ownerID) {
      items {
        clinicID
      }
    }
  }
`

// Phase 7.8 : garde-fou multi-vétérinaire sur useClinicSettings.deleteAccount -- avant de
// supprimer la Clinic, il faut savoir si un AUTRE Veterinarian y est encore rattaché
// (Clinic.veterinarians: [Veterinarian] @hasMany, schema.graphql -- plusieurs Veterinarian
// par Clinic est un cas prévu par le schéma, pas un cas limite). La query générée
// `veterinariansByClinicID` (queries.js) redemande createdAt/updatedAt/owner/__typename en
// plus -- on n'a besoin que de `id` ici pour compter/exclure le vétérinaire courant, même
// raisonnement de sur-fetch que `myClinicRelationsByOwnerID` ci-dessus.
export const veterinariansByClinicIDSimple = /* GraphQL */ `
  query VeterinariansByClinicIDSimple($clinicID: ID!) {
    veterinariansByClinicID(clinicID: $clinicID) {
      items {
        id
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
        sex
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
