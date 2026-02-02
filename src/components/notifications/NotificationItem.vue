<template>
  <div
    :class="itemClasses"
    @click="handleClick"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <!-- Indicateur de priorité -->
    <div :class="priorityClasses"></div>

    <!-- Icône de type -->
    <div class="notification-icon">
      <i :class="typeIcon" :style="{ color: typeColor }"></i>
    </div>

    <!-- Contenu principal -->
    <div class="notification-content">
      <div class="notification-header">
        <h4 class="notification-title">{{ notification.title }}</h4>
        <div class="notification-meta">
          <span class="notification-time">{{ formatTime(notification.createdAt) }}</span>
          <Tag
            v-if="notification.priority !== 'NORMAL'"
            :value="priorityLabel"
            :severity="prioritySeverity"
            size="small"
          />
        </div>
      </div>

      <p class="notification-message">{{ notification.message }}</p>

      <!-- Actions si disponibles -->
      <div v-if="hasActions" class="notification-actions">
        <Button
          v-if="notification.actionUrl"
          :label="notification.actionLabel || 'Voir'"
          size="small"
          :severity="getActionSeverity()"
          @click.stop="handleAction('view')"
        />

        <Button
          v-if="showQuickActions"
          label="Accepter"
          size="small"
          severity="success"
          outlined
          @click.stop="handleAction('accept')"
        />

        <Button
          v-if="showQuickActions"
          label="Refuser"
          size="small"
          severity="danger"
          outlined
          @click.stop="handleAction('decline')"
        />
      </div>
    </div>

    <!-- Menu d'actions -->
    <div class="notification-menu">
      <Button
        ref="menuButton"
        icon="pi pi-ellipsis-v"
        size="small"
        text
        rounded
        @click.stop="toggleMenu"
      />

      <Menu ref="menu" :model="menuItems" :popup="true" />
    </div>

    <!-- Indicateur non lu -->
    <div v-if="!notification.read" class="unread-indicator"></div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Menu from 'primevue/menu'

const props = defineProps({
  notification: {
    type: Object,
    required: true,
  },
  index: {
    type: Number,
    default: 0,
  },
  compact: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['read', 'action', 'delete'])

// Refs
const menu = ref()
const menuButton = ref()

// Propriétés calculées
const itemClasses = computed(() => [
  'notification-item',
  {
    'notification-read': props.notification.read,
    'notification-unread': !props.notification.read,
    'notification-critical': props.notification.priority === 'CRITICAL',
    'notification-compact': props.compact,
    'notification-actioned': props.notification.actioned,
  },
])

const priorityClasses = computed(() => [
  'priority-indicator',
  `priority-${props.notification.priority.toLowerCase()}`,
])

const typeIcon = computed(() => {
  const iconMap = {
    NEW_MATCH: 'pi pi-heart',
    DONOR_ACCEPTED: 'pi pi-check-circle',
    DONOR_DECLINED: 'pi pi-times-circle',
    DONOR_EN_ROUTE: 'pi pi-car',
    DONOR_ARRIVED: 'pi pi-map-marker',
    TRANSFUSION_STARTED: 'pi pi-play-circle',
    TRANSFUSION_COMPLETED: 'pi pi-check',
    MISSION_CANCELLED: 'pi pi-ban',
    EMERGENCY_ALERT: 'pi pi-exclamation-triangle',
    REMINDER: 'pi pi-clock',
    SYSTEM_ALERT: 'pi pi-info-circle',
  }
  return iconMap[props.notification.type] || 'pi pi-bell'
})

const typeColor = computed(() => {
  const colorMap = {
    NEW_MATCH: 'var(--pink-500)',
    DONOR_ACCEPTED: 'var(--green-500)',
    DONOR_DECLINED: 'var(--red-500)',
    DONOR_EN_ROUTE: 'var(--blue-500)',
    DONOR_ARRIVED: 'var(--purple-500)',
    TRANSFUSION_STARTED: 'var(--orange-500)',
    TRANSFUSION_COMPLETED: 'var(--green-600)',
    MISSION_CANCELLED: 'var(--red-600)',
    EMERGENCY_ALERT: 'var(--red-500)',
    REMINDER: 'var(--yellow-500)',
    SYSTEM_ALERT: 'var(--blue-500)',
  }
  return colorMap[props.notification.type] || 'var(--primary-color)'
})

const priorityLabel = computed(() => {
  const labels = {
    CRITICAL: 'Critique',
    HIGH: 'Élevée',
    NORMAL: 'Normale',
    LOW: 'Faible',
  }
  return labels[props.notification.priority] || props.notification.priority
})

const prioritySeverity = computed(() => {
  const severityMap = {
    CRITICAL: 'danger',
    HIGH: 'warning',
    NORMAL: 'info',
    LOW: 'secondary',
  }
  return severityMap[props.notification.priority] || 'info'
})

const hasActions = computed(() => {
  return props.notification.actionUrl || showQuickActions.value
})

const showQuickActions = computed(() => {
  return (
    ['NEW_MATCH', 'EMERGENCY_ALERT'].includes(props.notification.type) &&
    !props.notification.actioned
  )
})

const menuItems = computed(() => [
  {
    label: props.notification.read ? 'Marquer non lu' : 'Marquer lu',
    icon: props.notification.read ? 'pi pi-eye-slash' : 'pi pi-eye',
    command: () => handleMenuAction('toggle-read'),
  },
  {
    label: 'Copier le message',
    icon: 'pi pi-copy',
    command: () => handleMenuAction('copy'),
  },
  {
    separator: true,
  },
  {
    label: 'Supprimer',
    icon: 'pi pi-trash',
    command: () => handleMenuAction('delete'),
    class: 'text-red-500',
  },
])

// Méthodes
const handleClick = () => {
  if (!props.notification.read) {
    emit('read', props.notification)
  }
}

const handleMouseEnter = () => {
  // Marquer comme lu au survol si pas encore lu
  if (!props.notification.read) {
    setTimeout(() => {
      emit('read', props.notification)
    }, 1000) // Délai de 1 seconde
  }
}

const handleMouseLeave = () => {
  // Placeholder pour futures fonctionnalités
}

const handleAction = (action) => {
  emit('action', props.notification, action)

  if (action === 'view' && props.notification.actionUrl) {
    window.open(props.notification.actionUrl, '_blank')
  }
}

const getActionSeverity = () => {
  if (props.notification.priority === 'CRITICAL') return 'danger'
  if (props.notification.priority === 'HIGH') return 'warning'
  return 'info'
}

const toggleMenu = (event) => {
  menu.value.toggle(event)
}

const handleMenuAction = (action) => {
  switch (action) {
    case 'toggle-read':
      emit('read', props.notification)
      break
    case 'copy':
      copyToClipboard()
      break
    case 'delete':
      emit('delete', props.notification)
      break
  }
}

const copyToClipboard = async () => {
  try {
    const text = `${props.notification.title}\n${props.notification.message}`
    await navigator.clipboard.writeText(text)
    console.log('📋 Texte copié dans le presse-papiers')
  } catch (error) {
    console.error('Erreur copie presse-papiers:', error)
  }
}

const formatTime = (timestamp) => {
  if (!timestamp) return ''

  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "À l'instant"
  if (diffMins < 60) return `Il y a ${diffMins}min`
  if (diffHours < 24) return `Il y a ${diffHours}h`
  if (diffDays < 7) return `Il y a ${diffDays}j`

  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<style scoped>
.notification-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem;
  border-bottom: 1px solid var(--surface-border);
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--surface-card);
}

