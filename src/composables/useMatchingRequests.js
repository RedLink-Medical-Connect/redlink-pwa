import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { listOpenRequestsWithClinic } from '@/graphql/custom-queries'
import { checkEligibility } from '@/services/eligibility-service'
import { useAnimals } from '@/composables/useAnimals'
import { useOwnerProfile } from '@/composables/useOwnerProfile'
import { RequestStatus } from '@/constants/enums'

export function useMatchingRequests() {
  const client = generateClient()
  const matches = ref([])
  const isLoading = ref(false)

  // On réutilise vos composables existants pour avoir les données du user
  const { animals, fetchAnimals } = useAnimals()
  // useOwnerProfile() expose `form` (et non `ownerProfile`) : on l'alias ici
  // pour ne pas toucher au reste de la logique de ce composable.
  const { form: ownerProfile, fetchProfile } = useOwnerProfile()

  const searchMatches = async () => {
    isLoading.value = true
    matches.value = []

    try {
      // 1. S'assurer qu'on a bien les infos du propriétaire et ses animaux
      // `form` (alias ownerProfile) est toujours un objet non-nul par défaut,
      // donc on ne peut pas se fier à sa nullité pour savoir s'il faut le
      // récupérer : on le charge systématiquement.
      await fetchProfile()
      if (animals.value.length === 0) await fetchAnimals()

      // Si pas d'animaux, on ne peut rien faire
      if (animals.value.length === 0) {
        return
      }

      const myLat = ownerProfile.value.latitude
      const myLon = ownerProfile.value.longitude
      // Par défaut 50km si non renseigné
      const maxDist = ownerProfile.value.maxTravelDistance || 50

      // 2. Récupérer TOUTES les demandes ouvertes
      // Note : Pour un MVP, filtrer côté client est acceptable et plus simple
      const { data } = await client.graphql({
        query: listOpenRequestsWithClinic,
        variables: { filter: { status: { eq: RequestStatus.OPEN } } },
        authMode: 'userPool'
      })

      const allRequests = data.listRequests.items

      // 3. Le Moteur de Matching : on passe par le composite checkEligibility()
      // (src/services/eligibility-service.js) pour que les 5 critères de
      // l'Eligibility (CONTEXT.md) soient réellement appliqués ici, et pas
      // seulement dans useOwnerMissions.acceptMission comme avant ce fix.
      // Clinic Priority (critère 5, tri seulement) est explicitement hors
      // périmètre ici : ownerClinicIds reste à sa valeur par défaut ([]).
      const compatibleRequests = allRequests.filter(req => {
        for (const animal of animals.value) {
          const result = checkEligibility({
            animal,
            request: req,
            ownerLatitude: myLat,
            ownerLongitude: myLon,
            maxTravelDistance: maxDist,
          })

          if (result.eligible) {
            // On attache l'animal qui matche et la distance pour l'affichage,
            // même arrondi qu'avant ce fix.
            req.matchingAnimal = animal
            req.distanceKM = Math.round(result.distanceKM * 10) / 10
            return true
          }
        }

        return false
      })

      // 4. Trier par distance (le plus proche en premier)
      matches.value = compatibleRequests.sort((a, b) => a.distanceKM - b.distanceKM)

    } catch (e) {
      console.error("Erreur matching:", e)
    } finally {
      isLoading.value = false
    }
  }

  return {
    matches,
    isLoading,
    searchMatches
  }
}
