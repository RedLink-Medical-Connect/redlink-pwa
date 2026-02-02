import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { createClinic, createVeterinarian } from '@/graphql/mutations'

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
          address
          hasEmergencyService
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
        transfusionsDone
        donorOwnersCount
      }
    }
  }
`

export function useDebugData() {
  const debugData = async () => {
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
        return { hasVet: true, vet: userVet, clinics: clinicsResponse.data.listClinics.items }
      } else {
        console.log("\n❌ PROBLÈME: Aucun profil vétérinaire trouvé pour l'utilisateur:", userId)
        console.log('💡 SOLUTION: Il faut créer un profil vétérinaire pour cet utilisateur')
        return { hasVet: false, userId, clinics: clinicsResponse.data.listClinics.items }
      }
    } catch (error) {
      console.error('❌ Erreur lors du débogage:', error)
      throw error
    }
  }

  const createTestData = async () => {
    try {
      console.log('=== CRÉATION DES DONNÉES DE TEST ===')

      const { userId } = await getCurrentUser()
      console.log('👤 Utilisateur connecté:', userId)

      // 1. Créer une clinique de test
      console.log("\n🏥 Création d'une clinique de test...")
      const clinicInput = {
        name: 'Clinique Vétérinaire de Test',
        rpps: '12345678901',
        email: 'test@clinique.fr',
        phone: '+33123456789',
        address: '123 Rue de Test, 75001 Paris',
        latitude: 48.8566,
        longitude: 2.3522,
        hasEmergencyService: true,
        transfusionsDone: 0,
        donorOwnersCount: 0,
      }

      const clinicResponse = await client.graphql({
        query: createClinic,
        variables: { input: clinicInput },
        authMode: 'userPool',
      })

      const clinicId = clinicResponse.data.createClinic.id
      console.log("✅ Clinique créée avec l'ID:", clinicId)

      // 2. Créer un profil vétérinaire pour l'utilisateur actuel
      console.log('\n👨‍⚕️ Création du profil vétérinaire...')
      const vetInput = {
        id: userId, // Utiliser l'ID de l'utilisateur connecté
        firstname: 'Dr. Jean',
        lastname: 'Dupont',
        email: 'jean.dupont@test.fr',
        clinicID: clinicId,
      }

      const vetResponse = await client.graphql({
        query: createVeterinarian,
        variables: { input: vetInput },
        authMode: 'userPool',
      })

      console.log('✅ Profil vétérinaire créé:', vetResponse.data.createVeterinarian)

      console.log('\n🎉 DONNÉES DE TEST CRÉÉES AVEC SUCCÈS!')
      console.log('Vous pouvez maintenant recharger la page des paramètres.')

      return { success: true, clinicId, vetId: userId }
    } catch (error) {
      console.error('❌ Erreur lors de la création des données de test:', error)

      if (error.errors) {
        error.errors.forEach((err) => {
          console.error('- ', err.message)
        })
      }
      throw error
    }
  }

  return {
    debugData,
    createTestData,
  }
}

// Exposer globalement pour la console du navigateur
if (typeof window !== 'undefined') {
  const { debugData, createTestData } = useDebugData()
  window.debugData = debugData
  window.createTestData = createTestData
  console.log('🔧 Fonctions de débogage disponibles: debugData() et createTestData()')
}
