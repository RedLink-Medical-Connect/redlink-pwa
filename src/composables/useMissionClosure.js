import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
import { closeMissionSimple, updateAnimalLastDonationDateSimple } from '@/graphql/custom-mutations'
import { MissionStatus } from '@/constants/enums'

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
 * Phase 2.1 : composable Veterinarian-facing pour la clôture d'une Mission acceptée
 * (marquer COMPLETED ou NO_SHOW). Logique + mutations uniquement — aucun câblage UI
 * (bouton, vue) dans cette sous-tâche, voir roadmap Phase 2.2.
 *
 * Sur COMPLETED, `Animal.lastDonationDate` est mis à la date du jour (format `AWSDate`,
 * `YYYY-MM-DD`) via `updateAnimalLastDonationDateSimple` — c'est l'écriture qui permet à
 * la Frequency Rule (CONTEXT.md, `satisfiesFrequencyRule` dans eligibility-service.js) de
 * s'activer en conditions réelles : sans elle, un Animal reste éligible indéfiniment après
 * un don réel (voir docs/adr/0003). Sur NO_SHOW, aucun don n'a eu lieu — `Animal` n'est
 * jamais touché.
 *
 * Pas d'écriture atomique conditionnelle (contrairement à `acceptMission`,
 * useOwnerMissions.js, ADR-0001) : cette action n'oppose pas plusieurs parties non fiables
 * en course l'une contre l'autre (le cas qui justifiait la ConditionExpression sur
 * `Request.status`), mais une seule Veterinarian qui a la Mission ouverte devant elle et
 * décide de son issue. La vue qui appellera `closeMission` (Phase 2.2, hors périmètre ici)
 * ne proposera l'action que pour une Mission encore `ACCEPTED`/`PENDING_ARRIVAL`, ce qui
 * suffit comme garde pour le profil de risque réel de cette action.
 */
export function useMissionClosure() {
  const client = generateClient()

  const isClosing = ref(false)

  /**
   * Clôture une Mission avec l'issue `outcome` (`MissionStatus.COMPLETED` ou
   * `MissionStatus.NO_SHOW`). Met toujours à jour `Mission.status`. Si (et seulement si)
   * `outcome === MissionStatus.COMPLETED`, met aussi à jour `Animal.lastDonationDate` à la
   * date du jour.
   *
   * @param {string} missionId
   * @param {string} animalId - requis même pour NO_SHOW (contrat stable de la fonction),
   *   mais n'est utilisé (et donc n'a besoin d'être valide) que sur COMPLETED.
   * @param {string} outcome - `MissionStatus.COMPLETED` ou `MissionStatus.NO_SHOW`
   * @throws {Error} `INVALID_OUTCOME` si `outcome` n'est ni COMPLETED ni NO_SHOW — levée
   *   avant tout appel GraphQL.
   */
  const closeMission = async (missionId, animalId, outcome) => {
    if (!VALID_OUTCOMES.includes(outcome)) {
      throw new Error('INVALID_OUTCOME')
    }

    isClosing.value = true
    try {
      await client.graphql({
        query: closeMissionSimple,
        variables: { input: { id: missionId, status: outcome } },
        authMode: 'userPool',
      })

      if (outcome === MissionStatus.COMPLETED) {
        // AWSDate attend `YYYY-MM-DD` (pas d'heure) — contrairement à `appointmentDatetime`/
        // `validationExpiresAt` ailleurs dans ce repo, qui sont des AWSDateTime en ISO 8601
        // complet. Date LOCALE (todayAsAWSDate), pas UTC — voir son commentaire.
        const today = todayAsAWSDate()

        await client.graphql({
          query: updateAnimalLastDonationDateSimple,
          variables: { input: { id: animalId, lastDonationDate: today } },
          authMode: 'userPool',
        })
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
