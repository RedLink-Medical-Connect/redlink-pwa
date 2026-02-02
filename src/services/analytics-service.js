/**
 * Service d'analytics et machine learning pour l'optimisation du matching
 * Analyse les patterns de succès et ajuste automatiquement les poids de l'algorithme
 */

import { useMonitoring } from '@/utils/monitoring'

class AnalyticsService {
  constructor(options = {}) {
    this.monitoring = useMonitoring()

    // Configuration
    this.learningRate = options.learningRate || 0.1
    this.minSampleSize = options.minSampleSize || 50
    this.maxHistorySize = options.maxHistorySize || 1000
    this.confidenceThreshold = options.confidenceThreshold || 0.7

    // Données d'apprentissage
    this.missionHistory = []
    this.successPatterns = new Map()
    this.failurePatterns = new Map()

    // Poids optimisés par ML
    this.learnedWeights = {
      distance: 0.35,
      availability: 0.25,
      compatibility: 0.2,
      reliability: 0.15,
      urgency: 0.05,
    }

    // Métriques de performance
    this.performanceMetrics = {
      totalPredictions: 0,
      correctPredictions: 0,
      accuracy: 0,
      lastUpdate: null,
    }

    // Patterns contextuels
    this.contextualPatterns = {
      timeOfDay: new Map(), // Patterns par heure
      dayOfWeek: new Map(), // Patterns par jour
      urgencyType: new Map(), // Patterns par type d'urgence
      geographic: new Map(), // Patterns géographiques
      seasonal: new Map(), // Patterns saisonniers
    }
  }

  /**
   * Enregistre le résultat d'une mission pour l'apprentissage
   */
  recordMissionOutcome(missionData) {
    try {
      // Validation des données d'entrée
      if (!missionData || typeof missionData !== 'object') {
        console.warn('⚠️ Données de mission invalides, ignorées')
        return
      }

      if (!missionData.id || !missionData.scoreBreakdown) {
        console.warn('⚠️ Données de mission incomplètes, ignorées')
        return
      }

      const outcome = {
        id: missionData.id,
        matchScore: missionData.matchScore || 0,
        scoreBreakdown: missionData.scoreBreakdown || {},
        success: Boolean(missionData.success),
        responseTime: missionData.responseTime || 0,
        completionTime: missionData.completionTime || 0,
        cancellationReason: missionData.cancellationReason,
        context: {
          timeOfDay: missionData.createdAt
            ? new Date(missionData.createdAt).getHours()
            : new Date().getHours(),
          dayOfWeek: missionData.createdAt
            ? new Date(missionData.createdAt).getDay()
            : new Date().getDay(),
          urgencyType: missionData.requestType || 'UNKNOWN',
          distance: missionData.distance || null,
          duration: missionData.duration || null,
          weather: missionData.weather || null,
          trafficCondition: missionData.trafficCondition || null,
        },
        timestamp: Date.now(),
      }

      // Ajouter à l'historique
      this.missionHistory.push(outcome)

      // Limiter la taille de l'historique
      if (this.missionHistory.length > this.maxHistorySize) {
        this.missionHistory.shift()
      }

      // Analyser les patterns
      this.analyzePatterns(outcome)

      // Déclencher l'apprentissage si assez de données
      if (this.missionHistory.length >= this.minSampleSize) {
        this.updateWeights()
      }

      // Enregistrer les métriques
      this.monitoring.recordMetric('Analytics.MissionRecorded', 1, 'Count', {
        Success: outcome.success,
        UrgencyType: outcome.context.urgencyType,
      })

      console.log(
        `📊 Mission enregistrée pour apprentissage: ${outcome.success ? 'Succès' : 'Échec'}`,
      )
    } catch (error) {
      console.error("❌ Erreur lors de l'enregistrement de mission:", error)
      this.monitoring.recordError(error, { context: 'mission-recording' })
    }
  }

  /**
   * Analyse les patterns de succès/échec
   */
  analyzePatterns(outcome) {
    const patternKey = this.generatePatternKey(outcome)

    if (outcome.success) {
      this.updatePatternMap(this.successPatterns, patternKey, outcome)
    } else {
      this.updatePatternMap(this.failurePatterns, patternKey, outcome)
    }

    // Analyser les patterns contextuels
    this.analyzeContextualPatterns(outcome)
  }

