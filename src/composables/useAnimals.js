import { ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { getCurrentUser } from 'aws-amplify/auth'

// Phase 8, sous-tâche 5 (lot 1/3) : migré sur le client Gen2 (`aws-amplify/data`,
// `client.models.Animal.*`). Les mutations `*Simple`/queries indexées Gen1
// (`createAnimalSimple`, `listMyAnimalsByOwnerId`) n'ont plus lieu d'être ici -- le
// SELECTION SET par défaut du client Gen2 (champs scalaires du modèle) correspond déjà à ce
// que ces documents demandaient explicitement, et l'objet `input` passé à `create()`/
// `update()` limite déjà les champs envoyés, sans avoir besoin d'un document GraphQL séparé
// pour ça (voir CLAUDE.md/commentaire de tête d'`amplify/data/resource.ts`).
//
// Changement de comportement le plus important de cette migration (voir aussi
// useOwnerProfile.js/useOwnerAvailability.js/useRegistrationCompletion.js, même sous-tâche) :
// `client.models.Animal.*` NE LÈVE PAS d'exception sur une erreur GraphQL/@auth (contrairement
// à `client.graphql()` en Gen1) -- il résout normalement avec `{ data, errors }`. Chaque endroit
// qui doit se comporter EXACTEMENT comme avant pour son appelant (loadError déclenché,
// rollback+rethrow, écran d'erreur affiché...) synthétise donc une exception à la place --
// voir le commentaire dédié sur chaque fonction ci-dessous.

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

      // Gen1 (aws-amplify/api) levait une exception sur toute erreur GraphQL/@auth, attrapée
      // par le catch ci-dessous. Gen2 (aws-amplify/data) résout normalement avec
      // `{ data, errors }` -- on la retransforme en exception pour que ce même catch reste le
      // seul endroit qui pilote `loadError`, sans dupliquer sa logique ici.
      if (errors) {
        throw Object.assign(new Error('Erreur GraphQL listAnimals'), { errors })
      }

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
   * synchronise `animals` avec la réponse serveur. Gère le succès partiel GraphQL : en Gen2,
   * une réponse portant à la fois `data` et `errors` (ex. une relation annexe non résolue)
   * n'est plus une exception JS porteuse d'un `.data` (pattern Gen1) mais directement le
   * `{ data, errors }` résolu par `client.models.Animal.update()` -- si `data` est exploitable
   * malgré `errors`, on traite comme un succès (même logique qu'auparavant, juste déplacée
   * d'un `catch` vers une vérification explicite après l'`await`). Une vraie erreur (pas de
   * `data` exploitable, ou une exception JS réseau/offline) continue de relancer -- via le
   * `try/finally` (pas de `catch` ici : rien à intercepter, la relance est le comportement
   * par défaut d'une exception non attrapée).
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

      if (errors) {
        if (data) {
          console.warn('Update réussi (malgré erreurs relations)', errors)
          updatedItem = data
        } else {
          throw Object.assign(new Error('Erreur GraphQL updateAnimal'), { errors })
        }
      } else {
        updatedItem = data
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
   * traitement du succès partiel GraphQL qu'`updateAnimalDetails` ci-dessus : `data` présent
   * malgré `errors` est traité comme un succès (pas de rollback), le reste (vraie erreur
   * @auth remontée en `errors` sans `data`, ou exception JS réseau/offline) déclenche le
   * rollback + relance, unifiés dans le même `catch` (la vraie erreur `@auth` est
   * synthétisée en exception juste en dessous pour y retomber, exactement comme une
   * exception JS classique).
   */
  const deleteAnimalById = async (id) => {
    isSaving.value = true
    const previousAnimals = [...animals.value]

    try {
      animals.value = animals.value.filter((a) => a.id !== id)

      const { data, errors } = await client.models.Animal.delete({ id })

      if (errors && !data) {
        throw Object.assign(new Error('Erreur GraphQL deleteAnimal'), { errors })
      }
      // errors && data (succès partiel) : rien de plus à faire, pas de rollback -- même
      // comportement que le `return` anticipé du pattern Gen1 `catch(error) { if (error.data...) return }`.
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
   * Gen1 n'avait pas de `catch` ici : une erreur GraphQL (via `client.graphql()`) se
   * propageait telle quelle à l'appelant (`AddAnimalView.vue`, qui lit `err.errors`). Gen2 ne
   * levant plus d'exception pour ce cas, on synthétise une exception portant `.errors` pour
   * préserver exactement ce contrat -- voir le commentaire d'en-tête de fichier.
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

      if (errors && !data) {
        throw Object.assign(new Error('Erreur GraphQL createAnimal'), { errors })
      }

      if (data) {
        animals.value.push({
          ...data,
          age: calculateAge(data.birthDate),
        })
      }

      return data

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
