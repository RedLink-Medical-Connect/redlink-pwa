<template>
  <div class="mission-details">
    <div v-if="loading" class="loading-state">
      <ProgressSpinner />
      <p>Chargement des détails...</p>
    </div>

    <div v-else-if="missionStatus" class="details-content">
      <!-- Informations générales -->
      <div class="info-section">
        <h4>Informations Générales</h4>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">ID Mission:</span>
            <span class="info-value">{{ missionStatus.id }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Statut:</span>
            <Tag
              :value="getStatusLabel(missionStatus.status)"
              :severity="getStatusSeverity(missionStatus.status)"
            />
          </div>
          <div class="info-item">
            <span class="info-label">Durée:</span>
            <span class="info-value">{{ formatDuration(missionStatus.duration) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Dernière MAJ:</span>
            <span class="info-value">{{ formatTime(missionStatus.lastUpdate) }}</span>
          </div>
        </div>
      </div>

      <!-- Timeline des événements -->
      <div class="timeline-section">
        <h4>Timeline des Événements</h4>
        <div v-if="missionStatus.events.length > 0" class="timeline">
          <div v-for="(event, index) in sortedEvents" :key="index" class="timeline-event">
            <div class="event-marker">
              <i :class="getEventIcon(event.type)"></i>
            </div>
            <div class="event-content">
              <div class="event-header">
                <span class="event-type">{{ getEventLabel(event.type) }}</span>
                <span class="event-time">{{ formatTime(event.timestamp) }}</span>
              </div>
              <div v-if="event.data && Object.keys(event.data).length > 0" class="event-data">
                <div v-for="(value, key) in event.data" :key="key" class="event-detail">
                  <span class="detail-key">{{ formatKey(key) }}:</span>
                  <span class="detail-value">{{ formatValue(value) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="no-events">
          <p>Aucun événement enregistré</p>
        </div>
      </div>

      <!-- Actions rapides -->
      <div class="actions-section">
        <h4>Actions Rapides</h4>
        <div class="quick-actions">
          <Button
            icon="pi pi-phone"
            label="Donneur contacté"
            size="small"
            outlined
            @click="recordQuickEvent('DONOR_CONTACTED')"
          />
          <Button
            icon="pi pi-check"
            label="Donneur accepté"
            size="small"
            severity="success"
            outlined
            @click="recordQuickEvent('DONOR_ACCEPTED')"
          />
          <Button
            icon="pi pi-times"
            label="Donneur refusé"
            size="small"
            severity="warning"
            outlined
            @click="recordQuickEvent('DONOR_DECLINED')"
          />
          <Button
            icon="pi pi-car"
            label="En route"
            size="small"
            outlined
            @click="recordQuickEvent('DONOR_EN_ROUTE')"
          />
          <Button
            icon="pi pi-map-marker"
            label="Arrivé"
            size="small"
            severity="info"
            outlined
            @click="recordQuickEvent('DONOR_ARRIVED')"
          />
          <Button
            icon="pi pi-play"
            label="Transfusion démarrée"
            size="small"
            severity="warning"
            outlined
            @click="recordQuickEvent('TRANSFUSION_STARTED')"
          />
          <Button
            icon="pi pi-check-circle"
            label="Transfusion terminée"
            size="small"
            severity="success"
            outlined
            @click="recordQuickEvent('TRANSFUSION_COMPLETED')"
          />
        </div>
      </div>

      <!-- Action personnalisée -->
      <div class="custom-action-section">
        <h4>Événement Personnalisé</h4>
        <div class="custom-action-form">
          <div class="form-row">
            <Dropdown
              v-model="customEventType"
              :options="availableEventTypes"
              option-label="label"
              option-value="value"
              placeholder="Type d'événement"
              class="event-dropdown"
            />
            <InputText
              v-model="customEventData"
              placeholder="Données (JSON optionnel)"
              class="event-data-input"
            />
            <Button
              icon="pi pi-plus"
              label="Ajouter"
              :disabled="!customEventType"
              size="small"
              @click="recordCustomEvent"
            />
          </div>
        </div>
      </div>
    </div>

    <div v-else class="error-state">
      <Message severity="error" :closable="false">
        Mission non trouvée ou erreur de chargement
      </Message>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useMissionTracking } from '@/composables/useMissionTracking'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import Dropdown from 'primevue/dropdown'
import InputText from 'primevue/inputtext'

const props = defineProps({
  missionId: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['event-recorded'])

const { getMissionStatus, recordEvent, missionEvents } = useMissionTracking()

// États
const loading = ref(true)
const missionStatus = ref(null)
const customEventType = ref('')
const customEventData = ref('')

// Types d'événements disponibles
const availableEventTypes = [
  { label: 'Donneur contacté', value: 'DONOR_CONTACTED' },
  { label: 'Donneur accepté', value: 'DONOR_ACCEPTED' },
  { label: 'Donneur refusé', value: 'DONOR_DECLINED' },
  { label: 'En route', value: 'DONOR_EN_ROUTE' },
  { label: 'Arrivé', value: 'DONOR_ARRIVED' },
  { label: 'Transfusion démarrée', value: 'TRANSFUSION_STARTED' },
  { label: 'Transfusion terminée', value: 'TRANSFUSION_COMPLETED' },
  { label: 'Mission annulée', value: 'MISSION_CANCELLED' },
  { label: 'Mission échouée', value: 'MISSION_FAILED' },
]

// Propriétés calculées
const sortedEvents = computed(() => {
  if (!missionStatus.value?.events) return []
  return [...missionStatus.value.events].sort((a, b) => b.timestamp - a.timestamp)
})

// Méthodes
const loadMissionDetails = () => {
  loading.value = true
  try {
    missionStatus.value = getMissionStatus(props.missionId)
  } catch (err) {
    console.error('Erreur chargement détails mission:', err)
    missionStatus.value = null
  } finally {
    loading.value = false
  }
}

const recordQuickEvent = async (eventType) => {
  try {
    await recordEvent(props.missionId, eventType)
    loadMissionDetails() // Recharger les détails
    emit('event-recorded', { missionId: props.missionId, eventType })
  } catch (err) {
    console.error('Erreur enregistrement événement:', err)
  }
}

const recordCustomEvent = async () => {
  try {
    let eventData = {}

    if (customEventData.value.trim()) {
      try {
        eventData = JSON.parse(customEventData.value)
      } catch {
        // Si ce n'est pas du JSON valide, traiter comme texte simple
        eventData = { note: customEventData.value }
      }
    }

    await recordEvent(props.missionId, customEventType.value, eventData)

    // Réinitialiser le formulaire
    customEventType.value = ''
    customEventData.value = ''

    loadMissionDetails() // Recharger les détails
    emit('event-recorded', { missionId: props.missionId, eventType: customEventType.value })
  } catch (err) {
    console.error('Erreur enregistrement événement personnalisé:', err)
  }
}

const getStatusLabel = (status) => {
  const labels = {
    STARTED: 'Démarrée',
    CONTACTED: 'Contacté',
    ACCEPTED: 'Acceptée',
    DECLINED: 'Refusée',
    EN_ROUTE: 'En route',
    ARRIVED: 'Arrivé',
    IN_PROGRESS: 'En cours',
    COMPLETED: 'Terminée',
    CANCELLED: 'Annulée',
    FAILED: 'Échouée',
  }
  return labels[status] || status
}

const getStatusSeverity = (status) => {
  const severities = {
    STARTED: 'info',
    CONTACTED: 'info',
    ACCEPTED: 'success',
    DECLINED: 'warning',
    EN_ROUTE: 'info',
    ARRIVED: 'success',
    IN_PROGRESS: 'warning',
    COMPLETED: 'success',
    CANCELLED: 'danger',
    FAILED: 'danger',
  }
  return severities[status] || 'info'
}

const getEventLabel = (eventType) => {
  const labels = {
    MISSION_STARTED: 'Mission démarrée',
    DONOR_CONTACTED: 'Donneur contacté',
    DONOR_ACCEPTED: 'Donneur accepté',
    DONOR_DECLINED: 'Donneur refusé',
    DONOR_EN_ROUTE: 'Donneur en route',
    DONOR_ARRIVED: 'Donneur arrivé',
    TRANSFUSION_STARTED: 'Transfusion démarrée',
    TRANSFUSION_COMPLETED: 'Transfusion terminée',
    MISSION_CANCELLED: 'Mission annulée',
    MISSION_FAILED: 'Mission échouée',
  }
  return labels[eventType] || eventType
}

const getEventIcon = (eventType) => {
  const icons = {
    MISSION_STARTED: 'pi pi-play-circle',
    DONOR_CONTACTED: 'pi pi-phone',
    DONOR_ACCEPTED: 'pi pi-check',
    DONOR_DECLINED: 'pi pi-times',
    DONOR_EN_ROUTE: 'pi pi-car',
    DONOR_ARRIVED: 'pi pi-map-marker',
    TRANSFUSION_STARTED: 'pi pi-play',
    TRANSFUSION_COMPLETED: 'pi pi-check-circle',
    MISSION_CANCELLED: 'pi pi-ban',
    MISSION_FAILED: 'pi pi-exclamation-triangle',
  }
  return icons[eventType] || 'pi pi-circle'
}

const formatDuration = (milliseconds) => {
  if (!milliseconds) return '0min'

  const minutes = Math.floor(milliseconds / (1000 * 60))
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}min`
  }
  return `${minutes}min`
}

const formatTime = (timestamp) => {
  if (!timestamp) return 'N/A'
  return new Date(timestamp).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const formatKey = (key) => {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())
}

const formatValue = (value) => {
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

// Watchers
watch(() => props.missionId, loadMissionDetails, { immediate: true })

// Lifecycle
onMounted(() => {
  loadMissionDetails()
})
</script>

<style scoped>
.mission-details {
  padding: 1rem;
}

.loading-state,
.error-state {
  text-align: center;
  padding: 2rem;
}

.loading-state p {
  margin-top: 1rem;
  color: var(--text-color-secondary);
}

.details-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Sections */
.info-section,
.timeline-section,
.actions-section,
.custom-action-section {
  background: var(--surface-50);
  border-radius: 8px;
  padding: 1rem;
}

.info-section h4,
.timeline-section h4,
.actions-section h4,
.custom-action-section h4 {
  margin: 0 0 1rem 0;
  color: var(--primary-color);
  font-size: 1.1rem;
}

/* Informations générales */
.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.info-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-color-secondary);
}

.info-value {
  font-weight: 500;
  color: var(--text-color);
}

/* Timeline */
.timeline {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.timeline-event {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.event-marker {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--primary-color);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.event-content {
  flex: 1;
  background: var(--surface-card);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  padding: 0.75rem;
}

.event-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.event-type {
  font-weight: 600;
  color: var(--text-color);
}

.event-time {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.event-data {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.event-detail {
  display: flex;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.detail-key {
  font-weight: 600;
  color: var(--text-color-secondary);
}

.detail-value {
  color: var(--text-color);
}

.no-events {
  text-align: center;
  padding: 2rem;
  color: var(--text-color-secondary);
}

/* Actions rapides */
.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* Action personnalisée */
.custom-action-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.event-dropdown {
  flex: 1;
  min-width: 200px;
}

.event-data-input {
  flex: 2;
}

/* Responsive */
@media (max-width: 768px) {
  .info-grid {
    grid-template-columns: 1fr;
  }

  .event-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .quick-actions {
    flex-direction: column;
  }

  .form-row {
    flex-direction: column;
    align-items: stretch;
  }

  .event-dropdown,
  .event-data-input {
    min-width: auto;
  }
}
</style>
