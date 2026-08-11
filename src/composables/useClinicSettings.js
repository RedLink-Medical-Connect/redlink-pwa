import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { deleteUser, getCurrentUser } from 'aws-amplify/auth'
import {
  updateClinic,
} from '@/graphql/mutations'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { getVetWithClinic } from '@/graphql/custom-queries.js'
import {
  deleteClinicSimple,
  deleteVeterinarianSimple,
  updateVeterinarianSimple,
} from '@/graphql/custom-mutations.js'

export function useClinicSettings() {
  const client = generateClient()
  const auth = useAuthStore()
  const router = useRouter()

  const isLoading = ref(false)
  const isSaving = ref(false)

  const vetId = ref(null)
  const clinicId = ref(null)

  const clinicForm = ref({
    name: '',
    email: '',
    phone: '',
    rpps: '',
    address: '',
    latitude: null,
    longitude: null,
    hasEmergencyService: false,
  })

  const vetForm = ref({
    firstname: '',
    lastname: '',
    email: '',
  })

  const fetchSettings = async () => {
    isLoading.value = true
    try {
      const { userId } = await getCurrentUser()

      if (!userId) throw new Error("Impossible de récupérer l'ID utilisateur")

      const { data } = await client.graphql({
        query: getVetWithClinic,
        variables: { id: userId },
        authMode: 'userPool',
      })

      const vet = data.getVeterinarian

      if (vet) {
        vetId.value = vet.id
        vetForm.value = {
          firstname: vet.firstname,
          lastname: vet.lastname,
          email: vet.email,
        }

        if (vet.clinic) {
          console.log("🔍 Données Clinic reçues de l'API :", vet.clinic)
          clinicId.value = vet.clinic.id
          clinicForm.value = {
            name: vet.clinic.name,
            email: vet.clinic.email,
            phone: vet.clinic.phone,
            rpps: vet.clinic.rpps,
            address: vet.clinic.address,
            latitude: vet.clinic.latitude,
            longitude: vet.clinic.longitude,
            hasEmergencyService: vet.clinic.hasEmergencyService,
          }
        }
      }
    } finally {
      isLoading.value = false
    }
  }

  const updateClinicDetails = async () => {
    if (!clinicId.value) return
    isSaving.value = true
    try {
      const input = {
        id: clinicId.value,
        name: clinicForm.value.name,
        email: clinicForm.value.email,
        phone: clinicForm.value.phone,
        rpps: clinicForm.value.rpps,
        address: clinicForm.value.address,
        latitude: clinicForm.value.latitude,
        longitude: clinicForm.value.longitude,
        hasEmergencyService: clinicForm.value.hasEmergencyService,
      }

      await client.graphql({
        query: updateClinic,
        variables: { input },
        authMode: 'userPool',
      })
    } finally {
      isSaving.value = false
    }
  }

  const updateVetDetails = async () => {
    if (!vetId.value) return
    isSaving.value = true
    try {
      const input = {
        id: vetId.value,
        firstname: vetForm.value.firstname,
        lastname: vetForm.value.lastname,
        email: vetForm.value.email,
      }

      await client.graphql({
        query: updateVeterinarianSimple,
        variables: { input },
        authMode: 'userPool',
      })
    } finally {
      isSaving.value = false
    }
  }

  const deleteAccount = async () => {
    isSaving.value = true
    try {
      if (vetId.value) {
        await client.graphql({
          query: deleteVeterinarianSimple,
          variables: { input: { id: vetId.value } },
          authMode: 'userPool',
        })
      }

      if (clinicId.value) {
        await client.graphql({
          query: deleteClinicSimple,
          variables: { input: { id: clinicId.value } },
          authMode: 'userPool',
        })
      }

      await deleteUser()
      await auth.logout()
      await router.push('/')
    } finally {
      isSaving.value = false
    }
  }

  return {
    clinicForm,
    vetForm,
    isLoading,
    isSaving,
    fetchSettings,
    updateClinicDetails,
    updateVetDetails,
    deleteAccount,
  }
}
