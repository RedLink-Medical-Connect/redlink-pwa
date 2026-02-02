#!/usr/bin/env node

/**
 * Script de test pour valider le système de pagination GraphQL
 * Teste les performances et la fonctionnalité de la pagination
 */

import { generateClient } from 'aws-amplify/api'
import { Amplify } from 'aws-amplify'
import { listOpenRequestsForMatching } from '../src/graphql/paginated-queries.js'

// Configuration Amplify (utilise les variables d'environnement)
const amplifyConfig = {
  aws_project_region: process.env.VITE_AWS_REGION || 'eu-west-3',
  aws_cognito_region: process.env.VITE_AWS_REGION || 'eu-west-3',
  aws_user_pools_id: process.env.VITE_USER_POOL_ID,
  aws_user_pools_web_client_id: process.env.VITE_USER_POOL_CLIENT_ID,
  aws_appsync_graphqlEndpoint: process.env.VITE_GRAPHQL_ENDPOINT,
  aws_appsync_region: process.env.VITE_AWS_REGION || 'eu-west-3',
  aws_appsync_authenticationType: 'AMAZON_COGNITO_USER_POOLS',
}

Amplify.configure(amplifyConfig)

const client = generateClient()

/**
 * Test de pagination basique
 */
async function testBasicPagination() {
  console.log('🧪 Test de pagination basique...')

  try {
    const startTime = Date.now()

    // Premier appel avec limite
    const { data } = await client.graphql({
      query: listOpenRequestsForMatching,
      variables: {
        limit: 5,
        filter: {
          status: { eq: 'OPEN' },
        },
      },
      authMode: 'apiKey', // Utiliser API Key pour les tests
    })

    const endTime = Date.now()
    const duration = endTime - startTime

    console.log(`✅ Première page chargée en ${duration}ms`)
    console.log(`📊 Nombre d'éléments: ${data.listRequests.items.length}`)
    console.log(`🔗 NextToken présent: ${!!data.listRequests.nextToken}`)

    // Test de la deuxième page si nextToken existe
    if (data.listRequests.nextToken) {
      console.log('\n🧪 Test de la deuxième page...')

      const startTime2 = Date.now()

      const { data: data2 } = await client.graphql({
        query: listOpenRequestsForMatching,
        variables: {
          limit: 5,
          nextToken: data.listRequests.nextToken,
          filter: {
            status: { eq: 'OPEN' },
          },
        },
        authMode: 'apiKey',
      })

      const endTime2 = Date.now()
      const duration2 = endTime2 - startTime2

      console.log(`✅ Deuxième page chargée en ${duration2}ms`)
      console.log(`📊 Nombre d'éléments: ${data2.listRequests.items.length}`)
      console.log(`🔗 NextToken présent: ${!!data2.listRequests.nextToken}`)
    }

    return true
  } catch (error) {
    console.error('❌ Erreur test pagination:', error)
    return false
  }
}

/**
 * Test de performance avec différentes tailles de page
 */
async function testPerformance() {
  console.log('\n🚀 Test de performance...')

  const pageSizes = [5, 10, 20, 50]

  for (const pageSize of pageSizes) {
    try {
      const startTime = Date.now()

      const { data } = await client.graphql({
        query: listOpenRequestsForMatching,
        variables: {
          limit: pageSize,
          filter: {
            status: { eq: 'OPEN' },
          },
        },
        authMode: 'apiKey',
      })

      const endTime = Date.now()
      const duration = endTime - startTime

      console.log(
        `📄 Page size ${pageSize}: ${duration}ms (${data.listRequests.items.length} items)`,
      )

      // Vérifier que la performance reste acceptable
      if (duration > 2000) {
        console.warn(`⚠️  Performance dégradée pour page size ${pageSize}: ${duration}ms`)
      }
    } catch (error) {
      console.error(`❌ Erreur pour page size ${pageSize}:`, error.message)
    }
  }
}

