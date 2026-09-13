import { ref } from 'vue'
import { generateClient } from '@/services/bff-graphql-client'
import { getCurrentUser } from '@/services/bff-auth-session'
import { bffFetch } from '@/services/bff-fetch'
import { throwIfGraphqlError } from '@/services/graphql-error-service'

/**
 * Équipe de vétérinaires de la clinique du vétérinaire courant, sous-onglet "Équipe" de
 * `SettingsView.vue` (à côté de `general`/`vet_ref`/`reputation`) : liste des collègues (avec
 * leur rôle, référent ou non) + invitation d'un nouveau vétérinaire, réservée au vétérinaire
 * RÉFÉRENT.
 *
 * "Référent" réutilise une règle déjà existante plutôt qu'un nouveau champ "rôle" :
 * `Clinic` porte `allow.owner()` (`amplify/data/resource.ts:402`) -- le vétérinaire qui a créé
 * la Clinic (`completeVetRegistration`, `useRegistrationCompletion.js`) est son `owner` Cognito,
 * déjà le seul autorisé à la supprimer (`useClinicSettings.deleteAccount`). `clinic.owner` est au
 * format `"${sub}::${username}"` (confirmé par le pin test `resource.transform.test.ts` --
 * "Clinic... compilent avec le défaut ownerField: 'owner'") -- on ne compare QUE la partie `sub`
 * (avant `::`), jamais `username`/email : `Veterinarian.id` EST déjà ce `sub` (convention "id =
 * cognitoUserId" de tout ce repo), donc `clinic.owner.split('::')[0] === vet.id` suffit et évite
 * de reconstruire une identité composite côté client à partir de l'email (`auth.user.attributes.
 * email`, la CASSE telle que saisie à l'inscription, potentiellement différente du `Username`
 * Cognito réel selon la normalisation du user pool -- cause probable du bug initial où le bouton
 * "Inviter" restait invisible même pour le vrai référent).
 *
 * L'invitation elle-même (`POST /api/clinic/veterinarians`) ne passe PAS par
 * `client.models.Veterinarian.create()` : voir le commentaire de
 * `amplify/functions/bff/clinic-routes.ts` sur pourquoi cette écriture doit se faire côté BFF.
 */
export function useClinicVeterinarians() {
  const client = generateClient()

  const veterinarians = ref([])
  const isLoading = ref(false)
  const loadError = ref(false)
  const isReferent = ref(false)

  const isInviting = ref(false)
  const inviteError = ref(null)

  const fetchTeam = async () => {
    isLoading.value = true
    loadError.value = false
    try {
      const { userId } = await getCurrentUser()
      if (!userId) throw new Error("Impossible de récupérer l'ID utilisateur")

      const { data: vet, errors: vetErrors } = await client.models.Veterinarian.get(
        { id: userId },
        { selectionSet: ['id', 'clinicID'] },
      )
      throwIfGraphqlError(vetErrors, 'getVeterinarian')
      if (!vet?.clinicID) return

      const { data: clinic, errors: clinicErrors } = await client.models.Clinic.get(
        { id: vet.clinicID },
        { selectionSet: ['owner'] },
      )
      throwIfGraphqlError(clinicErrors, 'getClinic')

      const referentSub = clinic?.owner?.split('::')[0] ?? null
      isReferent.value = !!referentSub && referentSub === userId

      // `accountConfirmed: { ne: false }` (pas `eq: true`) -- inclut aussi bien `true` QUE
      // `null`/absent (lignes créées avant l'ajout de ce champ, toutes de l'auto-inscription
      // donc déjà confirmées par construction), exclut seulement `false` EXPLICITE (compte
      // invité, `clinic-routes.ts`, qui n'a pas encore résolu son challenge
      // `NEW_PASSWORD_REQUIRED`). Évite une migration de données pour les lignes existantes.
      const { data: vets, errors: listErrors } = await client.models.Veterinarian.list({
        filter: { clinicID: { eq: vet.clinicID }, accountConfirmed: { ne: false } },
        selectionSet: ['id', 'firstname', 'lastname', 'email'],
      })
      throwIfGraphqlError(listErrors, 'listVeterinarians')

      veterinarians.value = (vets || []).map((v) => ({ ...v, isReferent: v.id === referentSub }))
    } catch (e) {
      console.error("Erreur chargement de l'équipe de la clinique :", e)
      loadError.value = true
    } finally {
      isLoading.value = false
    }
  }

  /**
   * @param {string} email
   * @param {string} [locale] -- locale courante (`useI18n().locale.value`), transmise par la
   *   vue (ce composable n'appelle pas `useI18n()`, convention CLAUDE.md) jusqu'au trigger
   *   `CustomMessage_AdminCreateUser` (`amplify/functions/custom-message/handler.ts`).
   * @returns {Promise<boolean>} succès de l'invitation
   */
  const inviteVeterinarian = async (email, locale) => {
    isInviting.value = true
    inviteError.value = null
    try {
      const { ok, data } = await bffFetch('/api/clinic/veterinarians', { body: { email, locale } })
      if (!ok) {
        inviteError.value = mapInviteVeterinarianError(data?.error)
        return false
      }
      await fetchTeam()
      return true
    } catch (e) {
      console.error('Erreur invitation vétérinaire :', e)
      inviteError.value = mapInviteVeterinarianError()
      return false
    } finally {
      isInviting.value = false
    }
  }

  /**
   * Appelée par `SetNewPasswordView.vue` juste après un `confirmNewPasswordChallenge()`
   * réussi (compte invité, `clinic-routes.ts` -- voir le commentaire du champ `accountConfirmed`
   * dans `amplify/data/resource.ts`). Écriture secondaire best-effort (convention CLAUDE.md,
   * même idiome que `upsertClinicOwnerRelation`) : un échec ne doit jamais bloquer la
   * redirection vers le tableau de bord déjà effectuée par le store -- au pire la collègue
   * n'apparaît pas encore dans "Équipe" tant que la ligne n'est pas corrigée manuellement.
   */
  const confirmOwnAccount = async () => {
    try {
      const { userId } = await getCurrentUser()
      if (!userId) return
      const { errors } = await client.models.Veterinarian.update({ id: userId, accountConfirmed: true })
      throwIfGraphqlError(errors, 'confirmOwnVeterinarianAccount')
    } catch (e) {
      console.error('Erreur confirmation du compte vétérinaire (best-effort) :', e)
    }
  }

  return {
    veterinarians,
    isLoading,
    loadError,
    isReferent,
    isInviting,
    inviteError,
    fetchTeam,
    inviteVeterinarian,
    confirmOwnAccount,
  }
}

/**
 * Fonction pure exportée à côté du composable (convention CLAUDE.md, même forme que
 * `mapAcceptMissionError`) : renvoie une CLÉ i18n, jamais un message traduit.
 * @param {string} [errorCode]
 * @returns {string}
 */
export function mapInviteVeterinarianError(errorCode) {
  switch (errorCode) {
    case 'EMAIL_ALREADY_EXISTS':
      return 'dashboard.settings.team.errors.email_already_exists'
    case 'NOT_CLINIC_REFERENT':
      return 'dashboard.settings.team.errors.not_referent'
    case 'MISSING_EMAIL':
      return 'dashboard.settings.team.errors.missing_email'
    default:
      return 'dashboard.settings.team.errors.invite_failed'
  }
}
