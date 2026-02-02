import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { useRouter } from 'vue-router'
import { getCurrentUser } from 'aws-amplify/auth'
import { getVeterinarian } from '@/graphql/queries'
import { listRequestsByClinic } from '@/graphql/custom-queries'
import { createRequestSimple, updateRequestStatusSimple } from '@/graphql/custom-mutations'

export function useClinicRequests() {
  const client = generateClient()
  const router = useRouter()

  const requests = ref([])
  const isLoading = ref(false)
  const isCreating = ref(false)
  const clinicId = ref(null)

  // Récupère l'ID de la clinique via le profil du Vétérinaire connecté
  const fetchClinicId = async () => {
    // Si on l'a déjà en mémoire, on le renvoie direct
    if (clinicId.value) return clinicId.value

    try {
      // 1. Récupérer l'ID utilisateur (sub) depuis Cognito
      const { userId } = await getCurrentUser()
      if (!userId) throw new Error('Utilisateur non connecté')

      console.log(`🔍 Recherche du profil Vétérinaire pour l'ID: ${userId}`)

      // 2. Fetch direct via la clé primaire (ID Cognito == ID DB)
      // C'est ici que la nouvelle architecture brille par sa simplicité
      const { data } = await client.graphql({
        query: getVeterinarian,
        variables: { id: userId },
        authMode: 'userPool',
      })

      const vet = data.getVeterinarian

      // 3. Vérification critique : Le profil existe-t-il ?
      if (!vet) {
        console.error('❌ Aucun profil vétérinaire trouvé pour cet utilisateur.')
        console.warn("👉 Assurez-vous d'avoir exécuté la création du profil après l'inscription.")
        return null
      }

      // 4. Vérification critique : Le profil a-t-il une clinique ?
      if (!vet.clinicID) {
        console.error("❌ Le vétérinaire existe mais n'est rattaché à aucune clinique.")
        return null
      }

      console.log(`✅ Clinique identifiée : ${vet.clinicID}`)
      clinicId.value = vet.clinicID
      return vet.clinicID
    } catch (e) {
      console.error('💥 Erreur lors de la récupération du contexte clinique:', e)
      return null
    }
  }

  const fetchRequests = async () => {
    isLoading.value = true
    try {
      const cId = await fetchClinicId()

      if (!cId) {
        // Si pas de clinique, on laisse la liste vide mais on ne plante pas
        requests.value = []
        return
      }

      const { data } = await client.graphql({
        query: listRequestsByClinic,
        variables: {
          filter: { clinicID: { eq: cId } },
        },
        authMode: 'userPool',
      })

      // Tri par date de création (plus récent en premier)
      requests.value = data.listRequests.items.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      )
    } catch (e) {
      console.error('Erreur chargement demandes:', e)
    } finally {
      isLoading.value = false
    }
  }

  const createNewRequest = async (formData) => {
    isCreating.value = true
    try {
      const cId = await fetchClinicId()
      if (!cId) throw new Error('Impossible de créer une demande : Clinique introuvable.')

      const input = {
        clinicID: cId,
        requestType: formData.type === 'emergency' ? 'EMERGENCY' : 'APPOINTMENT',
        requiredSpecies: formData.species.toUpperCase(),
        requiredBloodGroup: formData.bloodGroup,
        quantity: parseInt(formData.quantity),
        status: 'OPEN',
      }

      await client.graphql({
        query: createRequestSimple,
        variables: { input },
        authMode: 'userPool',
      })

      await fetchRequests() // Rafraîchir la liste locale
      await router.push('/dashboard/requests')
    } catch (e) {
      console.error('Erreur création demande:', e)
      throw e
    } finally {
      isCreating.value = false
    }
  }

  const closeRequest = async (requestId) => {
    try {
      await client.graphql({
        query: updateRequestStatusSimple,
        variables: { input: { id: requestId, status: 'CLOSED' } },
        authMode: 'userPool',
      })
      // Mise à jour optimiste locale
      const req = requests.value.find((r) => r.id === requestId)
      if (req) req.status = 'CLOSED'
    } catch (e) {
      console.error('Erreur fermeture demande:', e)
      throw e
    }
  }

  return {
    requests,
    isLoading,
    isCreating,
    fetchRequests,
    createNewRequest,
    closeRequest,
  }
}
