import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { deleteUser, getCurrentUser } from 'aws-amplify/auth'
import {
  updateClinic,
} from '@/graphql/mutations'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { getVetWithClinic, veterinariansByClinicIDSimple } from '@/graphql/custom-queries.js'
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

  /**
   * Supprime le compte Veterinarian courant : nettoyage DB (Veterinarian, puis Clinic si
   * plus aucun autre Veterinarian n'y est rattaché) puis suppression Cognito
   * (`deleteUser()`), déconnexion et redirection. Flux irréversible.
   *
   * Garde-fou multi-vétérinaire (Phase 7.8, audit Phase 6.B) : `Clinic.veterinarians` est un
   * `@hasMany` -- le schéma prévoit explicitement plusieurs Veterinarian par Clinic (contexte
   * école). Supprimer la Clinic entière au départ du premier Veterinarian romprait l'accès
   * des autres et laisserait des `Request`/`Mission` orphelins. On ne supprime donc la
   * Clinic QUE si le Veterinarian courant est le dernier qui y est rattaché.
   *
   * Convention du repo (CLAUDE.md, "écriture secondaire best-effort") : comme
   * `useOwnerProfile.deleteAccount`, le nettoyage DB (Veterinarian/Clinic) est une écriture
   * secondaire qui précède l'action critique (`deleteUser()`) -- son échec est loggé mais
   * jamais relancé, pour ne pas empêcher un Veterinarian de supprimer son compte Cognito à
   * cause d'un résidu DB. Seul l'échec de `deleteUser()` (et de ce qui suit) doit remonter à
   * l'appelant.
   */
  const deleteAccount = async () => {
    isSaving.value = true
    try {
      // Lecture du garde-fou, volontairement HORS du try/catch best-effort ci-dessous : un
      // échec de CETTE lecture (réseau, @auth...) ne doit jamais entraîner la suppression de
      // la Clinic par défaut. Fail-safe : on considère qu'il reste "peut-être" d'autres
      // Veterinarian et on ne supprime pas la Clinic -- un résidu Clinic orphelin d'un
      // Veterinarian supprimé (déjà un compromis assumé ailleurs dans ce repo, ex. ADR-0004)
      // est un moindre mal face au risque de supprimer une Clinic encore utilisée par
      // d'autres comptes suite à un simple hoquet transitoire de cette vérification.
      let clinicHasOtherVets = false
      if (clinicId.value) {
        try {
          const { data } = await client.graphql({
            query: veterinariansByClinicIDSimple,
            variables: { clinicID: clinicId.value },
            authMode: 'userPool',
          })
          const items = data.veterinariansByClinicID?.items || []
          clinicHasOtherVets = items.some((v) => v && v.id !== vetId.value)
        } catch (guardError) {
          clinicHasOtherVets = true
          console.error(
            "Erreur vérification des autres vétérinaires de la clinique (garde-fou suppression), la Clinic est conservée par prudence :",
            guardError,
          )
        }
      }

      try {
        if (vetId.value) {
          await client.graphql({
            query: deleteVeterinarianSimple,
            variables: { input: { id: vetId.value } },
            authMode: 'userPool',
          })
        }

        if (clinicId.value && !clinicHasOtherVets) {
          await client.graphql({
            query: deleteClinicSimple,
            variables: { input: { id: clinicId.value } },
            authMode: 'userPool',
          })
        }
      } catch (dbError) {
        console.error(
          'Erreur nettoyage DB (Veterinarian/Clinic) lors de la suppression du compte, ignorée (best-effort) :',
          dbError,
        )
      }

      await deleteUser()
      await auth.logout()
      await router.push('/')
    } catch (authError) {
      console.error('Erreur critique lors de la suppression du compte (Cognito) :', authError)
      throw authError
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
