import { ref, computed } from 'vue'
import { generateClient } from '@/services/bff-graphql-client'
import { throwIfGraphqlError } from '@/services/graphql-error-service'

// Système de notifications (badge + email), 2026-09-17 -- voir le modèle `Notification`
// (amplify/data/resource.ts) pour l'idiome `@auth` complet (adressage double personnel/
// broadcast par groupe). `client.models.Notification.list()` n'a besoin d'AUCUN filtre côté
// composable : le `@auth` du modèle lui-même restreint déjà le Scan aux lignes que l'appelant
// a le droit de lire (ses notifications personnelles `recipientID` + les broadcasts de ses
// groupes Cognito `recipientGroup`) -- même mécanisme que `Owner`/`Animal`/tout modèle à
// `allow.owner()` de ce schéma, aucun filtre client-side à dupliquer ici.
//
// PAS DE TEMPS RÉEL (subscriptions GraphQL) -- décision explicite du 2026-09-17 : aucune
// subscription n'existe nulle part ailleurs dans ce dépôt (toutes les mises à jour "quasi
// temps réel" existantes, ex. `useMatchingRequests.js`, sont du POLLING léger + refresh au
// retour de focus d'onglet). Reproduit ici à l'identique plutôt que d'introduire un nouveau
// mécanisme pour ce seul écran -- voir `startAutoRefresh`/`stopAutoRefresh` ci-dessous, copiés
// du même patron.
const NOTIFICATIONS_REFRESH_INTERVAL_MS = 60_000

const NOTIFICATION_SELECTION_SET = ['id', 'type', 'titleKey', 'bodyKey', 'data', 'link', 'read', 'createdAt']

export function useNotifications() {
  const client = generateClient()

  const notifications = ref([])
  const isLoading = ref(false)
  const loadError = ref(false)

  // Compté côté client (pas un agrégat serveur dédié -- volume par appelant bien trop faible
  // pour le justifier, contrairement à `Clinic.averageRatingAsClinic`/ADR-0017).
  const unreadCount = computed(() => notifications.value.filter((n) => !n.read).length)

  /**
   * `silent: true` (polling/retour de focus) ne touche jamais `isLoading`/`loadError` -- même
   * raison que `searchMatches({ silent })` dans `useMatchingRequests.js` : un hoquet réseau
   * transitoire d'arrière-plan ne doit ni afficher de spinner plein écran ni faire apparaître
   * une bannière d'erreur au-dessus de notifications déjà affichées.
   */
  const fetchNotifications = async ({ silent = false } = {}) => {
    if (!silent) {
      isLoading.value = true
    }
    try {
      const { data, errors } = await client.models.Notification.list({
        selectionSet: NOTIFICATION_SELECTION_SET,
      })
      throwIfGraphqlError(errors, 'listNotifications')

      notifications.value = [...(data ?? [])].sort((a, b) =>
        (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
      )
      loadError.value = false
    } catch (e) {
      console.error('Erreur chargement notifications:', e)
      if (!silent) {
        loadError.value = true
      }
    } finally {
      if (!silent) {
        isLoading.value = false
      }
    }
  }

  /**
   * Marque une notification comme lue -- mise à jour LOCALE optimiste (`notifications.value`)
   * avant même la réponse serveur : un badge qui resterait affiché jusqu'au prochain
   * `fetchNotifications()` (jusqu'à `NOTIFICATIONS_REFRESH_INTERVAL_MS` plus tard) donnerait
   * l'impression que le clic n'a rien fait. Best-effort côté écriture (résidu assumé, voir
   * `Notification.authorization` -- `update` ne restreint aucune VALEUR) : un échec réseau est
   * logué mais ne fait pas revenir en arrière l'état local, cohérent avec le reste de ce dépôt
   * qui n'a pas d'outil de suivi d'erreurs (trou d'observabilité déjà documenté).
   */
  const markAsRead = async (id) => {
    const target = notifications.value.find((n) => n.id === id)
    if (target) target.read = true

    try {
      const { errors } = await client.models.Notification.update({ id, read: true })
      throwIfGraphqlError(errors, 'updateNotification')
    } catch (e) {
      console.error('Erreur marquage notification lue:', e)
    }
  }

  let refreshIntervalId = null
  let isFetching = false

  const refreshIfVisibleAndIdle = () => {
    if (document.visibilityState === 'visible' && !isFetching) {
      isFetching = true
      fetchNotifications({ silent: true }).finally(() => {
        isFetching = false
      })
    }
  }

  /**
   * Démarre le polling léger (voir le commentaire d'en-tête sur l'absence de subscriptions) --
   * même patron qu'`useMatchingRequests.startAutoRefresh()` : idempotent, à appeler depuis
   * `onMounted` du composant consommateur (`NotificationBell.vue`), symétrique à
   * `stopAutoRefresh()` depuis son `onUnmounted`.
   */
  const startAutoRefresh = () => {
    stopAutoRefresh()
    refreshIntervalId = setInterval(refreshIfVisibleAndIdle, NOTIFICATIONS_REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', refreshIfVisibleAndIdle)
  }

  const stopAutoRefresh = () => {
    if (refreshIntervalId !== null) {
      clearInterval(refreshIntervalId)
      refreshIntervalId = null
    }
    document.removeEventListener('visibilitychange', refreshIfVisibleAndIdle)
  }

  return {
    notifications,
    unreadCount,
    isLoading,
    loadError,
    fetchNotifications,
    markAsRead,
    startAutoRefresh,
    stopAutoRefresh,
  }
}
