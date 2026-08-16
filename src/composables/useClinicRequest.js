import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { useRouter } from 'vue-router'
import { getCurrentUser } from 'aws-amplify/auth'

// 👇 On garde vos requêtes existantes
import { getVeterinarian } from '@/graphql/queries'
import { listRequestsByClinic } from '@/graphql/custom-queries'

// 👇 On importe les mutations SIMPLES pour éviter les erreurs de sous-champs
import { createRequestSimple, updateRequestStatusSimple } from '@/graphql/custom-mutations'
import { Species, RequestStatus } from '@/constants/enums'

export function useClinicRequests() {
  const client = generateClient()
  const router = useRouter()

  const requests = ref([])
  const isLoading = ref(false)
  const isCreating = ref(false)
  // Refs de loading dédiées (Phase 6.6) — consommées par le bouton "Confirmer" de la
  // dialog de confirmation partagée fermeture/annulation dans RequestsView.vue.
  const isClosing = ref(false)
  const isCancelling = ref(false)
  const clinicId = ref(null)
  // Distingue "chargement en erreur" d'une liste réellement vide — même convention que
  // `loadError` dans useClinicDonors.js/useAnimalValidation.js (CLAUDE.md). Ajouté en
  // Phase 3.3 pour useClinicHistory.js, qui réutilise fetchRequests() et a besoin de
  // distinguer un échec réseau d'un historique réellement vide ; purement additif, ne
  // change pas le comportement observable de RequestsView.vue (qui ne le consomme pas).
  const loadError = ref(false)

  /**
   * Résout et mémoïse le `clinicID` du Veterinarian courant (un seul aller-retour réseau par
   * instance de composable).
   *
   * Ne catch PAS ses propres erreurs (Phase 7.6, R-12 — contrairement à l'ancienne version qui
   * avalait tout dans un `console.error` + `return null`) : elle ne renvoie `null` QUE pour le
   * cas légitime "ce Veterinarian n'a pas (encore) de clinicID" — une vraie erreur (réseau,
   * `@auth`, `getCurrentUser()` sans session...) est laissée à remonter à l'appelant. Sans cette
   * distinction, `fetchRequests()` ne pouvait pas différencier "cet Owner n'a simplement pas de
   * clinique" (état légitime, ne doit jamais s'afficher comme une erreur) d'un vrai échec de
   * résolution du contexte clinique (doit déclencher `loadError`) : les deux ressortaient
   * identiquement en `null`. Même pattern que `fetchClinicContext()` dans useClinicDonors.js, qui
   * ne catch pas non plus ses propres appels réseau, pour la même raison.
   */
  const fetchClinicId = async () => {
    if (clinicId.value) return clinicId.value

    const { userId } = await getCurrentUser()
    if (!userId) throw new Error('Utilisateur non connecté')

    const { data } = await client.graphql({
      query: getVeterinarian,
      variables: { id: userId },
      authMode: 'userPool',
    })

    const vet = data.getVeterinarian
    if (!vet || !vet.clinicID) return null

    clinicId.value = vet.clinicID
    return vet.clinicID
  }

  const fetchRequests = async () => {
    isLoading.value = true
    loadError.value = false
    try {
      const cId = await fetchClinicId()
      if (!cId) {
        requests.value = []
        return
      }

      const { data } = await client.graphql({
        query: listRequestsByClinic,
        variables: { filter: { clinicID: { eq: cId } } },
        authMode: 'userPool',
      })

      requests.value = data.listRequests.items.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      )
    } catch (e) {
      console.error('Erreur chargement demandes:', e)
      loadError.value = true
    } finally {
      isLoading.value = false
    }
  }

  const createNewRequest = async (formData) => {
    isCreating.value = true
    try {
      // 1. On récupère l'ID clinique
      const cId = await fetchClinicId()
      if (!cId) throw new Error('Impossible de créer : Clinique introuvable.')

      // 2. MAPPING SÉCURISÉ DES ENUMS (C'est souvent là que ça plante)
      // On s'assure que "Chien" ou "dog" devient bien "DOG" pour GraphQL
      const speciesMap = {
        dog: Species.DOG, chien: Species.DOG,
        cat: Species.CAT, chat: Species.CAT,
      }
      const safeSpecies = speciesMap[formData.species?.toLowerCase()]
      // Contexte médical vétérinaire : une Request créée pour la mauvaise espèce est un
      // risque sécurité, pas un simple bug d'UI. On ne défaulte JAMAIS silencieusement sur
      // DOG — une espèce non reconnue doit bloquer la soumission.
      if (!safeSpecies) {
        throw new Error(
          `Espèce non reconnue : "${formData.species}". Impossible de créer la demande.`,
        )
      }

      const input = {
        clinicID: cId,
        requestType: formData.type === 'emergency' ? 'EMERGENCY' : 'APPOINTMENT',
        requiredSpecies: safeSpecies,
        requiredBloodGroup: formData.bloodGroup,
        quantity: parseInt(formData.quantity), // On s'assure que c'est un entier
        status: 'OPEN',
      }

      // Phase 6.5 (ADR-0005) : appointmentDatetime n'a de sens que pour un RDV planifié
      // (non-pertinent pour 'emergency', laissé absent de l'input dans ce cas plutôt que
      // d'envoyer explicitement `null`). NewRequestView.vue impose déjà ce champ avant
      // d'appeler createNewRequest() pour un RDV (voir son handleSubmit) -- ce garde-fou
      // supplémentaire évite malgré tout d'envoyer un appointmentDatetime vide/invalide si
      // ce composable est un jour appelé par un autre appelant sans cette validation UI.
      if (formData.type === 'appointment' && formData.appointmentDatetime) {
        input.appointmentDatetime = new Date(formData.appointmentDatetime).toISOString()
      }

      // 3. Appel de la mutation simple
      await client.graphql({
        query: createRequestSimple,
        variables: { input },
        authMode: 'userPool',
      })

      await fetchRequests()
      await router.push('/dashboard/requests')

    } catch (e) {
      // 👇 LE LOG DÉTAILLÉ POUR LE DÉBUG
      console.error("💥 ERREUR CRÉATION DEMANDE 💥")

      // R-05 : `e.errors` peut être présent mais vide selon la forme de l'erreur renvoyée par
      // client.graphql() — indexer [0] sans vérifier la longueur levait une TypeError qui
      // masquait l'erreur GraphQL d'origine de création de Request derrière une erreur de log.
      if (e.errors?.length > 0) {
        console.error("👉 Message Backend :", e.errors[0].message)
        console.error("👉 Type d'erreur :", e.errors[0].errorType)
      } else {
        console.error(e)
      }
      throw e
    } finally {
      isCreating.value = false
    }
  }

  const closeRequest = async (requestId) => {
    isClosing.value = true
    try {
      await client.graphql({
        query: updateRequestStatusSimple,
        variables: { input: { id: requestId, status: 'CLOSED' } },
        authMode: 'userPool',
      })
      const req = requests.value.find((r) => r.id === requestId)
      if (req) req.status = 'CLOSED'
    } catch (e) {
      console.error('Erreur fermeture demande:', e)
      throw e
    } finally {
      isClosing.value = false
    }
  }

  /**
   * Annule une Request OPEN (RequestStatus.CANCELLED) — Phase 6.6. Distincte de
   * `closeRequest()` : une Request CLOSED signifie qu'un don a eu lieu ou que le besoin a
   * été comblé (cycle de vie "normal"), une Request CANCELLED signifie une erreur de
   * saisie ou un besoin disparu avant tout don (cycle de vie "annulé"). Même mutation
   * `*Simple` sous-jacente (`updateRequestStatusSimple`, custom-mutations.js, déjà
   * existante — aucune nouvelle mutation ni changement de schéma nécessaire, `CANCELLED`
   * est déjà une valeur acceptée par `enum RequestStatus` côté schema.graphql), seul le
   * statut cible change.
   */
  const cancelRequest = async (requestId) => {
    isCancelling.value = true
    try {
      await client.graphql({
        query: updateRequestStatusSimple,
        variables: { input: { id: requestId, status: RequestStatus.CANCELLED } },
        authMode: 'userPool',
      })
      const req = requests.value.find((r) => r.id === requestId)
      if (req) req.status = RequestStatus.CANCELLED
    } catch (e) {
      console.error('Erreur annulation demande:', e)
      throw e
    } finally {
      isCancelling.value = false
    }
  }

  return {
    requests,
    isLoading,
    isCreating,
    isClosing,
    isCancelling,
    loadError,
    fetchRequests,
    createNewRequest,
    closeRequest,
    cancelRequest,
  }
}