/**
 * Test de filtrage avec pagination
 */
async function testFilteredPagination() {
  console.log('\n🔍 Test de filtrage avec pagination...')

  const filters = [
    { requestType: { eq: 'EMERGENCY' } },
    { requiredSpecies: { eq: 'DOG' } },
    { requiredSpecies: { eq: 'CAT' } },
  ]

  for (const filter of filters) {
    try {
      const startTime = Date.now()

      const { data } = await client.graphql({
        query: listOpenRequestsForMatching,
        variables: {
          limit: 10,
          filter: {
            status: { eq: 'OPEN' },
            ...filter,
          },
        },
        authMode: 'apiKey',
      })

      const endTime = Date.now()
      const duration = endTime - startTime

      console.log(
        `🔍 Filtre ${JSON.stringify(filter)}: ${duration}ms (${data.listRequests.items.length} items)`,
      )
    } catch (error) {
      console.error(`❌ Erreur pour filtre ${JSON.stringify(filter)}:`, error.message)
    }
  }
}

/**
 * Test de validation des données
 */
async function testDataValidation() {
  console.log('\n✅ Test de validation des données...')

  try {
    const { data } = await client.graphql({
      query: listOpenRequestsForMatching,
      variables: {
        limit: 5,
        filter: {
          status: { eq: 'OPEN' },
        },
      },
      authMode: 'apiKey',
    })

    const items = data.listRequests.items

    if (items.length === 0) {
      console.log('ℹ️  Aucune donnée à valider (liste vide)')
      return true
    }

    // Vérifier la structure des données
    const firstItem = items[0]
    const requiredFields = [
      'id',
      'requestType',
      'requiredSpecies',
      'requiredBloodGroup',
      'status',
      'createdAt',
    ]

    for (const field of requiredFields) {
      if (!(field in firstItem)) {
        console.error(`❌ Champ manquant: ${field}`)
        return false
      }
    }

    // Vérifier les valeurs enum
    const validRequestTypes = ['EMERGENCY', 'APPOINTMENT']
    const validSpecies = ['DOG', 'CAT']
    const validStatuses = ['OPEN', 'MATCHED', 'COMPLETED', 'CANCELLED']

    for (const item of items) {
      if (!validRequestTypes.includes(item.requestType)) {
        console.error(`❌ RequestType invalide: ${item.requestType}`)
        return false
      }

      if (!validSpecies.includes(item.requiredSpecies)) {
        console.error(`❌ Species invalide: ${item.requiredSpecies}`)
        return false
      }

      if (!validStatuses.includes(item.status)) {
        console.error(`❌ Status invalide: ${item.status}`)
        return false
      }
    }

    console.log('✅ Validation des données réussie')
    return true
  } catch (error) {
    console.error('❌ Erreur validation données:', error)
    return false
  }
}

/**
 * Fonction principale
 */
async function main() {
  console.log('🧪 TESTS DE PAGINATION GRAPHQL')
  console.log('================================\n')

  const results = {
    basicPagination: await testBasicPagination(),
    performance: await testPerformance(),
    filteredPagination: await testFilteredPagination(),
    dataValidation: await testDataValidation(),
  }

  console.log('\n📊 RÉSULTATS DES TESTS')
  console.log('======================')

  Object.entries(results).forEach(([test, success]) => {
    console.log(`${success ? '✅' : '❌'} ${test}: ${success ? 'RÉUSSI' : 'ÉCHEC'}`)
  })

  const allPassed = Object.values(results).every((result) => result)

  console.log(
    `\n🎯 RÉSULTAT GLOBAL: ${allPassed ? '✅ TOUS LES TESTS RÉUSSIS' : '❌ CERTAINS TESTS ONT ÉCHOUÉ'}`,
  )

  process.exit(allPassed ? 0 : 1)
}

// Exécution
main().catch((error) => {
  console.error('💥 Erreur fatale:', error)
  process.exit(1)
})
