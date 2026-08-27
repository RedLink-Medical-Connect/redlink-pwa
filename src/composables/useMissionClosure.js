import { ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { MissionStatus, MissionValidationOutcome } from '@/constants/enums'
import { throwIfGraphqlError } from '@/services/graphql-error-service'
import { resolveClinicOwnerRelationUpsert } from '@/services/clinic-owner-relation-service'

// Double validation de Mission (2026-08-26, étape 4/5) : l'écriture du statut passe désormais
// par `client.mutations.submitMissionValidation` (mutation custom, ADR-0015/ADR-0016) et NON
// plus par `client.models.Mission.update({ status })` — `Mission.status` n'est plus écrivable
// par un Veterinarian via une mutation générée (`missionStatusFieldAuth`, étape 1/5). Les
// autres appels de ce fichier (Animal/ClinicOwnerRelation/Clinic) sont inchangés.
//
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

// ─────────────────────────────────────────────────────────────────────────────────────────
// TRADUCTION `MissionStatus` (vocabulaire PUBLIC de closeMission) -> `MissionValidationOutcome`
// (vocabulaire de la mutation `submitMissionValidation`). LE point le plus sensible de la
// migration vers la double validation (2026-08-26) : une inversion ici serait SILENCIEUSE et
// catastrophique (confirmer un don qui n'a PAS eu lieu, ou infirmer un don réel).
//
// Les deux vocabulaires ne parlent PAS de la même chose, d'où la table explicite plutôt qu'une
// coercition implicite :
// - `MissionStatus` (ce que l'appelant passe, contrat public inchangé depuis la Phase 2.1 —
//   RequestsView.vue envoie toujours MissionStatus.COMPLETED/NO_SHOW) décrit l'issue FINALE
//   observée par le vétérinaire : le donneur s'est présenté et le don a eu lieu (COMPLETED),
//   ou pas (NO_SHOW).
// - `MissionValidationOutcome` (ce que le resolver attend) décrit le VOTE d'UN SEUL des deux
//   côtés sur la question « le don a-t-il eu lieu ? » : CONFIRMED (oui) / DENIED (non).
//   'PENDING' n'est PAS une soumission valide (état initial implicite, rejeté explicitement
//   par le resolver — voir submit-mission-validation-write-side.js).
//
// D'où, dans ce sens et pas l'autre :
//   COMPLETED (« le don a eu lieu »)   -> CONFIRMED (le vétérinaire CONFIRME le don)
//   NO_SHOW   (« le don n'a pas eu lieu ») -> DENIED  (le vétérinaire INFIRME le don)
//
// Le statut FINAL de la Mission n'est plus décidé ici : il est calculé par le resolver à
// partir des DEUX votes (matrice dans submit-mission-validation-finalize-status.js —
// CONFIRMED+CONFIRMED -> COMPLETED, DENIED+DENIED -> NO_SHOW, mixte -> DISPUTED, un seul côté
// -> PENDING_VALIDATION). Un vétérinaire qui clôture en COMPLETED n'obtient donc PAS
// forcément une Mission COMPLETED — voir `closeMission` plus bas.
const OUTCOME_TO_VALIDATION_OUTCOME = Object.freeze({
  [MissionStatus.COMPLETED]: MissionValidationOutcome.CONFIRMED,
  [MissionStatus.NO_SHOW]: MissionValidationOutcome.DENIED,
})

// Les deux seules issues valides pour la clôture d'une Mission côté Veterinarian (roadmap
// Phase 2, sous-tâche 1) : le donneur s'est présenté (COMPLETED) ou pas (NO_SHOW). Toute
// autre valeur (ex. un statut d'ouverture comme ACCEPTED/PENDING_ARRIVAL, ou une faute de
// frappe) doit être rejetée explicitement — `closeMission` ne coerce/ne défaulte jamais
// silencieusement sur l'une des deux. Dérivé des clés de la table de traduction ci-dessus
// (plutôt que d'une seconde liste à garder synchronisée à la main) : ajouter une issue sans
// lui donner de traduction devient impossible.
const VALID_OUTCOMES = Object.keys(OUTCOME_TO_VALIDATION_OUTCOME)

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
 * Depuis la double validation (2026-08-26, étape 4/5), « sur COMPLETED » ci-dessous signifie
 * « quand la Mission ATTEINT RÉELLEMENT le statut COMPLETED à l'issue de cette soumission »
 * (les deux côtés ont confirmé), pas « quand le vétérinaire a cliqué Terminé » — voir le
 * JSDoc de `closeMission` pour le détail de ce changement.
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
 * Écritures conditionnelles : ce composable n'en pose plus AUCUNE lui-même (il n'en posait
 * déjà aucune avant la double validation, contrairement à `acceptMission`/ADR-0001) — elles
 * vivent désormais toutes dans le resolver `submitMissionValidation` : write-once par côté
 * (`attributeExists: false` sur le champ d'outcome de l'appelant, un second vote du MÊME côté
 * échoue avec `ALREADY_VALIDATED`) et condition optimiste sur `Mission.status` au moment de
 * la finalisation. La re-clôture accidentelle (double clic) que l'UI seule gardait jusqu'ici
 * est donc désormais fermée CÔTÉ SERVEUR aussi — pas une raison de retirer la garde d'UI de
 * RequestsView.vue (elle évite un message d'erreur inutile), mais un vrai renforcement.
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
   * Soumet la validation CÔTÉ VÉTÉRINAIRE pour une Mission, avec l'issue `outcome`
   * (`MissionStatus.COMPLETED` ou `MissionStatus.NO_SHOW`) — traduite EN INTERNE en
   * `MissionValidationOutcome` (voir `OUTCOME_TO_VALIDATION_OUTCOME` en tête de fichier pour
   * la table de traduction et le raisonnement complet).
   *
   * CHANGEMENT DE COMPORTEMENT (2026-08-26, double validation, étape 4/5) — le coeur de cette
   * sous-tâche, à lire avant de toucher à cette fonction :
   * - AVANT : cette fonction écrivait `Mission.status = outcome` directement, et déclenchait
   *   les 3 écritures secondaires dès que `outcome === COMPLETED`, sur la seule décision du
   *   vétérinaire.
   * - MAINTENANT : elle soumet un VOTE. Le statut final est calculé côté serveur à partir des
   *   DEUX votes (Owner + Clinic). Les 3 écritures secondaires ne se déclenchent QUE si le
   *   statut RÉELLEMENT retourné par la mutation est `COMPLETED` — c'est-à-dire une fois les
   *   deux parties d'accord sur le fait que le don a eu lieu. Jamais sur `PENDING_VALIDATION`
   *   (l'Owner n'a pas encore répondu), jamais sur `DISPUTED` (désaccord), jamais sur
   *   `NO_SHOW`. `COMPLETED_AUTO` (finalisation automatique après délai) n'est jamais produit
   *   par ce chemin : c'est la Lambda planifiée qui l'écrit ET qui refait elle-même les 3
   *   écritures secondaires de son côté (ADR-0016 §4) — d'où le test sur `COMPLETED` STRICT
   *   ici, sinon un don serait compté deux fois.
   *
   * Conséquence produit à connaître côté UI (câblage hors périmètre de cette sous-tâche,
   * réservé à une PR de suivi) : `Animal.lastDonationDate` — donc la Frequency Rule — n'est
   * plus réarmé au clic du vétérinaire mais seulement une fois la validation de l'Owner
   * reçue (ou après le délai, via la Lambda).
   *
   * `disputeReason` (3e argument de `submitMissionValidation`) n'est délibérément PAS exposé
   * ici : le champ écrit par le resolver côté Veterinarian est `clinicValidationOutcome`/
   * `clinicValidatedAt` uniquement — `ownerDisputeReason` n'existe que côté Owner (motif de
   * litige en texte libre). Le passer depuis ce composable n'aurait aucun effet.
   *
   * @param {string} missionId
   * @param {string} animalId - requis même pour NO_SHOW (contrat stable de la fonction),
   *   mais n'est utilisé (et donc n'a besoin d'être valide) que si la double validation
   *   aboutit à COMPLETED.
   * @param {string} outcome - `MissionStatus.COMPLETED` ou `MissionStatus.NO_SHOW`
   * @param {string} [clinicID] - `Request.clinicID` de la Mission clôturée. Requis pour
   *   l'upsert `ClinicOwnerRelation`, mais uniquement utilisé (et donc n'a besoin d'être
   *   valide) que sur COMPLETED — même contrat que `animalId`. RequestsView.vue le passe
   *   déjà chargé, aucun aller-retour GraphQL dédié requis.
   * @param {string} [ownerID] - `Animal.ownerID` de l'animal donneur. Mêmes conditions que
   *   `clinicID` ci-dessus.
   * @returns {Promise<string|null>} le statut RÉEL de la Mission après cette soumission, tel
   *   que renvoyé par le serveur (`PENDING_VALIDATION` tant que l'Owner n'a pas répondu, ou
   *   `COMPLETED`/`NO_SHOW`/`DISPUTED` si les deux ont répondu) — `null` si le serveur n'a
   *   renvoyé aucune donnée exploitable sans lever d'erreur (cas défensif, ne devrait pas
   *   arriver). Ce retour est délibérément le STATUT et pas un booléen de succès : c'est ce
   *   qui permettra à une future vue d'afficher « en attente de la confirmation du
   *   propriétaire » sans avoir à changer une deuxième fois cette signature. L'appelant
   *   actuel (RequestsView.vue) ignore la valeur de retour — aucune régression.
   * @throws {Error} `INVALID_OUTCOME` si `outcome` n'est ni COMPLETED ni NO_SHOW — levée
   *   avant tout appel GraphQL. Toute autre erreur (réseau, `@auth`, `ALREADY_VALIDATED`
   *   renvoyé par le resolver si ce côté a déjà voté) est relayée telle quelle, sans mapping
   *   de code dédié — contrat d'erreur inchangé par rapport à la Phase 2.1, voir le
   *   commentaire correspondant dans RequestsView.vue.
   */
  const closeMission = async (missionId, animalId, outcome, clinicID, ownerID) => {
    if (!VALID_OUTCOMES.includes(outcome)) {
      throw new Error('INVALID_OUTCOME')
    }

    isClosing.value = true
    try {
      // `client.models.Mission.update({ status })` N'EST PLUS UNE OPTION : `Mission.status`
      // porte depuis l'étape 1/5 une `.authorization()` de champ (`missionStatusFieldAuth`,
      // amplify/data/resource.ts) qui retire `update` aux Veterinarians — la mutation custom
      // est désormais la SEULE voie d'écriture du statut.
      const { data, errors } = await client.mutations.submitMissionValidation({
        missionId,
        outcome: OUTCOME_TO_VALIDATION_OUTCOME[outcome],
      })
      throwIfGraphqlError(errors, 'submitMissionValidation')

      const finalStatus = data?.status ?? null

      // STRICTEMENT `COMPLETED` : voir le bloc "CHANGEMENT DE COMPORTEMENT" ci-dessus. Ne
      // jamais retomber sur `outcome === MissionStatus.COMPLETED` (l'ancien test) — ce serait
      // exactement la régression que cette sous-tâche corrige : déclencher les effets d'un don
      // réalisé sur la seule parole du vétérinaire.
      if (finalStatus === MissionStatus.COMPLETED) {
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

      return finalStatus
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