.notification-item:hover {
  background: var(--surface-50);
}

.notification-item:last-child {
  border-bottom: none;
}

/* États */
.notification-unread {
  background: var(--surface-0);
  border-left: 3px solid var(--primary-color);
}

.notification-read {
  opacity: 0.8;
}

.notification-critical {
  border-left-color: var(--red-500);
  background: var(--red-50);
}

.notification-critical:hover {
  background: var(--red-100);
}

.notification-actioned {
  background: var(--green-50);
}

.notification-compact {
  padding: 0.75rem;
}

/* Indicateur de priorité */
.priority-indicator {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
}

.priority-critical {
  background: var(--red-500);
}

.priority-high {
  background: var(--orange-500);
}

.priority-normal {
  background: var(--blue-500);
}

.priority-low {
  background: var(--surface-400);
}

/* Icône */
.notification-icon {
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-100);
  border-radius: 50%;
  font-size: 1.25rem;
}

.notification-compact .notification-icon {
  width: 2rem;
  height: 2rem;
  font-size: 1rem;
}

/* Contenu */
.notification-content {
  flex: 1;
  min-width: 0;
}

.notification-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.notification-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-color);
  line-height: 1.3;
}

.notification-compact .notification-title {
  font-size: 0.875rem;
}

.notification-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.notification-time {
  font-size: 0.75rem;
  color: var(--text-color-secondary);
  white-space: nowrap;
}

.notification-message {
  margin: 0 0 1rem 0;
  font-size: 0.875rem;
  color: var(--text-color-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.notification-compact .notification-message {
  font-size: 0.8125rem;
  -webkit-line-clamp: 1;
  margin-bottom: 0.5rem;
}

/* Actions */
.notification-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* Menu */
.notification-menu {
  flex-shrink: 0;
}

/* Indicateur non lu */
.unread-indicator {
  position: absolute;
  top: 1rem;
  right: 1rem;
  width: 8px;
  height: 8px;
  background: var(--primary-color);
  border-radius: 50%;
}

.notification-critical .unread-indicator {
  background: var(--red-500);
  animation: pulse 2s infinite;
}

/* Animations */
.notification-item {
  animation: slideInRight 0.3s ease-out;
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(1.2);
  }
}

/* Responsive */
@media (max-width: 768px) {
  .notification-item {
    padding: 0.75rem;
    gap: 0.75rem;
  }

  .notification-header {
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
  }

  .notification-meta {
    align-self: flex-end;
  }

  .notification-actions {
    flex-direction: column;
  }

  .notification-icon {
    width: 2rem;
    height: 2rem;
    font-size: 1rem;
  }
}

/* Accessibilité */
.notification-item:focus {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}

/* Thème sombre */
@media (prefers-color-scheme: dark) {
  .notification-unread {
    background: var(--surface-800);
  }

  .notification-critical {
    background: rgba(239, 68, 68, 0.1);
  }

  .notification-actioned {
    background: rgba(34, 197, 94, 0.1);
  }
}
</style>
