<template>
  <div class="notification-center">
    <!-- Header avec actions -->
    <div class="notification-header">
      <div class="header-title">
        <i class="pi pi-bell"></i>
        <span>Notifications</span>
        <NotificationBadge :count="unreadCount" :show-zero="false" class="header-badge" />
      </div>

      <div class="header-actions">
        <Button
          v-tooltip="'Actualiser'"
          icon="pi pi-refresh"
          :loading="isLoading"
          size="small"
          text
          rounded
          @click="refreshNotifications"
        />

        <Button
          v-tooltip="'Tout marquer comme lu'"
          icon="pi pi-check-circle"
          :disabled="!hasUnread"
          size="small"
          text
          rounded
          @click="markAllAsRead"
        />

        <Button
          icon="pi pi-trash"
          :disabled="notifications.length === 0"
          v-tooltip="'Tout supprimer'"
          size="small"
          text
          rounded
          severity="danger"
          @click="showClearConfirm = true"
        />

        <Button
          v-tooltip="'Paramètres'"
          icon="pi pi-cog"
          size="small"
          text
          rounded
          @click="showSettings = true"
        />
      </div>
    </div>

    <!-- Indicateur de connexion -->
    <div v-if="!isConnected" class="connection-status">
      <Message severity="warn" :closable="false">
        <div class="connection-message">
          <i class="pi pi-wifi connection-icon"></i>
          <span>Reconnexion en cours...</span>
          <ProgressSpinner size="small" />
        </div>
      </Message>
    </div>

    <!-- Filtres rapides -->
    <div v-if="notifications.length > 0" class="notification-filters">
      <div class="filter-tabs">
        <Button
          :label="`Toutes (${notifications.length})`"
          :class="{ 'p-button-outlined': activeFilter !== 'all' }"
          size="small"
          @click="activeFilter = 'all'"
        />
        <Button
          :label="`Non lues (${unreadCount})`"
          :class="{ 'p-button-outlined': activeFilter !== 'unread' }"
          size="small"
          :severity="unreadCount > 0 ? 'info' : undefined"
          @click="activeFilter = 'unread'"
        />
        <Button
          :label="`Critiques (${criticalNotifications.length})`"
          :class="{ 'p-button-outlined': activeFilter !== 'critical' }"
          size="small"
          :severity="criticalNotifications.length > 0 ? 'danger' : undefined"
          @click="activeFilter = 'critical'"
        />
      </div>
    </div>

    <!-- Liste des notifications -->
    <div v-if="filteredNotifications.length > 0" class="notification-list">
      <VirtualScroller
        :items="filteredNotifications"
        :item-size="120"
        class="notification-scroller"
      >
        <template #item="{ item: notification, index }">
          <NotificationItem
            :key="notification.id"
            :notification="notification"
            :index="index"
            @read="handleNotificationRead"
            @action="handleNotificationAction"
            @delete="handleNotificationDelete"
          />
        </template>
      </VirtualScroller>
    </div>

    <!-- État vide -->
    <div v-else class="empty-state">
      <div class="empty-icon">
        <i class="pi pi-bell-slash"></i>
      </div>
      <h4>{{ getEmptyStateTitle() }}</h4>
      <p>{{ getEmptyStateMessage() }}</p>

      <Button
        v-if="activeFilter !== 'all'"
        label="Voir toutes les notifications"
        text
        @click="activeFilter = 'all'"
      />
    </div>

    <!-- Dialog de confirmation suppression -->
    <Dialog
      v-model:visible="showClearConfirm"
      header="Supprimer toutes les notifications"
      modal
      :style="{ width: '400px' }"
    >
      <p>Êtes-vous sûr de vouloir supprimer toutes les notifications ?</p>
      <p class="text-sm text-muted">Cette action est irréversible.</p>

      <template #footer>
        <Button label="Annuler" text @click="showClearConfirm = false" />
        <Button label="Supprimer" severity="danger" @click="confirmClearAll" />
      </template>
    </Dialog>

    <!-- Dialog des paramètres -->
    <Dialog
      v-model:visible="showSettings"
      header="Paramètres de Notifications"
      modal
      :style="{ width: '600px' }"
    >
      <NotificationSettings @close="showSettings = false" />
    </Dialog>

    <!-- Toast pour feedback -->
    <Toast ref="toast" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useNotifications } from '@/composables/useNotifications'
import { useAuth } from '@/composables/useAuth'
import Button from 'primevue/button'
import Message from 'primevue/message'
import Dialog from 'primevue/dialog'
import VirtualScroller from 'primevue/virtualscroller'
import ProgressSpinner from 'primevue/progressspinner'
import Toast from 'primevue/toast'
import NotificationBadge from './NotificationBadge.vue'
import NotificationItem from './NotificationItem.vue'
import NotificationSettings from './NotificationSettings.vue'

