import { ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { getCurrentUser } from 'aws-amplify/auth'

// Phase 8, sous-tâche 5 (lot 1/3) : migré sur le client Gen2 (`aws-amplify/data`,
// `client.models.OwnerAvailability.*`). Plus d'import depuis `@/graphql/custom-mutations`/
// `@/graphql/custom-queries` -- voir le commentaire équivalent dans useAnimals.js.
//
// Changement de comportement le plus important de cette migration (voir aussi
// useAnimals.js/useOwnerProfile.js/useRegistrationCompletion.js, même sous-tâche) :
// `client.models.OwnerAvailability.*` NE LÈVE PAS d'exception sur une erreur GraphQL/@auth --
// il résout normalement avec `{ data, errors }`. Chaque appel synthétise donc une exception
// sur `errors` pour préserver le comportement observable Gen1 :
// - `fetchAvailabilities()` : avalait déjà toute erreur dans son `catch` -- la synthèse
//   retombe simplement dans ce même `catch`, rien ne change pour l'appelant.
// - `addAvailabilityForDays()` : chaque création tourne dans `Promise.allSettled()` -- sans
//   cette synthèse, un jour en échec `@auth` résoudrait `Promise.allSettled` en `'fulfilled'`
//   au lieu de `'rejected'`, et casserait le compteur `succeeded`/`failed` best-effort.
// - `removeAvailability()` : relançait déjà l'erreur à l'appelant (`AvailabilityView.vue`,
//   correction R-03/Phase 7.2) -- la synthèse préserve cette relance.

export function useOwnerAvailability() {
  const client = generateClient()
  const availabilities = ref([])
  const isLoading = ref(false)

  const fetchAvailabilities = async () => {
    isLoading.value = true
    try {
      const { userId } = await getCurrentUser()

      const { data, errors } = await client.models.OwnerAvailability.list({
        filter: { ownerID: { eq: userId } },
      })

      if (errors) {
        throw Object.assign(new Error('Erreur GraphQL listOwnerAvailabilities'), { errors })
      }

      availabilities.value = (data || []).sort((a, b) => {
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

  /**
   * Crée un créneau `OwnerAvailability` par jour de `days` (même heure de début/fin pour
   * tous), pour couvrir aussi bien l'ajout d'un seul jour (`days: [1]`, formulaire "Heure
   * exacte") que les raccourcis "Semaine"/"Weekend" de `AvailabilityView.vue` (plusieurs
   * jours en un clic). Best-effort par jour (`Promise.allSettled`) : un jour qui échoue
   * (réseau, `@auth`...) n'annule pas les autres -- chacun est une écriture indépendante,
   * pas une transaction. `getCurrentUser()` reste hors du `allSettled` : son échec (pas de
   * session) doit faire échouer tout l'appel, pas être traité comme "0 jour créé sur N".
   *
   * @param {number[]} days Valeurs `dayOfWeek` (convention `Date.prototype.getDay()`).
   * @param {string} start `HH:mm`.
   * @param {string} end `HH:mm`.
   * @returns {Promise<{succeeded: number, failed: number, total: number}>}
   */
  const addAvailabilityForDays = async (days, start, end) => {
    const { userId } = await getCurrentUser()

    const results = await Promise.allSettled(
      days.map(async (day) => {
        const { data, errors } = await client.models.OwnerAvailability.create({
          ownerID: userId,
          dayOfWeek: day,
          startTime: start,
          endTime: end,
        })

        if (errors) {
          throw Object.assign(new Error('Erreur GraphQL createOwnerAvailability'), { errors })
        }

        return data
      }),
    )

    results
      .filter((r) => r.status === 'rejected')
      .forEach((r) => console.error('Erreur ajout availability (jour ignoré) :', r.reason))

    await fetchAvailabilities()

    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    return { succeeded, failed: results.length - succeeded, total: results.length }
  }

  const removeAvailability = async (id) => {
    try {
      const { errors } = await client.models.OwnerAvailability.delete({ id })

      if (errors) {
        throw Object.assign(new Error('Erreur GraphQL deleteOwnerAvailability'), { errors })
      }

      availabilities.value = availabilities.value.filter((a) => a.id !== id)
    } catch (e) {
      console.error('Erreur suppression availability:', e)
      throw e
    }
  }

  return {
    availabilities,
    isLoading,
    fetchAvailabilities,
    addAvailabilityForDays,
    removeAvailability,
  }
}
