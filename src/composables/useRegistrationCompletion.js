import { ref } from 'vue'
import { generateClient } from '@/services/bff-graphql-client'
import { Species, DonationFrequency, AccountRole, LegalDocumentType } from '@/constants/enums'
import { LEGAL_DOCUMENT_VERSIONS } from '@/constants/legal.js'
import { throwIfGraphqlError } from '@/services/graphql-error-service'

/**
 * Phase 7.7 : composable regroupant la logique métier + les 5 appels `client.graphql()`
 * de complétion d'inscription, extraits de `VerifyEmailView.vue` pour respecter la
 * convention "logique métier et appels GraphQL dans les composables, jamais dans les
 * composants" (CLAUDE.md).
 *
 * Phase 8, sous-tâche 5 (lot 1/3) : migré sur le client Gen2 (`aws-amplify/data`,
 * `client.models.Owner.create()`/`client.models.Animal.create()`/etc.). Plus d'import depuis
 * `@/graphql/custom-mutations` -- voir le commentaire équivalent dans useAnimals.js. Sur le
 * changement de comportement d'erreur Gen1 -> Gen2 et `throwIfGraphqlError` ci-dessous : voir
 * le JSDoc de `src/services/graphql-error-service.js`, seule source de vérité sur le
 * "pourquoi" (aucun des 5 appels de ce fichier n'avait de `catch` dédié en Gen1 -- seul
 * `completeRegistration()`, plus bas, entoure l'ensemble d'un `try/catch` qui logue et
 * relance -- `throwIfGraphqlError` continue de faire remonter l'échec jusqu'à ce `try/catch`
 * englobant, exactement le contrat qu'attend `VerifyEmailView.vue`, `err.errors`).
 *
 * Intervient APRÈS la vérification du code Cognito (`auth.confirmRegistration`, restée
 * dans la vue — ce n'est pas un appel `client.graphql()`, et hors du périmètre de cette
 * extraction) : crée les entités métier correspondant au rôle choisi à l'inscription
 * (`data.role`, valeur de `tempRegistrationData`/`temp_register_safe_data`, voir
 * `VerifyEmailView.vue`) :
 *
 * - `owner` : Owner (`id` = cognitoUserId) + 2 ConsentRecord (CGU/confidentialité, voir
 *   `createConsentRecords` ci-dessous, scaffolding légal/RGPD 2026-08-25) + Animal par
 *   défaut si un nom d'animal a été renseigné à l'inscription express (Phase 6.B) +
 *   OwnerAvailability par défaut (samedi 9h-12h).
 * - `vet` : Clinic (`id` généré côté backend) + Veterinarian (`id` = cognitoUserId) + 2
 *   ConsentRecord (même scaffolding).
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
 * dans le rapport de la Phase 7.7 pour arbitrage par le coordinateur/Lead Dev. Toujours vrai
 * en Gen2 (R-25) : `a.model()` sans contrainte d'unicité personnalisée applique la même
 * condition implicite `attribute_not_exists(id)` que le Transformer v1 sur une création avec
 * `id` explicite.
 *
 * Contrairement à `mapAcceptMissionError`/`mapValidationErrorKey`, ce composable n'a pas
 * de fonction de mapping erreur -> clé i18n dédiée : il n'existait déjà aucune
 * catégorisation d'erreur pour ce flux avant l'extraction (la vue distinguait déjà
 * `err.errors` d'AppSync de `err.message` brut, logique de présentation restée dans la
 * vue à l'identique) — ne pas en inventer une ici serait une extension de périmètre non
 * demandée par la sous-tâche 7.7.
 */