  /**
   * Génère une clé de pattern basée sur les caractéristiques de la mission
   */
  generatePatternKey(outcome) {
    const scoreRanges = {
      distance: this.getScoreRange(outcome.scoreBreakdown.distance),
      availability: this.getScoreRange(outcome.scoreBreakdown.availability),
      compatibility: this.getScoreRange(outcome.scoreBreakdown.compatibility),
      reliability: this.getScoreRange(outcome.scoreBreakdown.reliability),
    }

    return `${scoreRanges.distance}_${scoreRanges.availability}_${scoreRanges.compatibility}_${scoreRanges.reliability}_${outcome.context.urgencyType}`
  }

  getScoreRange(score) {
    if (score >= 80) return 'high'
    if (score >= 60) return 'medium'
    if (score >= 40) return 'low'
    return 'very_low'
  }

  /**
   * Met à jour une map de patterns
   */
  updatePatternMap(patternMap, key, outcome) {
    if (!patternMap.has(key)) {
      patternMap.set(key, {
        count: 0,
        totalResponseTime: 0,
        totalCompletionTime: 0,
        avgScore: 0,
        contexts: [],
      })
    }

    const pattern = patternMap.get(key)
    pattern.count++
    pattern.totalResponseTime += outcome.responseTime || 0
    pattern.totalCompletionTime += outcome.completionTime || 0
    pattern.avgScore = (pattern.avgScore * (pattern.count - 1) + outcome.matchScore) / pattern.count
    pattern.contexts.push(outcome.context)

    // Limiter le nombre de contextes stockés
    if (pattern.contexts.length > 100) {
      pattern.contexts.shift()
    }
  }

  /**
   * Analyse les patterns contextuels (heure, jour, etc.)
   */
  analyzeContextualPatterns(outcome) {
    const context = outcome.context

    // Pattern par heure
    this.updateContextualPattern('timeOfDay', context.timeOfDay, outcome)

    // Pattern par jour de la semaine
    this.updateContextualPattern('dayOfWeek', context.dayOfWeek, outcome)

    // Pattern par type d'urgence
    this.updateContextualPattern('urgencyType', context.urgencyType, outcome)

    // Pattern géographique (par tranche de distance)
    const distanceRange = this.getDistanceRange(context.distance)
    this.updateContextualPattern('geographic', distanceRange, outcome)
  }

  updateContextualPattern(type, key, outcome) {
    const patternMap = this.contextualPatterns[type]

    if (!patternMap.has(key)) {
      patternMap.set(key, {
        successes: 0,
        failures: 0,
        totalScore: 0,
        count: 0,
      })
    }

    const pattern = patternMap.get(key)
    pattern.count++
    pattern.totalScore += outcome.matchScore

    if (outcome.success) {
      pattern.successes++
    } else {
      pattern.failures++
    }
  }

  getDistanceRange(distance) {
    if (distance <= 10) return 'very_close'
    if (distance <= 25) return 'close'
    if (distance <= 50) return 'medium'
    if (distance <= 100) return 'far'
    return 'very_far'
  }

  /**
   * Met à jour les poids de l'algorithme par apprentissage automatique
   */
  updateWeights() {
    try {
      console.log("🤖 Démarrage de l'optimisation des poids par ML...")

      // Calculer l'importance de chaque critère basée sur les succès
      const criteriaImportance = this.calculateCriteriaImportance()

      // Appliquer l'apprentissage graduel
      const newWeights = this.applyGradientDescent(criteriaImportance)

      // Valider les nouveaux poids
      if (this.validateWeights(newWeights)) {
        const oldWeights = { ...this.learnedWeights }
        this.learnedWeights = newWeights

        // Calculer l'amélioration
        const improvement = this.calculateImprovement(oldWeights, newWeights)

        this.performanceMetrics.lastUpdate = Date.now()

        console.log('✅ Poids optimisés par ML:', newWeights)
        console.log('📈 Amélioration estimée:', improvement.toFixed(2) + '%')

        // Enregistrer les métriques
        this.monitoring.recordMetric('Analytics.WeightsUpdated', 1, 'Count', {
          Improvement: improvement,
        })
      } else {
        console.warn('⚠️ Nouveaux poids rejetés (validation échouée)')
      }
    } catch (error) {
      console.error("❌ Erreur lors de l'optimisation ML:", error)
      this.monitoring.recordError(error, { context: 'ml-optimization' })
    }
  }

