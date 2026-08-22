import { ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { getCurrentUser } from 'aws-amplify/auth'
import { throwIfGraphqlError, resolveOrThrowOnFailure } from '@/services/graphql-error-service'

// Phase 8, sous-tâche 5 (lot 1/3) : migré sur le client Gen2 (`aws-amplify/data`,
// `client.models.Animal.*`). Les mutations `*Simple`/queries indexées Gen1
// (`createAnimalSimple`, `listMyAnimalsByOwnerId`) n'ont plus lieu d'être ici -- le
// SELECTION SET par défaut du client Gen2 (champs scalaires du modèle) correspond déjà à ce
// que ces documents demandaient explicitement, et l'objet `input` passé à `create()`/
// `update()` limite déjà les champs envoyés, sans avoir besoin d'un document GraphQL séparé
// pour ça (voir CLAUDE.md/commentaire de tête d'`amplify/data/resource.ts`).
//
// Sur le changement de comportement d'erreur Gen1 -> Gen2 (`client.models.Animal.*` résout
// `{ data, errors }` au lieu de lever une exception) et sa traduction via
// `throwIfGraphqlError`/`resolveOrThrowOnFailure` ci-dessous : voir le JSDoc de
// `src/services/graphql-error-service.js`, seule source de vérité sur le "pourquoi".

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

      const { data, errors } = await client.models.Animal.list({
        filter: { ownerID: { eq: userId } },
      })

      throwIfGraphqlError(errors, 'listAnimals')

      const rawAnimals = data || []

      // `_deleted` : résidu Gen1 (DataStore/conflict-resolution) -- aucun item Gen2 ne porte ce
      // champ, donc `!item._deleted` reste toujours vrai. Laissé tel quel plutôt que retiré (hors
      // périmètre de cette migration composable-par-composable, comportement observable
      // inchangé).
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
   * Met à jour les champs éditables d'un Animal (via `client.models.Animal.update()`) et
   * synchronise `animals` avec la réponse serveur. `resolveOrThrowOnFailure` traite un succès
   * partiel (`data` exploitable malgré `errors`, ex. une relation annexe non résolue) comme un
   * succès -- le `console.warn` ci-dessous, lui, reste local à cette fonction (ce n'est pas le
   * rôle du service de décider quoi logger).
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

      const { data, errors } = await client.models.Animal.update(input)

      updatedItem = resolveOrThrowOnFailure({ data, errors }, 'updateAnimal')

      if (errors) {
        console.warn('Update réussi (malgré erreurs relations)', errors)
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

  /**
   * Supprime un Animal (retrait optimiste immédiat, rollback sur vraie erreur). Même
   * traitement du succès partiel GraphQL qu'`updateAnimalDetails` ci-dessus via
   * `resolveOrThrowOnFailure` (pas de rollback si `data` reste exploitable malgré `errors`) ;
   * une vraie erreur (`errors` sans `data`, ou exception JS réseau/offline) retombe dans le
   * même `catch` (rollback + relance).
   */
  const deleteAnimalById = async (id) => {
    isSaving.value = true
    const previousAnimals = [...animals.value]

    try {
      animals.value = animals.value.filter((a) => a.id !== id)

      const { data, errors } = await client.models.Animal.delete({ id })

      resolveOrThrowOnFailure({ data, errors }, 'deleteAnimal')
    } catch (error) {
      console.error('Vraie erreur suppression:', error)
      animals.value = previousAnimals
      throw error
    } finally {
      isSaving.value = false
    }
  }

  /**
   * Crée un nouvel Animal pour `ownerID` via `client.models.Animal.create()` et l'ajoute
   * localement à `animals` en cas de succès. `bloodGroup` retombe sur `'UNKNOWN'` quand non
   * renseigné -- CONTEXT.md ("Validated Donor") interdit un groupe sanguin inconnu à la
   * validation, mais pas à la création : un Owner peut déclarer un animal sans connaître son
   * groupe, ce sera bloqué plus tard par `useAnimalValidation.js`.
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
      }

      const { data, errors } = await client.models.Animal.create(input)

      const created = resolveOrThrowOnFailure({ data, errors }, 'createAnimal')

      if (created) {
        animals.value.push({
          ...created,
          age: calculateAge(created.birthDate),
        })
      }

      return created
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
