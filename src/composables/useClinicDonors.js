import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { getCurrentUser } from 'aws-amplify/auth'
import { getVetWithClinic, listClinicDonorsByClinicID } from '@/graphql/custom-queries'
import { isValidatedDonor, calculateDistance } from '@/services/eligibility-service'

/**
 * Phase 3.2 : composable Veterinarian-facing pour l'annuaire des donneurs de la clinique
 * courante (DonorsView.vue). Lit `ClinicOwnerRelation` — peuplée depuis Phase 3.1
 * (`useMissionClosure.js`, upsert best-effort à la clôture COMPLETED d'une Mission) — et
 * la traverse jusqu'aux `Animal` de chaque `Owner` rattaché, en une seule requête
 * imbriquée (`listClinicDonorsByClinicID`, custom-queries.js), pas de boucle N+1.
 *
 * Une ligne du résultat = un couple (Animal, Owner) — la table de DonorsView.vue est
 * animal-centrique (un Owner avec plusieurs Animals Validated Donor apparaît sur
 * plusieurs lignes), pas Owner-centrique.
 *
 * Ne surface PAS `isPrimaryClinic` : hors périmètre de cette vue (annuaire de donneurs,
 * pas gestion de la relation clinique/propriétaire).
 */
export function useClinicDonors() {
  const client = generateClient()

  const donors = ref([])
  const isLoading = ref(false)
  // Distingue "chargement en erreur" d'un annuaire réellement vide — même convention que
  // `loadError` dans useAnimalValidation.js (CLAUDE.md).
  const loadError = ref(false)

  const clinicId = ref(null)
  const clinicLatitude = ref(null)
  const clinicLongitude = ref(null)

  /**
   * Résout le `clinicID` du Veterinarian courant ET les coordonnées GPS de sa clinique
   * (nécessaires au calcul de distance ci-dessous) en un seul appel à `getVetWithClinic`
   * (déjà utilisée par `useClinicRequest.js`, qui ne récupère elle que l'ID — ici on
   * profite du fait qu'elle sélectionne déjà `clinic.latitude`/`clinic.longitude` pour
   * éviter un second aller-retour GraphQL dédié).
   *
   * Mémoïsé sur l'instance du composable (comme `fetchClinicId()` dans
   * useClinicRequest.js) : un seul appel réseau par montage de vue, même si
   * `fetchDonors()` est rappelée (ex. bouton "Réessayer").
   */
  const fetchClinicContext = async () => {
    if (clinicId.value) {
      return {
        clinicId: clinicId.value,
        latitude: clinicLatitude.value,
        longitude: clinicLongitude.value,
      }
    }

    const { userId } = await getCurrentUser()
    if (!userId) throw new Error('Utilisateur non connecté')

    const { data } = await client.graphql({
      query: getVetWithClinic,
      variables: { id: userId },
      authMode: 'userPool',
    })

    const vet = data.getVeterinarian
    if (!vet?.clinicID || !vet.clinic) return null

    clinicId.value = vet.clinicID
    clinicLatitude.value = vet.clinic.latitude
    clinicLongitude.value = vet.clinic.longitude

    return {
      clinicId: clinicId.value,
      latitude: clinicLatitude.value,
      longitude: clinicLongitude.value,
    }
  }

  /**
   * Charge l'annuaire des donneurs de la clinique courante, aplati en une ligne par
   * (Animal, Owner) et filtré aux seuls Validated Donor courants (`isValidatedDonor()`,
   * eligibility-service.js — traite une validation expirée comme non valide même si le
   * flag brut `Animal.isValidatedDonor` est toujours `true` en base, aucun job planifié
   * ne le corrige : simplification pilote assumée, même raisonnement que
   * `useAnimalValidation.js`).
   *
   * `distanceKM` : distance entre la clinique et l'Owner (pas l'Animal — `Animal` n'a pas
   * de coordonnées propres dans ce schéma), calculée via `calculateDistance()`
   * (eligibility-service.js) et arrondie au dixième (`Math.round(x * 10) / 10`), même
   * arrondi que `useMatchingRequests.searchMatches()`. `null` si la distance n'est pas
   * calculable (coordonnées manquantes côté clinique ou Owner) plutôt que d'afficher
   * "Infinity km".
   */
  const fetchDonors = async () => {
    isLoading.value = true
    loadError.value = false
    try {
      const context = await fetchClinicContext()
      if (!context) {
        donors.value = []
        return
      }

      const { data } = await client.graphql({
        query: listClinicDonorsByClinicID,
        variables: { clinicID: context.clinicId },
        authMode: 'userPool',
      })

      const relations = data.clinicOwnerRelationsByClinicID.items || []

      const rows = []
      for (const relation of relations) {
        const owner = relation.ownerProfile
        if (!owner) continue

        const animals = owner.animals?.items || []
        for (const animal of animals) {
          if (!isValidatedDonor(animal)) continue

          const rawDistance = calculateDistance(
            context.latitude,
            context.longitude,
            owner.latitude,
            owner.longitude,
          )
          const distanceKM = Number.isFinite(rawDistance)
            ? Math.round(rawDistance * 10) / 10
            : null

          rows.push({
            animalId: animal.id,
            animalName: animal.name,
            species: animal.species,
            breed: animal.breed,
            bloodGroup: animal.bloodGroup,
            lastDonationDate: animal.lastDonationDate,
            distanceKM,
            ownerId: owner.id,
            ownerFirstname: owner.firstname,
            ownerLastname: owner.lastname,
            ownerPhone: owner.phone,
            ownerAddress: owner.address,
          })
        }
      }

      donors.value = rows
    } catch (e) {
      console.error("Erreur chargement de l'annuaire des donneurs:", e)
      loadError.value = true
      donors.value = []
    } finally {
      isLoading.value = false
    }
  }

  return {
    donors,
    isLoading,
    loadError,
    fetchDonors,
  }
}
