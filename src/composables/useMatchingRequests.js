import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { listRequests } from '@/graphql/queries'
import { calculateDistance, isBloodCompatible } from '@/services/geolocation-service'
import { useAnimals } from '@/composables/useAnimals'
import { useOwnerProfile } from '@/composables/useOwnerProfile'

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
        query: listRequests,
        variables: { filter: { status: { eq: 'OPEN' } } },
        authMode: 'userPool'
      })

      const allRequests = data.listRequests.items

      // 3. Le Moteur de Matching
      const compatibleRequests = allRequests.filter(req => {
        // A. Vérification Géographique
        if (!req.clinic || !req.clinic.latitude || !req.clinic.longitude) return false

        const dist = calculateDistance(myLat, myLon, req.clinic.latitude, req.clinic.longitude)

        // On attache la distance calculée à l'objet pour l'affichage
        req.distanceKM = Math.round(dist * 10) / 10

        if (dist > maxDist) return false

        // B. Vérification Compatibilité Animaux
        // On cherche SI l'un de mes animaux correspond à la demande
        const potentialDonor = animals.value.find(animal =>
          isBloodCompatible(
            req.requiredSpecies,
            req.requiredBloodGroup,
            animal.species,
            animal.bloodGroup
          )
        )

        if (potentialDonor) {
          // On attache l'animal qui matche pour pouvoir dire "Rex peut aider !"
          req.matchingAnimal = potentialDonor
          return true
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
