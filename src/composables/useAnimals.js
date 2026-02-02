import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { updateAnimal, deleteAnimal } from '@/graphql/mutations'
import { createAnimalSimple } from '@/graphql/custom-mutations.js'
import { listMyAnimalsByOwnerId } from '@/graphql/custom-queries.js'
import { useValidation } from '@/composables/useValidation.js'
import { animalSchema, validateDonorEligibility } from '@/utils/validation.js'

export function useAnimals() {
  const client = generateClient()
  // On récupère validate et errors depuis ton composable de validation
  const { validate, errors } = useValidation()

  const isLoading = ref(false)
  const isSaving = ref(false)
  const animals = ref([])

  // Utilitaire interne
  const calculateAge = (d) => {
    if (!d) return '?'
    const ageDifMs = Date.now() - new Date(d).getTime()
    const ageDate = new Date(ageDifMs)
    return Math.abs(ageDate.getUTCFullYear() - 1970)
  }

  // --- FETCH ---
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

      // On map les animaux et on calcule leur éligibilité dès la récupération
      animals.value = validItems.map((animal) => {
        const eligibility = validateDonorEligibility(animal)
        return {
          ...animal,
          age: calculateAge(animal.birthDate),
          isEligible: eligibility.isEligible, // Ajout utile pour l'affichage
          eligibilityReasons: eligibility.reasons,
        }
      })

      return userId
    } catch (e) {
      console.error('Erreur fetch animals:', e)
      animals.value = []
    } finally {
      isLoading.value = false
    }
  }

  // --- UPDATE ---
  const updateAnimalDetails = async (form) => {
    // 1. Validation avant envoi
    const isValid = await validate(form, animalSchema)
    if (!isValid) {
      throw new Error('Validation échouée') // Le composant vérifiera l'objet 'errors'
    }

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
        console.warn('Update partiel (erreurs relations possibles)', error.errors)
        updatedItem = error.data.updateAnimal
      } else {
        throw error
      }
    } finally {
      if (updatedItem) {
        const index = animals.value.findIndex((a) => a.id === updatedItem.id)
        if (index !== -1) {
          // Recalcul éligibilité après modification
          const eligibility = validateDonorEligibility(updatedItem)

          animals.value[index] = {
            ...animals.value[index],
            ...updatedItem,
            age: calculateAge(updatedItem.birthDate),
            isEligible: eligibility.isEligible,
            eligibilityReasons: eligibility.reasons,
          }
        }
      }
      isSaving.value = false
    }
  }

  // --- DELETE ---
  const deleteAnimalById = async (id) => {
    isSaving.value = true
    const previousAnimals = [...animals.value]

    try {
      // Optimistic UI update
      animals.value = animals.value.filter((a) => a.id !== id)

      await client.graphql({
        query: deleteAnimal,
        variables: { input: { id } },
        authMode: 'userPool',
      })
    } catch (error) {
      // Si l'objet est déjà supprimé ou erreur partielle acceptable
      if (error.data && error.data.deleteAnimal) return

      console.error('Erreur suppression:', error)
      // Rollback
      animals.value = previousAnimals
      throw error
    } finally {
      isSaving.value = false
    }
  }

  // --- CREATE ---
  const createNewAnimal = async (form, ownerID) => {
    // 1. Validation
    const isValid = await validate(form, animalSchema)
    if (!isValid) {
      throw new Error('Validation échouée')
    }

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
        lastDonationDate: null,
      }

      const { data } = await client.graphql({
        query: createAnimalSimple,
        variables: { input },
        authMode: 'userPool',
      })

      if (data.createAnimal) {
        const eligibilityCheck = validateDonorEligibility(data.createAnimal)

        const newAnimal = {
          ...data.createAnimal,
          age: calculateAge(data.createAnimal.birthDate),
          isEligible: eligibilityCheck.isEligible,
          eligibilityReasons: eligibilityCheck.reasons,
        }

        animals.value.push(newAnimal)
        return newAnimal // Retourne l'objet complet enrichi
      }
    } catch (error) {
      console.error('Erreur création animal:', error)
      throw error
    } finally {
      isSaving.value = false
    }
  }

  return {
    animals,
    isLoading,
    isSaving,
    errors, // Très utile pour le template
    fetchAnimals,
    updateAnimalDetails,
    deleteAnimalById,
    createNewAnimal,
  }
}
