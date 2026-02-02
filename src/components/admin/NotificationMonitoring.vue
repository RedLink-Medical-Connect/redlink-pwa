<template>
  <div class="notification-monitoring">
    <!-- Header -->
    <div class="monitoring-header">
      <h2>
        <i class="pi pi-chart-line"></i>
        Monitoring des Notifications
      </h2>
      <div class="header-actions">
        <Button
          label="Actualiser"
          icon="pi pi-refresh"
          :loading="isRefreshing"
          @click="refreshData"
        />
        <Button label="Exporter rapport" icon="pi pi-download" outlined @click="exportReport" />
      </div>
    </div>

    <!-- Métriques en temps réel -->
    <div class="realtime-metrics">
      <div class="metrics-grid">
        <div class="metric-card critical">
          <div class="metric-icon">
            <i class="pi pi-exclamation-triangle"></i>
          </div>
          <div class="metric-content">
            <span class="metric-value">{{ realtimeStats.activeEmergencies }}</span>
            <span class="metric-label">Urgences Actives</span>
            <span class="metric-trend" :class="getTrendClass(realtimeStats.emergencyTrend)">
              <i :class="getTrendIcon(realtimeStats.emergencyTrend)"></i>
              {{ Math.abs(realtimeStats.emergencyTrend) }}%
            </span>
          </div>
        </div>

        <div class="metric-card success">
          <div class="metric-icon">
            <i class="pi pi-check-circle"></i>
          </div>
          <div class="metric-content">
            <span class="metric-value">{{ realtimeStats.deliveryRate }}%</span>
            <span class="metric-label">Taux de Délivrance</span>
            <span class="metric-trend" :class="getTrendClass(realtimeStats.deliveryTrend)">
              <i :class="getTrendIcon(realtimeStats.deliveryTrend)"></i>
              {{ Math.abs(realtimeStats.deliveryTrend) }}%
            </span>
          </div>
        </div>

        <div class="metric-card warning">
          <div class="metric-icon">
            <i class="pi pi-clock"></i>
          </div>
          <div class="metric-content">
            <span class="metric-value">{{ realtimeStats.avgResponseTime }}</span>
            <span class="metric-label">Temps de Réponse</span>
            <span class="metric-trend" :class="getTrendClass(realtimeStats.responseTrend)">
              <i :class="getTrendIcon(realtimeStats.responseTrend)"></i>
              {{ Math.abs(realtimeStats.responseTrend) }}%
            </span>
          </div>
        </div>

        <div class="metric-card info">
          <div class="metric-icon">
            <i class="pi pi-users"></i>
          </div>
          <div class="metric-content">
            <span class="metric-value">{{ realtimeStats.activeUsers }}</span>
            <span class="metric-label">Utilisateurs Actifs</span>
            <span class="metric-trend" :class="getTrendClass(realtimeStats.userTrend)">
              <i :class="getTrendIcon(realtimeStats.userTrend)"></i>
              {{ Math.abs(realtimeStats.userTrend) }}%
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Graphiques de performance -->
    <div class="performance-charts">
      <div class="charts-grid">
        <!-- Graphique de délivrabilité -->
        <div class="chart-card">
          <div class="chart-header">
            <h3>Délivrabilité par Canal</h3>
            <Select
              v-model="deliveryTimeRange"
              :options="timeRangeOptions"
              option-label="label"
              option-value="value"
              @change="updateDeliveryChart"
            />
          </div>
          <div class="chart-content">
            <canvas ref="deliveryChart" width="400" height="200"></canvas>
          </div>
        </div>

        <!-- Graphique de latence -->
        <div class="chart-card">
          <div class="chart-header">
            <h3>Latence des Notifications</h3>
            <Select
              v-model="latencyTimeRange"
              :options="timeRangeOptions"
              option-label="label"
              option-value="value"
              @change="updateLatencyChart"
            />
          </div>
          <div class="chart-content">
            <canvas ref="latencyChart" width="400" height="200"></canvas>
          </div>
        </div>

        <!-- Graphique d'escalade -->
        <div class="chart-card">
          <div class="chart-header">
            <h3>Escalades d'Urgence</h3>
            <Select
              v-model="escalationTimeRange"
              :options="timeRangeOptions"
              option-label="label"
              option-value="value"
              @change="updateEscalationChart"
            />
          </div>
          <div class="chart-content">
            <canvas ref="escalationChart" width="400" height="200"></canvas>
          </div>
        </div>

        <!-- Graphique de volume -->
        <div class="chart-card">
          <div class="chart-header">
            <h3>Volume de Notifications</h3>
            <Select
              v-model="volumeTimeRange"
              :options="timeRangeOptions"
              option-label="label"
              option-value="value"
              @change="updateVolumeChart"
            />
          </div>
          <div class="chart-content">
            <canvas ref="volumeChart" width="400" height="200"></canvas>
          </div>
        </div>
      </div>
    </div>

    <!-- Alertes système -->
    <div class="system-alerts">
      <div class="alerts-header">
        <h3>
          <i class="pi pi-bell"></i>
          Alertes Système
        </h3>
        <div class="alert-filters">
          <MultiSelect
            v-model="selectedAlertTypes"
            :options="alertTypes"
            option-label="label"
            option-value="value"
            placeholder="Filtrer par type"
            @change="filterAlerts"
          />
        </div>
      </div>

      <div class="alerts-list">
        <div
          v-for="alert in filteredAlerts"
          :key="alert.id"
          class="alert-item"
          :class="alert.severity"
        >
          <div class="alert-icon">
            <i :class="getAlertIcon(alert.severity)"></i>
          </div>
          <div class="alert-content">
            <div class="alert-title">{{ alert.title }}</div>
            <div class="alert-message">{{ alert.message }}</div>
            <div class="alert-meta">
              <span class="alert-time">{{ formatTime(alert.timestamp) }}</span>
              <Tag :value="alert.type" :severity="getAlertSeverity(alert.severity)" />
            </div>
          </div>
          <div class="alert-actions">
            <Button
              v-tooltip="'Voir détails'"
              icon="pi pi-eye"
              size="small"
              text
              @click="viewAlertDetails(alert)"
            />
            <Button
              v-tooltip="'Ignorer'"
              icon="pi pi-times"
              size="small"
              text
              severity="secondary"
              @click="dismissAlert(alert)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Statistiques détaillées -->
    <div class="detailed-stats">
      <TabView>
        <TabPanel header="Canaux" left-icon="pi pi-send">
          <DataTable :value="channelStats" responsive-layout="scroll" :paginator="true" :rows="10">
            <Column field="channel" header="Canal">
              <template #body="{ data }">
                <div class="channel-info">
                  <i :class="getChannelIcon(data.channel)"></i>
                  <span>{{ getChannelLabel(data.channel) }}</span>
                </div>
              </template>
            </Column>
            <Column field="sent" header="Envoyées" sortable />
            <Column field="delivered" header="Délivrées" sortable />
            <Column field="failed" header="Échecs" sortable />
            <Column field="successRate" header="Taux de Succès" sortable>
              <template #body="{ data }">
                <div class="success-rate">
                  <ProgressBar :value="data.successRate" :show-value="false" />
                  <span>{{ data.successRate }}%</span>
                </div>
              </template>
            </Column>
            <Column field="avgLatency" header="Latence Moy." sortable>
              <template #body="{ data }"> {{ data.avgLatency }}ms </template>
            </Column>
            <Column field="status" header="Statut">
              <template #body="{ data }">
                <Tag
                  :value="data.status"
                  :severity="data.status === 'Actif' ? 'success' : 'danger'"
                />
              </template>
            </Column>
          </DataTable>
        </TabPanel>

        <TabPanel header="Utilisateurs" left-icon="pi pi-users">
          <DataTable :value="userStats" responsive-layout="scroll" :paginator="true" :rows="10">
            <Column field="userId" header="Utilisateur" />
            <Column field="totalNotifications" header="Total Notif." sortable />
            <Column field="responseRate" header="Taux Réponse" sortable>
              <template #body="{ data }"> {{ data.responseRate }}% </template>
            </Column>
            <Column field="avgResponseTime" header="Temps Réponse Moy." sortable />
            <Column field="preferredChannel" header="Canal Préféré" />
            <Column field="lastActivity" header="Dernière Activité">
              <template #body="{ data }">
                {{ formatDateTime(data.lastActivity) }}
              </template>
            </Column>
          </DataTable>
        </TabPanel>

        <TabPanel header="Erreurs" left-icon="pi pi-exclamation-triangle">
          <DataTable :value="errorStats" responsive-layout="scroll" :paginator="true" :rows="10">
            <Column field="timestamp" header="Heure" sortable>
              <template #body="{ data }">
                {{ formatDateTime(data.timestamp) }}
              </template>
            </Column>
            <Column field="type" header="Type" />
            <Column field="channel" header="Canal" />
            <Column field="error" header="Erreur" />
            <Column field="count" header="Occurrences" sortable />
            <Column field="severity" header="Sévérité">
              <template #body="{ data }">
                <Tag :value="data.severity" :severity="getErrorSeverity(data.severity)" />
              </template>
            </Column>
          </DataTable>
        </TabPanel>
      </TabView>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { deliveryOptimizer } from '@/services/notification-delivery-optimizer'
