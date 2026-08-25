import { ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { MissionStatus } from '@/constants/enums'
import { throwIfGraphqlError } from '@/services/graphql-error-service'
import { resolveClinicOwnerRelationUpsert } from '@/services/clinic-owner-relation-service'

// Phase 8, sous-tâche 5 (lot 3/3) : migré sur le client Gen2 (`aws-amplify/data`,
// `client.models.Mission.*`/`client.models.Animal.*`/`client.models.ClinicOwnerRelation.*`/
// `client.models.Clinic.*`). Les mutations `*Simple`/queries Gen1 (`closeMissionSimple`,
// `updateAnimalLastDonationDateSimple`, `createClinicOwnerRelationSimple`,
// `updateClinicStatsSimple`, `clinicOwnerRelationsByOwnerID`, `getClinic`) n'ont plus lieu
// d'être ici -- voir CLAUDE.md / roadmap Phase 8 pour la méthodologie de migration.
//
// Sur le changement de comportement d'erreur Gen1 -> Gen2 et `throwIfGraphqlError` : voir le
// JSDoc de `src/services/graphql-error-service.js`. Les cinq appels de ce composable
// reprennent tous `throwIfGraphqlError` : le Gen1 d'origine faisait un simple
// `await client.graphql(...)` sans jamais destructurer/inspecter la réponse, donc aucun
// n'avait de notion de succès partiel à préserver.
//
// Pas de `selectionSet` dédié sur `Clinic.get()`/`ClinicOwnerRelation.list()` ci-dessous
// (contrairement à useClinicDonors.js/useMatchingRequests.js) : ce sont des lectures PLATES
// (aucune relation imbriquée traversée), donc le sur-fetch potentiel du selectionSet par
// défaut (scalaires du modèle) reste négligeable -- la discipline "champs réellement
// consommés" documentée dans CLAUDE.md/lot 2 vise spécifiquement le coût d'une traversée de
// relation, pas un `get()`/`list()` à plat.

// Les deux seules issues valides pour la clôture d'une Mission côté Veterinarian (roadmap
// Phase 2, sous-tâche 1) : le donneur s'est présenté (COMPLETED) ou pas (NO_SHOW). Toute
// autre valeur (ex. un statut d'ouverture comme ACCEPTED/PENDING_ARRIVAL, ou une faute de
// frappe) doit être rejetée explicitement — `closeMission` ne coerce/ne défaulte jamais
// silencieusement sur l'une des deux.
const VALID_OUTCOMES = [MissionStatus.COMPLETED, MissionStatus.NO_SHOW]

/**
 * Date du jour au format `AWSDate` (`YYYY-MM-DD`), dans le fuseau LOCAL — pas
 * `toISOString().slice(0, 10)`, qui donne la date UTC. Un vétérinaire qui clôture une
 * Mission entre ~22h et minuit UTC (0h-2h heure de Paris en été) verrait sinon
 * `Animal.lastDonationDate` daté de la veille, faussant silencieusement la Frequency Rule
 * d'un jour — trouvé par un test de frontière de fuseau horaire en QA sur cette sous-tâche.
 */
function todayAsAWSDate(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Phase 2.1/3.1 : composable Veterinarian-facing pour la clôture d'une Mission acceptée
 * (marquer COMPLETED ou NO_SHOW). Logique + mutations uniquement — aucun câblage UI
 * (bouton, vue) dans la sous-tâche 2.1, voir roadmap Phase 2.2 (câblage effectué depuis dans
 * RequestsView.vue).
 *
 * Sur COMPLETED :
 * - `Animal.lastDonationDate` est mis à la date du jour (format `AWSDate`, `YYYY-MM-DD`) via
 *   `updateAnimalLastDonationDateSimple` — c'est l'écriture qui permet à la Frequency Rule
 *   (CONTEXT.md, `satisfiesFrequencyRule` dans eligibility-service.js) de s'activer en
 *   conditions réelles : sans elle, un Animal reste éligible indéfiniment après un don réel
 *   (voir docs/adr/0003).
 * - Une `ClinicOwnerRelation` entre le Clinic de la Request et l'Owner de l'Animal est
 *   upsertée (Phase 3.1, roadmap) — c'est l'écriture qui permet à `DonorsView.vue` (Phase
 *   3.2, hors périmètre ici) de retrouver un jour les Owners rattachés à une clinique : sans
 *   elle, `ClinicOwnerRelation` n'est jamais peuplée en conditions réelles bien que ses
 *   mutations CRUD soient générées depuis le début. Voir `resolveClinicOwnerRelationUpsert`
 *   ci-dessus pour la logique d'upsert, et `upsertClinicOwnerRelation` plus bas pour son
 *   traitement d'erreur délibérément best-effort (documenté sur cette fonction).
 * - `Clinic.transfusionsDone`/`donorOwnersCount` sont incrémentés (Phase 6.7, CdC §2.4) —
 *   voir `incrementClinicStats` plus bas, même traitement best-effort.
 *
 * Sur NO_SHOW, aucun don n'a eu lieu — ni `Animal` ni `ClinicOwnerRelation` ne sont jamais
 * touchés.
 *
 * Pas d'écriture atomique conditionnelle (contrairement à `acceptMission`,
 * useOwnerMissions.js, ADR-0001) : cette action n'oppose pas plusieurs parties non fiables
 * en course l'une contre l'autre (le cas qui justifiait la ConditionExpression sur
 * `Request.status`), mais une seule Veterinarian qui a la Mission ouverte devant elle et
 * décide de son issue. La vue qui appelle `closeMission` (RequestsView.vue) ne propose
 * l'action que pour une Mission encore `ACCEPTED`/`PENDING_ARRIVAL`, ce qui suffit comme
 * garde pour le profil de risque réel de cette action.
 */
export function useMissionClosure() {
  const client = generateClient()

  const isClosing = ref(false)

  /**
   * Upsert best-effort d'une `ClinicOwnerRelation` (clinicID, ownerID) — voir
   * `resolveClinicOwnerRelationUpsert` pour la logique de décision.
   *
   * Choix délibéré (à documenter/scruter en review) : cette écriture ne fait JAMAIS échouer
   * `closeMission` — toute erreur ici (réseau, @auth, GraphQL) est loguée et avalée, jamais
   * relancée. Raisonnement : au moment où cette fonction est appelée, `Mission.status` et
   * `Animal.lastDonationDate` ont déjà été écrits avec succès — le don a réellement eu lieu
   * et la Frequency Rule est déjà correctement mise à jour, ce qui est la partie critique du
   * métier (CONTEXT.md). `ClinicOwnerRelation` n'alimente qu'un annuaire clinique
   * (`DonorsView.vue`, Phase 3.2) : un échec ici est un manque de confort d'annuaire, pas
   * une perte de donnée médicale. Faire échouer toute la clôture de Mission pour ça
   * afficherait au vétérinaire un message d'erreur trompeur (laissant penser que le don n'a
   * pas été enregistré) alors que l'essentiel a réussi — même esprit que le nettoyage
   * best-effort de Mission orpheline dans `useOwnerMissions.js`/`acceptMission`.
   *
   * Si `clinicID`/`ownerID` sont absents (ex. appelant qui n'a pas encore migré vers le
   * nouveau contrat de `closeMission`), no-op silencieux + log — mêmes raisons.
   *
   * @returns {Promise<boolean>} `true` si une NOUVELLE `ClinicOwnerRelation` a été créée
   *   (donc un nouveau propriétaire donneur pour cette clinique — voir
   *   `incrementClinicStats` ci-dessous, Phase 6.7), `false` sinon (relation déjà
   *   existante, ids manquants, ou erreur — mêmes raisons best-effort que le reste de
   *   cette fonction : une incertitude sur `donorOwnersCount` est préférable à faire
   *   échouer la clôture).
   */
  const upsertClinicOwnerRelation = async (clinicID, ownerID) => {
    if (!clinicID || !ownerID) {
      console.error(
        'Liaison clinique/propriétaire (ClinicOwnerRelation) ignorée : clinicID ou ownerID manquant.',
      )
      return false
    }

    try {
      const { data, errors } = await client.models.ClinicOwnerRelation.list({
        filter: { ownerID: { eq: ownerID } },
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
    } catch (e) {
      console.error('Erreur liaison clinique/propriétaire (ClinicOwnerRelation) :', e)
      // Volontairement avalée, pas relancée — voir le commentaire de fonction ci-dessus.
      return false
    }
  }

  /**
   * Incrément best-effort des indicateurs tableau de bord vétérinaire (CdC §2.4, Phase
   * 6.7) : `Clinic.transfusionsDone` (toujours, une transfusion a réellement eu lieu) et
   * `Clinic.donorOwnersCount` (seulement si `isNewDonorOwner` — sinon ce don compterait un
   * propriétaire déjà connu de cette clinique une deuxième fois). Même traitement d'erreur
   * best-effort que `upsertClinicOwnerRelation` ci-dessus et pour la même raison : au
   * moment de l'appel, `Mission.status`/`Animal.lastDonationDate` ont déjà été écrits avec
   * succès (le don a réellement eu lieu), donc un échec ici est une imprécision de
   * tableau de bord, pas une perte de donnée médicale — ne doit jamais faire échouer
   * `closeMission`.
   *
   * Lecture-puis-écriture, pas d'incrément atomique côté serveur (le Transformer v1 n'en
   * expose pas nativement sur un scalaire `Int`) : même course acceptée, non résolue, que
   * `resolveClinicOwnerRelationUpsert` documente plus haut — deux Missions de la même
   * Clinic closes à quelques instants d'écart peuvent perdre un incrément. Accepté pour ce
   * pilote (scénario mono-vétérinaire à faible fréquence) ; un vrai incrément atomique
   * (ex. `ADD` DynamoDB) demanderait un resolver VTL dédié, hors périmètre de cette
   * sous-tâche.
   */
  const incrementClinicStats = async (clinicID, isNewDonorOwner) => {
    if (!clinicID) {
      console.error('Incrément des indicateurs clinique ignoré : clinicID manquant.')
      return
    }

    try {
      const { data, errors } = await client.models.Clinic.get({ id: clinicID })
      throwIfGraphqlError(errors, 'getClinic')

      const current = data
      if (!current) return

      const { errors: updateErrors } = await client.models.Clinic.update({
        id: clinicID,
        transfusionsDone: (current.transfusionsDone ?? 0) + 1,
        donorOwnersCount: (current.donorOwnersCount ?? 0) + (isNewDonorOwner ? 1 : 0),
      })
      throwIfGraphqlError(updateErrors, 'updateClinic')
    } catch (e) {
      console.error('Erreur incrément des indicateurs clinique (transfusionsDone/donorOwnersCount) :', e)
      // Volontairement avalée, pas relancée — voir le commentaire de fonction ci-dessus.
    }
  }

  /**
   * Clôture une Mission avec l'issue `outcome` (`MissionStatus.COMPLETED` ou
   * `MissionStatus.NO_SHOW`). Met toujours à jour `Mission.status`. Si (et seulement si)
   * `outcome === MissionStatus.COMPLETED`, met aussi à jour `Animal.lastDonationDate` à la
   * date du jour, puis upserte (best-effort) la `ClinicOwnerRelation` correspondante.
   *
   * @param {string} missionId
   * @param {string} animalId - requis même pour NO_SHOW (contrat stable de la fonction),
   *   mais n'est utilisé (et donc n'a besoin d'être valide) que sur COMPLETED.
   * @param {string} outcome - `MissionStatus.COMPLETED` ou `MissionStatus.NO_SHOW`
   * @param {string} [clinicID] - `Request.clinicID` de la Mission clôturée. Requis pour
   *   l'upsert `ClinicOwnerRelation`, mais uniquement utilisé (et donc n'a besoin d'être
   *   valide) que sur COMPLETED — même contrat que `animalId`. RequestsView.vue le passe
   *   déjà chargé (via `listRequestsByClinic`), aucun aller-retour GraphQL dédié requis.
   * @param {string} [ownerID] - `Animal.ownerID` de l'animal donneur. Mêmes conditions que
   *   `clinicID` ci-dessus.
   * @throws {Error} `INVALID_OUTCOME` si `outcome` n'est ni COMPLETED ni NO_SHOW — levée
   *   avant tout appel GraphQL.
   */
  const closeMission = async (missionId, animalId, outcome, clinicID, ownerID) => {
    if (!VALID_OUTCOMES.includes(outcome)) {
      throw new Error('INVALID_OUTCOME')
    }

    isClosing.value = true
    try {
      const { errors } = await client.models.Mission.update({ id: missionId, status: outcome })
      throwIfGraphqlError(errors, 'updateMission')

      if (outcome === MissionStatus.COMPLETED) {
        // AWSDate attend `YYYY-MM-DD` (pas d'heure) — contrairement à `appointmentDatetime`/
        // `validationExpiresAt` ailleurs dans ce repo, qui sont des AWSDateTime en ISO 8601
        // complet. Date LOCALE (todayAsAWSDate), pas UTC — voir son commentaire.
        const today = todayAsAWSDate()

        const { errors: animalErrors } = await client.models.Animal.update({
          id: animalId,
          lastDonationDate: today,
        })
        throwIfGraphqlError(animalErrors, 'updateAnimal')

        const isNewDonorOwner = await upsertClinicOwnerRelation(clinicID, ownerID)
        await incrementClinicStats(clinicID, isNewDonorOwner)
      }
    } catch (e) {
      console.error('Erreur clôture de la mission:', e)
      throw e
    } finally {
      isClosing.value = false
    }
  }

  return {
    isClosing,
    closeMission,
  }
}
