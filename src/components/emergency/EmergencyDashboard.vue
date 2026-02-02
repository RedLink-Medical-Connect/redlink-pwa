<template>
  <div class="emergency-dashboard">
    <!-- Header avec statistiques -->
    <div class="dashboard-header">
      <div class="header-title">
        <h2>
          <i class="pi pi-exclamation-triangle"></i>
          Tableau de bord des urgences
        </h2>
        <p>Gestion et suivi des notifications d'urgence en temps réel</p>
      </div>

      <div class="header-stats">
        <div class="stat-card critical">
          <div class="stat-icon">
            <i class="pi pi-exclamation-triangle"></i>
          </div>
          <div class="stat-content">
            <span class="stat-value">{{ criticalEmergencies.length }}</span>
            <span class="stat-label">Critiques</span>
          </div>
        </div>

        <div class="stat-card urgent">
          <div class="stat-icon">
            <i class="pi pi-exclamation-circle"></i>
          </div>
          <div class="stat-content">
            <span class="stat-value">{{ urgentEmergencies.length }}</span>
            <span class="stat-label">Urgentes</span>
          </div>
        </div>

        <div class="stat-card high">
          <div class="stat-icon">
            <i class="pi pi-info-circle"></i>
          </div>
          <div class="stat-content">
            <span class="stat-value">{{ highEmergencies.length }}</span>
            <span class="stat-label">Élevées</span>
          </div>
        </div>

        <div class="stat-card response">
          <div class="stat-icon">
            <i class="pi pi-clock"></i>
          </div>
          <div class="stat-content">
            <span class="stat-value">{{ formatResponseTime(averageResponseTime) }}</span>
            <span class="stat-label">Temps moyen</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Actions rapides -->
    <div class="dashboard-actions">
      <Button
        label="Nouvelle urgence"
        icon="pi pi-plus"
        severity="danger"
        @click="showCreateEmergency = true"
      />

      <Button
        label="Actualiser"
        icon="pi pi-refresh"
        :loading="isProcessing"
        outlined
        @click="refreshDashboard"
      />

      <Button
        label="Tester escalade"
        icon="pi pi-play"
        severity="warning"
        outlined
        @click="testEscalation"
      />

      <Button label="Paramètres" icon="pi pi-cog" outlined @click="showSettings = true" />
    </div>

    <!-- Liste des urgences actives -->
    <div class="active-emergencies">
      <div class="section-header">
        <h3>Urgences actives ({{ totalActiveEmergencies }})</h3>
        <div class="section-actions">
          <Dropdown
            v-model="selectedFilter"
            :options="filterOptions"
            option-label="label"
            option-value="value"
            placeholder="Filtrer par urgence"
            @change="applyFilter"
          />
        </div>
      </div>

      <div v-if="filteredEmergencies.length === 0" class="empty-state">
        <div class="empty-icon">
          <i class="pi pi-check-circle"></i>
        </div>
        <h4>Aucune urgence active</h4>
        <p>Toutes les urgences ont été traitées ou aucune urgence en cours.</p>
      </div>

      <div v-else class="emergencies-grid">
        <EmergencyCard
          v-for="emergency in filteredEmergencies"
          :key="emergency.id"
          :emergency="emergency"
          @acknowledge="handleAcknowledge"
          @update-status="handleStatusUpdate"
          @view-details="handleViewDetails"
        />
      </div>
    </div>

    <!-- Historique récent -->
    <div class="emergency-history">
      <div class="section-header">
        <h3>Historique récent</h3>
        <Button label="Voir tout" text @click="showFullHistory = true" />
      </div>

      <DataTable
        :value="recentEmergencies"
        :rows="5"
        :paginator="false"
        responsive-layout="scroll"
        class="history-table"
      >
        <Column field="createdAt" header="Heure">
          <template #body="{ data }">
            {{ formatDateTime(data.createdAt) }}
          </template>
        </Column>

        <Column field="urgencyLevel" header="Niveau">
          <template #body="{ data }">
            <Tag
              :value="getUrgencyLabel(data.urgencyLevel)"
              :severity="getUrgencySeverity(data.urgencyLevel)"
            />
          </template>
        </Column>

        <Column field="title" header="Titre" />

        <Column field="status" header="Statut">
          <template #body="{ data }">
            <Tag :value="getStatusLabel(data.status)" :severity="getStatusSeverity(data.status)" />
          </template>
        </Column>

        <Column field="responseTime" header="Temps de réponse">
          <template #body="{ data }">
            {{ formatDuration(data.responseTime) }}
          </template>
        </Column>

        <Column header="Actions">
          <template #body="{ data }">
            <Button icon="pi pi-eye" size="small" text rounded @click="handleViewDetails(data)" />
          </template>
        </Column>
      </DataTable>
    </div>

    <!-- Dialog création d'urgence -->
    <Dialog
      v-model:visible="showCreateEmergency"
      header="Créer une nouvelle urgence"
      modal
      :style="{ width: '600px' }"
    >
      <CreateEmergencyForm
        @created="handleEmergencyCreated"
        @cancel="showCreateEmergency = false"
      />
    </Dialog>

    <!-- Dialog paramètres -->
    <Dialog
      v-model:visible="showSettings"
      header="Paramètres des urgences"
      modal
      :style="{ width: '500px' }"
    >
      <EmergencySettings @close="showSettings = false" />
    </Dialog>

    <!-- Dialog détails -->
    <Dialog
      v-model:visible="showDetails"
      :header="`Détails de l'urgence ${selectedEmergency?.id}`"
      modal
      :style="{ width: '700px' }"
    >
      <EmergencyDetails
        v-if="selectedEmergency"
        :emergency="selectedEmergency"
        @close="showDetails = false"
      />
    </Dialog>

    <!-- Notification d'urgence plein écran -->
    <EmergencyNotification
      v-if="currentEmergency"
      :notification="currentEmergency"
      :visible="isEmergencyVisible"
      @accept="handleEmergencyAccept"
      @decline="handleEmergencyDecline"
      @acknowledge="handleEmergencyAcknowledge"
      @dismiss="hideCurrentEmergency"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useEmergencyNotifications } from '@/composables/useEmergencyNotifications'