const props = defineProps({
  maxHeight: {
    type: String,
    default: '500px',
  },
  autoConnect: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits(['notification-received', 'notification-read', 'notification-actioned'])

const {
  notifications,
  unreadCount,
  isConnected,
  unreadNotifications,
  criticalNotifications,
  hasUnread,
  markAsRead,
  markAsActioned,
  markAllAsRead,
  deleteNotification,
  clearAll,
  connect,
  disconnect,
  requestPermission,
} = useNotifications()

const { user } = useAuth()

// États locaux
const isLoading = ref(false)
const activeFilter = ref('all')
const showClearConfirm = ref(false)
const showSettings = ref(false)
const toast = ref()

// Propriétés calculées
const filteredNotifications = computed(() => {
  switch (activeFilter.value) {
    case 'unread':
      return unreadNotifications.value
    case 'critical':
      return criticalNotifications.value
    default:
      return notifications.value
  }
})

// Méthodes
const refreshNotifications = async () => {
  try {
    isLoading.value = true

    // Simuler un délai pour l'UX
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Ici on pourrait recharger depuis le serveur
    console.log('🔄 Notifications actualisées')

    toast.value?.add({
      severity: 'success',
      summary: 'Actualisé',
      detail: 'Notifications mises à jour',
      life: 2000,
    })
  } catch (error) {
    console.error('Erreur actualisation:', error)
    toast.value?.add({
      severity: 'error',
      summary: 'Erreur',
      detail: "Impossible d'actualiser les notifications",
      life: 3000,
    })
  } finally {
    isLoading.value = false
  }
}

const handleNotificationRead = (notification) => {
  markAsRead(notification.id)
  emit('notification-read', notification)

  console.log(`📖 Notification lue: ${notification.id}`)
}

const handleNotificationAction = (notification, action) => {
  markAsActioned(notification.id)
  emit('notification-actioned', { notification, action })

  console.log(`⚡ Action sur notification: ${notification.id} - ${action}`)

  toast.value?.add({
    severity: 'info',
    summary: 'Action effectuée',
    detail: `${action} pour ${notification.title}`,
    life: 2000,
  })
}

const handleNotificationDelete = (notification) => {
  deleteNotification(notification.id)

  toast.value?.add({
    severity: 'info',
    summary: 'Supprimée',
    detail: 'Notification supprimée',
    life: 2000,
  })
}

const confirmClearAll = () => {
  clearAll()
  showClearConfirm.value = false

  toast.value?.add({
    severity: 'info',
    summary: 'Supprimées',
    detail: 'Toutes les notifications ont été supprimées',
    life: 3000,
  })
}

const getEmptyStateTitle = () => {
  switch (activeFilter.value) {
    case 'unread':
      return 'Aucune notification non lue'
    case 'critical':
      return 'Aucune notification critique'
    default:
      return 'Aucune notification'
  }
}

const getEmptyStateMessage = () => {
  switch (activeFilter.value) {
    case 'unread':
      return 'Toutes vos notifications ont été lues'
    case 'critical':
      return 'Aucune notification critique en attente'
    default:
      return 'Vous recevrez ici les notifications importantes'
  }
}

const initializeNotifications = async () => {
  try {
    if (!user.value) {
      console.log("⏳ En attente de l'authentification...")
      return
    }

    // Demander la permission pour les notifications push
    try {
      await requestPermission()
      console.log('✅ Permission notifications accordée')
    } catch (error) {
      console.warn('⚠️ Permission notifications refusée:', error.message)
    }

    // Connecter aux notifications temps réel
    if (props.autoConnect) {
      await connect(user.value.id)
      console.log('🔌 Connecté aux notifications temps réel')
    }
  } catch (error) {
    console.error('❌ Erreur initialisation notifications:', error)
  }
}

// Watchers
watch(
  () => user.value,
  (newUser) => {
    if (newUser && props.autoConnect) {
      initializeNotifications()
    }
  },
  { immediate: true },
)

watch(
  () => notifications.value.length,
  (newLength, oldLength) => {
    if (newLength > oldLength) {
      // Nouvelle notification reçue
      const newNotification = notifications.value[0]
      emit('notification-received', newNotification)
    }
  },
)

// Lifecycle
onMounted(() => {
  if (user.value) {
    initializeNotifications()
  }
})

onUnmounted(() => {
  disconnect()
})
</script>

<style scoped>
.notification-center {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface-card);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  overflow: hidden;
}

/* Header */
.notification-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid var(--surface-border);
  background: var(--surface-50);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  color: var(--text-color);
}

.header-title i {
  color: var(--primary-color);
}

.header-badge {
  margin-left: 0.25rem;
}

.header-actions {
  display: flex;
  gap: 0.25rem;
}

/* Connexion */
.connection-status {
  padding: 0.5rem 1rem;
}

.connection-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.connection-icon {
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* Filtres */
.notification-filters {
  padding: 1rem;
  border-bottom: 1px solid var(--surface-border);
}

.filter-tabs {
  display: flex;
  gap: 0.5rem;
}

/* Liste */
.notification-list {
  flex: 1;
  overflow: hidden;
}

.notification-scroller {
  height: v-bind(maxHeight);
}

/* État vide */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 2rem;
  text-align: center;
  color: var(--text-color-secondary);
}

.empty-icon {
  font-size: 3rem;
  color: var(--surface-400);
  margin-bottom: 1rem;
}

.empty-state h4 {
  margin: 0 0 0.5rem 0;
  color: var(--text-color);
}

.empty-state p {
  margin: 0 0 1rem 0;
  font-size: 0.875rem;
}

/* Responsive */
@media (max-width: 768px) {
  .notification-header {
    padding: 0.75rem;
  }

  .header-actions {
    gap: 0.125rem;
  }

  .filter-tabs {
    flex-direction: column;
    gap: 0.25rem;
  }

  .empty-state {
    padding: 2rem 1rem;
  }
}

/* Animations */
.notification-center {
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
