import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { getVeterinarian, getClinic } from '@/graphql/queries'

/**
 * Phase 6.7 (CdC §2.4) : indicateurs tableau de bord vétérinaire, en lecture seule côté UI
 * (l'écriture/incrément se fait exclusivement à la clôture COMPLETED d'une Mission, voir
 * `useMissionClosure.js`). Résout son propre `clinicID` (même pattern que `fetchClinicId`
 * dans `useClinicRequest.js`) plutôt que de le recevoir en paramètre — cohérent avec le reste
 * des composables de ce repo, aucun ne reçoit ses dépendances en injection aujourd'hui.
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

      const { data: vetData } = await client.graphql({
        query: getVeterinarian,
        variables: { id: userId },
        authMode: 'userPool',
      })

      const clinicID = vetData.getVeterinarian?.clinicID
      if (!clinicID) throw new Error('Clinique introuvable pour ce vétérinaire')

      const { data } = await client.graphql({
        query: getClinic,
        variables: { id: clinicID },
        authMode: 'userPool',
      })

      transfusionsDone.value = data.getClinic?.transfusionsDone ?? 0
      donorOwnersCount.value = data.getClinic?.donorOwnersCount ?? 0
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