  /**
   * Calcule l'importance de chaque critère basée sur les données historiques
   */
  calculateCriteriaImportance() {
    const importance = {
      distance: 0,
      availability: 0,
      compatibility: 0,
      reliability: 0,
      urgency: 0,
    }

    // Analyser les corrélations entre scores et succès
    const successfulMissions = this.missionHistory.filter((m) => m.success)
    const failedMissions = this.missionHistory.filter((m) => !m.success)

    if (successfulMissions.length === 0 || failedMissions.length === 0) {
      return importance // Pas assez de données variées
    }

    // Calculer les moyennes de scores pour succès vs échecs
    const successAvg = this.calculateAverageScores(successfulMissions)
    const failureAvg = this.calculateAverageScores(failedMissions)

    // Calculer l'importance basée sur la différence
    Object.keys(importance).forEach((criteria) => {
      const difference = Math.abs(successAvg[criteria] - failureAvg[criteria])
      importance[criteria] = difference / 100 // Normaliser sur 0-1
    })

    return importance
  }

  calculateAverageScores(missions) {
    const totals = {
      distance: 0,
      availability: 0,
      compatibility: 0,
      reliability: 0,
      urgency: 0,
    }

    missions.forEach((mission) => {
      Object.keys(totals).forEach((criteria) => {
        totals[criteria] += mission.scoreBreakdown[criteria] || 0
      })
    })

    Object.keys(totals).forEach((criteria) => {
      totals[criteria] /= missions.length
    })

    return totals
  }

  /**
   * Applique la descente de gradient pour optimiser les poids
   */
  applyGradientDescent(importance) {
    const currentWeights = { ...this.learnedWeights }
    const newWeights = { ...currentWeights }

    // Calculer les ajustements basés sur l'importance
    const totalImportance = Object.values(importance).reduce((sum, val) => sum + val, 0)

    if (totalImportance === 0) {
      return currentWeights // Pas d'ajustement nécessaire
    }

    // Normaliser l'importance et ajuster les poids
    Object.keys(importance).forEach((criteria) => {
      const normalizedImportance = importance[criteria] / totalImportance
      const targetWeight = normalizedImportance * 0.8 // 80% du poids total disponible

      // Appliquer l'apprentissage graduel
      const adjustment = (targetWeight - currentWeights[criteria]) * this.learningRate
      newWeights[criteria] = Math.max(0.05, Math.min(0.6, currentWeights[criteria] + adjustment))
    })

    // Normaliser pour que la somme soit 1
    const totalWeight = Object.values(newWeights).reduce((sum, val) => sum + val, 0)
    Object.keys(newWeights).forEach((criteria) => {
      newWeights[criteria] /= totalWeight
    })

    return newWeights
  }

  /**
   * Valide que les nouveaux poids sont raisonnables
   */
  validateWeights(weights) {
    // Vérifier que tous les poids sont positifs
    const allPositive = Object.values(weights).every((w) => w > 0)

    // Vérifier que la somme est proche de 1
    const sum = Object.values(weights).reduce((s, w) => s + w, 0)
    const sumValid = Math.abs(sum - 1) < 0.01

    // Vérifier qu'aucun poids n'est trop dominant (>60%)
    const maxWeight = Math.max(...Object.values(weights))
    const balanceValid = maxWeight < 0.6

    // Vérifier qu'aucun poids n'est trop faible (<5%)
    const minWeight = Math.min(...Object.values(weights))
    const minValid = minWeight >= 0.05

    return allPositive && sumValid && balanceValid && minValid
  }

