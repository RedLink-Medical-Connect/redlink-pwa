import { ref } from 'vue'
import { generateClient } from '@/services/bff-graphql-client'
import { getCurrentUser } from '@/services/bff-auth-session'
import { throwIfGraphqlError } from '@/services/graphql-error-service'
import { resolveClinicOwnerRelationUpsert } from '@/services/clinic-owner-relation-service'

/**
 * Rattachement volontaire d'un Owner à UNE clinique, proposé juste après la vérification de son
 * email (popup `ClinicLinkDialog.vue` sur `ProfileView.vue`). Facultatif.
 *
 * Écrit la même `ClinicOwnerRelation` que celle que créerait sinon la première validation
 * vétérinaire d'un de ses Animals (`useAnimalValidation.upsertClinicOwnerRelation`), avec la
 * même décision (`resolveClinicOwnerRelationUpsert`) : la clinique choisie ici devient donc
 * la clinique principale (`isPrimaryClinic: true`, première relation de l'Owner), et une
 * validation ultérieure par une AUTRE clinique ajoute une relation secondaire au lieu de
 * prendre cette place (ou ne fait rien si c'est la même clinique).
 *
 * Écriture par l'Owner lui-même, autorisée par `allow.ownerDefinedIn('ownerID')` (sans
 * `.to([...])`, donc toutes les opérations) sur `ClinicOwnerRelation` -- `ownerID` = `Owner.id`
 * = `sub` Cognito de l'appelant (`completeOwnerRegistration`). Aucun changement de schéma.
 *
 * Liste : TOUTES les cliniques (`allow.authenticated().to(['read'])` sur `Clinic`). Pas de
 * filtre sur `verificationStatus` : ce champ n'est pas lisible par un Owner
 * (`clinicVerificationStatusFieldAuth`), un filtre dessus échouerait en `Unauthorized`.
 */
export function useClinicLink() {
  const client = generateClient()

  const clinics = ref([])
  const isLoading = ref(false)
  const isLinking = ref(false)
  const loadError = ref(null)

  /**
   * Charge toutes les cliniques (pagination `nextToken`), uniquement les champs affichés dans
   * la recherche -- jamais email/téléphone/RPPS des cliniques (voir CLAUDE.md, `selectionSet`).
   */
  const fetchClinics = async () => {
    isLoading.value = true
    loadError.value = null
    try {
      const all = []
      let nextToken = null
      do {
        const { data, errors, nextToken: token } = await client.models.Clinic.list({
          selectionSet: ['id', 'name', 'address'],
          limit: 1000,
          nextToken,
        })
        throwIfGraphqlError(errors, 'listClinics')
        all.push(...(data || []))
        nextToken = token || null
      } while (nextToken)
      clinics.value = all
    } catch (e) {
      console.error('Erreur chargement des cliniques :', e)
      loadError.value = e
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Lie l'Owner connecté à `clinicID`. Idempotent : déjà lié à cette clinique -> no-op.
   * Lève en cas d'échec (action explicite de l'utilisateur, l'échec doit être visible --
   * pas une écriture secondaire best-effort).
   *
   * @param {string} clinicID
   * @returns {Promise<boolean>} `true` si une relation a été créée, `false` si elle existait déjà.
   */
  const linkToClinic = async (clinicID) => {
    if (!clinicID) throw new Error('CLINIC_REQUIRED')

    isLinking.value = true
    try {
      const { userId: ownerID } = await getCurrentUser()
      if (!ownerID) throw new Error('NOT_AUTHENTICATED')

      const { data, errors } = await client.models.ClinicOwnerRelation.list({
        filter: { ownerID: { eq: ownerID } },
        selectionSet: ['clinicID', 'isPrimaryClinic'],
      })
      throwIfGraphqlError(errors, 'clinicOwnerRelationsByOwnerID')

      const toCreate = resolveClinicOwnerRelationUpsert(data || [], clinicID)
      if (!toCreate) return false

      const { errors: createErrors } = await client.models.ClinicOwnerRelation.create({
        clinicID: toCreate.clinicID,
        ownerID,
        isPrimaryClinic: toCreate.isPrimaryClinic,
      })
      throwIfGraphqlError(createErrors, 'createClinicOwnerRelation')
      return true
    } finally {
      isLinking.value = false
    }
  }

  return { clinics, isLoading, isLinking, loadError, fetchClinics, linkToClinic }
}

/**
 * Clé i18n du message d'erreur d'un échec de `linkToClinic` (le composant fait `t(...)`).
 *
 * @param {unknown} error
 * @returns {string}
 */
export function mapClinicLinkErrorKey(error) {
  if (error?.message === 'NOT_AUTHENTICATED') return 'dashboard.clinic_link.errors.session'
  if (error?.errors?.[0]?.errorType === 'Unauthorized') {
    return 'dashboard.clinic_link.errors.unauthorized'
  }
  return 'dashboard.clinic_link.errors.generic'
}
