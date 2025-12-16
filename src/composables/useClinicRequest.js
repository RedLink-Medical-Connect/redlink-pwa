import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { useRouter } from 'vue-router'
import { listVeterinarians } from '@/graphql/queries'
import { listRequestsByClinic } from '@/graphql/custom-queries'
import { createRequestSimple, updateRequestStatusSimple } from '@/graphql/custom-mutations'

export function useClinicRequests() {
  const client = generateClient()
  const router = useRouter()

  const requests = ref([])
  const isLoading = ref(false)
  const isCreating = ref(false)

  const clinicId = ref(null)

  const fetchClinicId = async () => {
    if (clinicId.value) return clinicId.value

    try {
      const { data } = await client.graphql({
        query: listVeterinarians,
        authMode: 'userPool',
      })
      const vet = data.listVeterinarians.items[0]
      if (vet && vet.clinicID) {
        clinicId.value = vet.clinicID
        return vet.clinicID
      }
    } catch (e) {
      console.error('Erreur récupération ClinicID:', e)
    }
    return null
  }

  const fetchRequests = async () => {
    isLoading.value = true
    try {
      const cId = await fetchClinicId()
      if (!cId) return

      const { data } = await client.graphql({
        query: listRequestsByClinic,
        variables: {
          filter: { clinicID: { eq: cId } },
        },
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
      const cId = await fetchClinicId()
      if (!cId) throw new Error('Clinique introuvable')

      const input = {
        clinicID: cId,
        requestType: formData.type === 'emergency' ? 'EMERGENCY' : 'APPOINTMENT',
        requiredSpecies: formData.species.toUpperCase(),
        requiredBloodGroup: formData.bloodGroup,
        quantity: parseInt(formData.quantity),
        status: 'OPEN',
        // Note: On pourrait ajouter 'details', 'patientName' etc. si on étend le schéma Request plus tard
      }

      await client.graphql({
        query: createRequestSimple,
        variables: { input },
        authMode: 'userPool',
      })

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