  /**
   * Calcule l'amélioration estimée des nouveaux poids
   */
  calculateImprovement(oldWeights, newWeights) {
    // Simuler l'amélioration basée sur les données historiques
    let oldScore = 0
    let newScore = 0

    this.missionHistory.forEach((mission) => {
      const breakdown = mission.scoreBreakdown

      const oldWeightedScore =
        breakdown.distance * oldWeights.distance +
        breakdown.availability * oldWeights.availability +
        breakdown.compatibility * oldWeights.compatibility +
        breakdown.reliability * oldWeights.reliability +
        breakdown.urgency * oldWeights.urgency

      const newWeightedScore =
        breakdown.distance * newWeights.distance +
        breakdown.availability * newWeights.availability +
        breakdown.compatibility * newWeights.compatibility +
        breakdown.reliability * newWeights.reliability +
        breakdown.urgency * newWeights.urgency

      // Pondérer par le succès réel
      if (mission.success) {
        oldScore += oldWeightedScore
        newScore += newWeightedScore
      } else {
        oldScore -= oldWeightedScore * 0.5 // Pénalité pour échec
        newScore -= newWeightedScore * 0.5
      }
    })

    return ((newScore - oldScore) / Math.abs(oldScore)) * 100
  }

  /**
   * Prédit la probabilité de succès d'un match
   */
  predictSuccessProbability(matchData) {
    try {
      // Validation des données d'entrée
      if (!matchData || typeof matchData !== 'object') {
        console.warn('⚠️ Données de match invalides pour prédiction')
        return 0.5
      }

      if (!matchData.scoreBreakdown || !matchData.context) {
        console.warn('⚠️ Données de match incomplètes pour prédiction')
        return 0.5
      }

      const patternKey = this.generatePatternKey({
        scoreBreakdown: matchData.scoreBreakdown,
        context: matchData.context,
      })

      // Chercher des patterns similaires
      const successPattern = this.successPatterns.get(patternKey)
      const failurePattern = this.failurePatterns.get(patternKey)

      if (!successPattern && !failurePattern) {
        return 0.5 // Probabilité neutre si pas de données
      }

      const successCount = successPattern?.count || 0
      const failureCount = failurePattern?.count || 0
      const totalCount = successCount + failureCount

      if (totalCount < 5) {
        return 0.5 // Pas assez de données pour une prédiction fiable
      }

      const probability = successCount / totalCount

      // Ajuster selon les patterns contextuels
      const contextualAdjustment = this.getContextualAdjustment(matchData.context)
      const adjustedProbability = Math.max(0.1, Math.min(0.9, probability + contextualAdjustment))

      // Mettre à jour les métriques de prédiction
      this.performanceMetrics.totalPredictions++

      return adjustedProbability
    } catch (error) {
      console.error('❌ Erreur lors de la prédiction:', error)
      this.monitoring.recordError(error, { context: 'prediction' })
      return 0.5 // Probabilité neutre en cas d'erreur
    }
  }

  /**
   * Calcule l'ajustement contextuel de la probabilité
   */
  getContextualAdjustment(context) {
    let adjustment = 0

    // Ajustement par heure
    const timePattern = this.contextualPatterns.timeOfDay.get(context.timeOfDay)
    if (timePattern && timePattern.count > 10) {
      const timeSuccessRate = timePattern.successes / timePattern.count
      adjustment += (timeSuccessRate - 0.5) * 0.1
    }

    // Ajustement par jour de la semaine
    const dayPattern = this.contextualPatterns.dayOfWeek.get(context.dayOfWeek)
    if (dayPattern && dayPattern.count > 10) {
      const daySuccessRate = dayPattern.successes / dayPattern.count
      adjustment += (daySuccessRate - 0.5) * 0.1
    }

    // Ajustement par type d'urgence
    const urgencyPattern = this.contextualPatterns.urgencyType.get(context.urgencyType)
    if (urgencyPattern && urgencyPattern.count > 10) {
      const urgencySuccessRate = urgencyPattern.successes / urgencyPattern.count
      adjustment += (urgencySuccessRate - 0.5) * 0.15
    }

    return Math.max(-0.2, Math.min(0.2, adjustment))
  }

  /**
   * Obtient les poids optimisés actuels
   */
  getOptimizedWeights() {
    return { ...this.learnedWeights }
  }

  /**
   * Obtient les insights d'analyse
   */
  getAnalyticsInsights() {
    const insights = {
      totalMissions: this.missionHistory.length,
      successRate: this.calculateOverallSuccessRate(),
      bestPerformingCriteria: this.getBestPerformingCriteria(),
      contextualInsights: this.getContextualInsights(),
      recommendations: this.generateRecommendations(),
      performanceMetrics: this.performanceMetrics,
      lastOptimization: this.performanceMetrics.lastUpdate,
    }

    return insights
  }