import Button from 'primevue/button'
import Select from 'primevue/select'
import MultiSelect from 'primevue/multiselect'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import Tag from 'primevue/tag'
import ProgressBar from 'primevue/progressbar'

// États
const isRefreshing = ref(false)
const deliveryTimeRange = ref('24h')
const latencyTimeRange = ref('24h')
const escalationTimeRange = ref('24h')
const volumeTimeRange = ref('24h')
const selectedAlertTypes = ref(['error', 'warning'])

// Refs pour les graphiques
const deliveryChart = ref(null)
const latencyChart = ref(null)
const escalationChart = ref(null)
const volumeChart = ref(null)

// Timer pour actualisation automatique
let refreshTimer = null

// Options
const timeRangeOptions = [
  { label: 'Dernière heure', value: '1h' },
  { label: 'Dernières 24h', value: '24h' },
  { label: 'Derniers 7 jours', value: '7d' },
  { label: 'Dernier mois', value: '30d' },
]

const alertTypes = [
  { label: 'Erreurs', value: 'error' },
  { label: 'Avertissements', value: 'warning' },
  { label: 'Informations', value: 'info' },
  { label: 'Succès', value: 'success' },
]

// Données simulées
const realtimeStats = ref({
  activeEmergencies: 12,
  emergencyTrend: -8,
  deliveryRate: 97.3,
  deliveryTrend: 2.1,
  avgResponseTime: '2min 34s',
  responseTrend: -12,
  activeUsers: 156,
  userTrend: 5,
})

