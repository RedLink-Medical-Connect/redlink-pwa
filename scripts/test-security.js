#!/usr/bin/env node

/**
 * Script de test de sécurité GraphQL
 * Valide les nouvelles règles d'autorisation
 */

import { Amplify } from 'aws-amplify'
import { generateClient } from 'aws-amplify/api'
import { signIn, signOut } from 'aws-amplify/auth'
import awsConfig from '../src/config/aws-config.js'

// Configuration Amplify
Amplify.configure(awsConfig)

const client = generateClient()

// Couleurs pour les logs
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
}

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

// Tests de sécurité
const securityTests = [
  {
    name: 'Test Accès Public - Info Clinique',
    test: async () => {
      const query = `
        query GetClinicPublic($id: ID!) {
          getClinic(id: $id) {
            id
            name
            address
            rpps
            email
          }
        }
      `

      try {
        const { data } = await client.graphql({
          query,
          variables: { id: 'test-clinic-id' },
          authMode: 'apiKey',
        })

        // Vérifier que les données sensibles sont protégées
        if (data.getClinic.rpps === null && data.getClinic.email === null) {
          return { success: true, message: 'Données sensibles correctement protégées' }
        } else {
          return { success: false, message: 'FAILLE: Données sensibles exposées' }
        }
      } catch (error) {
        return { success: true, message: 'Accès correctement bloqué' }
      }
    },
  },

  {
    name: 'Test Propriétaire - Accès Animaux',
    test: async () => {
      try {
        await signIn({
          username: process.env.TEST_OWNER_EMAIL,
          password: process.env.TEST_OWNER_PASSWORD,
        })

        const query = `
          query ListMyAnimals {
            listAnimals {
              items {
                id
                name
                ownerID
              }
            }
          }
        `

        const { data } = await client.graphql({
          query,
          authMode: 'userPool',
        })

        await signOut()

        if (data.listAnimals.items) {
          return {
            success: true,
            message: `Accès autorisé - ${data.listAnimals.items.length} animaux`,
          }
        } else {
          return { success: false, message: 'Accès refusé incorrectement' }
        }
      } catch (error) {
        await signOut()
        return { success: false, message: `Erreur: ${error.message}` }
      }
    },
  },

  {
    name: 'Test Vétérinaire - Création Demande',
    test: async () => {
      try {
        await signIn({
          username: process.env.TEST_VET_EMAIL,
          password: process.env.TEST_VET_PASSWORD,
        })

        const mutation = `
          mutation CreateTestRequest($input: CreateRequestInput!) {
            createRequest(input: $input) {
              id
              status
              requestType
            }
          }
        `

        const { data } = await client.graphql({
          query: mutation,
          variables: {
            input: {
              requestType: 'EMERGENCY',
              requiredSpecies: 'DOG',
              requiredBloodGroup: 'DEA 1.1+',
              quantity: 1,
              clinicID: 'test-clinic-id',
              status: 'OPEN',
            },
          },
          authMode: 'userPool',
        })

        await signOut()

        if (data.createRequest.id) {
          return { success: true, message: `Demande créée: ${data.createRequest.id}` }
        } else {
          return { success: false, message: 'Création échouée' }
        }
      } catch (error) {
        await signOut()
        return { success: false, message: `Erreur: ${error.message}` }
      }
    },
  },

  {
    name: 'Test Cross-Access - Propriétaire vs Demandes',
    test: async () => {
      try {
        await signIn({
          username: process.env.TEST_OWNER_EMAIL,
          password: process.env.TEST_OWNER_PASSWORD,
        })

        const mutation = `
          mutation CreateUnauthorizedRequest($input: CreateRequestInput!) {
            createRequest(input: $input) {
              id
            }
          }
        `

        const { data } = await client.graphql({
          query: mutation,
          variables: {
            input: {
              requestType: 'EMERGENCY',
              requiredSpecies: 'DOG',
              requiredBloodGroup: 'DEA 1.1+',
              quantity: 1,
              clinicID: 'unauthorized-clinic-id',
              status: 'OPEN',
            },
          },
          authMode: 'userPool',
        })

        await signOut()

        // Si on arrive ici, c'est une faille de sécurité
        return { success: false, message: 'FAILLE: Propriétaire peut créer des demandes' }
      } catch (error) {
        await signOut()
        return { success: true, message: 'Accès correctement bloqué' }
      }
    },
  },
]

// Exécution des tests
async function runSecurityTests() {
  log('blue', '🔒 DÉMARRAGE DES TESTS DE SÉCURITÉ GRAPHQL')
  log('blue', '='.repeat(50))

  let passed = 0
  let failed = 0

  for (const testCase of securityTests) {
    log('yellow', `\n🧪 ${testCase.name}`)

    try {
      const result = await testCase.test()

      if (result.success) {
        log('green', `✅ SUCCÈS: ${result.message}`)
        passed++
      } else {
        log('red', `❌ ÉCHEC: ${result.message}`)
        failed++
      }
    } catch (error) {
      log('red', `💥 ERREUR: ${error.message}`)
      failed++
    }
  }

  log('blue', '\n' + '='.repeat(50))
  log('blue', '📊 RÉSULTATS DES TESTS')
  log('green', `✅ Tests réussis: ${passed}`)
  log('red', `❌ Tests échoués: ${failed}`)

  if (failed === 0) {
    log('green', '🎉 TOUS LES TESTS DE SÉCURITÉ SONT PASSÉS!')
    process.exit(0)
  } else {
    log('red', '⚠️  CERTAINS TESTS ONT ÉCHOUÉ - VÉRIFIER LA SÉCURITÉ')
    process.exit(1)
  }
}

// Gestion des erreurs
process.on('unhandledRejection', (error) => {
  log('red', `💥 Erreur non gérée: ${error.message}`)
  process.exit(1)
})

// Lancement des tests
runSecurityTests().catch((error) => {
  log('red', `💥 Erreur fatale: ${error.message}`)
  process.exit(1)
})
