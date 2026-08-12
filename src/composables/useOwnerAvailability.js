import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { createOwnerAvailabilitySimple, deleteOwnerAvailabilitySimple } from '@/graphql/custom-mutations'
import { listMyAvailabilities } from '@/graphql/custom-queries'

export function useOwnerAvailability() {
  const client = generateClient()
  const availabilities = ref([])
  const isLoading = ref(false)

  const fetchAvailabilities = async () => {
    isLoading.value = true
    try {
      const { userId } = await getCurrentUser()

      const { data } = await client.graphql({
        query: listMyAvailabilities,
        variables: {
          filter: { ownerID: { eq: userId } },
        },
        authMode: 'userPool',
      })

      availabilities.value = data.listOwnerAvailabilities.items.sort((a, b) => {
        const dayA = a.dayOfWeek === 0 ? 7 : a.dayOfWeek
        const dayB = b.dayOfWeek === 0 ? 7 : b.dayOfWeek
        return dayA - dayB
      })
    } catch (e) {
      console.error('Erreur fetch availabilities:', e)
    } finally {
      isLoading.value = false
    }
  }

  const addAvailability = async (day, start, end) => {
    try {
      const { userId } = await getCurrentUser()

      const input = {
        ownerID: userId,
        dayOfWeek: day,
        startTime: start,
        endTime: end,
      }

      // 👇 2. On utilise la mutation SIMPLE
      await client.graphql({
        query: createOwnerAvailabilitySimple,
        variables: { input },
        authMode: 'userPool',
      })

      await fetchAvailabilities()
      return true
    } catch (e) {
      console.error('Erreur ajout availability:', e)
      throw e
    }
  }

  const removeAvailability = async (id) => {
    try {
      // 👇 3. On utilise la mutation SIMPLE pour la suppression aussi
      await client.graphql({
        query: deleteOwnerAvailabilitySimple,
        variables: { input: { id } },
        authMode: 'userPool',
      })

      availabilities.value = availabilities.value.filter((a) => a.id !== id)
    } catch (e) {
      console.error('Erreur suppression availability:', e)
    }
  }

  return {
    availabilities,
    isLoading,
    fetchAvailabilities,
    addAvailability,
    removeAvailability,
  }
}
