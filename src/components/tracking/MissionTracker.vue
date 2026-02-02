<template>
  <div class="mission-tracker">
    <div class="tracker-header">
      <h3 class="tracker-title">
        <i class="pi pi-map-marker"></i>
        Suivi des Missions
      </h3>
      <div class="tracker-actions">
        <Button
          icon="pi pi-refresh"
          label="Actualiser"
          :loading="isTracking"
          size="small"
          outlined
          @click="refreshMissions"
        />
        <Button icon="pi pi-cog" size="small" outlined @click="showSettings = true" />
      </div>
    </div>

    <div v-if="error" class="error-message">
      <Message severity="error" :closable="false">
        {{ error.message }}
      </Message>
    </div>

    <!-- Statistiques rapides -->
    <div v-if="trackingStats" class="tracker-stats">
      <div class="stat-card">
        <div class="stat-value">{{ activeMissions.length }}</div>
        <div class="stat-label">Missions actives</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ formatDuration(averageMissionDuration) }}</div>
        <div class="stat-label">Durée moyenne</div>
      </div>
      <div v-if="oldestMission" class="stat-card">
        <div class="stat-value">{{ formatDuration(oldestMission.duration) }}</div>
        <div class="stat-label">Plus ancienne</div>
      </div>
    </div>

    <!-- Liste des missions par statut -->
    <div v-if="hasActiveMissions" class="missions-container">
      <div v-for="(missions, status) in missionsByStatus" :key="status" class="status-group">
        <div class="status-header">
          <Tag
            :value="getStatusLabel(status)"
            :severity="getStatusSeverity(status)"
            class="status-tag"
          />
          <span class="mission-count">{{ missions.length }}</span>
        </div>

        <div class="missions-list">
          <Card v-for="mission in missions" :key="mission.id" class="mission-card">
            <template #content>
              <div class="mission-content">
                <div class="mission-header">
                  <div class="mission-info">
                    <span class="mission-id">{{ mission.id.slice(-8) }}</span>
                    <Tag
                      :value="mission.requestType"
                      :severity="mission.requestType === 'EMERGENCY' ? 'danger' : 'info'"
                      size="small"
                    />
                  </div>
                  <div class="mission-duration">
                    {{ formatDuration(mission.duration) }}
                  </div>
                </div>

                <div class="mission-timeline">
                  <div v-if="mission.eventsCount > 0" class="timeline-item">
                    <i class="pi pi-clock timeline-icon"></i>
                    <span class="timeline-text">{{ mission.eventsCount }} événements</span>
                  </div>
                </div>

                <div class="mission-actions">
                  <Button
                    icon="pi pi-eye"
                    label="Détails"
                    size="small"
                    text
                    @click="showMissionDetails(mission.id)"
                  />
                  <Button
                    icon="pi pi-check"
                    label="Terminer"
                    size="small"
                    severity="success"
                    outlined
                    @click="completeMission(mission.id)"
                  />
                </div>
              </div>
            </template>
          </Card>
        </div>
      </div>
    </div>

    <!-- État vide -->
    <div v-else class="empty-state">
      <div class="empty-icon">
        <i class="pi pi-map-marker"></i>
      </div>
      <h4>Aucune mission active</h4>
      <p>Les missions en cours de suivi apparaîtront ici</p>
    </div>

    <!-- Dialog des détails de mission -->
    <Dialog
      v-model:visible="showDetails"
      :header="`Détails Mission ${selectedMissionId}`"
      modal
      class="mission-details-dialog"
      :style="{ width: '600px' }"
    >
      <MissionDetails
        v-if="selectedMissionId"
        :mission-id="selectedMissionId"
        @event-recorded="refreshMissions"
      />
    </Dialog>

    <!-- Dialog des paramètres -->
    <Dialog
      v-model:visible="showSettings"
      header="Paramètres de Suivi"
      modal
      class="settings-dialog"
      :style="{ width: '400px' }"
    >
      <div class="settings-content">
        <div class="setting-item">
          <label class="setting-label">
            <InputSwitch v-model="trackingEnabled" @change="updateTrackingEnabled" />
            Suivi des missions activé
          </label>
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <InputSwitch v-model="autoRecordResults" @change="updateAutoRecordResults" />
            Enregistrement ML automatique
          </label>
        </div>
      </div>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useMissionTracking } from '@/composables/useMissionTracking'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import Dialog from 'primevue/dialog'
