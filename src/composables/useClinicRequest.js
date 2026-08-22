import { ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { useRouter } from 'vue-router'
import { getCurrentUser } from 'aws-amplify/auth'
import { Species, RequestStatus, RequestType } from '@/constants/enums'
import { throwIfGraphqlError } from '@/services/graphql-error-service'

// Phase 8, sous-tâche 5 (lot 2/3) : migré sur le client Gen2 (`aws-amplify/data`,
// `client.models.Veterinarian.*`/`client.models.Request.*`). Plus d'import depuis
// `@/graphql/queries`/`@/graphql/custom-queries`/`@/graphql/custom-mutations` -- le client
// Gen2 sélectionne déjà les champs scalaires du modèle par défaut (`fetchClinicId()`), et
// l'objet `input` passé à `create()`/`update()` limite déjà les champs envoyés (voir
// CLAUDE.md/`amplify/data/resource.ts`).
//
// `listRequestsByClinic` (Gen1) sélectionnait explicitement la relation imbriquée
// `mission.animal.ownerProfile` sur 3 niveaux -- son équivalent Gen2 est l'option
// `selectionSet` (confirmé via context7, `/aws-amplify/amplify-data`, "Query Related Data
// with Selection Set"), qui supporte les chemins pointés à plusieurs niveaux
// (`mission.animal.ownerProfile.phone`), voir `fetchRequests()` ci-dessous.
//
// Sur le changement de comportement d'erreur Gen1 -> Gen2 (`client.models.X.*` résout
// `{ data, errors }` au lieu de lever une exception) et sa traduction via
// `throwIfGraphqlError` ci-dessous : voir le JSDoc de `src/services/graphql-error-service.js`.
// `createNewRequest()`'s `catch` (bloc R-05/R-17) continue de lire `e.errors` sans
// changement : l'exception synthétisée par `throwIfGraphqlError` porte cette même
// propriété, exactement le format qu'attendait déjà ce bloc en Gen1.

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

    const { data, errors } = await client.models.Veterinarian.get(
      { id: userId },
      // Revue Lead Dev (lot 2) : seul `data.clinicID` est lu plus bas -- `selectionSet`
      // explicite plutôt que la sélection scalaire par défaut du client Gen2 (même principe
      // que `useClinicDonors.fetchClinicContext()`/`useClinicStats.fetchStats()`, voir
      // CLAUDE.md, section Backend/Infra).
      { selectionSet: ['clinicID'] },
    )

    throwIfGraphqlError(errors, 'getVeterinarian')

    if (!data || !data.clinicID) return null

    clinicId.value = data.clinicID
    return data.clinicID
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

      const { data, errors } = await client.models.Request.list({
        filter: { clinicID: { eq: cId } },
        selectionSet: [
          'id',
          'requestType',
          'requiredSpecies',
          'requiredBloodGroup',
          'quantity',
          'status',
          'createdAt',
          'updatedAt',
          'clinicID',
          'mission.id',
          'mission.status',
          'mission.animalID',
          'mission.createdAt',
          'mission.updatedAt',
          'mission.animal.name',
          'mission.animal.breed',
          'mission.animal.weight',
          'mission.animal.ownerID',
          'mission.animal.ownerProfile.phone',
          'mission.animal.ownerProfile.firstname',
          'mission.animal.ownerProfile.lastname',
        ],
      })

      throwIfGraphqlError(errors, 'listRequests')

      requests.value = (data || []).sort(
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
        requestType: formData.type === 'emergency' ? RequestType.EMERGENCY : RequestType.APPOINTMENT,
        requiredSpecies: safeSpecies,
        requiredBloodGroup: formData.bloodGroup,
        quantity: parseInt(formData.quantity), // On s'assure que c'est un entier
        status: RequestStatus.OPEN,
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

      // 3. Appel de la mutation
      const { errors } = await client.models.Request.create(input)

      throwIfGraphqlError(errors, 'createRequest')

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
      const { errors } = await client.models.Request.update({
        id: requestId,
        status: RequestStatus.CLOSED,
      })

      throwIfGraphqlError(errors, 'updateRequest')

      const req = requests.value.find((r) => r.id === requestId)
      if (req) req.status = RequestStatus.CLOSED
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
   * sous-jacente (`client.models.Request.update()`), seul le statut cible change --
   * `CANCELLED` est déjà une valeur acceptée par `RequestStatus` côté
   * `amplify/data/resource.ts`.
   */
  const cancelRequest = async (requestId) => {
    isCancelling.value = true
    try {
      const { errors } = await client.models.Request.update({
        id: requestId,
        status: RequestStatus.CANCELLED,
      })

      throwIfGraphqlError(errors, 'updateRequest')

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
