import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import {
  createOwnerSimple,
  createAnimalSimple,
  createOwnerAvailabilitySimple,
  createClinicSimple,
  createVeterinarianSimple,
} from '@/graphql/custom-mutations'
import { Species, DonationFrequency } from '@/constants/enums'

/**
 * Phase 7.7 : composable regroupant la logique métier + les 5 appels `client.graphql()`
 * de complétion d'inscription, extraits de `VerifyEmailView.vue` pour respecter la
 * convention "logique métier et appels GraphQL dans les composables, jamais dans les
 * composants" (CLAUDE.md).
 *
 * Intervient APRÈS la vérification du code Cognito (`auth.confirmRegistration`, restée
 * dans la vue — ce n'est pas un appel `client.graphql()`, et hors du périmètre de cette
 * extraction) : crée les entités métier correspondant au rôle choisi à l'inscription
 * (`data.role`, valeur de `tempRegistrationData`/`temp_register_safe_data`, voir
 * `VerifyEmailView.vue`) :
 *
 * - `owner` : Owner (`id` = cognitoUserId) + Animal par défaut si un nom d'animal a été
 *   renseigné à l'inscription express (Phase 6.B) + OwnerAvailability par défaut
 *   (samedi 9h-12h).
 * - `vet` : Clinic (`id` généré côté backend) + Veterinarian (`id` = cognitoUserId).
 * - tout autre rôle : no-op, identique au comportement d'origine (le `if`/`else if` du
 *   composant ne couvrait déjà que ces deux cas).
 *
 * ⚠️ Comportement connu en cas d'échec AU MILIEU de la séquence (ex. `createAnimalSimple`
 * échoue après que `createOwnerSimple` ait réussi) : AUCUN rollback, AUCUNE compensation.
 * L'erreur remonte telle quelle à l'appelant (la vue affiche un message), mais l'Owner
 * déjà créé reste orphelin (sans Animal ni OwnerAvailability). Si l'utilisateur retente
 * l'opération, `completeRegistration` est rejoué depuis le début : `createOwnerSimple`
 * retente alors de créer un Owner avec le même `id` (= cognitoUserId) — la mutation
 * générée par le Transformer v1 refuse la création si l'`id` existe déjà (condition
 * implicite `attribute_not_exists(id)`), donc l'utilisateur reste bloqué sans pouvoir
 * terminer son inscription tant qu'aucune intervention manuelle ne nettoie l'Owner
 * orphelin. Documenté ici (voir aussi le test dédié dans
 * `useRegistrationCompletion.test.js`) : c'est un bug réel préexistant à cette
 * extraction, PAS introduit ni corrigé par elle — le comportement d'origine (déjà
 * non-transactionnel dans `VerifyEmailView.vue`) est reproduit à l'identique. Signalé
 * dans le rapport de la Phase 7.7 pour arbitrage par le coordinateur/Lead Dev.
 *
 * Contrairement à `mapAcceptMissionError`/`mapValidationErrorKey`, ce composable n'a pas
 * de fonction de mapping erreur -> clé i18n dédiée : il n'existait déjà aucune
 * catégorisation d'erreur pour ce flux avant l'extraction (la vue distinguait déjà
 * `err.errors` d'AppSync de `err.message` brut, logique de présentation restée dans la
 * vue à l'identique) — ne pas en inventer une ici serait une extension de périmètre non
 * demandée par la sous-tâche 7.7.
 */
/**
 * Phase 7 (revue Lead Dev) : `completeOwnerRegistration` crée TOUJOURS un
 * `OwnerAvailability` par défaut (samedi 9h-12h), que `data.animal_name` soit
 * renseigné ou non -- seul l'Animal (et ses valeurs par défaut isVaccinated/
 * donationFrequency) dépend de `animal_name`. La condition initiale de
 * `VerifyEmailView.vue` (`role === 'owner' && animal_name`) laissait donc un
 * Owner sans animal recevoir ce créneau fantôme sans jamais voir l'écran de
 * transparence. Fonction pure exportée pour rester testable sans monter de
 * composant (`VerifyEmailView.vue` fait `t(...)`, jamais cette fonction).
 *
 * @param {object} data - `tempRegistrationData` (voir `completeRegistration`).
 * @returns {boolean}
 */
export function shouldShowExpressDefaultsInfo(data) {
  return data?.role === 'owner'
}

