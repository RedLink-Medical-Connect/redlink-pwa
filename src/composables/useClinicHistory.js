import { computed } from 'vue'
import { useClinicRequests } from '@/composables/useClinicRequest'
import { RequestStatus, MissionStatus } from '@/constants/enums'

/**
 * Types d'événement du fil d'activité de HistoryView.vue. Taxonomie propre à cette vue,
 * dérivée du cycle de vie Request/Mission mais sans équivalent direct dans le schéma
 * GraphQL (une Request/Mission n'expose qu'un `status` courant, jamais une liste
 * d'événements passés) — gardée ici plutôt que dans `constants/enums.js` (réservé aux
 * valeurs qui reflètent directement une valeur de schéma/@model, cf. `.cursorrules`).
 */
export const HistoryEventType = Object.freeze({
  REQUEST_CREATED: 'REQUEST_CREATED',
  MISSION_ACCEPTED: 'MISSION_ACCEPTED',
  MISSION_COMPLETED: 'MISSION_COMPLETED',
  MISSION_NO_SHOW: 'MISSION_NO_SHOW',
  REQUEST_CLOSED: 'REQUEST_CLOSED',
})

/**
 * Dérive la liste plate des événements d'activité d'une seule Request (fonction pure,
 * sans réactivité Vue ni appel réseau — testable isolément, voir
 * useClinicHistory.spec.js). Colocalisée ici plutôt que dans un `*-service.js` : ce n'est
 * pas une règle métier transverse comme `eligibility-service.js` (compatibilité sanguine,
 * distance...), c'est de l'agrégation de présentation propre à ce seul composable/vue —
 * même raisonnement que `mapAcceptMissionError`/`mapValidationErrorKey`, exportées à côté
 * de leur composable plutôt que dans un service dédié.
 *
 * Règles (roadmap Phase 3.3) :
 * - Toujours un événement REQUEST_CREATED à `request.createdAt`.
 * - Si `request.mission` existe : un événement MISSION_ACCEPTED à `mission.createdAt`
 *   (nom du donneur = `mission.animal.name`). Si en plus `mission.status` est COMPLETED ou
 *   NO_SHOW, un second événement MISSION_COMPLETED/MISSION_NO_SHOW à `mission.updatedAt`.
 * - Sinon (pas de Mission) et si `request.status === RequestStatus.CLOSED` : un événement
 *   REQUEST_CLOSED supplémentaire à `request.updatedAt` (Request clôturée manuellement via
 *   `closeRequest`, sans jamais avoir eu de donneur).
 *
 * Décision documentée — REQUEST_CREATED + REQUEST_CLOSED (2 événements), jamais un seul :
 * la règle "Toujours un événement REQUEST_CREATED" est inconditionnelle (elle ne dépend
 * pas de la présence d'une Mission ni du statut de clôture), donc une Request clôturée
 * sans Mission produit les DEUX événements, pas seulement REQUEST_CLOSED. C'est aussi ce
 * qui rend le nombre d'événements cohérent avec les trois autres cas de la sous-tâche :
 * pas de Mission (et pas clôturée) -> 1 événement ; Mission acceptée non close -> 2
 * (REQUEST_CREATED + MISSION_ACCEPTED) ; Mission COMPLETED/NO_SHOW -> 3 (+ l'événement de
 * clôture de Mission). Une Request clôturée sans Mission qui n'aurait qu'un seul événement
 * casserait ce motif, et ferait disparaître sa création du fil d'activité — contraire à
 * l'objectif d'un flux chronologique complet ("historique d'activité").
 *
 * Hypothèse documentée — `mission.updatedAt` comme date de clôture : ce schéma n'a pas de
 * champ dédié "closedAt"/"resolvedAt" sur Mission. `updatedAt` est la date de la dernière
 * écriture sur l'enregistrement, qui en pratique correspond à l'écriture de clôture
 * (COMPLETED/NO_SHOW, via `useMissionClosure.js`) puisque rien d'autre n'écrit sur une
 * Mission entre sa création (ACCEPTED) et sa clôture. C'est un proxy, pas une garantie
 * absolue du schéma — signalé ici comme le compromis volontaire qu'il est.
 *
 * @param {object} request - un élément de `requests` (useClinicRequest.js, via
 *   listRequestsByClinic)
 * @returns {Array<{id: string, type: string, timestamp: string, requestId: string,
 *   requiredSpecies: string, requiredBloodGroup: string, donorName: string|null}>}
 */
export function deriveHistoryEvents(request) {
  const events = []

  events.push({
    id: `${request.id}-created`,
    type: HistoryEventType.REQUEST_CREATED,
    timestamp: request.createdAt,
    requestId: request.id,
    requiredSpecies: request.requiredSpecies,
    requiredBloodGroup: request.requiredBloodGroup,
    donorName: null,
  })

  if (request.mission) {
    const mission = request.mission
    const donorName = mission.animal?.name ?? null

    events.push({
      id: `${mission.id}-accepted`,
      type: HistoryEventType.MISSION_ACCEPTED,
      timestamp: mission.createdAt,
      requestId: request.id,
      requiredSpecies: request.requiredSpecies,
      requiredBloodGroup: request.requiredBloodGroup,
      donorName,
    })

    if (mission.status === MissionStatus.COMPLETED || mission.status === MissionStatus.NO_SHOW) {
      events.push({
        id: `${mission.id}-closed`,
        type:
          mission.status === MissionStatus.COMPLETED
            ? HistoryEventType.MISSION_COMPLETED
            : HistoryEventType.MISSION_NO_SHOW,
        timestamp: mission.updatedAt,
        requestId: request.id,
        requiredSpecies: request.requiredSpecies,
        requiredBloodGroup: request.requiredBloodGroup,
        donorName,
      })
    }
  } else if (request.status === RequestStatus.CLOSED) {
    events.push({
      id: `${request.id}-closed`,
      type: HistoryEventType.REQUEST_CLOSED,
      timestamp: request.updatedAt,
      requestId: request.id,
      requiredSpecies: request.requiredSpecies,
      requiredBloodGroup: request.requiredBloodGroup,
      donorName: null,
    })
  }

  return events
}

/**
 * Phase 3.3 : composable Veterinarian-facing pour le fil d'activité de la clinique
 * courante (HistoryView.vue). Réutilise `useClinicRequest.js` (`fetchRequests`,
 * `requests`, `isLoading`, `loadError`) plutôt que d'écrire une seconde query scopée
 * clinique — évite de dupliquer `fetchClinicId()`/`listRequestsByClinic`, déjà en place.
 *
 * `historyEvents` aplatit chaque Request en un ou plusieurs événements
 * (`deriveHistoryEvents`) et trie l'ensemble par date décroissante (le plus récent en
 * premier), tous types d'événements confondus — pas un tri par Request puis par
 * événement.
 */
export function useClinicHistory() {
  const { requests, isLoading, loadError, fetchRequests } = useClinicRequests()

  const historyEvents = computed(() => {
    const events = requests.value.flatMap((request) => deriveHistoryEvents(request))
    return events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  })

  return {
    historyEvents,
    isLoading,
    loadError,
    fetchRequests,
  }
}
