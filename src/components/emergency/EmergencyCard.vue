<template>
  <div class="emergency-card" :class="cardClasses">
    <!-- Header avec niveau d'urgence -->
    <div class="card-header">
      <div class="urgency-indicator">
        <i :class="urgencyIcon"></i>
        <Tag :value="urgencyLabel" :severity="urgencySeverity" />
      </div>
      <div class="card-actions">
        <Button
          v-tooltip="'Voir détails'"
          icon="pi pi-eye"
          size="small"
          text
          rounded
          @click="$emit('view-details', emergency)"
        />
        <Button icon="pi pi-ellipsis-v" size="small" text rounded @click="toggleMenu" />
        <Menu ref="menu" :model="menuItems" :popup="true" />
      </div>
    </div>

    <!-- Contenu principal -->
    <div class="card-content">
      <h4 class="emergency-title">{{ emergency.title }}</h4>
      <p class="emergency-message">{{ emergency.message }}</p>

      <!-- Détails de l'urgence -->
      <div v-if="emergencyDetails" class="emergency-info">
        <div v-if="emergencyDetails.animalType" class="info-item">
          <i class="pi pi-heart"></i>
          <span>{{ emergencyDetails.animalType }}</span>
        </div>
        <div v-if="emergencyDetails.bloodType" class="info-item">
          <i class="pi pi-circle"></i>
          <span>{{ emergencyDetails.bloodType }}</span>
        </div>
        <div v-if="emergencyDetails.location" class="info-item">
          <i class="pi pi-map-marker"></i>
          <span>{{ emergencyDetails.location }}</span>
        </div>
      </div>

      <!-- Progression de l'escalade -->
      <div v-if="escalationInfo" class="escalation-progress">
        <div class="progress-header">
          <span class="progress-label">Escalade</span>
          <span class="progress-level"
            >{{ escalationInfo.currentLevel }}/{{ escalationInfo.maxLevel }}</span
          >
        </div>
        <ProgressBar :value="escalationProgress" :show-value="false" class="progress-bar" />
        <div v-if="escalationInfo.nextEscalation" class="next-escalation">
          <i class="pi pi-clock"></i>
          <span>Prochaine dans {{ formatDuration(escalationInfo.nextEscalation) }}</span>
        </div>
      </div>
    </div>

    <!-- Footer avec actions et timing -->
    <div class="card-footer">
      <div class="timing-info">
        <div class="created-time">
          <i class="pi pi-calendar"></i>
          <span>{{ formatTime(emergency.createdAt) }}</span>
        </div>
        <div class="elapsed-time">
          <i class="pi pi-stopwatch"></i>
          <span>{{ formatDuration(elapsedTime) }}</span>
        </div>
      </div>

      <div class="action-buttons">
        <Button
          v-if="!isAcknowledged"
          label="Accusé réception"
          icon="pi pi-check"
          size="small"
          severity="success"
          @click="handleAcknowledge"
        />
        <Button
          v-if="showStatusButton"
          :label="getStatusButtonLabel()"
          icon="pi pi-arrow-right"
          size="small"
          outlined
          @click="showStatusDialog = true"
        />
      </div>
    </div>

    <!-- Dialog de mise à jour du statut -->
    <Dialog
      v-model:visible="showStatusDialog"
      header="Mettre à jour le statut"
      modal
      :style="{ width: '400px' }"
    >
      <div class="status-update">
        <div class="field">
          <label for="newStatus">Nouveau statut</label>
          <Dropdown
            id="newStatus"
            v-model="selectedStatus"
            :options="statusOptions"
            option-label="label"
            option-value="value"
            placeholder="Sélectionner un statut"
            class="w-full"
          />
        </div>
        <div class="field">
          <label for="statusComment">Commentaire (optionnel)</label>
          <Textarea
            id="statusComment"
            v-model="statusComment"
            rows="3"
            placeholder="Ajouter un commentaire..."
            class="w-full"
          />
        </div>
      </div>

      <template #footer>
        <Button label="Annuler" text @click="showStatusDialog = false" />
        <Button label="Mettre à jour" :disabled="!selectedStatus" @click="handleStatusUpdate" />
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Menu from 'primevue/menu'
import Dialog from 'primevue/dialog'
import Dropdown from 'primevue/dropdown'
import Textarea from 'primevue/textarea'
import ProgressBar from 'primevue/progressbar'

