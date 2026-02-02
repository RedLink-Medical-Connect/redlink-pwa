/**
 * Composable optimisé pour la gestion des animaux avec pagination
 * Phase 1 Sprint 1.3 - Performance Critique
 */

import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { updateAnimal, deleteAnimal } from '@/graphql/mutations'
import { createAnimalSimple } from '@/graphql/custom-mutations.js'
import { listMyAnimalsOptimized } from '@/graphql/paginated-queries.js'
import { useValidation } from '@/composables/useValidation.js'
import { animalSchema, validateDonorEligibility } from '@/utils/validation.js'
import { usePagination } from '@/composables/usePagination.js'

export function useAnimalsOptimized() {
  const client = generateClient()
  const { validate, errors } = useValidation()
  const pagination = usePagination()

  const isLoading = ref(false)
  const isSaving = ref(false)

  const calculateAge = (d) => {
    if (!d) return '?'
    const ageDifMs = Date.now() - new Date(d).getTime()
    const ageDate = new Date(ageDifMs)
    return Math.abs(ageDate.getUTCFullYear() - 1970)
  }

  const processAnimal = (animal) => {
    const processed = {
      ...animal,
      age: calculateAge(animal.birthDate),
    }

    // Ajouter les informations d'éligibilité
    const eligibilityCheck = validateDonorEligibility(processed)
    processed.isEligible = eligibilityCheck.isEligible
    processed.eligibilityReasons = eligibilityCheck.reasons

    return processed
  }

  const fetchAnimals = async () => {
    isLoading.value = true
    try {
      const { userId } = await getCurrentUser()

      if (!userId) throw new Error("Impossible de récupérer l'ID utilisateur")

      // Initialiser la pagination
      pagination.initialize({
        query: listMyAnimalsOptimized,
        variables: { ownerID: userId },
        limit: 10,
        authMode: 'userPool',
      })

      const animals = await pagination.loadFirst()

      // Traiter les animaux avec âge et éligibilité
      const processedAnimals = animals
        .filter((animal) => animal && !animal._deleted)
        .map(processAnimal)

      // Mettre à jour les items de pagination avec les données traitées
      pagination.items.value = processedAnimals

      return userId
    } catch (e) {
      console.error('Erreur fetch animals:', e)
      pagination.items.value = []
      throw e
    } finally {
      isLoading.value = false
    }
  }

  const loadMoreAnimals = async () => {
    try {
      const newAnimals = await pagination.loadMore()

      // Traiter les nouveaux animaux
      const processedAnimals = newAnimals
        .filter((animal) => animal && !animal._deleted)
        .map(processAnimal)

      // Remplacer les derniers éléments par les versions traitées
      const startIndex = pagination.items.value.length - newAnimals.length
      pagination.items.value.splice(startIndex, newAnimals.length, ...processedAnimals)

      return processedAnimals
    } catch (e) {
      console.error('Erreur chargement animaux supplémentaires:', e)
      throw e
    }
  }

  const updateAnimalDetails = async (form) => {
    isSaving.value = true
    let updatedItem = null

    try {
      // Validation des données avant envoi
      const isValid = await validate(form, animalSchema)
      if (!isValid) {
        throw new Error('Données invalides')
      }

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
        const processedAnimal = processAnimal(updatedItem)
        pagination.updateItem(updatedItem.id, processedAnimal)
      }
      isSaving.value = false
    }
  }

  const deleteAnimalById = async (id) => {
    isSaving.value = true

    try {
      await client.graphql({
        query: deleteAnimal,
        variables: { input: { id } },
        authMode: 'userPool',
      })

      // Supprimer de la liste paginée
      pagination.removeItem(id)
    } catch (error) {
      if (error.data && error.data.deleteAnimal) {
        // Suppression réussie malgré les erreurs de relations
        pagination.removeItem(id)
        return
      }

      console.error('Vraie erreur suppression:', error)
      throw error
    } finally {
      isSaving.value = false
    }
  }

  const createNewAnimal = async (form, ownerID) => {
    isSaving.value = true

    try {
      // Validation des données avant envoi
      const isValid = await validate(form, animalSchema)
      if (!isValid) {
        throw new Error('Données invalides')
      }

      // Vérification de l'éligibilité du donneur
      const eligibility = validateDonorEligibility(form)
      if (!eligibility.isEligible) {
        console.warn('Animal non éligible:', eligibility.reasons)
        // On continue quand même la création mais on log l'avertissement
      }

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
        const processedAnimal = processAnimal(data.createAnimal)

        // Ajouter au début de la liste paginée
        pagination.prependItem(processedAnimal)
      }

      return data.createAnimal
    } catch (error) {
      console.error('Erreur création animal:', error)
      throw error
    } finally {
      isSaving.value = false
    }
  }

  // Filtres et tri optimisés
  const getEligibleAnimals = () => {
    return pagination.filterItems((animal) => animal.isEligible)
  }

  const getAnimalsBySpecies = (species) => {
    return pagination.filterItems((animal) => animal.species === species)
  }

  const sortAnimalsByLastDonation = () => {
    return pagination.sortItems((a, b) => {
      if (!a.lastDonationDate && !b.lastDonationDate) return 0
      if (!a.lastDonationDate) return 1
      if (!b.lastDonationDate) return -1
      return new Date(a.lastDonationDate) - new Date(b.lastDonationDate)
    })
  }

  return {
    // Données paginées
    animals: pagination.items,
    isLoading: pagination.isLoading,
    isLoadingMore: pagination.isLoadingMore,
    hasMore: pagination.hasMore,
    isEmpty: pagination.isEmpty,

    // États
    isSaving,
    errors, // Exposer les erreurs de validation

    // Actions principales
    fetchAnimals,
    loadMoreAnimals,
    updateAnimalDetails,
    deleteAnimalById,
    createNewAnimal,

    // Utilitaires de pagination
    refreshAnimals: pagination.refresh,

    // Filtres optimisés
    getEligibleAnimals,
    getAnimalsBySpecies,
    sortAnimalsByLastDonation,
  }
}

/**
 * Version de compatibilité pour l'ancien useAnimals
 * Utilise la pagination mais expose la même interface
 */
export function useAnimals() {
  const optimized = useAnimalsOptimized()

  return {
    animals: optimized.animals,
    isLoading: optimized.isLoading,
    isSaving: optimized.isSaving,
    errors: optimized.errors,
    fetchAnimals: optimized.fetchAnimals,
    updateAnimalDetails: optimized.updateAnimalDetails,
    deleteAnimalById: optimized.deleteAnimalById,
    createNewAnimal: optimized.createNewAnimal,

    // Nouvelles fonctionnalités
    loadMoreAnimals: optimized.loadMoreAnimals,
    hasMore: optimized.hasMore,
    refreshAnimals: optimized.refreshAnimals,
  }
}
