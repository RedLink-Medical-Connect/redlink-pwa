import { ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { deleteUser, getCurrentUser } from 'aws-amplify/auth'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { throwIfGraphqlError } from '@/services/graphql-error-service'

// Phase 8, sous-tâche 5 (lot 2/3) : migré sur le client Gen2 (`aws-amplify/data`,
// `client.models.Veterinarian.*`/`client.models.Clinic.*`). Plus d'import depuis
// `@/graphql/mutations`/`@/graphql/custom-queries`/`@/graphql/custom-mutations` -- voir le
// commentaire équivalent dans useClinicRequest.js.
//
// `getVetWithClinic` (Gen1) sélectionnait explicitement les 8 champs de `Clinic` -- son
// équivalent Gen2 est l'option `selectionSet` (confirmé via context7,
// `/aws-amplify/amplify-data`, "Query Related Data with Selection Set"), voir
// `fetchSettings()` ci-dessous. Contrairement à `useClinicDonors.fetchClinicContext()` (qui
// ne lit que `clinic.latitude`/`clinic.longitude` et restreint son `selectionSet` en
// conséquence, voir son commentaire dédié), ce composable a réellement besoin de TOUS les
// champs de `Clinic` pour peupler `clinicForm` -- le `selectionSet` ci-dessous reproduit
// donc exactement les 8 champs que `getVetWithClinic` sélectionnait.
//
// Sur le changement de comportement d'erreur Gen1 -> Gen2 (`client.models.X.*` résout
// `{ data, errors }` au lieu de lever une exception) et sa traduction via
// `throwIfGraphqlError` ci-dessous : voir le JSDoc de `src/services/graphql-error-service.js`.
// `fetchSettings()`/`updateClinicDetails()`/`updateVetDetails()` n'avaient déjà AUCUN
// `catch` en Gen1 (juste un `try/finally` pour piloter `isLoading`/`isSaving`) --
// `throwIfGraphqlError` continue de laisser l'exception se propager telle quelle à
// l'appelant (SettingsView.vue), comportement inchangé.

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

      const { data, errors } = await client.models.Veterinarian.get(
        { id: userId },
        {
          selectionSet: [
            'id',
            'firstname',
            'lastname',
            'email',
            'clinicID',
            'clinic.id',
            'clinic.name',
            'clinic.rpps',
            'clinic.email',
            'clinic.phone',
            'clinic.address',
            'clinic.latitude',
            'clinic.longitude',
            'clinic.hasEmergencyService',
          ],
        },
      )

      throwIfGraphqlError(errors, 'getVeterinarian')

      const vet = data

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

      const { errors } = await client.models.Clinic.update(input)

      throwIfGraphqlError(errors, 'updateClinic')
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

      const { errors } = await client.models.Veterinarian.update(input)

      throwIfGraphqlError(errors, 'updateVeterinarian')
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
          // Revue Lead Dev (lot 2) : seul `v.id` est lu plus bas -- `selectionSet` explicite
          // plutôt que la sélection scalaire par défaut du client Gen2, d'autant plus
          // important ici que ce sont les données personnelles de COLLÈGUES (firstname/
          // lastname/email) qui seraient sur-fetchées par défaut, pas les siennes propres
          // (même principe que `useClinicRequest.fetchClinicId()`/
          // `useClinicDonors.fetchClinicContext()`, voir CLAUDE.md, section Backend/Infra).
          const { data, errors } = await client.models.Veterinarian.list({
            filter: { clinicID: { eq: clinicId.value } },
            selectionSet: ['id'],
          })

          throwIfGraphqlError(errors, 'veterinariansByClinicID')

          const items = data || []
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
          const { errors: vetDeleteErrors } = await client.models.Veterinarian.delete({
            id: vetId.value,
          })

          throwIfGraphqlError(vetDeleteErrors, 'deleteVeterinarian')
        }

        if (clinicId.value && !clinicHasOtherVets) {
          // `Clinic` n'accorde `delete` qu'à `allow.owner()` (amplify/data/resource.ts) --
          // le groupe Veterinarians n'a que create/read/update dessus. Concrètement : ce
          // `client.models.Clinic.delete()` ne réussit que si le Veterinarian courant est
          // celui qui a créé la Clinic à l'inscription (`createClinicSimple`, `owner` posé
          // sur son identité) ; pour tout autre Veterinarian dernier-rattaché-mais-pas-créateur,
          // l'appel échoue en `@auth` et est avalé silencieusement par le `catch (dbError)`
          // ci-dessous (best-effort, voir sa JSDoc) -- pas un bug de CE composable, mais un
          // résidu à garder en tête pour ne pas supposer que ce chemin réussit toujours pour
          // n'importe quel dernier vétérinaire.
          const { errors: clinicDeleteErrors } = await client.models.Clinic.delete({
            id: clinicId.value,
          })

          throwIfGraphqlError(clinicDeleteErrors, 'deleteClinic')
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
