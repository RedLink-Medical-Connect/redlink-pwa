import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { updateAnimal, deleteAnimal } from '@/graphql/mutations'
import { createAnimalSimple } from '@/graphql/custom-mutations.js'
import { listMyAnimalsByOwnerId } from '@/graphql/custom-queries.js'

export function useAnimals() {
  const client = generateClient()
  const isLoading = ref(false)
  const isSaving = ref(false)
  const animals = ref([])

  const calculateAge = (d) => {
    if (!d) return '?'
    const ageDifMs = Date.now() - new Date(d).getTime()
    const ageDate = new Date(ageDifMs)
    return Math.abs(ageDate.getUTCFullYear() - 1970)
  }

  const fetchAnimals = async () => {
    isLoading.value = true
    try {
      const { userId } = await getCurrentUser()

      if (!userId) throw new Error("Impossible de récupérer l'ID utilisateur")

      const { data } = await client.graphql({
        query: listMyAnimalsByOwnerId,
        variables: { ownerID: userId },
        authMode: 'userPool',
      })

      const rawAnimals = data.listAnimals?.items || []

      const validItems = rawAnimals.filter((item) => item && !item._deleted)

      animals.value = validItems.map((animal) => ({
        ...animal,
        age: calculateAge(animal.birthDate),
      }))

      return userId
    } catch (e) {
      console.error('Erreur fetch animals:', e)
      animals.value = []
    } finally {
      isLoading.value = false
    }
  }

  const updateAnimalDetails = async (form) => {
    isSaving.value = true
    let updatedItem = null

    try {
      const input = {
        id: form.id,
        name: form.name,
        species: form.species,
        breed: form.breed,
        birthDate: form.birthDate,
        weight: parseFloat(form.weight),
        bloodGroup: form.bloodGroup,
        isVaccinated: form.isVaccinated,
        isSterilized: form.isSterilized,
        donationFrequency: form.donationFrequency,
      }

      const response = await client.graphql({
        query: updateAnimal,
        variables: { input },
        authMode: 'userPool',
      })

      updatedItem = response.data?.updateAnimal
    } catch (error) {
      if (error.data && error.data.updateAnimal) {
        console.warn('Update réussi (malgré erreurs relations)', error.errors)
        updatedItem = error.data.updateAnimal
      } else {
        throw error
      }
    } finally {
      if (updatedItem) {
        const index = animals.value.findIndex((a) => a.id === updatedItem.id)
        if (index !== -1) {
          animals.value[index] = {
            ...animals.value[index],
            ...updatedItem,
            age: calculateAge(updatedItem.birthDate),
          }
        }
      }
      isSaving.value = false
    }
  }

  const deleteAnimalById = async (id) => {
    isSaving.value = true
    const previousAnimals = [...animals.value]

    try {
      animals.value = animals.value.filter((a) => a.id !== id)

      await client.graphql({
        query: deleteAnimal,
        variables: { input: { id } },
        authMode: 'userPool',
      })
    } catch (error) {
      if (error.data && error.data.deleteAnimal) {
        return
      }

      console.error('Vraie erreur suppression:', error)
      animals.value = previousAnimals
      throw error
    } finally {
      isSaving.value = false
    }
  }

  const createNewAnimal = async (form, ownerID) => {
    isSaving.value = true
    try {
      const input = {
        ownerID: ownerID,
        name: form.name,
        species: form.species,
        breed: form.breed || null,
        birthDate: form.birthDate ? form.birthDate : null,
        weight: parseFloat(form.weight),
        bloodGroup: form.bloodGroup || 'UNKNOWN',
        isVaccinated: form.isVaccinated,
        isSterilized: form.isSterilized,
        donationFrequency: form.donationFrequency,
        lastDonationDate: null
      }

      const { data } = await client.graphql({
        query: createAnimalSimple,
        variables: { input },
        authMode: 'userPool',
      })

      if (data.createAnimal) {
        animals.value.push({
          ...data.createAnimal,
          age: calculateAge(data.createAnimal.birthDate)
        })
      }

      return data.createAnimal

    } finally {
      isSaving.value = false
    }
  }

  return {
    animals,
    isLoading,
    isSaving,
    fetchAnimals,
    updateAnimalDetails,
    deleteAnimalById,
    createNewAnimal,
  }
}
