<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useNotifications } from '@/composables/useNotifications'

// Système de notifications (badge + email), 2026-09-17 -- voir `useNotifications.js` pour la
// logique (polling léger, pas de subscription GraphQL) et `amplify/data/resource.ts` (modèle
// `Notification`) pour l'idiome `@auth` (adressage double personnel/broadcast par groupe).
// Composant monté dans `AppHeader.vue` UNIQUEMENT quand `auth.isAuthenticated` -- visible pour
// TOUT rôle (vet/owner), pas seulement `Admins` : `client.models.Notification.list()` renvoie
// naturellement 0 ligne pour un utilisateur sans notification personnelle ni appartenance à un
// groupe portant une notification broadcast, aucune condition `v-if` sur le rôle nécessaire ici.

const { t, locale } = useI18n()
const router = useRouter()

const {
  notifications,
  unreadCount,
  isLoading,
  loadError,
  fetchNotifications,
  markAsRead,
  startAutoRefresh,
  stopAutoRefresh,
} = useNotifications()

const panel = ref(null)
// Revue a11y (2026-09-17) : le `Popover` PrimeVue n'expose pas lui-même un état "ouvert"
// réactif -- ce ref, mis à jour via `@show`/`@hide`, pilote `aria-expanded` sur le bouton
// déclencheur (sinon un lecteur d'écran n'a aucun moyen de savoir si le panneau est ouvert).
const isPanelOpen = ref(false)

onMounted(() => {
  fetchNotifications()
  startAutoRefresh()
})

onUnmounted(() => {
  stopAutoRefresh()
})

const toggle = (event) => {
  panel.value.toggle(event)
  // Refresh à chaque ouverture (léger, un seul appel GraphQL) : le polling tourne toutes les
  // 60s (voir `useNotifications.js`) -- rouvrir le panneau juste après une notification
  // fraîche ne doit pas faire attendre le prochain tick.
  fetchNotifications({ silent: true })
}

const formatNotificationDate = (isoDate) => {
  if (!isoDate) return ''
  return new Date(isoDate).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' })
}

const onNotificationClick = async (notification) => {
  if (!notification.read) {
    await markAsRead(notification.id)
  }
  if (notification.link) {
    panel.value.hide()
    router.push(notification.link)
  }
}
</script>

<template>
  <div class="relative">
    <Button
      icon="pi pi-bell"
      variant="text"
      :aria-label="t('notifications.bell_aria', { count: unreadCount })"
      aria-haspopup="true"
      aria-controls="notification-panel"
      :aria-expanded="isPanelOpen"
      class="!text-zinc-600 dark:!text-zinc-400 hover:!text-[#ff3b4e]"
      @click="toggle"
    />
    <Badge
      v-if="unreadCount > 0"
      :value="unreadCount > 9 ? '9+' : unreadCount"
      severity="danger"
      aria-hidden="true"
      class="!absolute !top-0 !right-0 pointer-events-none"
    />

    <Popover
      ref="panel"
      :pt="{ root: { id: 'notification-panel', 'aria-labelledby': 'notification-panel-title' } }"
      @show="isPanelOpen = true"
      @hide="isPanelOpen = false"
    >
      <div class="w-80 max-w-[90vw] flex flex-col" aria-live="polite" :aria-busy="isLoading">
        <div
          id="notification-panel-title"
          class="px-3 py-2 font-bold text-zinc-800 dark:text-white border-b border-zinc-200 dark:border-zinc-700"
        >
          {{ t('notifications.title') }}
        </div>

        <div v-if="isLoading" class="p-4 text-center text-sm text-zinc-500">
          <i class="pi pi-spin pi-spinner" />
        </div>

        <div v-else-if="loadError" class="p-4 text-sm text-red-500 text-center">
          {{ t('notifications.load_error') }}
        </div>

        <div v-else-if="notifications.length === 0" class="p-4 text-sm text-zinc-500 text-center">
          {{ t('notifications.empty') }}
        </div>

        <ul v-else role="list" class="max-h-96 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
          <li
            v-for="notification in notifications"
            :key="notification.id"
            :class="{ 'bg-red-50/50 dark:bg-red-900/10': !notification.read }"
          >
            <button
              type="button"
              class="w-full flex items-start gap-2 p-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
              @click="onNotificationClick(notification)"
            >
              <span
                class="mt-1.5 w-2 h-2 rounded-full shrink-0"
                :class="notification.read ? 'bg-transparent' : 'bg-[#ff3b4e]'"
              />
              <span class="flex-1 min-w-0">
                <span class="block text-sm text-zinc-800 dark:text-zinc-100">
                  <span v-if="!notification.read" class="sr-only">{{ t('notifications.unread') }} — </span>
                  {{ t(notification.titleKey, notification.data || {}) }}
                </span>
                <span v-if="notification.bodyKey" class="block text-xs text-zinc-500 mt-0.5">
                  {{ t(notification.bodyKey, notification.data || {}) }}
                </span>
                <span class="block text-[10px] text-zinc-400 mt-1">
                  {{ formatNotificationDate(notification.createdAt) }}
                </span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </Popover>
  </div>
</template>