import InputSwitch from 'primevue/inputswitch'
import MissionDetails from './MissionDetails.vue'

const {
  activeMissions,
  isTracking,
  error,
  hasActiveMissions,
  missionsByStatus,
  averageMissionDuration,
  oldestMission,
  refreshActiveMissions,
  getTrackingStats,
  setTrackingEnabled,
  setAutoRecordResults,
  completeTracking,
} = useMissionTracking()

// États locaux
const showDetails = ref(false)
const selectedMissionId = ref(null)
const showSettings = ref(false)
const trackingEnabled = ref(true)
const autoRecordResults = ref(true)
const trackingStats = ref(null)

// Intervalle de rafraîchissement
let refreshInterval = null

// Méthodes
const refreshMissions = async () => {
  try {
    await refreshActiveMissions()
    trackingStats.value = getTrackingStats()
  } catch (err) {
    console.error('Erreur actualisation missions:', err)
  }
}

const showMissionDetails = (missionId) => {
  selectedMissionId.value = missionId
  showDetails.value = true
}

const completeMission = async (missionId) => {
  try {
    await completeTracking(missionId, { success: true })
    await refreshMissions()
  } catch (err) {
    console.error('Erreur finalisation mission:', err)
  }
}

const updateTrackingEnabled = (enabled) => {
  setTrackingEnabled(enabled)
}

const updateAutoRecordResults = (enabled) => {
  setAutoRecordResults(enabled)
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

const formatDuration = (milliseconds) => {
  if (!milliseconds) return '0min'

  const minutes = Math.floor(milliseconds / (1000 * 60))
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}min`
  }
  return `${minutes}min`
}

// Lifecycle
onMounted(() => {
  refreshMissions()

  // Rafraîchissement automatique toutes les 30 secondes
  refreshInterval = setInterval(refreshMissions, 30000)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})
</script>

<style scoped>
.mission-tracker {
  padding: 1rem;
}

.tracker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.tracker-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  color: var(--primary-color);
}

.tracker-actions {
  display: flex;
  gap: 0.5rem;
}

.error-message {
  margin-bottom: 1rem;
}

/* Statistiques */
.tracker-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.stat-card {
  background: var(--surface-card);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--primary-color);
  margin-bottom: 0.25rem;
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

/* Missions */
.missions-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.status-group {
  background: var(--surface-50);
  border-radius: 12px;
  padding: 1rem;
}

.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.status-tag {
  font-weight: 600;
}

.mission-count {
  background: var(--surface-200);
  color: var(--text-color);
  padding: 0.25rem 0.5rem;
  border-radius: 12px;
  font-size: 0.875rem;
  font-weight: 600;
}

.missions-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.mission-card {
  background: var(--surface-card);
  border: 1px solid var(--surface-border);
}

.mission-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.mission-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.mission-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.mission-id {
  font-family: monospace;
  font-weight: 600;
  color: var(--text-color);
}

.mission-duration {
  font-weight: 600;
  color: var(--text-color-secondary);
}

.mission-timeline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.timeline-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.timeline-icon {
  color: var(--primary-color);
}

.mission-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

/* État vide */
.empty-state {
  text-align: center;
  padding: 3rem 1rem;
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
  margin: 0;
}

/* Paramètres */
.settings-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.setting-item {
  display: flex;
  align-items: center;
}

.setting-label {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  font-weight: 500;
}

/* Responsive */
@media (max-width: 768px) {
  .tracker-header {
    flex-direction: column;
    gap: 1rem;
    align-items: stretch;
  }

  .tracker-actions {
    justify-content: center;
  }

  .tracker-stats {
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  }

  .mission-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .mission-actions {
    justify-content: flex-start;
  }
}
</style>