const props = defineProps({
  emergency: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['acknowledge', 'update-status', 'view-details'])

// Refs
const menu = ref()
const showStatusDialog = ref(false)
const selectedStatus = ref('')
const statusComment = ref('')
const elapsedTime = ref(0)
const isAcknowledged = ref(false)

// Timer pour le temps écoulé
let elapsedTimer = null

// Propriétés calculées
const emergencyDetails = computed(() => props.emergency.data || {})

const urgencyLevel = computed(() => emergencyDetails.value.urgencyLevel || 'HIGH')

const urgencyLabel = computed(() => {
  const labels = {
    CRITICAL: 'Critique',
    URGENT: 'Urgent',
    HIGH: 'Élevé',
  }
  return labels[urgencyLevel.value] || urgencyLevel.value
})

const urgencySeverity = computed(() => {
  const severities = {
    CRITICAL: 'danger',
    URGENT: 'warning',
    HIGH: 'info',
  }
  return severities[urgencyLevel.value] || 'info'
})

const urgencyIcon = computed(() => {
  const icons = {
    CRITICAL: 'pi pi-exclamation-triangle',
    URGENT: 'pi pi-exclamation-circle',
    HIGH: 'pi pi-info-circle',
  }
  return icons[urgencyLevel.value] || 'pi pi-info-circle'
})

const cardClasses = computed(() => [
  'emergency-card',
  `urgency-${urgencyLevel.value.toLowerCase()}`,
  {
    acknowledged: isAcknowledged.value,
    pulsing: urgencyLevel.value === 'CRITICAL' && !isAcknowledged.value,
  },
])

const escalationInfo = computed(() => {
  if (!emergencyDetails.value.escalationLevel) return null

  return {
    currentLevel: emergencyDetails.value.escalationLevel || 1,
    maxLevel: emergencyDetails.value.maxEscalationLevel || 5,
    nextEscalation: emergencyDetails.value.nextEscalationIn,
  }
})

const escalationProgress = computed(() => {
  if (!escalationInfo.value) return 0
  return (escalationInfo.value.currentLevel / escalationInfo.value.maxLevel) * 100
})

const showStatusButton = computed(() => {
  return emergencyDetails.value.missionId && !isAcknowledged.value
})

const statusOptions = [
  { label: 'Donneur en route', value: 'EN_ROUTE' },
  { label: 'Donneur arrivé', value: 'ARRIVED' },
  { label: 'Transfusion en cours', value: 'IN_PROGRESS' },
  { label: 'Transfusion terminée', value: 'COMPLETED' },
  { label: 'Mission annulée', value: 'CANCELLED' },
]

const menuItems = computed(() => [
  {
    label: 'Voir les détails',
    icon: 'pi pi-eye',
    command: () => emit('view-details', props.emergency),
  },
  {
    label: isAcknowledged.value ? 'Marquer non lu' : 'Marquer lu',
    icon: isAcknowledged.value ? 'pi pi-eye-slash' : 'pi pi-eye',
    command: () => handleAcknowledge(),
  },
  {
    separator: true,
  },
  {
    label: 'Copier les détails',
    icon: 'pi pi-copy',
    command: () => copyEmergencyDetails(),
  },
])

// Méthodes
const handleAcknowledge = () => {
  isAcknowledged.value = !isAcknowledged.value
  emit('acknowledge', props.emergency)
}

const handleStatusUpdate = () => {
  if (selectedStatus.value) {
    emit('update-status', props.emergency, selectedStatus.value)
    showStatusDialog.value = false
    selectedStatus.value = ''
    statusComment.value = ''
  }
}

const getStatusButtonLabel = () => {
  const currentStatus = emergencyDetails.value.currentStatus || 'PENDING'
  const statusLabels = {
    PENDING: 'Démarrer',
    EN_ROUTE: 'Arrivé',
    ARRIVED: 'En cours',
    IN_PROGRESS: 'Terminé',
  }
  return statusLabels[currentStatus] || 'Mettre à jour'
}

const toggleMenu = (event) => {
  menu.value.toggle(event)
}

const copyEmergencyDetails = async () => {
  try {
    const details = `
Urgence: ${props.emergency.title}
Niveau: ${urgencyLabel.value}
Message: ${props.emergency.message}
Animal: ${emergencyDetails.value.animalType || 'N/A'}
Groupe sanguin: ${emergencyDetails.value.bloodType || 'N/A'}
Localisation: ${emergencyDetails.value.location || 'N/A'}
Créée le: ${formatTime(props.emergency.createdAt)}
    `.trim()

    await navigator.clipboard.writeText(details)
    console.log("📋 Détails de l'urgence copiés")
  } catch (error) {
    console.error('Erreur copie détails:', error)
  }
}

const startElapsedTimer = () => {
  elapsedTimer = setInterval(() => {
    elapsedTime.value = Date.now() - props.emergency.createdAt
  }, 1000)
}

const stopElapsedTimer = () => {
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
}

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatDuration = (milliseconds) => {
  const seconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}min`
  } else if (minutes > 0) {
    return `${minutes}min`
  } else {
    return `${seconds}s`
  }
}

// Lifecycle
onMounted(() => {
  startElapsedTimer()

  // Vérifier si déjà accusée réception
  isAcknowledged.value = props.emergency.acknowledged || false
})

onUnmounted(() => {
  stopElapsedTimer()
})
</script>

<style scoped>
.emergency-card {
  background: var(--surface-card);
  border-radius: 12px;
  border: 1px solid var(--surface-border);
  overflow: hidden;
  transition: all 0.3s ease;
  position: relative;
}

.emergency-card:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

/* Niveaux d'urgence */
.urgency-critical {
  border-left: 4px solid var(--red-500);
}

.urgency-urgent {
  border-left: 4px solid var(--orange-500);
}

.urgency-high {
  border-left: 4px solid var(--blue-500);
}

/* Animation pour les urgences critiques */
.pulsing {
  animation: cardPulse 2s infinite;
}

@keyframes cardPulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 var(--red-500);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.3);
  }
}

.acknowledged {
  opacity: 0.8;
  background: var(--green-50);
}

/* Header */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1rem 0.5rem 1rem;
}

.urgency-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.urgency-indicator i {
  font-size: 1.25rem;
}

.urgency-critical .urgency-indicator i {
  color: var(--red-500);
}

.urgency-urgent .urgency-indicator i {
  color: var(--orange-500);
}

.urgency-high .urgency-indicator i {
  color: var(--blue-500);
}

.card-actions {
  display: flex;
  gap: 0.25rem;
}

/* Contenu */
.card-content {
  padding: 0.5rem 1rem 1rem 1rem;
}

.emergency-title {
  margin: 0 0 0.5rem 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-color);
  line-height: 1.3;
}

.emergency-message {
  margin: 0 0 1rem 0;
  color: var(--text-color-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Informations */
.emergency-info {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1rem;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.info-item i {
  color: var(--primary-color);
}

/* Progression escalade */
.escalation-progress {
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: var(--orange-50);
  border-radius: 6px;
  border-left: 3px solid var(--orange-500);
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.progress-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--orange-700);
}

.progress-level {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--orange-700);
}

.progress-bar {
  height: 6px;
  margin-bottom: 0.5rem;
}

.next-escalation {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--orange-600);
}

/* Footer */
.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: var(--surface-50);
  border-top: 1px solid var(--surface-border);
  gap: 1rem;
}

.timing-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.created-time,
.elapsed-time {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--text-color-secondary);
}

.action-buttons {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* Dialog */
.status-update {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field label {
  font-weight: 600;
  color: var(--text-color);
}

/* Responsive */
@media (max-width: 768px) {
  .card-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }

  .urgency-indicator {
    justify-content: center;
  }

  .card-actions {
    justify-content: center;
  }

  .emergency-info {
    flex-direction: column;
    gap: 0.5rem;
  }

  .card-footer {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .timing-info {
    align-items: center;
  }

  .action-buttons {
    justify-content: center;
  }
}

/* Thème sombre */
@media (prefers-color-scheme: dark) {
  .acknowledged {
    background: rgba(34, 197, 94, 0.1);
  }

  .escalation-progress {
    background: rgba(251, 146, 60, 0.1);
  }
}
</style>
