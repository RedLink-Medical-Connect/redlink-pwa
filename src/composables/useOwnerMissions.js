import { computed, ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { listMyAnimalsMissions, listMyAnimalsSimple } from '@/graphql/custom-queries'
import { createMissionSimple, linkRequestToMission } from '@/graphql/custom-mutations'
import { listOpenRequestsForMatching } from '@/graphql/paginated-queries'
import { useCachedPagination, useCachedGraphQL } from '@/composables/useCachedGraphQL'

export function useOwnerMissions() {
  const client = generateClient()
  const { mutate, invalidateCache } = useCachedGraphQL()

  // Utiliser la pagination avec cache pour les missions disponibles
  const pagination = useCachedPagination()

  const myMissions = ref([])
  const isLoading = ref(false)
  const isAccepting = ref(false)

  // Configuration de la requête paginée
  const paginationConfig = {
    query: listOpenRequestsForMatching,
    variables: {
      filter: {
        status: { eq: 'OPEN' },
      },
      limit: 10,
    },
    authMode: 'userPool',
    useCache: true,
  }

  // --- FETCH AVAILABLE ---
  const fetchAvailableMissions = async () => {
    try {
      // Simulation pour le dev
      if (import.meta.env.DEV) {
        console.log('🧪 Mode développement: missions simulées')
        await new Promise((resolve) => setTimeout(resolve, 800))
        const mockMissions = [
          {
            id: 'demo-mission-1',
            requestType: 'EMERGENCY',
            requiredSpecies: 'DOG',
            requiredBloodGroup: 'DEA 1.1+',
            quantity: 500,
            location: 'Clinique Vet Lyon', // Ajout utile
            createdAt: new Date().toISOString(),
          },
          {
            id: 'demo-mission-2',
            requestType: 'APPOINTMENT',
            requiredSpecies: 'CAT',
            requiredBloodGroup: 'A',
            quantity: 250,
            location: 'Clinique Vet Paris',
            createdAt: new Date(Date.now() - 3600000).toISOString(),
          },
        ]
        pagination.items.value = mockMissions
        return mockMissions
      }

      const missions = await pagination.loadFirst(paginationConfig)

      // Tri intelligent : Urgences d'abord, puis les plus récents
      return missions.sort((a, b) => {
        if (a.requestType === 'EMERGENCY' && b.requestType !== 'EMERGENCY') return -1
        if (a.requestType !== 'EMERGENCY' && b.requestType === 'EMERGENCY') return 1
        return new Date(b.createdAt) - new Date(a.createdAt)
      })
    } catch (e) {
      console.error('Erreur chargement missions:', e)
      if (import.meta.env.DEV) pagination.items.value = []
      throw e
    }
  }

  const loadMoreMissions = async () => {
    try {
      return await pagination.loadMore(paginationConfig)
    } catch (e) {
      console.error('Erreur chargement suite missions:', e)
      throw e
    }
  }

  // --- FETCH MY MISSIONS ---
  const fetchMyMissions = async () => {
    isLoading.value = true
    try {
      const { userId } = await getCurrentUser()

      // Ici, on bypass le cache pour "Mes Missions" car c'est critique d'être à jour
      // ou alors on implémente un cache avec une invalidation très courte
      const { data } = await client.graphql({
        query: listMyAnimalsMissions,
        variables: { ownerID: userId },
        authMode: 'userPool',
      })

      const flatList = []
      const animals = data.listAnimals.items || []

      animals.forEach((animal) => {
        const animalMissions = animal.missions?.items || []
        animalMissions.forEach((mission) => {
          flatList.push({
            ...mission,
            animalId: animal.id, // Garder la ref à l'animal
            animalName: animal.name,
            animalSpecies: animal.species, // Utile pour l'UI
          })
        })
      })

      myMissions.value = flatList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    } catch (e) {
      console.error('Erreur chargement mes missions:', e)
      // On ne vide pas myMissions en cas d'erreur pour garder l'affichage précédent (offline first)
    } finally {
      isLoading.value = false
    }
  }

  // --- ACTION: ACCEPT ---
  // CORRECTION : Ajout du paramètre optionnel selectedAnimalId
  const acceptMission = async (request, selectedAnimalId = null) => {
    isAccepting.value = true
    try {
      // 1. Récupérer mes animaux pour vérifier la compatibilité
      // Idéalement, cette liste devrait déjà être dans un store ou cache
      const { data } = await client.graphql({
        query: listMyAnimalsSimple,
        authMode: 'userPool',
      })

      const myAnimals = data.listAnimals.items || []
      let candidate = null

      if (selectedAnimalId) {
        // Cas 1: L'utilisateur a choisi un animal spécifique
        candidate = myAnimals.find((a) => a.id === selectedAnimalId)
        // Vérification de sécurité double
        if (!candidate) throw new Error('ANIMAL_NOT_FOUND')
        if (
          candidate.species !== request.requiredSpecies ||
          candidate.bloodGroup !== request.requiredBloodGroup
        ) {
          throw new Error('ANIMAL_NOT_COMPATIBLE')
        }
      } else {
        // Cas 2: Auto-sélection (Comportement actuel, mais dangereux si plusieurs matchs)
        // On prend le premier compatible
        candidate = myAnimals.find(
          (a) =>
            a.species === request.requiredSpecies && a.bloodGroup === request.requiredBloodGroup,
        )
      }

      if (!candidate) throw new Error('NO_MATCHING_ANIMAL')

      const missionInput = {
        requestID: request.id,
        animalID: candidate.id,
        status: request.requestType === 'EMERGENCY' ? 'PENDING_ARRIVAL' : 'ACCEPTED',
        appointmentDatetime: new Date().toISOString(), // À remplacer par une vraie date choisie si c'est un RDV
      }

      // 2. Création de la mission (Avec Cache Mutation)
      const missionResult = await mutate({
        mutation: createMissionSimple,
        variables: { input: missionInput },
        invalidateTypes: ['Mission'], // On invalidera Request après
      })

      const newMissionId = missionResult.data.createMission.id

      // 3. Link Request -> Mission (Mise à jour statut demande)
      await mutate({
        mutation: linkRequestToMission,
        variables: {
          id: request.id,
          activeMissionID: newMissionId,
          // Note: Il faudrait peut-être changer le statut de la Request ici aussi (ex: vers ASSIGNED)
          // cela dépend de ton backend resolver
        },
        invalidateTypes: ['Request'],
      })

      // 4. UI Update immédiate
      pagination.removeItem(request.id)

      // Ajouter à "Mes missions" localement pour éviter un refetch immédiat
      myMissions.value.unshift({
        ...missionResult.data.createMission,
        animalName: candidate.name,
        animalSpecies: candidate.species,
        request: request, // Pour avoir les infos de la demande
      })

      return candidate.name
    } catch (e) {
      console.error('Erreur acceptation:', e)
      throw e
    } finally {
      isAccepting.value = false
    }
  }

  const refreshMissions = async () => {
    try {
      return await pagination.refresh(paginationConfig)
    } catch (e) {
      console.error('Erreur rafraîchissement:', e)
      throw e
    }
  }

  // --- COMPUTED ---
  const activeMissions = computed(() => {
    return myMissions.value.filter((m) =>
      ['ACCEPTED', 'PENDING_ARRIVAL', 'IN_PROGRESS'].includes(m.status),
    )
  })

  const historyMissions = computed(() => {
    return myMissions.value.filter((m) =>
      ['COMPLETED', 'NO_SHOW', 'CANCELLED', 'REJECTED'].includes(m.status),
    )
  })

  return {
    // Missions disponibles (paginées)
    availableMissions: pagination.items,
    isLoadingMissions: pagination.isLoading,
    isLoadingMoreMissions: pagination.isLoadingMore,
    hasMoreMissions: pagination.hasMore,

    // Mes missions
    myMissions,
    activeMissions,
    historyMissions,

    // États
    isLoading,
    isAccepting,

    // Actions
    fetchAvailableMissions,
    loadMoreMissions,
    acceptMission,
    fetchMyMissions,
    refreshMissions,

    // Utilitaires
    invalidateCache,
  }
}
