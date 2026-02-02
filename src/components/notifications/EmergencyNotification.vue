<template>
  <Teleport to="body">
    <div v-if="visible" class="emergency-notification-overlay" @click.self="handleOverlayClick">
      <div class="emergency-notification" :class="emergencyClasses">
        <!-- Header d'urgence -->
        <div class="emergency-header">
          <div class="emergency-icon">
            <i :class="urgencyIcon" class="emergency-icon-symbol"></i>
          </div>
          <div class="emergency-title">
            <h2>{{ notification.title }}</h2>
            <div class="emergency-level">
              <Tag :value="urgencyLevelLabel" :severity="urgencySeverity" size="large" />
              <span class="emergency-time">{{ formatTime(notification.createdAt) }}</span>
            </div>
          </div>
          <div class="emergency-actions-header">
            <Button
              v-if="!isAcknowledged"
              icon="pi pi-volume-up"
              :class="{ 'sound-playing': isSoundPlaying }"
              size="small"
              rounded
              text
              @click="toggleSound"
            />
            <Button
              v-if="canDismiss"
              icon="pi pi-times"
              size="small"
              rounded
              text
              severity="secondary"
              @click="handleDismiss"
            />
          </div>
        </div>

        <!-- Contenu principal -->
        <div class="emergency-content">
          <div class="emergency-message">
            <p>{{ notification.message }}</p>
          </div>

          <!-- Informations détaillées -->
          <div v-if="emergencyDetails" class="emergency-details">
            <div class="detail-grid">
              <div v-if="emergencyDetails.animalType" class="detail-item">
                <i class="pi pi-heart detail-icon"></i>
                <div class="detail-content">
                  <span class="detail-label">Animal</span>
                  <span class="detail-value">{{ emergencyDetails.animalType }}</span>
                </div>
              </div>

              <div v-if="emergencyDetails.bloodType" class="detail-item">
                <i class="pi pi-circle detail-icon"></i>
                <div class="detail-content">
                  <span class="detail-label">Groupe sanguin</span>
                  <span class="detail-value">{{ emergencyDetails.bloodType }}</span>
                </div>
              </div>

              <div v-if="emergencyDetails.location" class="detail-item">
                <i class="pi pi-map-marker detail-icon"></i>
                <div class="detail-content">
                  <span class="detail-label">Localisation</span>
                  <span class="detail-value">{{ emergencyDetails.location }}</span>
                </div>
              </div>

              <div v-if="emergencyDetails.estimatedTime" class="detail-item">
                <i class="pi pi-clock detail-icon"></i>
                <div class="detail-content">
                  <span class="detail-label">Temps estimé</span>
                  <span class="detail-value">{{ emergencyDetails.estimatedTime }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Contact d'urgence -->
          <div v-if="emergencyDetails?.contactInfo" class="emergency-contact">
            <h4>Contact d'urgence</h4>
            <div class="contact-info">
              <Button
                :label="emergencyDetails.contactInfo.phone"
                icon="pi pi-phone"
                severity="success"
                @click="callEmergencyContact"
              />
              <Button
                v-if="emergencyDetails.contactInfo.email"
                :label="emergencyDetails.contactInfo.email"
                icon="pi pi-envelope"
                outlined
                @click="emailEmergencyContact"
              />
            </div>
          </div>
        </div>

        <!-- Actions principales -->
        <div class="emergency-actions">
          <div class="action-buttons">
            <Button
              v-if="showAcceptButton"
              label="Accepter la mission"
              icon="pi pi-check"
              size="large"
              severity="success"
              :loading="isProcessing"
              @click="handleAccept"
            />

            <Button
              v-if="showDeclineButton"
              label="Refuser"
              icon="pi pi-times"
              size="large"
              severity="danger"
              outlined
              :loading="isProcessing"
              @click="handleDecline"
            />

            <Button
              v-if="showAcknowledgeButton"
              label="Accusé de réception"
              icon="pi pi-eye"
              size="large"
              :loading="isProcessing"
              @click="handleAcknowledge"
            />
          </div>

          <!-- Indicateur d'escalade -->
          <div v-if="escalationInfo" class="escalation-info">
            <div class="escalation-level">
              <span class="escalation-label">Niveau d'escalade:</span>
              <ProgressBar
                :value="escalationProgress"
                :show-value="false"
                class="escalation-progress"
              />
              <span class="escalation-text"
                >{{ escalationInfo.currentLevel }}/{{ escalationInfo.maxLevel }}</span
              >
            </div>
            <div v-if="escalationInfo.nextEscalation" class="next-escalation">
              <i class="pi pi-clock"></i>
              <span
                >Prochaine escalade dans {{ formatDuration(escalationInfo.nextEscalation) }}</span
              >
            </div>
          </div>
        </div>

        <!-- Footer avec timer -->
        <div class="emergency-footer">
          <div class="emergency-timer">
            <i class="pi pi-stopwatch"></i>
            <span>Urgence active depuis {{ formatDuration(elapsedTime) }}</span>
          </div>
          <div v-if="requiresAcknowledgment && !isAcknowledged" class="acknowledgment-required">
            <i class="pi pi-exclamation-triangle"></i>
            <span>Accusé de réception requis</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import ProgressBar from 'primevue/progressbar'

const props = defineProps({
  notification: {
    type: Object,
    required: true,
  },
  visible: {
    type: Boolean,
    default: true,
  },
  canDismiss: {
    type: Boolean,
    default: false,
  },
  autoSound: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits([
  'accept',
  'decline',
  'acknowledge',
  'dismiss',
  'contact-call',
  'contact-email',
])

// États locaux
const isProcessing = ref(false)
const isAcknowledged = ref(false)
const isSoundPlaying = ref(false)
const elapsedTime = ref(0)
const soundInstance = ref(null)

// Timer pour le temps écoulé
let elapsedTimer = null

// Propriétés calculées
const emergencyDetails = computed(() => props.notification.data || {})

const urgencyLevel = computed(() => emergencyDetails.value.urgencyLevel || 'CRITICAL')

const urgencyLevelLabel = computed(() => {
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
  return severities[urgencyLevel.value] || 'danger'
})

const urgencyIcon = computed(() => {
  const icons = {
    CRITICAL: 'pi pi-exclamation-triangle',
    URGENT: 'pi pi-exclamation-circle',
    HIGH: 'pi pi-info-circle',
  }
  return icons[urgencyLevel.value] || 'pi pi-exclamation-triangle'
})

const emergencyClasses = computed(() => [
  'emergency-notification',
  `emergency-${urgencyLevel.value.toLowerCase()}`,
  {
    'emergency-acknowledged': isAcknowledged.value,
    'emergency-sound-playing': isSoundPlaying.value,
  },
])

const requiresAcknowledgment = computed(
  () => emergencyDetails.value.requiresAcknowledgment !== false,
)

const showAcceptButton = computed(
  () =>
    ['NEW_MATCH', 'EMERGENCY_ALERT', 'FALLBACK_EMERGENCY_ALERT'].includes(
      props.notification.type,
    ) && !isAcknowledged.value,
)

const showDeclineButton = computed(
  () =>
    ['NEW_MATCH', 'EMERGENCY_ALERT', 'FALLBACK_EMERGENCY_ALERT'].includes(
      props.notification.type,
    ) && !isAcknowledged.value,
)

const showAcknowledgeButton = computed(() => requiresAcknowledgment.value && !isAcknowledged.value)

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

// Méthodes
const handleAccept = async () => {
  try {
    isProcessing.value = true

    await new Promise((resolve) => setTimeout(resolve, 500)) // Simulation

    isAcknowledged.value = true
    stopSound()

    emit('accept', props.notification)

    console.log("✅ Mission d'urgence acceptée")
  } catch (error) {
    console.error('Erreur acceptation mission:', error)
  } finally {
    isProcessing.value = false
  }
}

const handleDecline = async () => {
  try {
    isProcessing.value = true

    await new Promise((resolve) => setTimeout(resolve, 500)) // Simulation

    isAcknowledged.value = true
    stopSound()

    emit('decline', props.notification)

    console.log("❌ Mission d'urgence refusée")
  } catch (error) {
    console.error('Erreur refus mission:', error)
  } finally {
    isProcessing.value = false
  }
}

const handleAcknowledge = async () => {
  try {
    isProcessing.value = true

    await new Promise((resolve) => setTimeout(resolve, 300)) // Simulation

    isAcknowledged.value = true
    stopSound()

    emit('acknowledge', props.notification)

    console.log('👁️ Accusé de réception envoyé')
  } catch (error) {
    console.error('Erreur accusé de réception:', error)
  } finally {
    isProcessing.value = false
  }
}

const handleDismiss = () => {
  stopSound()
  emit('dismiss', props.notification)
}

const handleOverlayClick = () => {
  // Ne pas fermer automatiquement les urgences critiques
  if (urgencyLevel.value !== 'CRITICAL' && props.canDismiss) {
    handleDismiss()
  }
}

const callEmergencyContact = () => {
  const phone = emergencyDetails.value.contactInfo?.phone
  if (phone) {
    window.location.href = `tel:${phone}`
    emit('contact-call', phone)
  }
}

const emailEmergencyContact = () => {
  const email = emergencyDetails.value.contactInfo?.email
  if (email) {
    window.location.href = `mailto:${email}`
    emit('contact-email', email)
  }
}

const playEmergencySound = () => {
  try {
    const soundType = emergencyDetails.value.sound || 'emergency-siren'
    const soundUrl = `/sounds/${soundType}.mp3`

    soundInstance.value = new Audio(soundUrl)
    soundInstance.value.loop = true
    soundInstance.value.volume = 0.8

    soundInstance.value
      .play()
      .then(() => {
        isSoundPlaying.value = true
        console.log(`🔊 Son d'urgence joué: ${soundType}`)
      })
      .catch((err) => {
        console.warn("Impossible de jouer le son d'urgence:", err)
      })
  } catch (error) {
    console.warn("Erreur lecture son d'urgence:", error)
  }
}

const stopSound = () => {
  if (soundInstance.value) {
    soundInstance.value.pause()
    soundInstance.value.currentTime = 0
    soundInstance.value = null
    isSoundPlaying.value = false
  }
}

const toggleSound = () => {
  if (isSoundPlaying.value) {
    stopSound()
  } else {
    playEmergencySound()
  }
}

const startElapsedTimer = () => {
  elapsedTimer = setInterval(() => {
    elapsedTime.value = Date.now() - props.notification.createdAt
  }, 1000)
}

const stopElapsedTimer = () => {
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
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

  if (hours > 0) {
    return `${hours}h ${minutes % 60}min`
  } else if (minutes > 0) {
    return `${minutes}min ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

// Watchers
watch(
  () => props.visible,
  (newVisible) => {
    if (newVisible && props.autoSound) {
      playEmergencySound()
      startElapsedTimer()
    } else {
      stopSound()
      stopElapsedTimer()
    }
  },
)

// Lifecycle
onMounted(() => {
  if (props.visible && props.autoSound) {
    playEmergencySound()
  }
  startElapsedTimer()

  // Vibration d'urgence
  if ('vibrate' in navigator) {
    const vibrationPattern =
      urgencyLevel.value === 'CRITICAL' ? [500, 200, 500, 200, 500] : [300, 150, 300]
    navigator.vibrate(vibrationPattern)
  }
})

onUnmounted(() => {
  stopSound()
  stopElapsedTimer()
})
</script>

<style scoped>
.emergency-notification-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(4px);
}

.emergency-notification {
  background: var(--surface-card);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  max-width: 600px;
  width: 90vw;
  max-height: 90vh;
  overflow-y: auto;
  animation: emergencySlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Animations d'urgence */
.emergency-critical {
  border: 3px solid var(--red-500);
  animation: emergencyPulse 2s infinite;
}

.emergency-urgent {
  border: 3px solid var(--orange-500);
  animation: emergencyGlow 3s infinite;
}

.emergency-high {
  border: 3px solid var(--blue-500);
}

@keyframes emergencySlideIn {
  from {
    opacity: 0;
    transform: scale(0.8) translateY(-50px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes emergencyPulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 var(--red-500);
  }
  50% {
    box-shadow: 0 0 0 10px transparent;
  }
}

@keyframes emergencyGlow {
  0%,
  100% {
    box-shadow: 0 0 20px rgba(255, 165, 0, 0.3);
  }
  50% {
    box-shadow: 0 0 40px rgba(255, 165, 0, 0.6);
  }
}

/* Header */
.emergency-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 2rem 2rem 1rem 2rem;
  background: linear-gradient(135deg, var(--red-50), var(--orange-50));
  border-bottom: 1px solid var(--surface-border);
}

.emergency-icon {
  flex-shrink: 0;
  width: 4rem;
  height: 4rem;
  background: var(--red-500);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: emergencyIconPulse 1.5s infinite;
}

.emergency-icon-symbol {
  font-size: 2rem;
  color: white;
}

@keyframes emergencyIconPulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
  }
}

.emergency-title {
  flex: 1;
}

.emergency-title h2 {
  margin: 0 0 0.5rem 0;
  color: var(--red-600);
  font-size: 1.5rem;
  font-weight: 700;
}

.emergency-level {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.emergency-time {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.emergency-actions-header {
  display: flex;
  gap: 0.5rem;
}

.sound-playing {
  animation: soundPulse 1s infinite;
}

@keyframes soundPulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* Contenu */
.emergency-content {
  padding: 1.5rem 2rem;
}

.emergency-message {
  margin-bottom: 1.5rem;
}

.emergency-message p {
  font-size: 1.125rem;
  line-height: 1.6;
  color: var(--text-color);
  margin: 0;
}

/* Détails */
.emergency-details {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: var(--surface-50);
  border-radius: 8px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.detail-icon {
  color: var(--primary-color);
  font-size: 1.25rem;
}

.detail-content {
  display: flex;
  flex-direction: column;
}

.detail-label {
  font-size: 0.75rem;
  color: var(--text-color-secondary);
  text-transform: uppercase;
  font-weight: 600;
}

.detail-value {
  font-size: 0.875rem;
  color: var(--text-color);
  font-weight: 500;
}

/* Contact */
.emergency-contact {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: var(--green-50);
  border-radius: 8px;
  border-left: 4px solid var(--green-500);
}

.emergency-contact h4 {
  margin: 0 0 1rem 0;
  color: var(--green-700);
}

.contact-info {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* Actions */
.emergency-actions {
  padding: 1.5rem 2rem;
  border-top: 1px solid var(--surface-border);
  background: var(--surface-50);
}

.action-buttons {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.action-buttons .p-button {
  flex: 1;
  min-width: 150px;
}

/* Escalade */
.escalation-info {
  padding: 1rem;
  background: var(--orange-50);
  border-radius: 8px;
  border-left: 4px solid var(--orange-500);
}

.escalation-level {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.escalation-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--orange-700);
}

.escalation-progress {
  flex: 1;
  height: 8px;
}

.escalation-text {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--orange-700);
}

.next-escalation {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--orange-600);
}

/* Footer */
.emergency-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: var(--surface-100);
  border-top: 1px solid var(--surface-border);
}

.emergency-timer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.acknowledgment-required {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--orange-600);
  font-weight: 600;
}

/* Responsive */
@media (max-width: 768px) {
  .emergency-notification {
    width: 95vw;
    margin: 1rem;
  }

  .emergency-header {
    padding: 1.5rem 1rem 1rem 1rem;
    flex-direction: column;
    text-align: center;
  }

  .emergency-content {
    padding: 1rem;
  }

  .emergency-actions {
    padding: 1rem;
  }

  .action-buttons {
    flex-direction: column;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }

  .escalation-level {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }

  .emergency-footer {
    flex-direction: column;
    gap: 0.5rem;
    text-align: center;
  }
}

/* Accessibilité */
.emergency-notification:focus-within {
  outline: 3px solid var(--primary-color);
  outline-offset: 2px;
}

/* Thème sombre */
@media (prefers-color-scheme: dark) {
  .emergency-notification-overlay {
    background: rgba(0, 0, 0, 0.95);
  }

  .emergency-header {
    background: linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(251, 146, 60, 0.1));
  }

  .emergency-contact {
    background: rgba(34, 197, 94, 0.1);
  }

  .escalation-info {
    background: rgba(251, 146, 60, 0.1);
  }
}
</style>
