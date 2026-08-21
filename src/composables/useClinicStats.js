import { ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { getCurrentUser } from 'aws-amplify/auth'
import { throwIfGraphqlError } from '@/services/graphql-error-service'

/**
 * Phase 6.7 (CdC §2.4) : indicateurs tableau de bord vétérinaire, en lecture seule côté UI
 * (l'écriture/incrément se fait exclusivement à la clôture COMPLETED d'une Mission, voir
 * `useMissionClosure.js`). Résout son propre `clinicID` (même pattern que `fetchClinicId`
 * dans `useClinicRequest.js`) plutôt que de le recevoir en paramètre — cohérent avec le reste
 * des composables de ce repo, aucun ne reçoit ses dépendances en injection aujourd'hui.
 *
 * Phase 8, sous-tâche 5 (lot 2/3) : migré sur le client Gen2 (`aws-amplify/data`,
 * `client.models.Veterinarian.get()`/`client.models.Clinic.get()`) -- des `.get()` directs,
 * `getVeterinarian`/`getClinic` (Gen1, `@/graphql/queries`) ne sélectionnaient ici que des
 * champs scalaires (`clinicID`, `transfusionsDone`, `donorOwnersCount`), déjà couverts par
 * le `selectionSet` par défaut du client Gen2 -- pas besoin d'un `selectionSet` explicite
 * (aucune relation imbriquée lue par ce composable, contrairement à `useClinicDonors.js`/
 * `useClinicSettings.js`). Sur le changement de comportement d'erreur Gen1 -> Gen2 et
 * `throwIfGraphqlError` ci-dessous : voir le JSDoc de `src/services/graphql-error-service.js`.
 */
export function useClinicStats() {
  const client = generateClient()

  const transfusionsDone = ref(0)
  const donorOwnersCount = ref(0)
  const isLoading = ref(false)
  const loadError = ref(false)

  const fetchStats = async () => {
    isLoading.value = true
    loadError.value = false

    try {
      const { userId } = await getCurrentUser()

      const { data: vetData, errors: vetErrors } = await client.models.Veterinarian.get({
        id: userId,
      })

      throwIfGraphqlError(vetErrors, 'getVeterinarian')

      const clinicID = vetData?.clinicID
      if (!clinicID) throw new Error('Clinique introuvable pour ce vétérinaire')

      const { data, errors } = await client.models.Clinic.get({ id: clinicID })

      throwIfGraphqlError(errors, 'getClinic')

      transfusionsDone.value = data?.transfusionsDone ?? 0
      donorOwnersCount.value = data?.donorOwnersCount ?? 0
    } catch (e) {
      console.error('Erreur récupération des indicateurs clinique:', e)
      loadError.value = true
    } finally {
      isLoading.value = false
    }
  }

  return {
    transfusionsDone,
    donorOwnersCount,
    isLoading,
    loadError,
    fetchStats,
  }
}
