import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { listAnimalsForValidation } from '@/graphql/custom-queries'
import { validateAnimalDonorSimple } from '@/graphql/custom-mutations'
import { isValidatedDonor } from '@/services/eligibility-service'

// Durée d'une validation vétérinaire (CONTEXT.md, "Validated Donor") : 1 an, renouvelable
// en consultation.
const VALIDATION_DURATION_MS = 365 * 24 * 60 * 60 * 1000

/**
 * Phase 1.1 : composable Veterinarian-facing pour la liste des Animals en attente de
 * validation, et l'action de validation elle-même (ADR-0002).
 *
 * ⚠️ Portée volontairement GLOBALE, pas "ma clinique" : `Animal` n'accorde aux
 * Veterinarians qu'un accès `read` global dans le schéma actuel (aucun scoping par
 * clinique — voir schema.graphql, type Animal), et l'infrastructure de requête
 * `ClinicOwnerRelation` nécessaire à un vrai filtrage par clinique n'existe encore nulle
 * part dans ce repo (déferrée à une phase ultérieure, avec le même trou pour "Clinic
 * Priority"). Pour ce pilote (une seule école vétérinaire partenaire), une liste globale
 * est une simplification honnête : elle correspond exactement à ce que le modèle @auth
 * permet déjà, plutôt que de simuler côté client une frontière de sécurité par clinique
 * qui n'existe pas réellement.
 *
 * Un Animal est "en attente" si `!isValidatedDonor(animal)` (eligibility-service.js) :
 * ça couvre aussi bien un Animal jamais validé qu'un Animal dont `isValidatedDonor` vaut
 * encore `true` en base mais dont `validationExpiresAt` est déjà dépassée — ce repo n'a
 * pas de job planifié qui repasse `isValidatedDonor` à `false` à l'expiration (
 * simplification pilote assumée), donc le statut réel se calcule toujours à la lecture
 * via cette fonction, jamais en faisant confiance au flag brut de la DB.
 *
 * `bloodGroup` n'est JAMAIS écrit ici : les Veterinarians n'ont aucun accès en écriture
 * dessus (seuls `isValidatedDonor` et `validationExpiresAt` sont ouverts en écriture par
 * @auth, cf. ADR-0002) — la règle "un groupe sanguin connu est un prérequis à la
 * validation" (CONTEXT.md) reste donc une vérification à faire côté UI (Phase 1.2, hors
 * périmètre de ce composable), pas quelque chose que ce composable peut faire respecter
 * en écrivant sur `bloodGroup`.
 */
export function useAnimalValidation() {
  const client = generateClient()

  const pendingAnimals = ref([])
  const isLoading = ref(false)
  const isValidating = ref(false)

  /**
   * Charge tous les Animals (liste globale, voir doc du composable) puis filtre côté
   * client ceux en attente de validation (`!isValidatedDonor(animal)`).
   */
  const fetchPendingValidations = async () => {
    isLoading.value = true
    try {
      const { data } = await client.graphql({
        query: listAnimalsForValidation,
        authMode: 'userPool',
      })

      const animals = data.listAnimals.items || []
      pendingAnimals.value = animals.filter((animal) => !isValidatedDonor(animal))
    } catch (e) {
      console.error('Erreur chargement des animaux en attente de validation:', e)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Valide un Animal comme donneur pour 1 an à partir de maintenant. N'écrit QUE
   * `isValidatedDonor` et `validationExpiresAt` (validateAnimalDonorSimple, ADR-0002) —
   * jamais `bloodGroup` ni aucun autre champ.
   *
   * @param {string} animalId
   */
  const validateAnimal = async (animalId) => {
    isValidating.value = true
    try {
      const validationExpiresAt = new Date(Date.now() + VALIDATION_DURATION_MS).toISOString()

      await client.graphql({
        query: validateAnimalDonorSimple,
        variables: {
          input: {
            id: animalId,
            isValidatedDonor: true,
            validationExpiresAt,
          },
        },
        authMode: 'userPool',
      })

      pendingAnimals.value = pendingAnimals.value.filter((animal) => animal.id !== animalId)
    } catch (e) {
      console.error("Erreur validation vétérinaire de l'animal:", e)
      throw e
    } finally {
      isValidating.value = false
    }
  }

  return {
    pendingAnimals,
    isLoading,
    isValidating,
    fetchPendingValidations,
    validateAnimal,
  }
}
