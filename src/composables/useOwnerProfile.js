import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { deleteUser, fetchUserAttributes } from 'aws-amplify/auth'
import { listOwners, listAnimals } from '@/graphql/queries'
import { updateOwner, deleteOwner, deleteAnimal } from '@/graphql/mutations'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'

export function useOwnerProfile() {
  const client = generateClient()
  const auth = useAuthStore()
  const router = useRouter()

  const isLoading = ref(false)
  const isSaving = ref(false)
  const ownerId = ref(null)

  const form = ref({
    firstname: '',
    lastname: '',
    email: '',
    phone: '',
    address: '',
    latitude: null,
    longitude: null,
    maxTravelDistance: 50,
  })

  const fetchProfile = async () => {
    isLoading.value = true
    try {
      const attributes = await fetchUserAttributes()
      const userEmail = attributes.email

      if (!userEmail) throw new Error("Impossible de récupérer l'email utilisateur")

      const { data } = await client.graphql({
        query: listOwners,
        variables: {
          filter: { email: { eq: userEmail } },
        },
        authMode: 'userPool',
      })

      const profile = data.listOwners.items[0]

      if (profile) {
        ownerId.value = profile.id
        form.value = {
          firstname: profile.firstname,
          lastname: profile.lastname,
          email: profile.email,
          phone: profile.phone,
          address: profile.address,
          latitude: profile.latitude,
          longitude: profile.longitude,
          maxTravelDistance: profile.maxTravelDistance,
        }
      }
    } finally {
      isLoading.value = false
    }
  }

  const updateProfile = async () => {
    isSaving.value = true
    try {
      const input = {
        id: ownerId.value,
        firstname: form.value.firstname,
        lastname: form.value.lastname,
        phone: form.value.phone,
        address: form.value.address,
        latitude: form.value.latitude,
        longitude: form.value.longitude,
        maxTravelDistance: form.value.maxTravelDistance,
      }

      await client.graphql({
        query: updateOwner,
        variables: { input },
        authMode: 'userPool',
      })
    } finally {
      isSaving.value = false
    }
  }

  const deleteAccount = async () => {
    isSaving.value = true

    if (ownerId.value) {
      try {
               const { data } = await client.graphql({
          query: listAnimals,
          authMode: 'userPool',
        })

        const rawItems = data.listAnimals?.items || []
        const validAnimals = rawItems.filter((item) => item && item.id && !item._deleted)

        if (validAnimals.length > 0) {
          await Promise.all(
            validAnimals.map((a) =>
              client.graphql({
                query: deleteAnimal,
                variables: { input: { id: a.id } },
                authMode: 'userPool',
              }),
            ),
          )
        }

        await client.graphql({
          query: deleteOwner,
          variables: { input: { id: ownerId.value } },
          authMode: 'userPool',
        })
      } catch (dbError) {
        console.error(
          '⚠️ Erreur partielle lors du nettoyage DB (Ignorée pour forcer la suppression compte):',
          dbError,
        )
      }
    }

    try {
      await deleteUser()

      await auth.logout()
      await router.push('/')
    } catch (authError) {
      console.error('❌ Erreur critique suppression Auth:', authError)
      throw authError
    } finally {
      isSaving.value = false
    }
  }

  return {
    form,
    isLoading,
    isSaving,
    fetchProfile,
    updateProfile,
    deleteAccount,
  }
}
