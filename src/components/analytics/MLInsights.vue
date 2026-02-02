<template>
  <div class="ml-insights">
    <div class="insights-header">
      <h3 class="insights-title">
        <i class="pi pi-chart-line"></i>
        Insights Machine Learning
      </h3>
      <div class="insights-actions">
        <Button
          icon="pi pi-refresh"
          label="Actualiser"
          :loading="isLoading"
          size="small"
          outlined
          @click="refreshInsights"
        />
        <Button icon="pi pi-download" label="Exporter" size="small" outlined @click="exportData" />
      </div>
    </div>

    <div v-if="error" class="error-message">
      <Message severity="error" :closable="false">
        {{ error.message }}
      </Message>
    </div>

    <div v-else-if="!hasInsights && !isLoading" class="no-data">
      <Message severity="info" :closable="false">
        Pas encore assez de données pour l'analyse ML.
        {{ totalMissions }}/50 missions collectées.
      </Message>
    </div>

    <div v-else-if="hasInsights" class="insights-content">
      <!-- Statut d'optimisation -->
      <Card class="optimization-status">
        <template #title>
          <div class="status-header">
            <i class="pi pi-cog"></i>
            Statut d'Optimisation
          </div>
        </template>
        <template #content>
          <div class="status-content">
            <Tag
              :value="optimizationStatus.message"
              :severity="getStatusSeverity(optimizationStatus.color)"
              class="status-tag"
            />
            <div class="status-details">
              <div class="metric">
                <span class="metric-label">Missions analysées:</span>
                <span class="metric-value">{{ totalMissions }}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Taux de succès:</span>
                <span class="metric-value">{{ successRate.toFixed(1) }}%</span>
              </div>
              <div v-if="lastOptimization" class="metric">
                <span class="metric-label">Dernière optimisation:</span>
                <span class="metric-value">{{ formatDate(lastOptimization) }}</span>
              </div>
            </div>
          </div>
        </template>
      </Card>

      <!-- Performance des critères -->
      <Card class="criteria-performance">
        <template #title>
          <div class="criteria-header">
            <i class="pi pi-chart-bar"></i>
            Performance des Critères
          </div>
        </template>
        <template #content>
          <div class="criteria-list">
            <div
              v-for="criteria in bestPerformingCriteria"
              :key="criteria.criteria"
              class="criteria-item"
            >
              <div class="criteria-info">
                <span class="criteria-name">{{ getCriteriaLabel(criteria.criteria) }}</span>
                <div class="criteria-metrics">
                  <span class="weight">Poids: {{ (criteria.weight * 100).toFixed(1) }}%</span>
                  <span class="impact">Impact: {{ criteria.impact.toFixed(1) }}</span>
                </div>
              </div>
              <div class="criteria-bar">
                <div class="criteria-fill" :style="{ width: `${criteria.weight * 100}%` }"></div>
              </div>
            </div>
          </div>
        </template>
      </Card>

      <!-- Patterns contextuels -->
      <Card v-if="contextualPatterns" class="contextual-patterns">
        <template #title>
          <div class="patterns-header">
            <i class="pi pi-clock"></i>
            Patterns Contextuels
          </div>
        </template>
        <template #content>
          <TabView>
            <TabPanel v-if="contextualPatterns.timeOfDay" header="Heures">
              <div class="pattern-grid">
                <div
                  v-for="(pattern, hour) in contextualPatterns.timeOfDay"
                  :key="hour"
                  class="pattern-item"
                >
                  <div class="pattern-label">{{ hour }}h</div>
                  <div class="pattern-success-rate">{{ pattern.successRate.toFixed(1) }}%</div>
                  <div class="pattern-sample">{{ pattern.sampleSize }} missions</div>
                </div>
              </div>
            </TabPanel>

            <TabPanel v-if="contextualPatterns.dayOfWeek" header="Jours">
              <div class="pattern-grid">
                <div
                  v-for="(pattern, day) in contextualPatterns.dayOfWeek"
                  :key="day"
                  class="pattern-item"
                >
                  <div class="pattern-label">{{ getDayLabel(day) }}</div>
                  <div class="pattern-success-rate">{{ pattern.successRate.toFixed(1) }}%</div>
                  <div class="pattern-sample">{{ pattern.sampleSize }} missions</div>
                </div>
              </div>
            </TabPanel>

            <TabPanel v-if="contextualPatterns.geographic" header="Distance">
              <div class="pattern-grid">
                <div
                  v-for="(pattern, range) in contextualPatterns.geographic"
                  :key="range"
                  class="pattern-item"
                >
                  <div class="pattern-label">{{ getDistanceLabel(range) }}</div>
                  <div class="pattern-success-rate">{{ pattern.successRate.toFixed(1) }}%</div>
                  <div class="pattern-sample">{{ pattern.sampleSize }} missions</div>
                </div>
              </div>
            </TabPanel>
          </TabView>
        </template>
      </Card>

      <!-- Recommandations -->
      <Card v-if="recommendations.length > 0" class="recommendations">
        <template #title>
          <div class="recommendations-header">
            <i class="pi pi-lightbulb"></i>
            Recommandations
          </div>
        </template>
        <template #content>
          <div class="recommendations-list">
            <div
              v-for="(recommendation, index) in recommendations"
              :key="index"
              class="recommendation-item"
            >
              <div class="recommendation-content">
                <Tag
                  :value="recommendation.impact"
                  :severity="getImpactSeverity(recommendation.impact)"
                  class="impact-tag"
                />
                <span class="recommendation-message">{{ recommendation.message }}</span>
              </div>
              <i class="pi pi-angle-right recommendation-arrow"></i>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <!-- Skeleton loading -->
    <div v-if="isLoading" class="loading-skeleton">
      <Skeleton height="120px" class="mb-3"></Skeleton>
      <Skeleton height="200px" class="mb-3"></Skeleton>
      <Skeleton height="150px"></Skeleton>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAnalytics } from '@/composables/useAnalytics'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import Skeleton from 'primevue/skeleton'

