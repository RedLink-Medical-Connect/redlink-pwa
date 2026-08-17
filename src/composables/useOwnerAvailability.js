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
      days.map((day) =>
        client.graphql({
          query: createOwnerAvailabilitySimple,
          variables: { input: { ownerID: userId, dayOfWeek: day, startTime: start, endTime: end } },
          authMode: 'userPool',
        }),
      ),
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
      // 👇 3. On utilise la mutation SIMPLE pour la suppression aussi
      await client.graphql({
        query: deleteOwnerAvailabilitySimple,
        variables: { input: { id } },
        authMode: 'userPool',
      })

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
