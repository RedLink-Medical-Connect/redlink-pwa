/**
 * Moteur de matching intelligent pour RedLink
 * Algorithme de scoring multi-critères pour optimiser les mises en relation
 */

import { useMonitoring } from '@/utils/monitoring'
import { analyticsService } from '@/services/analytics-service'

class MatchingEngine {
  constructor(options = {}) {
    this.weights = options.weights || {
      distance: 0.35, // 35% - Proximité géographique
      availability: 0.25, // 25% - Disponibilité immédiate
      compatibility: 0.2, // 20% - Compatibilité sanguine
      reliability: 0.15, // 15% - Historique de fiabilité
      urgency: 0.05, // 5% - Bonus urgence
    }

    this.maxDistance = options.maxDistance || 100 // km
    this.minScore = options.minScore || 30 // Score minimum pour être éligible
    this.maxResults = options.maxResults || 10 // Nombre max de résultats

    this.monitoring = useMonitoring()

    // Cache des calculs de distance pour optimiser les performances
    this.distanceCache = new Map()

    // Intégration avec le service d'analytics ML
    this.analyticsService = analyticsService

    // Règles de compatibilité sanguine par espèce
    this.bloodCompatibility = {
      DOG: {
        'DEA 1.1+': ['DEA 1.1+', 'DEA 1.1-'], // Donneur universel
        'DEA 1.1-': ['DEA 1.1-'], // Receveur universel pour première transfusion
        'DEA 3+': ['DEA 3+', 'DEA 3-'],
        'DEA 3-': ['DEA 3-'],
        'DEA 4+': ['DEA 4+', 'DEA 4-'],
        'DEA 4-': ['DEA 4-'],
        'DEA 5+': ['DEA 5+', 'DEA 5-'],
        'DEA 5-': ['DEA 5-'],
      },
      CAT: {
        A: ['A', 'AB'], // Type A peut donner à A et AB
        B: ['B', 'AB'], // Type B peut donner à B et AB
        AB: ['AB'], // Type AB ne peut donner qu'à AB
      },
    }
  }

  /**
   * Trouve les meilleurs donneurs pour une demande
   */
  async findMatches(request, availableDonors, options = {}) {
    const startTime = performance.now()

    try {
      // Validation des paramètres
      if (!request || !availableDonors || availableDonors.length === 0) {
        return { matches: [], metadata: { totalCandidates: 0, processingTime: 0 } }
      }

      console.log(`🧠 Démarrage matching pour demande ${request.id}`)
      console.log(`📊 ${availableDonors.length} donneurs candidats`)

      // Utiliser les poids optimisés par ML si disponibles
      const optimizedWeights = this.analyticsService.getOptimizedWeights()
      const currentWeights = { ...this.weights, ...optimizedWeights }

      console.log('🤖 Utilisation des poids ML:', currentWeights)

      // Étape 1: Filtrage de base (compatibilité obligatoire)
      const eligibleDonors = this.filterEligibleDonors(request, availableDonors)
      console.log(`✅ ${eligibleDonors.length} donneurs éligibles après filtrage`)

      if (eligibleDonors.length === 0) {
        return {
          matches: [],
          metadata: {
            totalCandidates: availableDonors.length,
            eligibleCandidates: 0,
            processingTime: performance.now() - startTime,
            reason: 'NO_ELIGIBLE_DONORS',
          },
        }
      }

      // Étape 2: Calcul des scores pour chaque donneur éligible
      const scoredDonors = await Promise.all(
        eligibleDonors.map((donor) => this.scoreDonor(donor, request, currentWeights)),
      )

      // Étape 3: Tri par score décroissant
      const sortedMatches = scoredDonors
        .filter((match) => match.score >= this.minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, options.maxResults || this.maxResults)

      // Étape 4: Enrichissement des résultats avec ML
      const enrichedMatches = sortedMatches.map((match, index) => ({
        ...match,
        rank: index + 1,
        confidence: this.calculateConfidence(match.score),
        estimatedResponseTime: this.estimateResponseTime(match.donor, request),
        successProbability: this.analyticsService.predictSuccessProbability({
          scoreBreakdown: match.breakdown,
          context: this.buildMatchContext(match.donor, request),
        }),
      }))

      const processingTime = performance.now() - startTime

      // Métriques de monitoring
      this.monitoring.recordMetric('Matching.ProcessingTime', processingTime, 'Milliseconds', {
        RequestType: request.requestType,
        CandidatesCount: availableDonors.length,
        MatchesFound: enrichedMatches.length,
        MLOptimized: true,
      })

      console.log(
        `🎯 Matching terminé: ${enrichedMatches.length} matches en ${processingTime.toFixed(2)}ms`,
      )

      return {
        matches: enrichedMatches,
        metadata: {
          totalCandidates: availableDonors.length,
          eligibleCandidates: eligibleDonors.length,
          matchesFound: enrichedMatches.length,
          processingTime,
          algorithm: 'multi-criteria-ml-v1',
          weights: currentWeights,
          mlOptimized: true,
        },
      }
    } catch (error) {
      this.monitoring.recordError(error, {
        context: 'matching-engine',
        requestId: request.id,
      })
      throw error
    }
  }

