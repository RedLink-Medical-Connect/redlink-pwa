import { computed, ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { getCurrentUser } from 'aws-amplify/auth'
import { isValidatedDonor, calculateDistance } from '@/services/eligibility-service'
import { throwIfGraphqlError } from '@/services/graphql-error-service'

/**
 * Phase 3.2 : composable Veterinarian-facing pour l'annuaire des donneurs de la clinique
 * courante (DonorsView.vue). Lit `ClinicOwnerRelation` — peuplée depuis Phase 3.1
 * (`useMissionClosure.js`, upsert best-effort à la clôture COMPLETED d'une Mission) — et
 * la traverse jusqu'aux `Animal` de chaque `Owner` rattaché, en une seule requête
 * imbriquée, pas de boucle N+1.
 *
 * Une ligne du résultat = un couple (Animal, Owner) — la table de DonorsView.vue est
 * animal-centrique (un Owner avec plusieurs Animals Validated Donor apparaît sur
 * plusieurs lignes), pas Owner-centrique.
 *
 * Ne surface PAS `isPrimaryClinic` : hors périmètre de cette vue (annuaire de donneurs,
 * pas gestion de la relation clinique/propriétaire).
 *
 * Phase 8, sous-tâche 5 (lot 2/3) : migré sur le client Gen2 (`aws-amplify/data`,
 * `client.models.Veterinarian.*`/`client.models.ClinicOwnerRelation.*`). Les deux queries
 * imbriquées Gen1 (`getVetWithClinic`, `listClinicDonorsByClinicID`, custom-queries.js)
 * n'ont plus lieu d'être ici : leur équivalent Gen2 est l'option `selectionSet` (confirmé
 * via context7, `/aws-amplify/amplify-data`, "Query Related Data with Selection Set") --
 * voir `fetchClinicContext()`/`fetchDonors()` ci-dessous. Sur le changement de
 * comportement d'erreur Gen1 -> Gen2 et `throwIfGraphqlError` : voir le JSDoc de
 * `src/services/graphql-error-service.js`.
 *
 * Décision (`selectionSet` de `fetchClinicContext()`) : contrairement à
 * `useClinicSettings.fetchSettings()` (qui a besoin de TOUS les champs de `Clinic` pour
 * peupler un formulaire d'édition), ce composable ne lit jamais que
 * `vet.clinicID`/`vet.clinic.latitude`/`vet.clinic.longitude` (calcul de distance) --
 * `getVetWithClinic` (Gen1) sélectionnait les 8 champs de `Clinic` parce qu'un seul
 * document GraphQL partagé servait plusieurs composables à la fois ; en Gen2, le
 * `selectionSet` est posé par CHAQUE appelant, donc chaque composable ne demande que ce
 * qu'il consomme réellement plutôt que de recopier aveuglément la sélection Gen1 partagée
 * -- moins de sur-fetch, comportement observable inchangé (les seuls champs jamais lus
 * ici restent lisibles).
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

  // Phase 6.6 : recherche client-side sur l'annuaire déjà chargé (`donors`) — pas
  // d'aller-retour GraphQL supplémentaire (voir docstring de `fetchDonors()` : tout est
  // déjà en mémoire après le premier chargement).
  const searchQuery = ref('')

  /**
   * Critères de recherche choisis (Phase 6.6) : nom d'animal, nom/prénom du propriétaire,
   * groupe sanguin — les trois colonnes textuelles réellement affichées dans
   * DonorsView.vue (`columns.animal`/`columns.owner`/`columns.blood`). Volontairement PAS
   * la race (`breed`) : présente dans les données mais pas affichée comme colonne dans
   * cette vue, donc un match dessus surprendrait l'utilisateur sans qu'il puisse voir sur
   * quoi il a matché. Comparaison insensible à la casse, sous-chaîne (`includes`), sans
   * normalisation des accents (aucun utilitaire de ce type ailleurs dans le repo à ce
   * jour — pas introduit ici pour une seule vue).
   */
  const filteredDonors = computed(() => {
    const query = searchQuery.value.trim().toLowerCase()
    if (!query) return donors.value

    return donors.value.filter((donor) => {
      const haystack = [donor.animalName, donor.ownerFirstname, donor.ownerLastname, donor.bloodGroup]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  })

  /**
   * Résout le `clinicID` du Veterinarian courant ET les coordonnées GPS de sa clinique
   * (nécessaires au calcul de distance ci-dessous) en un seul appel `Veterinarian.get()`
   * avec `selectionSet` (voir décision ci-dessus sur le périmètre du `selectionSet`).
   *
   * Mémoïsé sur l'instance du composable (comme `fetchClinicId()` dans
   * useClinicRequest.js) : un seul appel réseau par montage de vue, même si
   * `fetchDonors()` est rappelée (ex. bouton "Réessayer").
   *
   * Ne catch PAS ses propres erreurs (même convention que `fetchClinicId()` dans
   * useClinicRequest.js/useClinicSettings.js) : elle ne renvoie `null` QUE pour le cas
   * légitime "ce Veterinarian n'a pas (encore) de clinicID/clinic" — une vraie erreur
   * (réseau, `@auth`...) remonte jusqu'au `try/catch` de `fetchDonors()`, seul à même de
   * distinguer "en erreur" de "légitimement vide".
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

    const { data, errors } = await client.models.Veterinarian.get(
      { id: userId },
      { selectionSet: ['id', 'clinicID', 'clinic.id', 'clinic.latitude', 'clinic.longitude'] },
    )

    throwIfGraphqlError(errors, 'getVeterinarian')

    const vet = data
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

      const { data, errors } = await client.models.ClinicOwnerRelation.list({
        filter: { clinicID: { eq: context.clinicId } },
        selectionSet: [
          'ownerID',
          'ownerProfile.id',
          'ownerProfile.firstname',
          'ownerProfile.lastname',
          'ownerProfile.phone',
          'ownerProfile.latitude',
          'ownerProfile.longitude',
          'ownerProfile.animals.id',
          'ownerProfile.animals.name',
          'ownerProfile.animals.species',
          'ownerProfile.animals.breed',
          'ownerProfile.animals.bloodGroup',
          'ownerProfile.animals.isValidatedDonor',
          'ownerProfile.animals.validationExpiresAt',
          'ownerProfile.animals.lastDonationDate',
        ],
      })

      throwIfGraphqlError(errors, 'clinicOwnerRelationsByClinicID')

      const relations = data || []

      const rows = []
      for (const relation of relations) {
        const owner = relation.ownerProfile
        if (!owner) continue

        const animals = owner.animals || []
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
    filteredDonors,
    searchQuery,
    isLoading,
    loadError,
    fetchDonors,
  }
}
