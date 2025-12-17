import { computed, ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { listRequests } from '@/graphql/queries'
import { listMyAnimalsMissions, listMyAnimalsSimple } from '@/graphql/custom-queries'
import { createMissionSimple, linkRequestToMission } from '@/graphql/custom-mutations'
import { getCurrentUser } from 'aws-amplify/auth'

export function useOwnerMissions() {
  const client = generateClient()

  const missions = ref([])
  const myMissions = ref([])
  const isLoading = ref(false)
  const isAccepting = ref(false)

  const fetchAvailableMissions = async () => {
    isLoading.value = true
    try {
      const { data } = await client.graphql({
        query: listRequests,
        variables: {
          filter: { status: { eq: 'OPEN' } },
        },
        authMode: 'userPool',
      })

      missions.value = data.listRequests.items.sort((a, b) => {
        if (a.requestType === 'EMERGENCY' && b.requestType !== 'EMERGENCY') return -1
        if (a.requestType !== 'EMERGENCY' && b.requestType === 'EMERGENCY') return 1
        return new Date(b.createdAt) - new Date(a.createdAt)
      })
    } catch (e) {
      console.error('Erreur chargement missions:', e)
    } finally {
      isLoading.value = false
    }
  }

  const fetchMyMissions = async () => {
    isLoading.value = true
    try {
      const { userId } = await getCurrentUser()

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
            animalName: animal.name,
          })
        })
      })

      myMissions.value = flatList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    } catch (e) {
      console.error('Erreur chargement mes missions:', e)
    } finally {
      isLoading.value = false
    }
  }

  const acceptMission = async (request) => {
    isAccepting.value = true
    try {
      const { data } = await client.graphql({ query: listMyAnimalsSimple, authMode: 'userPool' })
      const myAnimals = data.listAnimals.items
      const candidate = myAnimals.find(
        (a) => a.species === request.requiredSpecies && a.bloodGroup === request.requiredBloodGroup,
      )
      if (!candidate) throw new Error('NO_MATCHING_ANIMAL')

      const missionInput = {
        requestID: request.id,
        animalID: candidate.id,
        status: request.requestType === 'EMERGENCY' ? 'PENDING_ARRIVAL' : 'ACCEPTED',
        appointmentDatetime: new Date().toISOString(),
      }

      const missionResult = await client.graphql({
        query: createMissionSimple,
        variables: { input: missionInput },
        authMode: 'userPool',
      })

      const newMissionId = missionResult.data.createMission.id

      await client.graphql({
        query: linkRequestToMission,
        variables: {
          id: request.id,
          activeMissionID: newMissionId,
        },
        authMode: 'userPool',
      })

      missions.value = missions.value.filter((m) => m.id !== request.id)
      return candidate.name
    } catch (e) {
      console.error('Erreur acceptation:', e)
      throw e
    } finally {
      isAccepting.value = false
    }
  }
  const activeMissions = computed(() => {
    return myMissions.value.filter((m) => ['ACCEPTED', 'PENDING_ARRIVAL'].includes(m.status))
  })

  const historyMissions = computed(() => {
    return myMissions.value.filter((m) => ['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(m.status))
  })

  return {
    missions,
    myMissions,
    activeMissions,
    historyMissions,
    isLoading,
    isAccepting,
    fetchAvailableMissions,
    acceptMission,
    fetchMyMissions,
  }
}