  /**
   * Filtre les donneurs éligibles (critères obligatoires)
   */
  filterEligibleDonors(request, donors) {
    return donors.filter((donor) => {
      // Vérifier qu'il a des animaux
      if (!donor.animals || donor.animals.length === 0) return false

      // Vérifier la compatibilité d'espèce et de sang
      const compatibleAnimals = donor.animals.filter(
        (animal) =>
          animal.species === request.requiredSpecies &&
          this.isBloodCompatible(
            animal.bloodGroup,
            request.requiredBloodGroup,
            request.requiredSpecies,
          ) &&
          animal.isVaccinated &&
          animal.isEligible &&
          animal.weight >= (request.minWeight || 0),
      )

      if (compatibleAnimals.length === 0) return false

      // Vérifier la distance maximale
      if (donor.location && request.clinic?.location) {
        const distance = this.calculateDistance(donor.location, request.clinic.location)
        if (distance > this.maxDistance) return false
      }

      // Vérifier la disponibilité de base
      if (donor.isAvailable === false) return false

      return true
    })
  }

  /**
   * Calcule le score d'un donneur pour une demande
   */
  async scoreDonor(donor, request, weights = null) {
    const currentWeights = weights || this.weights

    const scores = {
      distance: 0,
      availability: 0,
      compatibility: 0,
      reliability: 0,
      urgency: 0,
    }

    // 1. Score de distance (35%)
    if (donor.location && request.clinic?.location) {
      scores.distance = await this.calculateDistanceScore(donor.location, request.clinic.location)
    } else {
      scores.distance = 50 // Score neutre si pas de géolocalisation
    }

    // 2. Score de disponibilité (25%)
    scores.availability = this.calculateAvailabilityScore(donor, request.requestType)

    // 3. Score de compatibilité (20%)
    scores.compatibility = this.calculateCompatibilityScore(donor.animals, request)

    // 4. Score de fiabilité (15%)
    scores.reliability = this.calculateReliabilityScore(donor.history || {})

    // 5. Bonus urgence (5%)
    scores.urgency = request.requestType === 'EMERGENCY' ? 15 : 0

    // Calcul du score final pondéré avec les poids ML
    const finalScore =
      scores.distance * currentWeights.distance +
      scores.availability * currentWeights.availability +
      scores.compatibility * currentWeights.compatibility +
      scores.reliability * currentWeights.reliability +
      scores.urgency * currentWeights.urgency

    return {
      donor,
      score: Math.round(finalScore * 100) / 100, // Arrondir à 2 décimales
      breakdown: scores,
      compatibleAnimals: donor.animals.filter(
        (animal) =>
          animal.species === request.requiredSpecies &&
          this.isBloodCompatible(
            animal.bloodGroup,
            request.requiredBloodGroup,
            request.requiredSpecies,
          ),
      ),
    }
  }

  /**
   * Calcule le score de distance (0-100) avec temps de trajet réel
   */
  async calculateDistanceScore(donorLocation, clinicLocation) {
    const cacheKey = `${donorLocation.latitude},${donorLocation.longitude}-${clinicLocation.latitude},${clinicLocation.longitude}`

    if (this.distanceCache.has(cacheKey)) {
      const cached = this.distanceCache.get(cacheKey)
      return this.durationToScore(cached.duration, cached.distance)
    }

    try {
      // Utiliser le service de géolocalisation pour un calcul précis
      const { geolocationService } = await import('@/services/geolocation-service')
      const route = await geolocationService.calculateRoute(donorLocation, clinicLocation)

      this.distanceCache.set(cacheKey, {
        distance: route.distance,
        duration: route.duration,
        isEstimated: route.isEstimated || false,
      })

      return this.durationToScore(route.duration, route.distance)
    } catch (error) {
      // Fallback sur calcul de distance simple
      console.warn('Erreur calcul route, fallback sur distance:', error.message)
      const distance = this.calculateDistance(donorLocation, clinicLocation)
      const estimatedDuration = Math.round(distance * 1.5) // 40km/h moyenne

      this.distanceCache.set(cacheKey, {
        distance,
        duration: estimatedDuration,
        isEstimated: true,
      })

      return this.durationToScore(estimatedDuration, distance)
    }
  }

