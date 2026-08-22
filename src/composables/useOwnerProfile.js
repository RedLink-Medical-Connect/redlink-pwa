import { ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { deleteUser, getCurrentUser } from 'aws-amplify/auth'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { throwIfGraphqlError } from '@/services/graphql-error-service'

// Phase 8, sous-tâche 5 (lot 1/3) : migré sur le client Gen2 (`aws-amplify/data`,
// `client.models.Owner.*`/`client.models.Animal.*`). Plus d'import depuis
// `@/graphql/queries`/`@/graphql/mutations` -- le client Gen2 sélectionne déjà les champs
// scalaires du modèle par défaut, et `create()`/`update()` prennent l'objet `input`
// directement (voir CLAUDE.md/`amplify/data/resource.ts`).
//
// Sur le changement de comportement d'erreur Gen1 -> Gen2 (`client.models.X.*` résout
// `{ data, errors }` au lieu de lever une exception) et sa traduction via
// `throwIfGraphqlError` ci-dessous : voir le JSDoc de `src/services/graphql-error-service.js`,
// seule source de vérité sur le "pourquoi". Ce fichier n'avait AUCUN `catch` avant cette
// migration (`fetchProfile`/`updateProfile` laissaient l'exception Gen1 se propager telle
// quelle à l'appelant -- `ProfileView.vue` fait `fetchProfile().catch(...)`,
// `useMatchingRequests.js` fait `await fetchProfile()` dans son propre `try/catch` qui pilote
// `loadError`) : sans `throwIfGraphqlError`, ces deux appelants ne verraient plus jamais
// d'échec sur ce chemin.

export function useOwnerProfile() {
  const client = generateClient()
  const auth = useAuthStore()
  const router = useRouter()

  const isLoading = ref(false)
  const isSaving = ref(false)
  const ownerId = ref(null)
  // R-19 : distingue "profil déjà chargé une fois cette session" d'un simple `form` non-nul
  // par défaut (qui ne le permettait pas — voir le commentaire sur `fetchProfile` juste
  // en dessous). Même composable réutilisé pour toute la durée de vie d'un consommateur
  // (ex. useMatchingRequests() instancie useOwnerProfile() une seule fois, voir son
  // commentaire dédié) : ce flag vit donc bien pour "une session", pas juste un appel.
  const isLoaded = ref(false)

  const form = ref({
    firstname: '',
    lastname: '',
    email: '',
    phone: '',
    address: '',
    latitude: null,
    longitude: null,
    maxTravelDistance: 50,
  })

  /**
   * Charge le profil Owner courant (résolu via `getCurrentUser()`). `form` a des valeurs
   * par défaut non-nulles (voir plus haut), donc on ne peut pas se fier à sa nullité pour
   * savoir si un chargement a déjà eu lieu — d'où `isLoaded` : au premier appel réussi de la
   * session, `fetchProfile()` marque `isLoaded = true` et les appels suivants deviennent des
   * no-op (R-19 : évite un aller-retour réseau `GetOwner` à chaque tick de polling dans
   * `useMatchingRequests.searchMatches()`).
   *
   * `updateProfile()` n'a aujourd'hui aucun flux qui recharge le profil après écriture (le
   * formulaire local sert déjà de source de vérité post-sauvegarde, voir ProfileView.vue) —
   * mais si un tel besoin apparaît, passer `{ force: true }` recharge explicitement malgré
   * `isLoaded`, sans avoir à réinstancier le composable.
   *
   * @param {{ force?: boolean }} [options] `force: true` ignore `isLoaded` et recharge.
   */
  const fetchProfile = async ({ force = false } = {}) => {
    if (isLoaded.value && !force) return

    isLoading.value = true
    try {
      const { userId } = await getCurrentUser()

      if (!userId) throw new Error("Impossible de récupérer l'ID utilisateur")

      const { data, errors } = await client.models.Owner.get({ id: userId })

      // `data === null` SANS `errors` (Owner pas encore créé) reste un cas légitime, pas une
      // erreur -- `profile` reste falsy plus bas, `isLoaded` passe quand même à `true`, comme
      // avant.
      throwIfGraphqlError(errors, 'getOwner')

      const profile = data

      if (profile) {
        ownerId.value = profile.id
        form.value = {
          firstname: profile.firstname,
          lastname: profile.lastname,
          email: profile.email,
          phone: profile.phone,
          address: profile.address,
          latitude: profile.latitude,
          longitude: profile.longitude,
          maxTravelDistance: profile.maxTravelDistance,
        }
      }

      isLoaded.value = true
    } finally {
      isLoading.value = false
    }
  }

  const updateProfile = async () => {
    isSaving.value = true
    try {
      const input = {
        id: ownerId.value,
        firstname: form.value.firstname,
        lastname: form.value.lastname,
        phone: form.value.phone,
        address: form.value.address,
        latitude: form.value.latitude,
        longitude: form.value.longitude,
        maxTravelDistance: form.value.maxTravelDistance,
      }

      const { errors } = await client.models.Owner.update(input)

      throwIfGraphqlError(errors, 'updateOwner')
    } finally {
      isSaving.value = false
    }
  }

  /**
   * Supprime le compte Owner courant : nettoyage DB (Animals + Owner) puis suppression
   * Cognito (`deleteUser()`), déconnexion et redirection. Flux irréversible.
   *
   * Convention du repo (CLAUDE.md, "écriture secondaire best-effort") : le nettoyage DB est
   * une écriture secondaire qui précède l'action critique (`deleteUser()`) — son échec est
   * loggé mais jamais relancé, pour ne pas empêcher un Owner de supprimer son compte Cognito
   * à cause d'un animal/relation orphelin en base. Seul l'échec de `deleteUser()` (et de ce
   * qui suit) doit remonter à l'appelant. Ce bloc étant déjà best-effort (toute erreur est
   * avalée par le `catch (dbError)` ci-dessous), `throwIfGraphqlError` (voir
   * `graphql-error-service.js`) retombe naturellement dans ce même `catch`.
   */
  const deleteAccount = async () => {
    isSaving.value = true
    try {
      if (ownerId.value) {
        try {
          const { data, errors: listErrors } = await client.models.Animal.list()

          throwIfGraphqlError(listErrors, 'listAnimals')

          const rawItems = data || []
          // `_deleted` : résidu Gen1 (DataStore/conflict-resolution), voir useAnimals.js --
          // toujours faux côté Gen2, laissé tel quel (comportement observable inchangé).
          const validAnimals = rawItems.filter((item) => item && item.id && !item._deleted)

          if (validAnimals.length > 0) {
            const deleteResults = await Promise.all(
              validAnimals.map((a) => client.models.Animal.delete({ id: a.id })),
            )
            const failed = deleteResults.find((r) => r.errors)
            if (failed) {
              throwIfGraphqlError(failed.errors, 'deleteAnimal')
            }
          }

          const { errors: deleteOwnerErrors } = await client.models.Owner.delete({
            id: ownerId.value,
          })

          throwIfGraphqlError(deleteOwnerErrors, 'deleteOwner')
        } catch (dbError) {
          console.error(
            'Erreur nettoyage DB (Animals/Owner) lors de la suppression du compte, ignorée (best-effort) :',
            dbError,
          )
        }
      }

      await deleteUser()
      await auth.logout()
      await router.push('/')
    } catch (authError) {
      console.error('Erreur critique lors de la suppression du compte (Cognito) :', authError)
      throw authError
    } finally {
      isSaving.value = false
    }
  }

  return {
    form,
    isLoading,
    isSaving,
    fetchProfile,
    updateProfile,
    deleteAccount,
  }
}
