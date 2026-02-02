// Script pour créer des données de test
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { createClinicSimple, createVeterinarianSimple } from './src/graphql/custom-mutations.js'

const client = generateClient()

async function createTestData() {
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
      query: createClinicSimple,
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
      query: createVeterinarianSimple,
      variables: { input: vetInput },
      authMode: 'userPool',
    })

    console.log('✅ Profil vétérinaire créé:', vetResponse.data.createVeterinarian)

    console.log('\n🎉 DONNÉES DE TEST CRÉÉES AVEC SUCCÈS!')
    console.log('Vous pouvez maintenant recharger la page des paramètres.')
  } catch (error) {
    console.error('❌ Erreur lors de la création des données de test:', error)

    if (error.errors) {
      error.errors.forEach((err) => {
        console.error('- ', err.message)
      })
    }
  }
}

// Exporter pour utilisation dans la console du navigateur
window.createTestData = createTestData

console.log(
  '🔧 Script de création de données chargé. Tapez "createTestData()" dans la console pour créer des données de test.',
)
