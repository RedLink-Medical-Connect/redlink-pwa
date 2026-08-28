import { ref } from 'vue'
import { generateClient } from 'aws-amplify/data'
import { MissionStatus, MissionValidationOutcome } from '@/constants/enums'
import { throwIfGraphqlError } from '@/services/graphql-error-service'
import { applyVeterinarianCompletionSideEffects } from '@/composables/mission-completion-side-effects'

// Correctif QA (2026-08-27) : les 3 écritures secondaires de fin de Mission
// (`Animal.lastDonationDate`, upsert `ClinicOwnerRelation`, incrément
// `Clinic.transfusionsDone`/`donorOwnersCount`) ne vivent plus en ligne dans ce fichier mais
// dans `mission-completion-side-effects.js`, partagé avec `useOwnerMissions.js` — depuis la
// double validation, le second vote (donc le passage réel en COMPLETED) peut venir de l'un
// OU l'autre côté, et ces écritures ne peuvent plus appartenir au seul composable
// vétérinaire. Comportement de CE composable strictement inchangé (mêmes appels, même ordre,
// même asymétrie de traitement d'erreur) — voir l'en-tête du module partagé pour le détail,
// dont l'asymétrie `@auth` entre les deux côtés.
//
// Double validation de Mission (2026-08-26, étape 4/5) : l'écriture du statut passe désormais
// par `client.mutations.submitMissionValidation` (mutation custom, ADR-0015/ADR-0016) et NON
// plus par `client.models.Mission.update({ status })` — `Mission.status` n'est plus écrivable
// par un Veterinarian via une mutation générée (`missionStatusFieldAuth`, étape 1/5). Les
// autres appels (Animal/ClinicOwnerRelation/Clinic) sont inchangés, mais vivent depuis le
// correctif QA du 2026-08-27 dans `mission-completion-side-effects.js` (voir ci-dessus).
//
// Phase 8, sous-tâche 5 (lot 3/3) : migré sur le client Gen2 (`aws-amplify/data`,
// `client.models.Mission.*`/`client.models.Animal.*`/`client.models.ClinicOwnerRelation.*`/
// `client.models.Clinic.*`). Les mutations `*Simple`/queries Gen1 (`closeMissionSimple`,
// `updateAnimalLastDonationDateSimple`, `createClinicOwnerRelationSimple`,
// `updateClinicStatsSimple`, `clinicOwnerRelationsByOwnerID`, `getClinic`) n'ont plus lieu
// d'être ici -- voir CLAUDE.md / roadmap Phase 8 pour la méthodologie de migration.
//
// Sur le changement de comportement d'erreur Gen1 -> Gen2 et `throwIfGraphqlError` : voir le
// JSDoc de `src/services/graphql-error-service.js`. Les cinq appels de ce flux (ici et dans le
// module partagé) reprennent tous `throwIfGraphqlError` : le Gen1 d'origine faisait un simple
// `await client.graphql(...)` sans jamais destructurer/inspecter la réponse, donc aucun
// n'avait de notion de succès partiel à préserver.

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
 * Sur COMPLETED, les 3 écritures secondaires sont émises par
 * `applyVeterinarianCompletionSideEffects` (`mission-completion-side-effects.js`, partagé avec
 * `useOwnerMissions.js` depuis le correctif QA du 2026-08-27) :
 * - `Animal.lastDonationDate` est mis à la date du jour (format `AWSDate`, `YYYY-MM-DD`) —
 *   c'est l'écriture qui permet à la Frequency Rule (CONTEXT.md, `satisfiesFrequencyRule`
 *   dans eligibility-service.js) de s'activer en conditions réelles : sans elle, un Animal
 *   reste éligible indéfiniment après un don réel (voir docs/adr/0003).
 * - Une `ClinicOwnerRelation` entre le Clinic de la Request et l'Owner de l'Animal est
 *   upsertée (Phase 3.1, roadmap) — c'est l'écriture qui permet à `DonorsView.vue` (Phase
 *   3.2) de retrouver les Owners rattachés à une clinique : sans elle,
 *   `ClinicOwnerRelation` n'est jamais peuplée en conditions réelles bien que ses mutations
 *   CRUD soient générées depuis le début.
 * - `Clinic.transfusionsDone`/`donorOwnersCount` sont incrémentés (Phase 6.7, CdC §2.4).
 * Les deux dernières sont best-effort (erreur loguée, jamais relancée), la première non —
 * voir le module partagé pour le raisonnement complet de cette asymétrie.
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
   *   renvoyé par le resolver si ce côté a déjà voté, `MISSION_ALREADY_FINALIZED` si la Mission
   *   portait déjà un statut terminal — docs/adr/0020) est relayée telle quelle, sans mapping
   *   de code dédié — contrat d'erreur inchangé par rapport à la Phase 2.1, voir le
   *   commentaire correspondant dans RequestsView.vue.
   *   ÉCART ASSUMÉ avec `useOwnerMissions.submitDonationValidation`, qui NORMALISE ces deux
   *   codes et expose `mapSubmitDonationValidationError` : ce composable-ci n'a jamais eu de
   *   table de messages (contrat historique Phase 2.1, RequestsView.vue affiche un message
   *   générique). En ajouter une ici pour le seul `MISSION_ALREADY_FINALIZED` reviendrait à
   *   inventer un vocabulaire d'erreur côté vétérinaire sans écran pour le consommer —
   *   laissé à la PR d'UI qui câblera l'affichage des deux côtés (docs/adr/0020 §5).
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
        await applyVeterinarianCompletionSideEffects(client, { animalId, clinicID, ownerID })
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