const systemAlerts = ref([
  {
    id: 1,
    severity: 'error',
    type: 'Délivrabilité',
    title: 'Échec SMS en masse',
    message: "Taux d'échec SMS anormalement élevé (15%) depuis 10 minutes",
    timestamp: Date.now() - 600000,
  },
  {
    id: 2,
    severity: 'warning',
    type: 'Performance',
    title: 'Latence élevée WebSocket',
    message: 'Latence WebSocket moyenne de 800ms détectée',
    timestamp: Date.now() - 1200000,
  },
  {
    id: 3,
    severity: 'info',
    type: 'Optimisation',
    title: 'Optimisation automatique appliquée',
    message: 'Timeouts ajustés automatiquement pour améliorer les performances',
    timestamp: Date.now() - 1800000,
  },
])

const channelStats = ref([
  {
    channel: 'websocket',
    sent: 1247,
    delivered: 1238,
    failed: 9,
    successRate: 99.3,
    avgLatency: 156,
    status: 'Actif',
  },
  {
    channel: 'push',
    sent: 892,
    delivered: 867,
    failed: 25,
    successRate: 97.2,
    avgLatency: 2340,
    status: 'Actif',
  },
  {
    channel: 'sms',
    sent: 234,
    delivered: 198,
    failed: 36,
    successRate: 84.6,
    avgLatency: 4560,
    status: 'Dégradé',
  },
  {
    channel: 'email',
    sent: 156,
    delivered: 152,
    failed: 4,
    successRate: 97.4,
    avgLatency: 8920,
    status: 'Actif',
  },
])

const userStats = ref([
  {
    userId: 'user-001',
    totalNotifications: 45,
    responseRate: 89,
    avgResponseTime: '2min 15s',
    preferredChannel: 'Push',
    lastActivity: Date.now() - 300000,
  },
  {
    userId: 'user-002',
    totalNotifications: 32,
    responseRate: 94,
    avgResponseTime: '1min 45s',
    preferredChannel: 'WebSocket',
    lastActivity: Date.now() - 600000,
  },
])

const errorStats = ref([
  {
    timestamp: Date.now() - 300000,
    type: 'Timeout',
    channel: 'SMS',
    error: 'Connection timeout after 30s',
    count: 15,
    severity: 'High',
  },
  {
    timestamp: Date.now() - 600000,
    type: 'Rate Limit',
    channel: 'Push',
    error: 'Rate limit exceeded',
    count: 8,
    severity: 'Medium',
  },
])

// Propriétés calculées
const filteredAlerts = computed(() => {
  return systemAlerts.value.filter((alert) => selectedAlertTypes.value.includes(alert.severity))
})

