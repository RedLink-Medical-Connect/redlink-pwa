import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { useRouter } from 'vue-router'
import { getCurrentUser } from 'aws-amplify/auth'

// 👇 On garde vos requêtes existantes
import { getVeterinarian } from '@/graphql/queries'
import { listRequestsByClinic, getVetWithClinic } from '@/graphql/custom-queries' // Ajout de getVetWithClinic ici

// 👇 On importe les mutations SIMPLES pour éviter les erreurs de sous-champs
import { createRequestSimple, updateRequestStatusSimple } from '@/graphql/custom-mutations'

export function useClinicRequests() {
  const client = generateClient()
  const router = useRouter()

  const requests = ref([])
  const isLoading = ref(false)
  const isCreating = ref(false)
  const clinicId = ref(null)

  // Récupère l'ID de la clinique
  const fetchClinicId = async () => {
    if (clinicId.value) return clinicId.value

    try {
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
    } catch (e) {
      console.error('Erreur récupération contexte clinique:', e)
      return null
    }
  }

  const fetchRequests = async () => {
    isLoading.value = true
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
        'dog': 'DOG', 'chien': 'DOG', 'DOG': 'DOG',
        'cat': 'CAT', 'chat': 'CAT', 'CAT': 'CAT'
      }
      // Par sécurité, on met en majuscule, et si c'est inconnu on force DOG par défaut
      const safeSpecies = speciesMap[formData.species?.toLowerCase()] || 'DOG'

      const input = {
        clinicID: cId,
        requestType: formData.type === 'emergency' ? 'EMERGENCY' : 'APPOINTMENT',
        requiredSpecies: safeSpecies,
        requiredBloodGroup: formData.bloodGroup,
        quantity: parseInt(formData.quantity), // On s'assure que c'est un entier
        status: 'OPEN',
      }

      console.log("🚀 Envoi Mutation avec Input :", input)

      // 3. Appel de la mutation simple
      const result = await client.graphql({
        query: createRequestSimple,
        variables: { input },
        authMode: 'userPool',
      })

      console.log("✅ Succès création :", result)

      await fetchRequests()
      await router.push('/dashboard/requests')

    } catch (e) {
      // 👇 LE LOG DÉTAILLÉ POUR LE DÉBUG
      console.error("💥 ERREUR CRÉATION DEMANDE 💥")

      if (e.errors) {
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