import Button from 'primevue/button'
import Dropdown from 'primevue/dropdown'
import Dialog from 'primevue/dialog'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import EmergencyNotification from '@/components/notifications/EmergencyNotification.vue'
import EmergencyCard from './EmergencyCard.vue'
import CreateEmergencyForm from './CreateEmergencyForm.vue'
import EmergencySettings from './EmergencySettings.vue'
import EmergencyDetails from './EmergencyDetails.vue'

const {
  activeEmergencies,
  currentEmergency,
  isEmergencyVisible,
  emergencyStats,
  isProcessing,
  criticalEmergencies,
  urgentEmergencies,
  highEmergencies,
  totalActiveEmergencies,
  averageResponseTime,
  sendEmergencyNotification,
  acknowledgeEmergency,
  updateMissionStatus,
  hideCurrentEmergency,
  handleEmergencyAccept,
  handleEmergencyDecline,
  updateEmergencyStats,
} = useEmergencyNotifications()

// États locaux
const showCreateEmergency = ref(false)
const showSettings = ref(false)
const showDetails = ref(false)
const showFullHistory = ref(false)
const selectedEmergency = ref(null)
const selectedFilter = ref('all')

// Données simulées pour l'historique
const recentEmergencies = ref([
  {
    id: 'emergency_001',
    createdAt: Date.now() - 3600000,
    urgencyLevel: 'CRITICAL',
    title: 'Transfusion urgente - Chien',
    status: 'COMPLETED',
    responseTime: 300000,
  },
  {
    id: 'emergency_002',
    createdAt: Date.now() - 7200000,
    urgencyLevel: 'URGENT',
    title: 'Accident de la route - Chat',
    status: 'COMPLETED',
    responseTime: 600000,
  },
])

// Options de filtrage
const filterOptions = [
  { label: 'Toutes les urgences', value: 'all' },
  { label: 'Critiques uniquement', value: 'CRITICAL' },
  { label: 'Urgentes uniquement', value: 'URGENT' },
  { label: 'Élevées uniquement', value: 'HIGH' },
]

// Propriétés calculées
const filteredEmergencies = computed(() => {
  if (selectedFilter.value === 'all') {
    return activeEmergencies.value
  }
  return activeEmergencies.value.filter(
    (emergency) => emergency.data?.urgencyLevel === selectedFilter.value,
  )
})

// Méthodes
const refreshDashboard = async () => {
  try {
    updateEmergencyStats()
    console.log('🔄 Tableau de bord actualisé')
  } catch (error) {
    console.error('Erreur actualisation tableau de bord:', error)
  }
}

const testEscalation = async () => {
  try {
    const testEmergency = {
      type: 'EMERGENCY_ALERT',
      urgencyLevel: 'CRITICAL',
      title: "Test d'escalade automatique",
      message: "Ceci est un test du système d'escalade automatique.",
      missionId: 'test_mission_001',
      animalType: 'Chien',
      bloodType: 'DEA 1.1+',
      location: 'Clinique Test, Paris',
      estimatedTime: '15 minutes',
      targetUsers: ['current-user'],
      fallbackUsers: ['fallback-user-1', 'fallback-user-2'],
    }

    await sendEmergencyNotification(testEmergency)
    console.log("🧪 Test d'escalade lancé")
  } catch (error) {
    console.error('Erreur test escalade:', error)
  }
}

const applyFilter = () => {
  console.log(`🔍 Filtre appliqué: ${selectedFilter.value}`)
}

const handleAcknowledge = async (emergency) => {
  try {
    await acknowledgeEmergency(emergency.id, 'READ')
    console.log(`✅ Urgence ${emergency.id} accusée réception`)
  } catch (error) {
    console.error('Erreur accusé de réception:', error)
  }
}

const handleStatusUpdate = async (emergency, newStatus) => {
  try {
    if (emergency.data?.missionId) {
      await updateMissionStatus(emergency.data.missionId, newStatus)
      console.log(`📋 Statut mission mis à jour: ${newStatus}`)
    }
  } catch (error) {
    console.error('Erreur mise à jour statut:', error)
  }
}