// Méthodes
const refreshData = async () => {
  try {
    isRefreshing.value = true

    // Simuler le chargement des données
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Mettre à jour les statistiques temps réel
    realtimeStats.value = {
      activeEmergencies: Math.floor(Math.random() * 20) + 5,
      emergencyTrend: Math.floor(Math.random() * 20) - 10,
      deliveryRate: 95 + Math.random() * 5,
      deliveryTrend: Math.floor(Math.random() * 10) - 5,
      avgResponseTime: `${Math.floor(Math.random() * 5) + 1}min ${Math.floor(Math.random() * 60)}s`,
      responseTrend: Math.floor(Math.random() * 20) - 10,
      activeUsers: Math.floor(Math.random() * 50) + 100,
      userTrend: Math.floor(Math.random() * 10) - 5,
    }

    console.log('📊 Données de monitoring actualisées')
  } catch (error) {
    console.error('Erreur actualisation monitoring:', error)
  } finally {
    isRefreshing.value = false
  }
}

const exportReport = () => {
  const report = {
    timestamp: new Date().toISOString(),
    realtimeStats: realtimeStats.value,
    channelStats: channelStats.value,
    userStats: userStats.value,
    errorStats: errorStats.value,
    alerts: systemAlerts.value,
  }

  const dataStr = JSON.stringify(report, null, 2)
  const dataBlob = new Blob([dataStr], { type: 'application/json' })
  const url = URL.createObjectURL(dataBlob)
  const link = document.createElement('a')
  link.href = url
  link.download = `notification-monitoring-${Date.now()}.json`
  link.click()
  URL.revokeObjectURL(url)

  console.log('📥 Rapport de monitoring exporté')
}

const updateDeliveryChart = () => {
  // Simuler la mise à jour du graphique
  console.log(`📈 Graphique de délivrabilité mis à jour (${deliveryTimeRange.value})`)
}

const updateLatencyChart = () => {
  console.log(`📈 Graphique de latence mis à jour (${latencyTimeRange.value})`)
}

const updateEscalationChart = () => {
  console.log(`📈 Graphique d'escalade mis à jour (${escalationTimeRange.value})`)
}

const updateVolumeChart = () => {
  console.log(`📈 Graphique de volume mis à jour (${volumeTimeRange.value})`)
}

const filterAlerts = () => {
  console.log("🔍 Filtres d'alertes mis à jour:", selectedAlertTypes.value)
}

const viewAlertDetails = (alert) => {
  console.log('👁️ Voir détails alerte:', alert)
}

const dismissAlert = (alert) => {
  const index = systemAlerts.value.findIndex((a) => a.id === alert.id)
  if (index > -1) {
    systemAlerts.value.splice(index, 1)
    console.log('❌ Alerte ignorée:', alert.title)
  }
}

// Utilitaires
const getTrendClass = (trend) => {
  if (trend > 0) return 'trend-up'
  if (trend < 0) return 'trend-down'
  return 'trend-neutral'
}

const getTrendIcon = (trend) => {
  if (trend > 0) return 'pi pi-arrow-up'
  if (trend < 0) return 'pi pi-arrow-down'
  return 'pi pi-minus'
}

const getAlertIcon = (severity) => {
  const icons = {
    error: 'pi pi-times-circle',
    warning: 'pi pi-exclamation-triangle',
    info: 'pi pi-info-circle',
    success: 'pi pi-check-circle',
  }
  return icons[severity] || 'pi pi-info-circle'
}

const getAlertSeverity = (severity) => {
  const severities = {
    error: 'danger',
    warning: 'warning',
    info: 'info',
    success: 'success',
  }
  return severities[severity] || 'info'
}

const getChannelIcon = (channel) => {
  const icons = {
    websocket: 'pi pi-desktop',
    push: 'pi pi-mobile',
    sms: 'pi pi-phone',
    email: 'pi pi-envelope',
  }
  return icons[channel] || 'pi pi-send'
}

const getChannelLabel = (channel) => {
  const labels = {
    websocket: 'WebSocket',
    push: 'Push',
    sms: 'SMS',
    email: 'Email',
  }
  return labels[channel] || channel
}

const getErrorSeverity = (severity) => {
  const severities = {
    High: 'danger',
    Medium: 'warning',
    Low: 'info',
  }
  return severities[severity] || 'info'
}

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatDateTime = (timestamp) => {
  return new Date(timestamp).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Lifecycle
onMounted(() => {
  refreshData()

  // Actualisation automatique toutes les 30 secondes
  refreshTimer = setInterval(refreshData, 30000)
})

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
  }
})
</script>

<style scoped>
.notification-monitoring {
  padding: 1.5rem;
  max-width: 1400px;
  margin: 0 auto;
}

