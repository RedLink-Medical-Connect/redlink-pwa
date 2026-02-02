/**
 * Script de migration des données vétérinaire
 *
 * Ce script permet de migrer les profils vétérinaires existants
 * pour utiliser l'ID Cognito comme ID principal.
 *
 * Usage:
 * 1. Ouvrir la console du navigateur sur l'application
 * 2. Exécuter: migrateVeterinarianData()
 * 3. Suivre les instructions affichées
 */

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
      }
    }
  }
`

async function analyzeCurrentData() {
  try {
    console.log('=== ANALYSE DES DONNÉES ACTUELLES ===')

    // 1. Utilisateur actuel
    const { userId } = await getCurrentUser()
    console.log('👤 Utilisateur connecté:', userId)

    // 2. Lister tous les vétérinaires
    const vetsResponse = await client.graphql({
      query: listVeterinarians,
      authMode: 'userPool',
    })
    const vets = vetsResponse.data.listVeterinarians.items
    console.log(`\n📋 ${vets.length} vétérinaire(s) trouvé(s):`)
    vets.forEach((vet, index) => {
      console.log(`${index + 1}. ID: ${vet.id}`)
      console.log(`   Nom: ${vet.firstname} ${vet.lastname}`)
      console.log(`   Email: ${vet.email}`)
      console.log(`   Clinique: ${vet.clinic?.name || 'Non associée'}`)
      console.log(`   ID Clinique: ${vet.clinicID}`)
      console.log('')
    })

    // 3. Lister toutes les cliniques
    const clinicsResponse = await client.graphql({
      query: listClinics,
      authMode: 'userPool',
    })
    const clinics = clinicsResponse.data.listClinics.items
    console.log(`🏥 ${clinics.length} clinique(s) trouvée(s):`)
    clinics.forEach((clinic, index) => {
      console.log(`${index + 1}. ID: ${clinic.id}`)
      console.log(`   Nom: ${clinic.name}`)
      console.log(`   Email: ${clinic.email}`)
      console.log(`   RPPS: ${clinic.rpps}`)
      console.log('')
    })

    // 4. Vérifier la correspondance
    const userVet = vets.find((vet) => vet.id === userId)
    if (userVet) {
      console.log('✅ PARFAIT: Un profil vétérinaire existe déjà avec votre ID Cognito')
      console.log('Aucune migration nécessaire.')
      return { needsMigration: false, userVet, vets, clinics }
    } else {
      console.log('⚠️ PROBLÈME: Aucun profil vétérinaire avec votre ID Cognito')
      console.log('Migration nécessaire.')
      return { needsMigration: true, userId, vets, clinics }
    }
  } catch (error) {
    console.error("❌ Erreur lors de l'analyse:", error)
    throw error
  }
}

// Exposer la fonction globalement
if (typeof window !== 'undefined') {
  window.analyzeCurrentData = analyzeCurrentData
  console.log("🔧 Fonction d'analyse disponible: analyzeCurrentData()")
}

export { analyzeCurrentData }
