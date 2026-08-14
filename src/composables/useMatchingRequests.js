import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { listOpenRequestsWithClinic, myClinicRelationsByOwnerID } from '@/graphql/custom-queries'
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

      // 2. Récupérer les Clinic déjà liées à cet Owner (ClinicOwnerRelation), pour le
      // critère 5 de l'Eligibility (Clinic Priority, CONTEXT.md). Refetché à chaque appel
      // de searchMatches() plutôt que mémoïsé comme fetchClinicId() ailleurs dans ce repo :
      // une recherche est déjà une action de rafraîchissement complet, donc le coût d'un
      // aller-retour GraphQL de plus ici est négligeable face à la complexité d'un cache.
      //
      // Try/catch dédié (relevé en Lead Dev review) : Clinic Priority est un critère
      // explicitement non-exclusif ("favorise, sans exclure", CONTEXT.md/eligibility-service.js).
      // Sans ce bloc séparé, un échec transitoire de CET appel précis (throttling, hoquet
      // @auth...) faisait avorter tout `searchMatches()` et vidait `matches.value` en entier —
      // un critère purement consultatif aurait alors accidentellement exclu TOUTES les
      // Requests, pas seulement désactivé son propre tri. Repli sur [] : dégrade la sous-tâche
      // en "aucune priorité connue", jamais en "aucun résultat".
      let ownerClinicIds = []
      try {
        const { userId } = await getCurrentUser()
        const { data: relationsData } = await client.graphql({
          query: myClinicRelationsByOwnerID,
          variables: { ownerID: userId },
          authMode: 'userPool',
        })
        ownerClinicIds = (relationsData.clinicOwnerRelationsByOwnerID?.items || []).map(
          (item) => item.clinicID,
        )
      } catch (e) {
        console.error('Erreur chargement des cliniques déjà liées (Clinic Priority) :', e)
      }

      // 3. Récupérer TOUTES les demandes ouvertes
      // Note : Pour un MVP, filtrer côté client est acceptable et plus simple
      const { data } = await client.graphql({
        query: listOpenRequestsWithClinic,
        variables: { filter: { status: { eq: RequestStatus.OPEN } } },
        authMode: 'userPool'
      })

      const allRequests = data.listRequests.items

      // 4. Le Moteur de Matching : on passe par le composite checkEligibility()
      // (src/services/eligibility-service.js) pour que les 5 critères de
      // l'Eligibility (CONTEXT.md) soient réellement appliqués ici, et pas
      // seulement dans useOwnerMissions.acceptMission comme avant ce fix.
      const compatibleRequests = allRequests.filter(req => {
        for (const animal of animals.value) {
          const result = checkEligibility({
            animal,
            request: req,
            ownerLatitude: myLat,
            ownerLongitude: myLon,
            maxTravelDistance: maxDist,
            ownerClinicIds,
          })

          if (result.eligible) {
            // On attache l'animal qui matche, la distance et le critère Clinic Priority
            // pour l'affichage, même arrondi qu'avant ce fix.
            req.matchingAnimal = animal
            req.distanceKM = Math.round(result.distanceKM * 10) / 10
            req.hasClinicPriority = result.hasClinicPriority
            return true
          }
        }

        return false
      })

      // 5. Trier : Clinic Priority (critère 5, CONTEXT.md) d'abord en GROUPEMENT PRIMAIRE
      // (les Requests d'une Clinic déjà connue de l'Owner remontent en bloc en tête de
      // liste), puis par distance croissante au sein de chaque groupe.
      //
      // Décision produit/UX à relire (voir rapport de sous-tâche) : le CdC/CONTEXT.md dit
      // seulement "favorise, sans exclure" sans préciser l'ordre relatif à la distance
      // (critère 4). Deux lectures existaient : (a) Clinic Priority comme groupement
      // primaire (implémenté ici), ou (b) Clinic Priority comme simple départage à distance
      // strictement égale. On retient (a) : deux distances GPS réelles sont quasiment
      // jamais rigoureusement égales, donc (b) rendrait Clinic Priority inerte en pratique
      // — un critère nommé dans le CdC qui ne changerait jamais rien à l'écran. (a) lui
      // donne un effet réel et défendable (l'Owner voit d'abord les demandes d'une clinique
      // qu'il connaît déjà) tout en respectant "sans exclure" : rien n'est jamais retiré de
      // la liste, seulement réordonné. Changement d'un comparateur si cette lecture ne
      // convient pas à l'usage.
      matches.value = compatibleRequests.sort((a, b) => {
        if (a.hasClinicPriority !== b.hasClinicPriority) {
          return a.hasClinicPriority ? -1 : 1
        }
        return a.distanceKM - b.distanceKM
      })

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
