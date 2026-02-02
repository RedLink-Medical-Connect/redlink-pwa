// Script de débogage pour vérifier les données dans la base
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'

const client = generateClient()

// Requête pour lister tous les vétérinaires
const listVeterinarians = /* GraphQL */ `
  query ListVeterinarians {
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
          email
          phone
          rpps
        }
      }
    }
  }
`

// Requête pour lister toutes les cliniques
const listClinics = /* GraphQL */ `
  query ListClinics {
    listClinics {
      items {
        id
        name
        email
        phone
        rpps
        address
        hasEmergencyService
      }
    }
  }
`

async function debugData() {
  try {
    console.log('=== DÉBOGAGE DES DONNÉES ===')

    // 1. Vérifier l'utilisateur actuel
    const { userId } = await getCurrentUser()
    console.log('👤 Utilisateur connecté:', userId)

    // 2. Lister tous les vétérinaires
    console.log('\n📋 Liste des vétérinaires:')
    const vetsResponse = await client.graphql({
      query: listVeterinarians,
      authMode: 'userPool',
    })
    console.log(vetsResponse.data.listVeterinarians.items)

    // 3. Lister toutes les cliniques
    console.log('\n🏥 Liste des cliniques:')
    const clinicsResponse = await client.graphql({
      query: listClinics,
      authMode: 'userPool',
    })
    console.log(clinicsResponse.data.listClinics.items)

    // 4. Vérifier si l'utilisateur actuel a un profil vétérinaire
    const userVet = vetsResponse.data.listVeterinarians.items.find((vet) => vet.id === userId)
    if (userVet) {
      console.log("\n✅ Profil vétérinaire trouvé pour l'utilisateur:", userVet)
    } else {
      console.log("\n❌ PROBLÈME: Aucun profil vétérinaire trouvé pour l'utilisateur:", userId)
      console.log('💡 SOLUTION: Il faut créer un profil vétérinaire pour cet utilisateur')
    }
  } catch (error) {
    console.error('❌ Erreur lors du débogage:', error)
  }
}

// Exporter pour utilisation dans la console du navigateur
window.debugData = debugData

console.log(
  '🔧 Script de débogage chargé. Tapez "debugData()" dans la console pour analyser les données.',
)
