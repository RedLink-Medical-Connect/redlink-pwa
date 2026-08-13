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
 * clinique — voir schema.graphql, type Animal). Un filtrage réel par clinique existerait en
 * combinant `getVeterinarian` (résout le `clinicID` du vétérinaire courant, cf.
 * `fetchClinicId()` dans `useClinicRequest.js`) avec la query générée
 * `clinicOwnerRelationsByClinicID` (existe déjà dans queries.js, mais jamais composée avec
 * une liste d'Animals nulle part dans ce repo) — pas construit ici, déferré à une phase
 * ultérieure avec le même trou pour "Clinic Priority". Pour ce pilote (une seule école
 * vétérinaire partenaire), une liste globale est une simplification honnête : elle
 * correspond exactement à ce que le modèle @auth permet déjà, plutôt que de simuler côté
 * client une frontière de sécurité par clinique qui n'existe pas réellement.
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
 * @auth, cf. ADR-0002). En revanche, la règle "un groupe sanguin connu est un prérequis à
 * la validation" (CONTEXT.md, "un Animal Validated Donor à groupe sanguin inconnu ne peut
 * pas exister") EST appliquée ici, comme l'assigne explicitement l'amendement de l'ADR-0002
 * à ce fichier précis — `validateAnimal` refuse la validation si le `bloodGroup` connu
 * localement (issu de `pendingAnimals`) est absent/`''`/`'UNKNOWN'`, même prédicat que celui
 * déjà utilisé par `isBloodCompatible` (eligibility-service.js) pour rester cohérent.
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
   * Refuse (throw `BLOOD_GROUP_UNKNOWN`) si l'Animal est trouvé dans `pendingAnimals` et que
   * son `bloodGroup` est absent/`'UNKNOWN'` — CONTEXT.md interdit un Validated Donor à groupe
   * sanguin inconnu. Si l'Animal n'est PAS (plus) dans `pendingAnimals` (ex. déjà validé par
   * un autre vétérinaire entre-temps), on ne peut pas vérifier son `bloodGroup` sans un fetch
   * supplémentaire — on laisse alors la mutation partir telle quelle, comme avant : ce cas
   * limite reste couvert par la revue humaine de la Mission plutôt que bloqué ici.
   *
   * @param {string} animalId
   */
  const validateAnimal = async (animalId) => {
    isValidating.value = true
    try {
      const knownAnimal = pendingAnimals.value.find((a) => a.id === animalId)
      if (knownAnimal && (!knownAnimal.bloodGroup || knownAnimal.bloodGroup === 'UNKNOWN')) {
        throw new Error('BLOOD_GROUP_UNKNOWN')
      }

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
