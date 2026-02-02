/**
 * Tests de sécurité pour les règles d'autorisation GraphQL
 * Phase 1 Sprint 1.2 - Validation des nouvelles règles @auth
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateClient } from 'aws-amplify/api'
import { signIn, signOut } from 'aws-amplify/auth'

// Requêtes de test
const GET_CLINIC_PUBLIC = `
  query GetClinicPublic($id: ID!) {
    getClinic(id: $id) {
      id
      name
      address
      hasEmergencyService
      rpps
      email
      phone
    }
  }
`

const LIST_MY_ANIMALS = `
  query ListMyAnimals($filter: ModelAnimalFilterInput) {
    listAnimals(filter: $filter) {
      items {
        id
        name
        species
        ownerID
      }
    }
  }
`

const CREATE_REQUEST = `
  mutation CreateRequest($input: CreateRequestInput!) {
    createRequest(input: $input) {
      id
      requestType
      status
      clinicID
    }
  }
`

describe('🔒 Tests de Sécurité GraphQL', () => {
  let client

  beforeEach(() => {
    client = generateClient()
  })

  describe('👤 Accès Public (Non Authentifié)', () => {
    it('devrait permettre la lecture des infos publiques de clinique', async () => {
      const { data } = await client.graphql({
        query: GET_CLINIC_PUBLIC,
        variables: { id: 'test-clinic-id' },
        authMode: 'apiKey', // Mode public
      })

      // Les infos publiques doivent être accessibles
      expect(data.getClinic.name).toBeDefined()
      expect(data.getClinic.address).toBeDefined()
      expect(data.getClinic.hasEmergencyService).toBeDefined()

      // Les données sensibles doivent être null ou undefined
      expect(data.getClinic.rpps).toBeNull()
      expect(data.getClinic.email).toBeNull()
      expect(data.getClinic.phone).toBeNull()
    })

    it("devrait interdire l'accès aux animaux sans authentification", async () => {
      await expect(
        client.graphql({
          query: LIST_MY_ANIMALS,
          authMode: 'apiKey',
        }),
      ).rejects.toThrow()
    })
  })

  describe("🐾 Propriétaire d'Animal (Owner)", () => {
    beforeEach(async () => {
      // Connexion en tant que propriétaire
      await signIn({
        username: process.env.TEST_OWNER_EMAIL,
        password: process.env.TEST_OWNER_PASSWORD,
      })
    })

    afterEach(async () => {
      await signOut()
    })

    it('devrait permettre la lecture de ses propres animaux', async () => {
      const { data } = await client.graphql({
        query: LIST_MY_ANIMALS,
        variables: {
          filter: { ownerID: { eq: 'current-user-id' } },
        },
        authMode: 'userPool',
      })

      expect(data.listAnimals.items).toBeDefined()
      // Tous les animaux retournés doivent appartenir à l'utilisateur
      data.listAnimals.items.forEach((animal) => {
        expect(animal.ownerID).toBe('current-user-id')
      })
    })

    it("devrait interdire la lecture des animaux d'autres propriétaires", async () => {
      await expect(
        client.graphql({
          query: LIST_MY_ANIMALS,
          variables: {
            filter: { ownerID: { eq: 'other-user-id' } },
          },
          authMode: 'userPool',
        }),
      ).rejects.toThrow()
    })

    it('devrait permettre la lecture des demandes ouvertes (pour matching)', async () => {
      const LIST_OPEN_REQUESTS = `
        query ListOpenRequests {
          listRequests(filter: { status: { eq: OPEN } }) {
            items {
              id
              requestType
              requiredSpecies
              requiredBloodGroup
              status
            }
          }
        }
      `

      const { data } = await client.graphql({
        query: LIST_OPEN_REQUESTS,
        authMode: 'userPool',
      })

      expect(data.listRequests.items).toBeDefined()
      // Toutes les demandes doivent être ouvertes
      data.listRequests.items.forEach((request) => {
        expect(request.status).toBe('OPEN')
      })
    })

    it('devrait interdire la création de demandes (réservé aux vétérinaires)', async () => {
      await expect(
        client.graphql({
          query: CREATE_REQUEST,
          variables: {
            input: {
              requestType: 'EMERGENCY',
              requiredSpecies: 'DOG',
              requiredBloodGroup: 'DEA 1.1+',
              quantity: 1,
              clinicID: 'test-clinic-id',
            },
          },
          authMode: 'userPool',
        }),
      ).rejects.toThrow()
    })
  })

  describe('👨‍⚕️ Vétérinaire (Vet)', () => {
    beforeEach(async () => {
      // Connexion en tant que vétérinaire
      await signIn({
        username: process.env.TEST_VET_EMAIL,
        password: process.env.TEST_VET_PASSWORD,
      })
    })

    afterEach(async () => {
      await signOut()
    })

    it('devrait permettre la lecture de tous les animaux (pour matching)', async () => {
      const { data } = await client.graphql({
        query: LIST_MY_ANIMALS,
        authMode: 'userPool',
      })

      expect(data.listAnimals.items).toBeDefined()
      expect(Array.isArray(data.listAnimals.items)).toBe(true)
    })

    it('devrait permettre la création de demandes pour sa clinique', async () => {
      const { data } = await client.graphql({
        query: CREATE_REQUEST,
        variables: {
          input: {
            requestType: 'EMERGENCY',
            requiredSpecies: 'DOG',
            requiredBloodGroup: 'DEA 1.1+',
            quantity: 1,
            clinicID: 'vet-clinic-id', // ID de la clinique du vétérinaire
          },
        },
        authMode: 'userPool',
      })

      expect(data.createRequest.id).toBeDefined()
      expect(data.createRequest.status).toBe('OPEN')
      expect(data.createRequest.clinicID).toBe('vet-clinic-id')
    })

    it("devrait interdire la création de demandes pour d'autres cliniques", async () => {
      await expect(
        client.graphql({
          query: CREATE_REQUEST,
          variables: {
            input: {
              requestType: 'EMERGENCY',
              requiredSpecies: 'DOG',
              requiredBloodGroup: 'DEA 1.1+',
              quantity: 1,
              clinicID: 'other-clinic-id', // Clinique d'un autre vétérinaire
            },
          },
          authMode: 'userPool',
        }),
      ).rejects.toThrow()
    })

    it('devrait permettre la lecture des propriétaires sans données sensibles', async () => {
      const LIST_OWNERS = `
        query ListOwners {
          listOwners {
            items {
              id
              firstname
              lastname
              address
              email
              phone
            }
          }
        }
      `

      const { data } = await client.graphql({
        query: LIST_OWNERS,
        authMode: 'userPool',
      })

      expect(data.listOwners.items).toBeDefined()
      // Les données sensibles doivent être exclues
      data.listOwners.items.forEach((owner) => {
        expect(owner.firstname).toBeDefined()
        expect(owner.lastname).toBeDefined()
        expect(owner.address).toBeDefined()
        expect(owner.email).toBeNull() // Exclu par excludeFields
        expect(owner.phone).toBeNull() // Exclu par excludeFields
      })
    })
  })

  describe('🔄 Tests de Mutation Cross-Entity', () => {
    it("devrait empêcher la modification d'entités non possédées", async () => {
      // Connexion propriétaire
      await signIn({
        username: process.env.TEST_OWNER_EMAIL,
        password: process.env.TEST_OWNER_PASSWORD,
      })

      const UPDATE_OTHER_ANIMAL = `
        mutation UpdateOtherAnimal($input: UpdateAnimalInput!) {
          updateAnimal(input: $input) {
            id
            name
          }
        }
      `

      await expect(
        client.graphql({
          query: UPDATE_OTHER_ANIMAL,
          variables: {
            input: {
              id: 'other-owner-animal-id',
              name: 'Hacked Name',
            },
          },
          authMode: 'userPool',
        }),
      ).rejects.toThrow()

      await signOut()
    })
  })

  describe('📊 Tests de Performance Sécurité', () => {
    it('devrait limiter les requêtes trop larges', async () => {
      await signIn({
        username: process.env.TEST_VET_EMAIL,
        password: process.env.TEST_VET_PASSWORD,
      })

      const LARGE_QUERY = `
        query LargeQuery {
          listAnimals(limit: 10000) {
            items {
              id
              name
              species
              breed
              weight
              bloodGroup
              ownerProfile {
                firstname
                lastname
                address
                animals {
                  items {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      `

      const startTime = Date.now()

      try {
        await client.graphql({
          query: LARGE_QUERY,
          authMode: 'userPool',
        })
      } catch (error) {
        // La requête peut échouer ou être limitée
        console.log('Requête large bloquée ou limitée:', error.message)
      }

      const duration = Date.now() - startTime

      // La requête ne doit pas prendre plus de 5 secondes
      expect(duration).toBeLessThan(5000)

      await signOut()
    })
  })
})

/**
 * Tests d'intégration pour les règles d'autorisation
 */