/* Header */
.monitoring-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.monitoring-header h2 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  color: var(--primary-color);
}

.header-actions {
  display: flex;
  gap: 1rem;
}

/* Métriques temps réel */
.realtime-metrics {
  margin-bottom: 2rem;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
}

.metric-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem;
  background: var(--surface-card);
  border-radius: 8px;
  border-left: 4px solid;
}

.metric-card.critical {
  border-left-color: var(--red-500);
}

.metric-card.success {
  border-left-color: var(--green-500);
}

.metric-card.warning {
  border-left-color: var(--orange-500);
}

.metric-card.info {
  border-left-color: var(--blue-500);
}

.metric-icon {
  width: 3rem;
  height: 3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 1.5rem;
}

.critical .metric-icon {
  background: var(--red-100);
  color: var(--red-600);
}

.success .metric-icon {
  background: var(--green-100);
  color: var(--green-600);
}

.warning .metric-icon {
  background: var(--orange-100);
  color: var(--orange-600);
}

.info .metric-icon {
  background: var(--blue-100);
  color: var(--blue-600);
}

.metric-content {
  display: flex;
  flex-direction: column;
}

.metric-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-color);
}

.metric-label {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
  margin-bottom: 0.25rem;
}

.metric-trend {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8125rem;
  font-weight: 600;
}

.trend-up {
  color: var(--green-600);
}

.trend-down {
  color: var(--red-600);
}

.trend-neutral {
  color: var(--text-color-secondary);
}

/* Graphiques */
.performance-charts {
  margin-bottom: 2rem;
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 1.5rem;
}

.chart-card {
  background: var(--surface-card);
  border-radius: 8px;
  border: 1px solid var(--surface-border);
  overflow: hidden;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background: var(--surface-50);
  border-bottom: 1px solid var(--surface-border);
}

.chart-header h3 {
  margin: 0;
  color: var(--text-color);
  font-size: 1rem;
}

.chart-content {
  padding: 1rem;
  height: 250px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Alertes système */
.system-alerts {
  margin-bottom: 2rem;
  background: var(--surface-card);
  border-radius: 8px;
  border: 1px solid var(--surface-border);
}

.alerts-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  background: var(--surface-50);
  border-bottom: 1px solid var(--surface-border);
}

.alerts-header h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  color: var(--text-color);
}

.alerts-list {
  max-height: 400px;
  overflow-y: auto;
}

.alert-item {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--surface-border);
  border-left: 4px solid;
}

.alert-item:last-child {
  border-bottom: none;
}

.alert-item.error {
  border-left-color: var(--red-500);
}

.alert-item.warning {
  border-left-color: var(--orange-500);
}

.alert-item.info {
  border-left-color: var(--blue-500);
}

.alert-item.success {
  border-left-color: var(--green-500);
}

.alert-icon {
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 1rem;
}

.error .alert-icon {
  background: var(--red-100);
  color: var(--red-600);
}

.warning .alert-icon {
  background: var(--orange-100);
  color: var(--orange-600);
}

.info .alert-icon {
  background: var(--blue-100);
  color: var(--blue-600);
}

.success .alert-icon {
  background: var(--green-100);
  color: var(--green-600);
}

.alert-content {
  flex: 1;
}

.alert-title {
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 0.25rem;
}

.alert-message {
  color: var(--text-color-secondary);
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
}

.alert-meta {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.alert-time {
  font-size: 0.8125rem;
  color: var(--text-color-secondary);
}

.alert-actions {
  display: flex;
  gap: 0.25rem;
}

/* Statistiques détaillées */
.detailed-stats {
  background: var(--surface-card);
  border-radius: 8px;
  border: 1px solid var(--surface-border);
}

.channel-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.success-rate {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.success-rate .p-progressbar {
  flex: 1;
  height: 8px;
}

/* Responsive */
@media (max-width: 768px) {
  .notification-monitoring {
    padding: 1rem;
  }

  .monitoring-header {
    flex-direction: column;
    gap: 1rem;
    align-items: stretch;
  }

  .header-actions {
    justify-content: center;
  }

  .metrics-grid {
    grid-template-columns: 1fr;
  }

  .charts-grid {
    grid-template-columns: 1fr;
  }

  .chart-header {
    flex-direction: column;
    gap: 1rem;
    align-items: stretch;
  }

  .alerts-header {
    flex-direction: column;
    gap: 1rem;
    align-items: stretch;
  }

  .alert-item {
    flex-direction: column;
    gap: 0.5rem;
  }

  .alert-meta {
    justify-content: space-between;
  }
}
</style>