  /**
   * Convertit une durée de trajet en score (priorité sur le temps)
   */
  durationToScore(duration, distance) {
    // Score basé principalement sur la durée (plus important que la distance)
    let score = 100

    // Pénalité basée sur la durée
    if (duration <= 10)
      score = 100 // Excellent: ≤10min
    else if (duration <= 20)
      score = 90 // Très bon: ≤20min
    else if (duration <= 30)
      score = 80 // Bon: ≤30min
    else if (duration <= 45)
      score = 70 // Correct: ≤45min
    else if (duration <= 60)
      score = 60 // Acceptable: ≤1h
    else score = Math.max(20, 60 - (duration - 60) * 2) // Dégradation: -2 points/min au-delà d'1h

    // Bonus pour proximité immédiate (même si durée plus longue à cause du trafic)
    if (distance <= 5) score = Math.max(score, 95)
    else if (distance <= 10) score = Math.max(score, 85)

    return Math.min(100, Math.max(0, score))
  }

  /**
   * Convertit une distance en score (méthode de fallback)
   */
  distanceToScore(distance) {
    if (distance <= 5) return 100 // Bonus proximité immédiate
    if (distance <= 10) return 90
    if (distance <= 20) return 80
    if (distance <= 30) return 70
    if (distance <= 50) return 60
    return Math.max(0, 60 - (distance - 50) * 2) // -2 points par km au-delà de 50km
  }

  /**
   * Calcule la distance entre deux points (formule de Haversine)
   */
  calculateDistance(point1, point2) {
    const R = 6371 // Rayon de la Terre en km
    const dLat = this.toRad(point2.latitude - point1.latitude)
    const dLon = this.toRad(point2.longitude - point1.longitude)

    const lat1 = this.toRad(point1.latitude)
    const lat2 = this.toRad(point2.latitude)

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c
  }

  toRad(degrees) {
    return degrees * (Math.PI / 180)
  }

  /**
   * Calcule le score de disponibilité (0-100)
   */
  calculateAvailabilityScore(donor, requestType) {
    if (!donor.isAvailable) return 0

    // Facteurs de disponibilité
    let score = 60 // Score de base pour "disponible"

    // Bonus si en ligne actuellement
    if (donor.isOnline) score += 20

    // Bonus basé sur le temps de réponse historique
    if (donor.averageResponseTime) {
      if (donor.averageResponseTime <= 15)
        score += 20 // Très rapide
      else if (donor.averageResponseTime <= 60)
        score += 10 // Rapide
      else if (donor.averageResponseTime <= 240) score += 5 // Correct
      // Pas de bonus si > 4h
    }

    // Bonus urgence si c'est une urgence
    if (requestType === 'EMERGENCY' && donor.acceptsEmergencies) {
      score += 15
    }

    return Math.min(100, score)
  }

  /**
   * Calcule le score de compatibilité (0-100)
   */
  calculateCompatibilityScore(animals, request) {
    const compatibleAnimals = animals.filter(
      (animal) =>
        animal.species === request.requiredSpecies &&
        this.isBloodCompatible(
          animal.bloodGroup,
          request.requiredBloodGroup,
          request.requiredSpecies,
        ) &&
        animal.isVaccinated &&
        animal.isEligible,
    )

    if (compatibleAnimals.length === 0) return 0

    let score = 70 // Score de base pour compatibilité

    // Bonus pour compatibilité parfaite (même groupe sanguin)
    const perfectMatches = compatibleAnimals.filter(
      (animal) => animal.bloodGroup === request.requiredBloodGroup,
    )
    if (perfectMatches.length > 0) score += 20

    // Bonus pour plusieurs animaux compatibles (flexibilité)
    if (compatibleAnimals.length > 1) score += 10

    // Bonus pour poids optimal
    const optimalWeightAnimals = compatibleAnimals.filter(
      (animal) =>
        animal.weight >= (request.minWeight || 0) && animal.weight <= (request.maxWeight || 100),
    )
    if (optimalWeightAnimals.length > 0) score += 10

    return Math.min(100, score)
  }

