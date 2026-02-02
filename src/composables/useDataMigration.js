import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { createVeterinarian, updateVeterinarian, deleteVeterinarian } from '@/graphql/mutations'

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

// Requête pour récupérer un vétérinaire par ID
const getVeterinarian = /* GraphQL */ `
  query GetVeterinarian($id: ID!) {
    getVeterinarian(id: $id) {
      id
      firstname
      lastname
      email
      clinicID
    }
  }
`

export function useDataMigration() {
  const migrateVeterinarianData = async () => {
    try {
      console.log('=== MIGRATION DES DONNÉES VÉTÉRINAIRE ===')

      // 1. Récupérer l'utilisateur actuel
      const { userId } = await getCurrentUser()
      console.log('👤 Utilisateur connecté:', userId)

      // 2. Vérifier si un profil existe déjà avec l'ID Cognito
      console.log('\n🔍 Vérification du profil existant avec ID Cognito...')
      try {
        const existingVetResponse = await client.graphql({
          query: getVeterinarian,
          variables: { id: userId },
          authMode: 'userPool',
        })

        if (existingVetResponse.data.getVeterinarian) {
          console.log(
            '✅ Profil vétérinaire déjà existant avec ID Cognito:',
            existingVetResponse.data.getVeterinarian,
          )
          return {
            success: true,
            action: 'already_exists',
            vet: existingVetResponse.data.getVeterinarian,
          }
        }
      } catch (error) {
        console.log('ℹ️ Aucun profil trouvé avec ID Cognito (normal si première migration)')
      }

      // 3. Lister tous les vétérinaires pour trouver un profil existant
      console.log('\n📋 Recherche de profils vétérinaires existants...')
      const vetsResponse = await client.graphql({
        query: listVeterinarians,
        authMode: 'userPool',
      })

      const existingVets = vetsResponse.data.listVeterinarians.items
      console.log(`Trouvé ${existingVets.length} profil(s) vétérinaire(s):`, existingVets)

      if (existingVets.length === 0) {
        console.log('❌ Aucun profil vétérinaire trouvé dans la base de données')
        console.log("💡 Vous devez d'abord créer un profil vétérinaire")
        return { success: false, action: 'no_data', message: 'Aucun profil vétérinaire trouvé' }
      }

      // 4. Si il y a exactement un profil, on peut le migrer
      if (existingVets.length === 1) {
        const existingVet = existingVets[0]
        console.log('\n🔄 Migration du profil existant:', existingVet)

        // Créer un nouveau profil avec l'ID Cognito
        const newVetInput = {
          id: userId, // Utiliser l'ID Cognito
          firstname: existingVet.firstname,
          lastname: existingVet.lastname,
          email: existingVet.email,
          clinicID: existingVet.clinicID,
        }

        console.log('📝 Création du nouveau profil avec ID Cognito...')
        const newVetResponse = await client.graphql({
          query: createVeterinarian,
          variables: { input: newVetInput },
          authMode: 'userPool',
        })

        console.log('✅ Nouveau profil créé:', newVetResponse.data.createVeterinarian)

        // Supprimer l'ancien profil
        console.log("🗑️ Suppression de l'ancien profil...")
        await client.graphql({
          query: deleteVeterinarian,
          variables: { input: { id: existingVet.id } },
          authMode: 'userPool',
        })

        console.log('✅ Ancien profil supprimé')
        console.log('🎉 MIGRATION RÉUSSIE!')

        return {
          success: true,
          action: 'migrated',
          oldId: existingVet.id,
          newId: userId,
          vet: newVetResponse.data.createVeterinarian,
        }
      }

      // 5. Si plusieurs profils, demander à l'utilisateur de choisir
      if (existingVets.length > 1) {
        console.log('⚠️ Plusieurs profils vétérinaires trouvés. Migration manuelle requise.')
        console.log('Profils disponibles:', existingVets)
        return {
          success: false,
          action: 'multiple_profiles',
          profiles: existingVets,
          message: 'Plusieurs profils trouvés, migration manuelle requise',
        }
      }
    } catch (error) {
      console.error('❌ Erreur lors de la migration:', error)
      if (error.errors) {
        error.errors.forEach((err) => {
          console.error('- ', err.message)
        })
      }
      throw error
    }
  }

  const createVeterinarianProfile = async (profileData) => {
    try {
      console.log('=== CRÉATION DU PROFIL VÉTÉRINAIRE ===')

      const { userId } = await getCurrentUser()
      console.log('👤 Utilisateur connecté:', userId)

      const vetInput = {
        id: userId, // Utiliser l'ID Cognito
        firstname: profileData.firstname,
        lastname: profileData.lastname,
        email: profileData.email,
        clinicID: profileData.clinicID,
      }

      console.log('📝 Création du profil vétérinaire...')
      const vetResponse = await client.graphql({
        query: createVeterinarian,
        variables: { input: vetInput },
        authMode: 'userPool',
      })

      console.log('✅ Profil vétérinaire créé:', vetResponse.data.createVeterinarian)
      return { success: true, vet: vetResponse.data.createVeterinarian }
    } catch (error) {
      console.error('❌ Erreur lors de la création du profil:', error)
      if (error.errors) {
        error.errors.forEach((err) => {
          console.error('- ', err.message)
        })
      }
      throw error
    }
  }

  return {
    migrateVeterinarianData,
    createVeterinarianProfile,
  }
}

// Exposer globalement pour la console du navigateur
if (typeof window !== 'undefined') {
  const { migrateVeterinarianData, createVeterinarianProfile } = useDataMigration()
  window.migrateVeterinarianData = migrateVeterinarianData
  window.createVeterinarianProfile = createVeterinarianProfile
  console.log(
    '🔧 Fonctions de migration disponibles: migrateVeterinarianData() et createVeterinarianProfile()',
  )
}
