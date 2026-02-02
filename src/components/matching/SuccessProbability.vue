<template>
  <div class="success-probability">
    <div class="probability-header">
      <i class="pi pi-chart-pie probability-icon"></i>
      <span class="probability-label">Probabilité de succès</span>
    </div>

    <div class="probability-content">
      <div class="probability-circle" :class="probabilityClass">
        <div class="probability-value">{{ Math.round(probability * 100) }}%</div>
        <div class="probability-ring">
          <svg viewBox="0 0 36 36" class="circular-chart">
            <path
              class="circle-bg"
              d="M18 2.0845
                a 15.9155 15.9155 0 0 1 0 31.831
                a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
              class="circle"
              :stroke-dasharray="`${probability * 100}, 100`"
              d="M18 2.0845
                a 15.9155 15.9155 0 0 1 0 31.831
                a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
        </div>
      </div>

      <div v-if="showDetails" class="probability-details">
        <div class="detail-item">
          <span class="detail-label">Confiance:</span>
          <Tag :value="confidenceLabel" :severity="confidenceSeverity" class="confidence-tag" />
        </div>

        <div v-if="factors && factors.length > 0" class="detail-item">
          <span class="detail-label">Facteurs clés:</span>
          <div class="factors-list">
            <Tag
              v-for="factor in factors.slice(0, 3)"
              :key="factor.name"
              :value="factor.label"
              :severity="factor.severity"
              class="factor-tag"
            />
          </div>
        </div>

        <div v-if="recommendation" class="detail-item">
          <span class="detail-label">Recommandation:</span>
          <div class="recommendation-text">
            {{ recommendation }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import Tag from 'primevue/tag'

const props = defineProps({
  probability: {
    type: Number,
    required: true,
    validator: (value) => value >= 0 && value <= 1,
  },
  matchData: {
    type: Object,
    default: () => ({}),
  },
  showDetails: {
    type: Boolean,
    default: true,
  },
})

// Propriétés calculées
const probabilityClass = computed(() => {
  if (props.probability >= 0.8) return 'high-probability'
  if (props.probability >= 0.6) return 'medium-probability'
  if (props.probability >= 0.4) return 'low-probability'
  return 'very-low-probability'
})

const confidenceLabel = computed(() => {
  if (props.probability >= 0.8) return 'Très élevée'
  if (props.probability >= 0.6) return 'Élevée'
  if (props.probability >= 0.4) return 'Moyenne'
  return 'Faible'
})

const confidenceSeverity = computed(() => {
  if (props.probability >= 0.8) return 'success'
  if (props.probability >= 0.6) return 'info'
  if (props.probability >= 0.4) return 'warning'
  return 'danger'
})

const factors = computed(() => {
  if (!props.matchData.breakdown) return []

  const breakdown = props.matchData.breakdown
  const factorsList = []

  // Analyser les scores pour identifier les facteurs positifs/négatifs
  Object.entries(breakdown).forEach(([key, score]) => {
    if (key === 'urgency' && score === 0) return // Ignorer urgence si pas applicable

    let severity = 'info'
    let label = ''

    if (score >= 80) {
      severity = 'success'
      label = `${getCriteriaLabel(key)} excellente`
    } else if (score >= 60) {
      severity = 'info'
      label = `${getCriteriaLabel(key)} bonne`
    } else if (score >= 40) {
      severity = 'warning'
      label = `${getCriteriaLabel(key)} moyenne`
    } else {
      severity = 'danger'
      label = `${getCriteriaLabel(key)} faible`
    }

    factorsList.push({
      name: key,
      score,
      label,
      severity,
    })
  })

  // Trier par score décroissant
  return factorsList.sort((a, b) => b.score - a.score)
})

const recommendation = computed(() => {
  if (props.probability >= 0.8) {
    return 'Match excellent, procédez avec confiance'
  }

  if (props.probability >= 0.6) {
    return 'Bon match, vérifiez la disponibilité'
  }

  if (props.probability >= 0.4) {
    return 'Match acceptable, préparez un plan B'
  }

  return "Match risqué, cherchez d'autres options"
})

// Méthodes
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
</script>

<style scoped>
.success-probability {
  background: var(--surface-card);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  padding: 1rem;
}

.probability-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.probability-icon {
  color: var(--primary-color);
}

.probability-label {
  font-weight: 600;
  color: var(--text-color);
}

.probability-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

/* Cercle de probabilité */
.probability-circle {
  position: relative;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.probability-value {
  font-size: 1.25rem;
  font-weight: 700;
  z-index: 2;
  position: relative;
}

.probability-ring {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.circular-chart {
  display: block;
  margin: 0 auto;
  max-width: 100%;
  max-height: 100%;
}

.circle-bg {
  fill: none;
  stroke: var(--surface-200);
  stroke-width: 2.8;
}

.circle {
  fill: none;
  stroke-width: 2.8;
  stroke-linecap: round;
  animation: progress 1s ease-in-out forwards;
}

/* Couleurs selon la probabilité */
.high-probability .probability-value {
  color: var(--green-500);
}

.high-probability .circle {
  stroke: var(--green-500);
}

.medium-probability .probability-value {
  color: var(--blue-500);
}

.medium-probability .circle {
  stroke: var(--blue-500);
}

.low-probability .probability-value {
  color: var(--orange-500);
}

.low-probability .circle {
  stroke: var(--orange-500);
}

.very-low-probability .probability-value {
  color: var(--red-500);
}

.very-low-probability .circle {
  stroke: var(--red-500);
}

/* Détails */
.probability-details {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.detail-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-color-secondary);
}

.confidence-tag {
  align-self: flex-start;
}

.factors-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.factor-tag {
  font-size: 0.75rem;
}

.recommendation-text {
  font-size: 0.875rem;
  color: var(--text-color);
  font-style: italic;
  padding: 0.5rem;
  background-color: var(--surface-50);
  border-radius: 6px;
  border-left: 3px solid var(--primary-color);
}

/* Animation */
@keyframes progress {
  0% {
    stroke-dasharray: 0 100;
  }
}

/* Responsive */
@media (max-width: 768px) {
  .success-probability {
    padding: 0.75rem;
  }

  .probability-circle {
    width: 60px;
    height: 60px;
  }

  .probability-value {
    font-size: 1rem;
  }

  .factors-list {
    justify-content: center;
  }
}
</style>