  /**
   * Calcule le score de fiabilité (0-100)
   */
  calculateReliabilityScore(history) {
    if (!history.totalMissions || history.totalMissions === 0) {
      return 50 // Score neutre pour nouveaux utilisateurs
    }

    const successRate = ((history.successfulMissions || 0) / history.totalMissions) * 100
    const cancellationRate = ((history.cancelledMissions || 0) / history.totalMissions) * 100

    let score = successRate // Base sur le taux de succès

    // Malus pour taux d'annulation élevé
    if (cancellationRate > 20) score -= 30
    else if (cancellationRate > 10) score -= 15
    else if (cancellationRate > 5) score -= 5

    // Bonus pour expérience
    if (history.totalMissions >= 10) score += 10
    if (history.totalMissions >= 50) score += 10

    // Bonus pour ponctualité
    if (history.averageDelayMinutes <= 5) score += 10
    else if (history.averageDelayMinutes <= 15) score += 5

    return Math.max(0, Math.min(100, score))
  }

  /**
   * Vérifie la compatibilité sanguine
   */
  isBloodCompatible(donorBloodGroup, requiredBloodGroup, species) {
    const compatibility = this.bloodCompatibility[species]
    if (!compatibility) return false

    const compatibleGroups = compatibility[donorBloodGroup]
    return compatibleGroups && compatibleGroups.includes(requiredBloodGroup)
  }

  /**
   * Calcule le niveau de confiance du match (0-100)
   */
  calculateConfidence(score) {
    if (score >= 90) return 95
    if (score >= 80) return 85
    if (score >= 70) return 75
    if (score >= 60) return 65
    if (score >= 50) return 55
    return 45
  }

  /**
   * Estime le temps de réponse du donneur
   */
  estimateResponseTime(donor, request) {
    let baseTime = donor.averageResponseTime || 60 // 1h par défaut

    // Ajustement selon l'urgence
    if (request.requestType === 'EMERGENCY') {
      baseTime *= 0.5 // Réponse plus rapide en urgence
    }

    // Ajustement selon la disponibilité
    if (donor.isOnline) {
      baseTime *= 0.3 // Beaucoup plus rapide si en ligne
    }

    return Math.max(5, Math.round(baseTime)) // Minimum 5 minutes
  }

  /**
   * Nettoie le cache de distance
   */
  clearDistanceCache() {
    this.distanceCache.clear()
  }

  /**
   * Construit le contexte pour l'analyse ML
   */
  buildMatchContext(donor, request) {
    return {
      timeOfDay: new Date().getHours(),
      dayOfWeek: new Date().getDay(),
      urgencyType: request.requestType,
      distance:
        donor.location && request.clinic?.location
          ? this.calculateDistance(donor.location, request.clinic.location)
          : null,
      duration: null, // Sera calculé par le service de géolocalisation
      weather: null, // Peut être ajouté plus tard
      trafficCondition: null, // Peut être ajouté plus tard
    }
  }

  /**
   * Enregistre le résultat d'une mission pour l'apprentissage ML
   */
  recordMissionOutcome(missionData) {
    try {
      this.analyticsService.recordMissionOutcome(missionData)
      console.log(
        `📊 Résultat de mission enregistré pour ML: ${missionData.success ? 'Succès' : 'Échec'}`,
      )
    } catch (error) {
      console.error('Erreur enregistrement mission ML:', error)
      this.monitoring.recordError(error, { context: 'ml-recording' })
    }
  }

  /**
   * Obtient les insights d'analyse ML
   */
  getAnalyticsInsights() {
    return this.analyticsService.getAnalyticsInsights()
  }

  /**
   * Obtient les statistiques du moteur
   */
  getStats() {
    const baseStats = {
      distanceCacheSize: this.distanceCache.size,
      weights: this.weights,
      maxDistance: this.maxDistance,
      minScore: this.minScore,
      maxResults: this.maxResults,
    }

    // Ajouter les statistiques ML
    const mlInsights = this.analyticsService.getAnalyticsInsights()

    return {
      ...baseStats,
      mlStats: {
        totalMissions: mlInsights.totalMissions,
        successRate: mlInsights.successRate,
        lastOptimization: mlInsights.lastOptimization,
        optimizedWeights: this.analyticsService.getOptimizedWeights(),
      },
    }
  }
}

// Instance globale
const matchingEngine = new MatchingEngine()

export { matchingEngine }
export default MatchingEngine
