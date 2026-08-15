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
  // Distingue "chargement en erreur" d'une liste réellement vide (Owner sans animal) --
  // même convention que `loadError` dans useClinicDonors.js/useAnimalValidation.js
  // (CLAUDE.md). Avant ce champ, `fetchAnimals()` avalait son erreur en silence et
  // AnimalsView.vue affichait le même état "grille vide" dans les deux cas -- le
  // `.catch()` posé côté vue ne se déclenchait d'ailleurs jamais, `fetchAnimals()` ne
  // rejetant jamais sa promesse.
  const loadError = ref(false)

  const calculateAge = (d) => {
    if (!d) return '?'
    const ageDifMs = Date.now() - new Date(d).getTime()
    const ageDate = new Date(ageDifMs)
    return Math.abs(ageDate.getUTCFullYear() - 1970)
  }

  /**
   * Charge les Animals de l'Owner courant (résolu via `getCurrentUser()`, pas passé en
   * paramètre). Met à jour `animals` et bascule `loadError` à `true` en cas d'échec (réseau,
   * @auth...) sans relancer l'erreur -- un appelant qui a besoin de réagir à l'échec (ex.
   * redirection) doit lire `loadError` après l'`await`, pas s'appuyer sur un rejet de
   * promesse.
   *
   * @returns {Promise<string|undefined>} l'`ownerID` courant en cas de succès, sinon `undefined`.
   */
  const fetchAnimals = async () => {
    isLoading.value = true
    loadError.value = false
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
      loadError.value = true
      animals.value = []
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Met à jour les champs éditables d'un Animal (via `updateAnimal`, mutation complète --
   * pas de scoping `@auth` particulier ici, l'Owner est propriétaire de la fiche) et
   * synchronise `animals` avec la réponse serveur. Gère le succès partiel GraphQL (réponse
   * contenant à la fois `data` et `errors` sans lever d'exception JS classique -- Amplify la
   * remonte comme une erreur porteuse d'un `.data`) : si `error.data.updateAnimal` est
   * présent malgré l'erreur, on traite comme un succès (même pattern que `deleteAnimalById`
   * ci-dessous) plutôt que de relancer une erreur trompeuse pour une écriture qui a en
   * réalité abouti côté serveur.
   *
   * @param {object} form Formulaire d'édition (voir `editForm` dans AnimalsView.vue) --
   *   doit au moins contenir `id`.
   * @returns {Promise<void>}
   */
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

  /**
   * Crée un nouvel Animal pour `ownerID` via `createAnimalSimple` (custom-mutations.js) et
   * l'ajoute localement à `animals` en cas de succès. `bloodGroup` retombe sur `'UNKNOWN'`
   * quand non renseigné -- CONTEXT.md ("Validated Donor") interdit un groupe sanguin inconnu
   * à la validation, mais pas à la création : un Owner peut déclarer un animal sans connaître
   * son groupe, ce sera bloqué plus tard par `useAnimalValidation.js`.
   *
   * @param {object} form Formulaire de création (voir AddAnimalView.vue).
   * @param {string} ownerID Owner propriétaire de l'Animal créé.
   * @returns {Promise<object|undefined>} l'Animal créé (réponse serveur), ou `undefined` si
   *   la mutation n'a renvoyé aucune donnée.
   */
  const createNewAnimal = async (form, ownerID) => {
    isSaving.value = true
    try {
      const input = {
        ownerID: ownerID,
        name: form.name,
        species: form.species,
        breed: form.breed || null,
        // Sous-tâche 6.8 : champ informatif uniquement (PAS un critère d'éligibilité,
        // voir schema.graphql) — optionnel, pas de valeur par défaut imposée.
        sex: form.sex || null,
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
    loadError,
    fetchAnimals,
    updateAnimalDetails,
    deleteAnimalById,
    createNewAnimal,
  }
}