  calculateOverallSuccessRate() {
    if (this.missionHistory.length === 0) return 0
    const successes = this.missionHistory.filter((m) => m.success).length
    return (successes / this.missionHistory.length) * 100
  }

  getBestPerformingCriteria() {
    const criteriaPerformance = {}

    Object.keys(this.learnedWeights).forEach((criteria) => {
      criteriaPerformance[criteria] = {
        weight: this.learnedWeights[criteria],
        impact: this.calculateCriteriaImpact(criteria),
      }
    })

    return criteriaPerformance
  }

  calculateCriteriaImpact(criteria) {
    const successfulMissions = this.missionHistory.filter((m) => m.success)
    const failedMissions = this.missionHistory.filter((m) => !m.success)

    if (successfulMissions.length === 0 || failedMissions.length === 0) return 0

    const successAvg =
      successfulMissions.reduce((sum, m) => sum + (m.scoreBreakdown[criteria] || 0), 0) /
      successfulMissions.length
    const failureAvg =
      failedMissions.reduce((sum, m) => sum + (m.scoreBreakdown[criteria] || 0), 0) /
      failedMissions.length

    return Math.abs(successAvg - failureAvg)
  }

  getContextualInsights() {
    const insights = {}

    Object.entries(this.contextualPatterns).forEach(([type, patternMap]) => {
      insights[type] = {}

      patternMap.forEach((pattern, key) => {
        if (pattern.count > 5) {
          insights[type][key] = {
            successRate: (pattern.successes / pattern.count) * 100,
            avgScore: pattern.totalScore / pattern.count,
            sampleSize: pattern.count,
          }
        }
      })
    })

    return insights
  }

  generateRecommendations() {
    const recommendations = []

    // Recommandations basées sur les patterns temporels
    const timeInsights = this.getContextualInsights().timeOfDay
    if (timeInsights) {
      const bestHours = Object.entries(timeInsights)
        .filter(([, data]) => data.successRate > 80 && data.sampleSize > 10)
        .map(([hourStr]) => parseInt(hourStr))

      if (bestHours.length > 0) {
        recommendations.push({
          type: 'temporal',
          message: `Meilleur taux de succès entre ${Math.min(...bestHours)}h et ${Math.max(...bestHours)}h`,
          impact: 'high',
        })
      }
    }

    // Recommandations basées sur la géographie
    const geoInsights = this.getContextualInsights().geographic
    if (geoInsights) {
      const bestDistances = Object.entries(geoInsights)
        .filter(([, data]) => data.successRate > 85)
        .map(([rangeStr]) => rangeStr)

      if (bestDistances.length > 0) {
        recommendations.push({
          type: 'geographic',
          message: `Optimiser pour les distances: ${bestDistances.join(', ')}`,
          impact: 'medium',
        })
      }
    }

    return recommendations
  }

  /**
   * Exporte les données d'apprentissage
   */
  exportLearningData() {
    return {
      missionHistory: this.missionHistory,
      learnedWeights: this.learnedWeights,
      successPatterns: Object.fromEntries(this.successPatterns),
      failurePatterns: Object.fromEntries(this.failurePatterns),
      contextualPatterns: Object.fromEntries(
        Object.entries(this.contextualPatterns).map(([key, map]) => [key, Object.fromEntries(map)]),
      ),
      performanceMetrics: this.performanceMetrics,
      exportDate: new Date().toISOString(),
    }
  }

  /**
   * Importe des données d'apprentissage
   */
  importLearningData(data) {
    try {
      this.missionHistory = data.missionHistory || []
      this.learnedWeights = data.learnedWeights || this.learnedWeights

      // Reconstituer les Maps
      this.successPatterns = new Map(Object.entries(data.successPatterns || {}))
      this.failurePatterns = new Map(Object.entries(data.failurePatterns || {}))

      Object.entries(data.contextualPatterns || {}).forEach(([key, obj]) => {
        this.contextualPatterns[key] = new Map(Object.entries(obj))
      })

      this.performanceMetrics = data.performanceMetrics || this.performanceMetrics

      console.log("✅ Données d'apprentissage importées avec succès")
      return true
    } catch (error) {
      console.error("❌ Erreur lors de l'import des données:", error)
      return false
    }
  }
}

// Instance globale
const analyticsService = new AnalyticsService()

export { analyticsService }
export default AnalyticsService