export function useRegistrationCompletion() {
  const client = generateClient()

  // Ref de loading dédié à cette action (convention CLAUDE.md), même si
  // VerifyEmailView.vue pilote aujourd'hui l'état visuel du bouton via `auth.isLoading`
  // (englobe aussi la vérification du code Cognito, en amont de cet appel).
  const isCompleting = ref(false)

  /**
   * Owner (id = cognitoUserId) + Animal par défaut (si renseigné) + OwnerAvailability
   * par défaut.
   */
  const completeOwnerRegistration = async (data, cognitoUserId) => {
    const ownerRes = await client.graphql({
      query: createOwnerSimple,
      variables: {
        input: {
          id: cognitoUserId,
          firstname: data.firstname,
          lastname: data.lastname,
          email: data.email,
          phone: data.phone || '',
          address: data.address || '',
          latitude: parseFloat(data.latitude || 0),
          longitude: parseFloat(data.longitude || 0),
          maxTravelDistance: 50,
          totalDonations: 0,
        },
      },
      authMode: 'userPool',
    })

    const ownerID = ownerRes.data.createOwner.id

    if (data.animal_name) {
      await client.graphql({
        query: createAnimalSimple,
        variables: {
          input: {
            ownerID: ownerID,
            name: data.animal_name,
            species: (data.animal_species || Species.DOG).toUpperCase(),
            breed: data.animal_breed || '',
            // Sous-tâche 6.8 : champ informatif uniquement, optionnel (voir schema.graphql).
            sex: data.animal_sex || null,
            weight: parseFloat(data.animal_weight || 0),
            // Pas d'entrée d'enum dédiée pour 'UNKNOWN' dans src/constants/enums.js (les
            // groupes sanguins connus sont listés par espèce dans BloodGroupsBySpecies,
            // sans valeur "inconnu") — littéral laissé tel quel, hors périmètre de la
            // substitution Species/DonationFrequency demandée pour la Phase 7.7/R-14.
            bloodGroup: data.blood_group || 'UNKNOWN',
            isVaccinated: true,
            isSterilized: false,
            donationFrequency: DonationFrequency.ASAP,
          },
        },
        authMode: 'userPool',
      })
    }

    await client.graphql({
      query: createOwnerAvailabilitySimple,
      variables: {
        input: {
          ownerID: ownerID,
          dayOfWeek: 6,
          startTime: '09:00Z',
          endTime: '12:00Z',
        },
      },
      authMode: 'userPool',
    })
  }

  /**
   * Clinic + Veterinarian (id = cognitoUserId).
   */
  const completeVetRegistration = async (data, cognitoUserId) => {
    // Clinic.id est un identifiant propre généré côté backend (comme Animal/OwnerAvailability) :
    // Clinic.veterinarians est une relation @hasMany, un Clinic peut donc avoir plusieurs
    // Veterinarian, et Clinic.id ne doit jamais être aliasé sur le cognitoUserId d'un vétérinaire.
    const clinicRes = await client.graphql({
      query: createClinicSimple,
      variables: {
        input: {
          name: data.clinic_name,
          rpps: data.rpps,
          email: data.email,
          phone: data.phone || '',
          address: data.address,
          latitude: parseFloat(data.latitude || 0),
          longitude: parseFloat(data.longitude || 0),
          hasEmergencyService: false,
          transfusionsDone: 0,
          donorOwnersCount: 0,
        },
      },
      authMode: 'userPool',
    })

    await client.graphql({
      query: createVeterinarianSimple,
      variables: {
        input: {
          id: cognitoUserId,
          clinicID: clinicRes.data.createClinic.id,
          firstname: data.firstname,
          lastname: data.lastname,
          email: data.email,
        },
      },
      authMode: 'userPool',
    })
  }

  /**
   * Point d'entrée unique, appelé depuis `VerifyEmailView.vue` juste après la
   * vérification du code Cognito. Branche sur `data.role` ('owner' | 'vet').
   *
   * @param {object} data - `tempRegistrationData` : `role` ('owner' | 'vet') + les
   *   champs de formulaire d'inscription associés.
   * @param {string} cognitoUserId - `currentUser.userId` (Cognito), utilisé comme `id`
   *   pour Owner/Veterinarian.
   */
  const completeRegistration = async (data, cognitoUserId) => {
    isCompleting.value = true
    try {
      if (data.role === 'owner') {
        await completeOwnerRegistration(data, cognitoUserId)
      } else if (data.role === 'vet') {
        await completeVetRegistration(data, cognitoUserId)
      }
    } catch (e) {
      console.error("Erreur complétion d'inscription (création des entités métier) :", e)
      throw e
    } finally {
      isCompleting.value = false
    }
  }

  return {
    isCompleting,
    completeRegistration,
  }
}