export function useRegistrationCompletion() {
  const client = generateClient()

  // Ref de loading dédié à cette action (convention CLAUDE.md), même si
  // VerifyEmailView.vue pilote aujourd'hui l'état visuel du bouton via `auth.isLoading`
  // (englobe aussi la vérification du code Cognito, en amont de cet appel).
  const isCompleting = ref(false)

  /**
   * Scaffolding légal/RGPD (2026-08-25, docs/adr/0014) : une ligne `ConsentRecord` par
   * document obligatoire (CGU + politique de confidentialité -- PAS CGV, non capturée à
   * l'inscription, voir constants/legal.js) pour le compte qui vient d'être créé.
   * `documentVersion` vient de `LEGAL_DOCUMENT_VERSIONS` (constants/legal.js), jamais d'une
   * valeur transmise par le client -- une `ConsentRecord` doit toujours référencer une
   * version qui a réellement existé, pas ce que le formulaire prétend avoir affiché.
   *
   * Volontairement CRITIQUE (rethrow via `throwIfGraphqlError`, PAS best-effort/avalé) --
   * contrairement à la convention "écriture secondaire best-effort" du reste du repo (ex.
   * `upsertClinicOwnerRelation`, useMissionClosure.js/useAnimalValidation.js) : cette preuve
   * de consentement EST la fonctionnalité elle-même (demande produit : "je veux pouvoir...
   * retrouver qui a consenti à quoi et quand"), pas un confort d'annuaire en plus d'une
   * écriture déjà réussie -- un profil créé sans sa preuve de consentement serait
   * exactement le risque que ce scaffolding existe pour éliminer.
   *
   * @param {string} userID cognitoUserId (= Owner.id ou Veterinarian.id)
   * @param {string} userRole `AccountRole.OWNER`/`AccountRole.VETERINARIAN`
   */
  const createConsentRecords = async (userID, userRole) => {
    for (const documentType of [LegalDocumentType.CGU, LegalDocumentType.PRIVACY_POLICY]) {
      const { errors } = await client.models.ConsentRecord.create({
        userID,
        userRole,
        documentType,
        documentVersion: LEGAL_DOCUMENT_VERSIONS[documentType].version,
      })
      throwIfGraphqlError(errors, 'createConsentRecord')
    }
  }

  /**
   * Owner (id = cognitoUserId) + Animal par défaut (si renseigné) + OwnerAvailability
   * par défaut.
   */
  const completeOwnerRegistration = async (data, cognitoUserId) => {
    // Défense en profondeur (même raisonnement que `BLOOD_GROUP_UNKNOWN`,
    // useAnimalValidation.js) : RegisterOwnerView.vue bloque déjà la progression tant que
    // les deux cases ne sont pas cochées, mais cette fonction reste appelable
    // indépendamment de ce composant -- un Owner ne doit jamais pouvoir être créé sans ses
    // deux `ConsentRecord` associés, quel que soit le chemin d'appel.
    if (!data.cguAccepted || !data.privacyAccepted) {
      throw new Error('CONSENT_REQUIRED')
    }

    const { data: owner, errors: ownerErrors } = await client.models.Owner.create({
      id: cognitoUserId,
      firstname: data.firstname,
      lastname: data.lastname,
      email: data.email,
      phone: data.phone || '',
      address: data.address || '',
      latitude: parseFloat(data.latitude || 0),
      longitude: parseFloat(data.longitude || 0),
      maxTravelDistance: 5,
      totalDonations: 0,
    })

    throwIfGraphqlError(ownerErrors, 'createOwner')

    const ownerID = owner.id

    await createConsentRecords(ownerID, AccountRole.OWNER)

    if (data.animal_name) {
      const { errors: animalErrors } = await client.models.Animal.create({
        ownerID: ownerID,
        name: data.animal_name,
        species: (data.animal_species || Species.DOG).toUpperCase(),
        breed: data.animal_breed || '',
        // Sous-tâche 6.8 : champ informatif uniquement, optionnel (voir schema.graphql).
        sex: data.animal_sex || null,
        // Bug réel trouvé en test manuel : `animal_birthDate` était collecté par
        // RegisterOwnerView.vue (form d'inscription express) mais jamais transmis
        // ici -- tout Animal créé à l'inscription se retrouvait avec `birthDate: null`,
        // donc un âge affiché en "?" (`calculateAge()`, useAnimals.js) quel que soit ce
        // qui avait été saisi. Même repli que `createNewAnimal` (useAnimals.js) :
        // chaîne vide traitée comme "non renseigné".
        birthDate: data.animal_birthDate ? data.animal_birthDate : null,
        weight: parseFloat(data.animal_weight || 0),
        // Pas d'entrée d'enum dédiée pour 'UNKNOWN' dans src/constants/enums.js (les
        // groupes sanguins connus sont listés par espèce dans BloodGroupsBySpecies,
        // sans valeur "inconnu") — littéral laissé tel quel, hors périmètre de la
        // substitution Species/DonationFrequency demandée pour la Phase 7.7/R-14.
        bloodGroup: data.blood_group || 'UNKNOWN',
        // Harmonisation avec AddAnimalView.vue (demande produit 2026-08-23) : ces trois
        // valeurs étaient fabriquées en silence (isVaccinated forcé à true en particulier,
        // jamais réellement demandé au propriétaire) -- RegisterOwnerView.vue expose
        // désormais les mêmes champs qu'AddAnimalView.vue, mêmes défauts (false/false/ASAP)
        // si l'Owner ne les touche pas, plutôt que de prétendre un statut vaccinal jamais
        // confirmé.
        isVaccinated: data.animal_isVaccinated || false,
        isSterilized: data.animal_isSterilized || false,
        donationFrequency: data.animal_donationFrequency || DonationFrequency.ASAP,
      })

      throwIfGraphqlError(animalErrors, 'createAnimal')
    }

    const { errors: availabilityErrors } = await client.models.OwnerAvailability.create({
      ownerID: ownerID,
      dayOfWeek: 6,
      startTime: '09:00Z',
      endTime: '12:00Z',
    })

    throwIfGraphqlError(availabilityErrors, 'createOwnerAvailability')
  }

  /**
   * Clinic + Veterinarian (id = cognitoUserId).
   */
  const completeVetRegistration = async (data, cognitoUserId) => {
    // Même garde-fou que completeOwnerRegistration ci-dessus, même raison.
    if (!data.cguAccepted || !data.privacyAccepted) {
      throw new Error('CONSENT_REQUIRED')
    }

    // Clinic.id est un identifiant propre généré côté backend (comme Animal/OwnerAvailability) :
    // Clinic.veterinarians est une relation @hasMany, un Clinic peut donc avoir plusieurs
    // Veterinarian, et Clinic.id ne doit jamais être aliasé sur le cognitoUserId d'un vétérinaire.
    const { data: clinic, errors: clinicErrors } = await client.models.Clinic.create({
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
    })

    throwIfGraphqlError(clinicErrors, 'createClinic')

    const { errors: vetErrors } = await client.models.Veterinarian.create({
      id: cognitoUserId,
      clinicID: clinic.id,
      firstname: data.firstname,
      lastname: data.lastname,
      email: data.email,
    })

    throwIfGraphqlError(vetErrors, 'createVeterinarian')

    await createConsentRecords(cognitoUserId, AccountRole.VETERINARIAN)
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
