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
