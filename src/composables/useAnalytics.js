/**
 * Composable pour l'analytics et machine learning
 * Interface entre les composants Vue et le service d'analytics
 */

import { ref, computed } from 'vue'
import { analyticsService } from '@/services/analytics-service'
import { matchingEngine } from '@/services/matching-engine'
import { useMonitoring } from '@/utils/monitoring'

export function useAnalytics() {
  const monitoring = useMonitoring()

  // États
  const isLoading = ref(false)
  const insights = ref(null)
  const error = ref(null)

  /**
   * Charge les insights d'analytics
   */
  const loadInsights = async () => {
    isLoading.value = true
    error.value = null

    try {
      console.log('📊 Chargement des insights ML...')

      const analyticsInsights = analyticsService.getAnalyticsInsights()
      const matchingStats = matchingEngine.getStats()

      insights.value = {
        ...analyticsInsights,
        matchingStats,
        loadedAt: new Date().toISOString(),
      }

      console.log('✅ Insights ML chargés:', insights.value)
      return insights.value
    } catch (err) {
      error.value = err
      monitoring.recordError(err, { context: 'analytics-loading' })
      console.error('Erreur chargement insights:', err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Enregistre le résultat d'une mission
   */
  const recordMissionOutcome = async (missionData) => {
    try {
      console.log('📝 Enregistrement résultat mission:', missionData.id)

      // Enrichir les données avec le contexte
      const enrichedData = {
        ...missionData,
        context: {
          timeOfDay: new Date(missionData.createdAt).getHours(),
          dayOfWeek: new Date(missionData.createdAt).getDay(),
          urgencyType: missionData.requestType,
          distance: missionData.distance,
          duration: missionData.duration,
          weather: missionData.weather,
          trafficCondition: missionData.trafficCondition,
        },
        timestamp: Date.now(),
      }

      // Enregistrer via le moteur de matching (qui utilise le service analytics)
      matchingEngine.recordMissionOutcome(enrichedData)

      // Recharger les insights si nécessaire
      if (insights.value) {
        await loadInsights()
      }

      console.log('✅ Mission enregistrée pour apprentissage ML')
    } catch (err) {
      error.value = err
      monitoring.recordError(err, { context: 'mission-recording' })
      console.error('Erreur enregistrement mission:', err)
      throw err
    }
  }

  /**
   * Obtient les poids optimisés actuels
   */
  const getOptimizedWeights = () => {
    return analyticsService.getOptimizedWeights()
  }

  /**
   * Prédit la probabilité de succès d'un match
   */
  const predictSuccessProbability = (matchData) => {
    try {
      return analyticsService.predictSuccessProbability(matchData)
    } catch (err) {
      console.error('Erreur prédiction succès:', err)
      return 0.5 // Probabilité neutre en cas d'erreur
    }
  }

  /**
   * Obtient les recommandations d'optimisation
   */
  const getRecommendations = () => {
    if (!insights.value) return []
    return insights.value.recommendations || []
  }

  /**
   * Obtient les patterns contextuels
   */
  const getContextualPatterns = () => {
    if (!insights.value) return {}
    return insights.value.contextualInsights || {}
  }

  /**
   * Obtient les métriques de performance ML
   */
  const getPerformanceMetrics = () => {
    if (!insights.value) return null
    return insights.value.performanceMetrics || null
  }

  /**
   * Exporte les données d'apprentissage
   */
  const exportLearningData = () => {
    try {
      const data = analyticsService.exportLearningData()

      // Créer un blob pour téléchargement
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      })

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `redlink-ml-data-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      console.log('✅ Données ML exportées')
    } catch (err) {
      error.value = err
      console.error('Erreur export données ML:', err)
      throw err
    }
  }

  /**
   * Importe des données d'apprentissage
   */
  const importLearningData = async (file) => {
    try {
      isLoading.value = true

      const text = await file.text()
      const data = JSON.parse(text)

      const success = analyticsService.importLearningData(data)

      if (success) {
        await loadInsights() // Recharger les insights
        console.log('✅ Données ML importées avec succès')
      } else {
        throw new Error("Échec de l'import des données ML")
      }

      return success
    } catch (err) {
      error.value = err
      console.error('Erreur import données ML:', err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Réinitialise les données d'apprentissage
   */
  const resetLearningData = () => {
    try {
      // Créer une nouvelle instance du service analytics
      const newService = new analyticsService.constructor()

      // Remplacer l'instance globale (attention: ceci est une approche simplifiée)
      Object.assign(analyticsService, newService)

      insights.value = null
      console.log('✅ Données ML réinitialisées')
    } catch (err) {
      error.value = err
      console.error('Erreur réinitialisation ML:', err)
      throw err
    }
  }

  // Propriétés calculées
  const hasInsights = computed(() => insights.value !== null)

  const successRate = computed(() => {
    return insights.value?.successRate || 0
  })

  const totalMissions = computed(() => {
    return insights.value?.totalMissions || 0
  })

  const lastOptimization = computed(() => {
    return insights.value?.lastOptimization || null
  })

  const isMLActive = computed(() => {
    return totalMissions.value >= 50 // ML actif après 50 missions
  })

  const optimizationStatus = computed(() => {
    if (!isMLActive.value) {
      return {
        status: 'learning',
        message: `${totalMissions.value}/50 missions collectées`,
        color: 'orange',
      }
    }

    if (!lastOptimization.value) {
      return {
        status: 'ready',
        message: 'Prêt pour optimisation',
        color: 'blue',
      }
    }

    const daysSinceOptimization = Math.floor(
      (Date.now() - lastOptimization.value) / (1000 * 60 * 60 * 24),
    )

    if (daysSinceOptimization < 7) {
      return {
        status: 'optimized',
        message: `Optimisé il y a ${daysSinceOptimization} jour(s)`,
        color: 'green',
      }
    }

    return {
      status: 'needs_update',
      message: 'Optimisation recommandée',
      color: 'orange',
    }
  })

  const bestPerformingCriteria = computed(() => {
    if (!insights.value?.bestPerformingCriteria) return []

    return Object.entries(insights.value.bestPerformingCriteria)
      .map(([criteria, data]) => ({
        criteria,
        weight: data.weight,
        impact: data.impact,
      }))
      .sort((a, b) => b.impact - a.impact)
  })

  return {
    // États
    isLoading,
    insights,
    error,

    // Propriétés calculées
    hasInsights,
    successRate,
    totalMissions,
    lastOptimization,
    isMLActive,
    optimizationStatus,
    bestPerformingCriteria,

    // Actions
    loadInsights,
    recordMissionOutcome,
    getOptimizedWeights,
    predictSuccessProbability,
    getRecommendations,
    getContextualPatterns,
    getPerformanceMetrics,
    exportLearningData,
    importLearningData,
    resetLearningData,
  }
}