describe("🔗 Tests d'Intégration Autorisation", () => {
  it('devrait maintenir la cohérence des données lors des opérations CRUD', async () => {
    // Test complet du cycle de vie d'une mission

    // 1. Vétérinaire crée une demande
    await signIn({
      username: process.env.TEST_VET_EMAIL,
      password: process.env.TEST_VET_PASSWORD,
    })

    const client = generateClient()

    const { data: requestData } = await client.graphql({
      query: CREATE_REQUEST,
      variables: {
        input: {
          requestType: 'EMERGENCY',
          requiredSpecies: 'DOG',
          requiredBloodGroup: 'DEA 1.1+',
          quantity: 1,
          clinicID: 'test-clinic-id',
        },
      },
      authMode: 'userPool',
    })

    expect(requestData.createRequest.id).toBeDefined()
    const requestId = requestData.createRequest.id

    await signOut()

    // 2. Propriétaire accepte la mission
    await signIn({
      username: process.env.TEST_OWNER_EMAIL,
      password: process.env.TEST_OWNER_PASSWORD,
    })

    const CREATE_MISSION = `
      mutation CreateMission($input: CreateMissionInput!) {
        createMission(input: $input) {
          id
          status
          requestID
          animalID
        }
      }
    `

    const { data: missionData } = await client.graphql({
      query: CREATE_MISSION,
      variables: {
        input: {
          requestID: requestId,
          animalID: 'owner-animal-id',
          status: 'ACCEPTED',
        },
      },
      authMode: 'userPool',
    })

    expect(missionData.createMission.id).toBeDefined()
    expect(missionData.createMission.status).toBe('ACCEPTED')

    await signOut()

    // 3. Vérifier que les données sont cohérentes
    await signIn({
      username: process.env.TEST_VET_EMAIL,
      password: process.env.TEST_VET_PASSWORD,
    })

    const GET_REQUEST_WITH_MISSION = `
      query GetRequestWithMission($id: ID!) {
        getRequest(id: $id) {
          id
          status
          mission {
            id
            status
            animal {
              id
              name
            }
          }
        }
      }
    `

    const { data: verifyData } = await client.graphql({
      query: GET_REQUEST_WITH_MISSION,
      variables: { id: requestId },
      authMode: 'userPool',
    })

    expect(verifyData.getRequest.mission).toBeDefined()
    expect(verifyData.getRequest.mission.status).toBe('ACCEPTED')

    await signOut()
  })
})
