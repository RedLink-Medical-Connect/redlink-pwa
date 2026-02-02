import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { deleteUser, getCurrentUser } from 'aws-amplify/auth'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// Imports GraphQL Standards (générés par Amplify)
import {
  updateClinic,
  updateVeterinarian,
  deleteClinic,
  deleteVeterinarian,
} from '@/graphql/mutations'
import { getVeterinarian } from '@/graphql/queries'

export function useClinicSettings() {
  const client = generateClient()
  const auth = useAuthStore()
  const router = useRouter()

  const isLoading = ref(false)
  const isSaving = ref(false)

  // IDs pour référence interne
  const vetId = ref(null)
  const clinicId = ref(null)

  // Formulaires
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
      // 1. Récupération ID Cognito
      const { userId } = await getCurrentUser()
      if (!userId) throw new Error('Utilisateur non connecté')

      console.log(`🔍 Chargement des réglages pour l'ID: ${userId}`)

      // 2. Récupération du profil Vétérinaire (ID Cognito == ID Table)
      const { data } = await client.graphql({
        query: getVeterinarian,
        variables: { id: userId },
        authMode: 'userPool',
      })

      const vet = data.getVeterinarian

      // 3. Vérification existence profil
      if (!vet) {
        console.error('❌ Profil vétérinaire introuvable.')
        // Ici, on pourrait rediriger vers la page de création de profil si nécessaire
        return
      }

      // Remplissage Vet
      vetId.value = vet.id
      vetForm.value = {
        firstname: vet.firstname,
        lastname: vet.lastname,
        email: vet.email,
      }

      // 4. Vérification existence Clinique
      if (vet.clinic) {
        // Le profil vétérinaire a bien une clinique liée
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
      } else {
        console.warn("⚠️ Ce vétérinaire n'est rattaché à aucune clinique.")
      }
    } catch (e) {
      console.error('💥 Erreur chargement réglages:', e)
    } finally {
      isLoading.value = false
    }
  }

  const updateClinicDetails = async () => {
    if (!clinicId.value) return
    isSaving.value = true
    try {
      const input = {
        id: clinicId.value, // L'ID est obligatoire pour l'update
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

      console.log('✅ Clinique mise à jour')
    } catch (e) {
      console.error('Erreur mise à jour clinique:', e)
      throw e
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
        query: updateVeterinarian,
        variables: { input },
        authMode: 'userPool',
      })

      console.log('✅ Vétérinaire mis à jour')
    } catch (e) {
      console.error('Erreur mise à jour vétérinaire:', e)
      throw e
    } finally {
      isSaving.value = false
    }
  }

  const deleteAccount = async () => {
    if (
      !confirm(
        'Êtes-vous sûr de vouloir supprimer votre compte et toutes les données associées ? Cette action est irréversible.',
      )
    ) {
      return
    }

    isSaving.value = true
    try {
      // 1. Supprimer le profil vétérinaire
      // Note: Selon ton schéma, la suppression du Vet ne supprime pas forcément la clinique.
      // Si le Vet est le "owner" de la clinique, il faudrait peut-être supprimer la clinique avant.

      if (vetId.value) {
        await client.graphql({
          query: deleteVeterinarian,
          variables: { input: { id: vetId.value } },
          authMode: 'userPool',
        })
      }

      // 2. (Optionnel) Supprimer la clinique si c'est souhaité
      // Attention: Cela supprimera la clinique pour les autres vétérinaires s'il y en a.
      // À décommenter seulement si un compte = une clinique unique
      /*
      if (clinicId.value) {
        await client.graphql({
          query: deleteClinic,
          variables: { input: { id: clinicId.value } },
          authMode: 'userPool',
        })
      }
      */

      // 3. Supprimer le compte Cognito
      await deleteUser()

      // 4. Nettoyer le store local et rediriger
      await auth.logout()
      await router.push('/')
    } catch (e) {
      console.error('Erreur lors de la suppression du compte:', e)
      // On ne rethrow pas forcément ici pour permettre la déconnexion même en cas d'erreur partielle DB
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