const {
  isLoading,
  insights,
  error,
  hasInsights,
  successRate,
  totalMissions,
  lastOptimization,
  optimizationStatus,
  bestPerformingCriteria,
  loadInsights,
  getRecommendations,
  getContextualPatterns,
  exportLearningData,
} = useAnalytics()

// Propriétés calculées
const recommendations = computed(() => getRecommendations())
const contextualPatterns = computed(() => getContextualPatterns())

// Méthodes
const refreshInsights = async () => {
  try {
    await loadInsights()
  } catch (err) {
    console.error('Erreur actualisation insights:', err)
  }
}

const exportData = () => {
  try {
    exportLearningData()
  } catch (err) {
    console.error('Erreur export données:', err)
  }
}

const getStatusSeverity = (color) => {
  const severityMap = {
    green: 'success',
    blue: 'info',
    orange: 'warning',
    red: 'danger',
  }
  return severityMap[color] || 'info'
}

const getImpactSeverity = (impact) => {
  const severityMap = {
    high: 'danger',
    medium: 'warning',
    low: 'info',
  }
  return severityMap[impact] || 'info'
}

const getCriteriaLabel = (criteria) => {
  const labels = {
    distance: 'Distance',
    availability: 'Disponibilité',
    compatibility: 'Compatibilité',
    reliability: 'Fiabilité',
    urgency: 'Urgence',
  }
  return labels[criteria] || criteria
}

const getDayLabel = (day) => {
  const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
  return days[parseInt(day)] || day
}

const getDistanceLabel = (range) => {
  const labels = {
    very_close: '< 10km',
    close: '10-25km',
    medium: '25-50km',
    far: '50-100km',
    very_far: '> 100km',
  }
  return labels[range] || range
}

const formatDate = (timestamp) => {
  if (!timestamp) return 'N/A'
  return new Date(timestamp).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Lifecycle
onMounted(() => {
  loadInsights()
})
</script>

<style scoped>
.ml-insights {
  padding: 1rem;
}

.insights-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.insights-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  color: var(--primary-color);
}

.insights-actions {
  display: flex;
  gap: 0.5rem;
}

.insights-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.error-message,
.no-data {
  margin-bottom: 1rem;
}

/* Statut d'optimisation */
.status-header,
.criteria-header,
.patterns-header,
.recommendations-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.status-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.status-tag {
  align-self: flex-start;
}

.status-details {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.metric-label {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.metric-value {
  font-weight: 600;
  color: var(--text-color);
}

/* Performance des critères */
.criteria-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.criteria-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.criteria-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.criteria-name {
  font-weight: 600;
}

.criteria-metrics {
  display: flex;
  gap: 1rem;
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.criteria-bar {
  height: 8px;
  background-color: var(--surface-200);
  border-radius: 4px;
  overflow: hidden;
}

.criteria-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary-color), var(--primary-color-text));
  transition: width 0.3s ease;
}

/* Patterns contextuels */
.pattern-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1rem;
}

.pattern-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem;
  background-color: var(--surface-50);
  border-radius: 8px;
  text-align: center;
}

.pattern-label {
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.pattern-success-rate {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--primary-color);
  margin-bottom: 0.25rem;
}

.pattern-sample {
  font-size: 0.75rem;
  color: var(--text-color-secondary);
}

/* Recommandations */
.recommendations-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.recommendation-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background-color: var(--surface-50);
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.recommendation-item:hover {
  background-color: var(--surface-100);
}

.recommendation-content {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.impact-tag {
  font-size: 0.75rem;
}

.recommendation-message {
  font-weight: 500;
}

.recommendation-arrow {
  color: var(--text-color-secondary);
}

/* Loading skeleton */
.loading-skeleton {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Responsive */
@media (max-width: 768px) {
  .insights-header {
    flex-direction: column;
    gap: 1rem;
    align-items: stretch;
  }

  .insights-actions {
    justify-content: center;
  }

  .status-details {
    flex-direction: column;
    gap: 0.5rem;
  }

  .criteria-info {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .pattern-grid {
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  }
}
</style>
