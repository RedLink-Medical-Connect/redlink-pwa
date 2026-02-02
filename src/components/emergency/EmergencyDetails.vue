<template>
  <div class="emergency-details">
    <!-- Header avec statut -->
    <div class="details-header">
      <div class="emergency-status">
        <div class="status-indicator" :class="statusClass">
          <i :class="statusIcon"></i>
        </div>
        <div class="status-info">
          <h3>{{ emergency.title }}</h3>
          <div class="status-tags">
            <Tag :value="urgencyLabel" :severity="urgencySeverity" size="large" />
            <Tag :value="statusLabel" :severity="statusSeverity" />
            <Tag v-if="isExpired" value="Expiré" severity="danger" />
          </div>
        </div>
      </div>
      <div class="header-actions">
        <Button
          v-if="!isAcknowledged"
          label="Accusé de réception"
          icon="pi pi-check"
          severity="success"
          @click="handleAcknowledge"
        />
        <Button v-tooltip="'Copier les détails'" icon="pi pi-copy" outlined @click="copyDetails" />
      </div>
    </div>

    <!-- Informations principales -->
    <div class="details-content">
      <div class="content-grid">
        <!-- Informations générales -->
        <div class="info-section">
          <h4>
            <i class="pi pi-info-circle"></i>
            Informations générales
          </h4>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">ID d'urgence</span>
              <span class="info-value">{{ emergency.id }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Type</span>
              <span class="info-value">{{ getTypeLabel(emergency.type) }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Créée le</span>
              <span class="info-value">{{ formatDateTime(emergency.createdAt) }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Temps écoulé</span>
              <span class="info-value">{{ formatDuration(elapsedTime) }}</span>
            </div>
            <div v-if="emergency.expiresAt" class="info-item">
              <span class="info-label">Expire le</span>
              <span class="info-value" :class="{ expired: isExpired }">
                {{ formatDateTime(emergency.expiresAt) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Informations animal -->
        <div v-if="hasAnimalInfo" class="info-section">
          <h4>
            <i class="pi pi-heart"></i>
            Informations animal
          </h4>
          <div class="info-grid">
            <div v-if="emergency.animalType" class="info-item">
              <span class="info-label">Type d'animal</span>
              <span class="info-value">{{ emergency.animalType }}</span>
            </div>
            <div v-if="emergency.bloodType" class="info-item">
              <span class="info-label">Groupe sanguin</span>
              <span class="info-value">{{ emergency.bloodType }}</span>
            </div>
            <div v-if="emergency.data?.animalWeight" class="info-item">
              <span class="info-label">Poids</span>
              <span class="info-value">{{ emergency.data.animalWeight }} kg</span>
            </div>
            <div v-if="emergency.data?.animalAge" class="info-item">
              <span class="info-label">Âge</span>
              <span class="info-value">{{ emergency.data.animalAge }} ans</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Description détaillée -->
      <div class="description-section">
        <h4>
          <i class="pi pi-file-text"></i>
          Description
        </h4>
        <div class="description-content">
          <p>{{ emergency.message }}</p>
        </div>
      </div>

      <!-- Localisation -->
      <div v-if="emergency.location" class="location-section">
        <h4>
          <i class="pi pi-map-marker"></i>
          Localisation
        </h4>
        <div class="location-content">
          <div class="location-info">
            <span class="location-address">{{ emergency.location }}</span>
            <div class="location-actions">
              <Button
                label="Ouvrir dans Maps"
                icon="pi pi-map"
                size="small"
                outlined
                @click="openInMaps"
              />
              <Button
                label="Copier l'adresse"
                icon="pi pi-copy"
                size="small"
                outlined
                @click="copyAddress"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Contact d'urgence -->
      <div v-if="hasContactInfo" class="contact-section">
        <h4>
          <i class="pi pi-phone"></i>
          Contact d'urgence
        </h4>
        <div class="contact-content">
          <div class="contact-grid">
            <div v-if="emergency.contactInfo?.phone" class="contact-item">
              <div class="contact-info">
                <i class="pi pi-phone contact-icon"></i>
                <span class="contact-value">{{ emergency.contactInfo.phone }}</span>
              </div>
              <Button icon="pi pi-phone" size="small" severity="success" @click="callContact" />
            </div>
            <div v-if="emergency.contactInfo?.email" class="contact-item">
              <div class="contact-info">
                <i class="pi pi-envelope contact-icon"></i>
                <span class="contact-value">{{ emergency.contactInfo.email }}</span>
              </div>
              <Button icon="pi pi-envelope" size="small" outlined @click="emailContact" />
            </div>
          </div>
        </div>
      </div>

      <!-- Escalade et timeline -->
      <div v-if="hasEscalationInfo" class="escalation-section">
        <h4>
          <i class="pi pi-clock"></i>
          Escalade automatique
        </h4>
        <div class="escalation-content">
          <div class="escalation-progress">
            <div class="progress-info">
              <span
                >Niveau {{ escalationInfo.currentLevel }} sur {{ escalationInfo.maxLevel }}</span
              >
              <ProgressBar :value="escalationProgress" :show-value="false" />
            </div>
            <div v-if="escalationInfo.nextEscalation" class="next-escalation">
              <i class="pi pi-clock"></i>
              <span
                >Prochaine escalade dans {{ formatDuration(escalationInfo.nextEscalation) }}</span
              >
            </div>
          </div>

          <!-- Timeline d'escalade -->
          <div class="escalation-timeline">
            <div
              v-for="(level, index) in escalationLevels"
              :key="index"
              class="timeline-item"
              :class="{
                completed: index < escalationInfo.currentLevel,
                current: index === escalationInfo.currentLevel - 1,
                pending: index >= escalationInfo.currentLevel,
              }"
            >
              <div class="timeline-marker">
                <i :class="getTimelineIcon(index, escalationInfo.currentLevel)"></i>
              </div>
              <div class="timeline-content">
                <div class="timeline-title">Niveau {{ index + 1 }}</div>
                <div class="timeline-description">{{ level.description }}</div>
                <div class="timeline-channels">
                  <Tag
                    v-for="channel in level.channels"
                    :key="channel"
                    :value="getChannelLabel(channel)"
                    size="small"
                    :severity="getChannelSeverity(channel)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Mission associée -->
      <div v-if="emergency.missionId" class="mission-section">
        <h4>
          <i class="pi pi-briefcase"></i>
          Mission associée
        </h4>
        <div class="mission-content">
          <div class="mission-info">
            <div class="info-item">
              <span class="info-label">ID Mission</span>
              <span class="info-value">{{ emergency.missionId }}</span>
            </div>
            <div v-if="emergency.data?.currentStatus" class="info-item">
              <span class="info-label">Statut actuel</span>
              <Tag :value="getMissionStatusLabel(emergency.data.currentStatus)" />
            </div>
            <div v-if="emergency.estimatedTime" class="info-item">
              <span class="info-label">Temps estimé</span>
              <span class="info-value">{{ emergency.estimatedTime }}</span>
            </div>
          </div>
          <div class="mission-actions">
            <Button
              label="Voir la mission"
              icon="pi pi-external-link"
              size="small"
              outlined
              @click="viewMission"
            />
          </div>
        </div>
      </div>

      <!-- Historique des actions -->
      <div v-if="actionHistory.length > 0" class="history-section">
        <h4>
          <i class="pi pi-history"></i>
          Historique des actions
        </h4>
        <div class="history-content">
          <div class="history-timeline">
            <div v-for="action in actionHistory" :key="action.id" class="history-item">
              <div class="history-time">{{ formatTime(action.timestamp) }}</div>
              <div class="history-action">
                <i :class="action.icon"></i>
                <span>{{ action.description }}</span>
              </div>
              <div v-if="action.user" class="history-user">{{ action.user }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Actions du footer -->
    <div class="details-footer">
      <div class="footer-info">
        <div v-if="isAcknowledged" class="acknowledged-info">
          <i class="pi pi-check-circle"></i>
          <span>Accusé de réception confirmé</span>
        </div>
        <div
          v-if="emergency.requiresAcknowledgment && !isAcknowledged"
          class="acknowledgment-required"
        >
          <i class="pi pi-exclamation-triangle"></i>
          <span>Accusé de réception requis</span>
        </div>
      </div>
      <div class="footer-actions">
        <Button label="Fermer" icon="pi pi-times" outlined @click="$emit('close')" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import ProgressBar from 'primevue/progressbar'

const props = defineProps({
  emergency: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['close', 'acknowledge'])

// États
const elapsedTime = ref(0)
const isAcknowledged = ref(false)

// Timer pour le temps écoulé
let elapsedTimer = null

// Propriétés calculées
const urgencyLabel = computed(() => {
  const labels = {
    CRITICAL: 'Critique',
    URGENT: 'Urgent',
    HIGH: 'Élevé',
  }
  return labels[props.emergency.data?.urgencyLevel] || 'Inconnu'
})

const urgencySeverity = computed(() => {
  const severities = {
    CRITICAL: 'danger',
    URGENT: 'warning',
    HIGH: 'info',
  }
  return severities[props.emergency.data?.urgencyLevel] || 'info'
})

const statusLabel = computed(() => {
  if (isAcknowledged.value) return 'Accusé réception'
  if (isExpired.value) return 'Expiré'
  return 'Actif'
})

const statusSeverity = computed(() => {
  if (isAcknowledged.value) return 'success'
  if (isExpired.value) return 'danger'
  return 'warning'
})

const statusClass = computed(() => {
  if (isAcknowledged.value) return 'acknowledged'
  if (isExpired.value) return 'expired'
  return 'active'
})

const statusIcon = computed(() => {
  if (isAcknowledged.value) return 'pi pi-check-circle'
  if (isExpired.value) return 'pi pi-times-circle'
  return 'pi pi-exclamation-triangle'
})

const isExpired = computed(() => {
  return props.emergency.expiresAt && Date.now() > props.emergency.expiresAt
})

const hasAnimalInfo = computed(() => {
  return (
    props.emergency.animalType ||
    props.emergency.bloodType ||
    props.emergency.data?.animalWeight ||
    props.emergency.data?.animalAge
  )
})

const hasContactInfo = computed(() => {
  return props.emergency.contactInfo?.phone || props.emergency.contactInfo?.email
})

const hasEscalationInfo = computed(() => {
  return props.emergency.data?.escalationLevel
})

const escalationInfo = computed(() => {
  if (!hasEscalationInfo.value) return null

  return {
    currentLevel: props.emergency.data.escalationLevel || 1,
    maxLevel: props.emergency.data.maxEscalationLevel || 5,
    nextEscalation: props.emergency.data.nextEscalationIn,
  }
})

const escalationProgress = computed(() => {
  if (!escalationInfo.value) return 0
  return (escalationInfo.value.currentLevel / escalationInfo.value.maxLevel) * 100
})

const escalationLevels = computed(() => [
  {
    description: 'Notification WebSocket + Push',
    channels: ['websocket', 'push'],
  },
  {
    description: 'Notification SMS',
    channels: ['sms'],
  },
  {
    description: 'Notification Email',
    channels: ['email'],
  },
  {
    description: 'Alerte administrateur',
    channels: ['admin-alert'],
  },
  {
    description: 'Donneurs de secours',
    channels: ['fallback-donors'],
  },
])

const actionHistory = computed(() => {
  // Simuler un historique d'actions
  const history = []

  history.push({
    id: 1,
    timestamp: props.emergency.createdAt,
    icon: 'pi pi-plus-circle',
    description: 'Urgence créée',
    user: 'Système',
  })

  if (props.emergency.data?.escalationLevel > 1) {
    history.push({
      id: 2,
      timestamp: props.emergency.createdAt + 300000,
      icon: 'pi pi-arrow-up',
      description: 'Escalade niveau 2 - SMS envoyé',
      user: 'Système',
    })
  }

  if (isAcknowledged.value) {
    history.push({
      id: 3,
      timestamp: Date.now() - 60000,
      icon: 'pi pi-check',
      description: 'Accusé de réception confirmé',
      user: 'Utilisateur actuel',
    })
  }

  return history.sort((a, b) => b.timestamp - a.timestamp)
})

// Méthodes
const handleAcknowledge = () => {
  isAcknowledged.value = true
  emit('acknowledge', props.emergency)
}

const copyDetails = async () => {
  try {
    const details = `
Urgence: ${props.emergency.title}
ID: ${props.emergency.id}
Niveau: ${urgencyLabel.value}
Type: ${getTypeLabel(props.emergency.type)}
Message: ${props.emergency.message}
Animal: ${props.emergency.animalType || 'N/A'}
Groupe sanguin: ${props.emergency.bloodType || 'N/A'}
Localisation: ${props.emergency.location || 'N/A'}
Contact: ${props.emergency.contactInfo?.phone || 'N/A'}
Créée le: ${formatDateTime(props.emergency.createdAt)}
    `.trim()

    await navigator.clipboard.writeText(details)
    console.log('📋 Détails copiés dans le presse-papiers')
  } catch (error) {
    console.error('Erreur copie détails:', error)
  }
}

const copyAddress = async () => {
  try {
    await navigator.clipboard.writeText(props.emergency.location)
    console.log('📍 Adresse copiée')
  } catch (error) {
    console.error('Erreur copie adresse:', error)
  }
}

const openInMaps = () => {
  const address = encodeURIComponent(props.emergency.location)
  const url = `https://www.google.com/maps/search/?api=1&query=${address}`
  window.open(url, '_blank')
}

const callContact = () => {
  const phone = props.emergency.contactInfo?.phone
  if (phone) {
    window.location.href = `tel:${phone}`
  }
}

const emailContact = () => {
  const email = props.emergency.contactInfo?.email
  if (email) {
    window.location.href = `mailto:${email}`
  }
}

const viewMission = () => {
  // TODO: Naviguer vers la page de détail de la mission
  console.log('Voir mission:', props.emergency.missionId)
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

// Utilitaires
const formatDateTime = (timestamp) => {
  return new Date(timestamp).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const formatDuration = (milliseconds) => {
  const seconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days}j ${hours % 24}h ${minutes % 60}min`
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}min`
  } else if (minutes > 0) {
    return `${minutes}min ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

const getTypeLabel = (type) => {
  const labels = {
    EMERGENCY_ALERT: "Alerte d'urgence",
    NEW_MATCH: 'Nouveau match',
    FALLBACK_EMERGENCY_ALERT: 'Donneur de secours',
    SYSTEM_ALERT: 'Alerte système',
  }
  return labels[type] || type
}

const getMissionStatusLabel = (status) => {
  const labels = {
    PENDING: 'En attente',
    DONOR_FOUND: 'Donneur trouvé',
    DONOR_CONFIRMED: 'Donneur confirmé',
    EN_ROUTE: 'En route',
    ARRIVED: 'Arrivé',
    IN_PROGRESS: 'En cours',
    COMPLETED: 'Terminé',
    CANCELLED: 'Annulé',
  }
  return labels[status] || status
}

const getChannelLabel = (channel) => {
  const labels = {
    websocket: 'Web',
    push: 'Push',
    sms: 'SMS',
    email: 'Email',
    'admin-alert': 'Admin',
    'fallback-donors': 'Secours',
  }
  return labels[channel] || channel
}

const getChannelSeverity = (channel) => {
  const severities = {
    websocket: 'info',
    push: 'info',
    sms: 'warning',
    email: 'secondary',
    'admin-alert': 'danger',
    'fallback-donors': 'help',
  }
  return severities[channel] || 'secondary'
}

const getTimelineIcon = (index, currentLevel) => {
  if (index < currentLevel) return 'pi pi-check-circle'
  if (index === currentLevel - 1) return 'pi pi-clock'
  return 'pi pi-circle'
}

// Lifecycle
onMounted(() => {
  startElapsedTimer()
  isAcknowledged.value = props.emergency.acknowledged || false
})

onUnmounted(() => {
  stopElapsedTimer()
})
</script>

<style scoped>
.emergency-details {
  max-width: 900px;
  margin: 0 auto;
}

/* Header */
.details-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: var(--surface-card);
  border-radius: 8px;
  border: 1px solid var(--surface-border);
}

.emergency-status {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}

.status-indicator {
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  flex-shrink: 0;
}

.status-indicator.active {
  background: var(--orange-100);
  color: var(--orange-600);
}

.status-indicator.acknowledged {
  background: var(--green-100);
  color: var(--green-600);
}

.status-indicator.expired {
  background: var(--red-100);
  color: var(--red-600);
}

.status-info h3 {
  margin: 0 0 0.5rem 0;
  color: var(--text-color);
  font-size: 1.5rem;
}

.status-tags {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

/* Contenu */
.details-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.content-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
}

/* Sections */
.info-section,
.description-section,
.location-section,
.contact-section,
.escalation-section,
.mission-section,
.history-section {
  padding: 1.5rem;
  background: var(--surface-card);
  border-radius: 8px;
  border: 1px solid var(--surface-border);
}

.info-section h4,
.description-section h4,
.location-section h4,
.contact-section h4,
.escalation-section h4,
.mission-section h4,
.history-section h4 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 1rem 0;
  color: var(--primary-color);
  font-size: 1.125rem;
}

/* Grille d'informations */
.info-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--surface-border);
}

.info-item:last-child {
  border-bottom: none;
}

.info-label {
  font-weight: 600;
  color: var(--text-color-secondary);
  font-size: 0.875rem;
}

.info-value {
  color: var(--text-color);
  font-weight: 500;
}

.info-value.expired {
  color: var(--red-500);
  font-weight: 600;
}

/* Description */
.description-content p {
  margin: 0;
  line-height: 1.6;
  color: var(--text-color);
}

/* Localisation */
.location-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.location-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.location-address {
  flex: 1;
  color: var(--text-color);
  font-weight: 500;
}

.location-actions {
  display: flex;
  gap: 0.5rem;
}

/* Contact */
.contact-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.contact-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: var(--surface-50);
  border-radius: 6px;
}

.contact-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.contact-icon {
  color: var(--primary-color);
  font-size: 1.25rem;
}

.contact-value {
  color: var(--text-color);
  font-weight: 500;
}

/* Escalade */
.escalation-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.escalation-progress {
  padding: 1rem;
  background: var(--surface-50);
  border-radius: 6px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  font-weight: 600;
  color: var(--text-color);
}

.next-escalation {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

/* Timeline */
.escalation-timeline {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.timeline-item {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}

.timeline-marker {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 1rem;
}

.timeline-item.completed .timeline-marker {
  background: var(--green-100);
  color: var(--green-600);
}

.timeline-item.current .timeline-marker {
  background: var(--orange-100);
  color: var(--orange-600);
}

.timeline-item.pending .timeline-marker {
  background: var(--surface-100);
  color: var(--text-color-secondary);
}

.timeline-content {
  flex: 1;
}

.timeline-title {
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 0.25rem;
}

.timeline-description {
  color: var(--text-color-secondary);
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
}

.timeline-channels {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}

/* Mission */
.mission-content {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.mission-info {
  flex: 1;
}

.mission-actions {
  display: flex;
  gap: 0.5rem;
}

/* Historique */
.history-timeline {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.history-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 1rem;
  align-items: center;
  padding: 0.75rem;
  background: var(--surface-50);
  border-radius: 6px;
}

.history-time {
  font-size: 0.8125rem;
  color: var(--text-color-secondary);
  font-weight: 600;
}

.history-action {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-color);
}

.history-action i {
  color: var(--primary-color);
}

.history-user {
  font-size: 0.8125rem;
  color: var(--text-color-secondary);
  font-style: italic;
}

/* Footer */
.details-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 2rem;
  padding: 1.5rem;
  background: var(--surface-card);
  border-radius: 8px;
  border: 1px solid var(--surface-border);
}

.footer-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.acknowledged-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--green-600);
  font-weight: 600;
}

.acknowledgment-required {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--orange-600);
  font-weight: 600;
}

.footer-actions {
  display: flex;
  gap: 0.5rem;
}

/* Responsive */
@media (max-width: 768px) {
  .details-header {
    flex-direction: column;
    gap: 1rem;
  }

  .emergency-status {
    align-items: center;
  }

  .header-actions {
    align-self: stretch;
    justify-content: center;
  }

  .content-grid {
    grid-template-columns: 1fr;
  }

  .location-info,
  .contact-item,
  .mission-content {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .location-actions,
  .mission-actions {
    justify-content: center;
  }

  .details-footer {
    flex-direction: column;
    gap: 1rem;
  }

  .footer-actions {
    align-self: stretch;
    justify-content: center;
  }

  .history-item {
    grid-template-columns: 1fr;
    text-align: center;
  }
}
</style>