const handleViewDetails = (emergency) => {
  selectedEmergency.value = emergency
  showDetails.value = true
}

const handleEmergencyCreated = (emergency) => {
  showCreateEmergency.value = false
  console.log('🚨 Nouvelle urgence créée:', emergency)
}

const handleEmergencyAcknowledge = async (notification) => {
  try {
    await acknowledgeEmergency(notification.data?.emergencyId || notification.id, 'READ')
  } catch (error) {
    console.error('Erreur accusé de réception urgence:', error)
  }
}

// Utilitaires de formatage
const formatResponseTime = (milliseconds) => {
  if (!milliseconds) return 'N/A'

  const minutes = Math.floor(milliseconds / 60000)
  const seconds = Math.floor((milliseconds % 60000) / 1000)

  if (minutes > 0) {
    return `${minutes}min ${seconds}s`
  }
  return `${seconds}s`
}

const formatDateTime = (timestamp) => {
  return new Date(timestamp).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatDuration = (milliseconds) => {
  if (!milliseconds) return 'N/A'
  return formatResponseTime(milliseconds)
}

const getUrgencyLabel = (level) => {
  const labels = {
    CRITICAL: 'Critique',
    URGENT: 'Urgent',
    HIGH: 'Élevé',
  }
  return labels[level] || level
}

const getUrgencySeverity = (level) => {
  const severities = {
    CRITICAL: 'danger',
    URGENT: 'warning',
    HIGH: 'info',
  }
  return severities[level] || 'info'
}

const getStatusLabel = (status) => {
  const labels = {
    PENDING: 'En attente',
    ACKNOWLEDGED: 'Accusé réception',
    IN_PROGRESS: 'En cours',
    COMPLETED: 'Terminé',
    CANCELLED: 'Annulé',
  }
  return labels[status] || status
}

const getStatusSeverity = (status) => {
  const severities = {
    PENDING: 'warning',
    ACKNOWLEDGED: 'info',
    IN_PROGRESS: 'info',
    COMPLETED: 'success',
    CANCELLED: 'danger',
  }
  return severities[status] || 'info'
}

// Lifecycle
onMounted(() => {
  refreshDashboard()
})
</script>

<style scoped>
.emergency-dashboard {
  padding: 1.5rem;
  max-width: 1400px;
  margin: 0 auto;
}

/* Header */
.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2rem;
  gap: 2rem;
}

.header-title h2 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.5rem 0;
  color: var(--red-600);
}

.header-title p {
  margin: 0;
  color: var(--text-color-secondary);
}

.header-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  min-width: 600px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: var(--surface-card);
  border-radius: 8px;
  border-left: 4px solid;
}

.stat-card.critical {
  border-left-color: var(--red-500);
}

.stat-card.urgent {
  border-left-color: var(--orange-500);
}

.stat-card.high {
  border-left-color: var(--blue-500);
}

.stat-card.response {
  border-left-color: var(--green-500);
}

.stat-icon {
  width: 3rem;
  height: 3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 1.5rem;
}

.critical .stat-icon {
  background: var(--red-100);
  color: var(--red-600);
}

.urgent .stat-icon {
  background: var(--orange-100);
  color: var(--orange-600);
}

.high .stat-icon {
  background: var(--blue-100);
  color: var(--blue-600);
}

.response .stat-icon {
  background: var(--green-100);
  color: var(--green-600);
}

.stat-content {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-color);
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

/* Actions */
.dashboard-actions {
  display: flex;
  gap: 1rem;
  margin-bottom: 2rem;
  flex-wrap: wrap;
}

/* Sections */
.active-emergencies,
.emergency-history {
  margin-bottom: 2rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.section-header h3 {
  margin: 0;
  color: var(--text-color);
}

.section-actions {
  display: flex;
  gap: 1rem;
}

/* Grille des urgences */
.emergencies-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 1rem;
}

/* État vide */
.empty-state {
  text-align: center;
  padding: 3rem 2rem;
  color: var(--text-color-secondary);
}

.empty-icon {
  font-size: 3rem;
  color: var(--green-500);
  margin-bottom: 1rem;
}

.empty-state h4 {
  margin: 0 0 0.5rem 0;
  color: var(--text-color);
}

.empty-state p {
  margin: 0;
}

/* Tableau historique */
.history-table {
  background: var(--surface-card);
  border-radius: 8px;
}

/* Responsive */
@media (max-width: 1200px) {
  .dashboard-header {
    flex-direction: column;
    align-items: stretch;
  }

  .header-stats {
    grid-template-columns: repeat(2, 1fr);
    min-width: auto;
  }
}

@media (max-width: 768px) {
  .emergency-dashboard {
    padding: 1rem;
  }

  .header-stats {
    grid-template-columns: 1fr;
  }

  .dashboard-actions {
    flex-direction: column;
  }

  .emergencies-grid {
    grid-template-columns: 1fr;
  }

  .section-header {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }
}
</style>
