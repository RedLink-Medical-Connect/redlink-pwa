/**
 * Composable pour le système de matching intelligent
 * Interface entre les composants Vue et le moteur de matching
 */

import { ref, computed } from 'vue'
import { matchingEngine } from '@/services/matching-engine'
import { useCachedGraphQL } from '@/composables/useCachedGraphQL'
import { useMonitoring } from '@/utils/monitoring'
import { useAnalytics } from '@/composables/useAnalytics'

export function useMatching() {
  const { query } = useCachedGraphQL()
  const monitoring = useMonitoring()
  const { recordMissionOutcome, predictSuccessProbability, getOptimizedWeights } = useAnalytics()

  // États
  const isMatching = ref(false)
  const matchResults = ref([])
  const matchMetadata = ref(null)
  const error = ref(null)

  /**
   * Lance le processus de matching pour une demande
   */
  const findMatches = async (request, options = {}) => {
    isMatching.value = true
    error.value = null

    try {
      console.log('🔍 Recherche de matches pour:', request)

      // Récupérer les donneurs disponibles
      const availableDonors = await fetchAvailableDonors(request, options)

      if (availableDonors.length === 0) {
        matchResults.value = []
        matchMetadata.value = {
          totalCandidates: 0,
          eligibleCandidates: 0,
          matchesFound: 0,
          reason: 'NO_DONORS_AVAILABLE',
        }
        return matchResults.value
      }

      // Lancer le matching avec le moteur intelligent
      const result = await matchingEngine.findMatches(request, availableDonors, options)

      matchResults.value = result.matches
      matchMetadata.value = result.metadata

      // Enregistrer les métriques
      monitoring.recordMissionMetrics(
        'matching',
        request.requestType,
        result.metadata.processingTime,
      )

      console.log(`✅ Matching terminé: ${result.matches.length} résultats`)
      return result.matches
    } catch (err) {
      error.value = err
      monitoring.recordError(err, { context: 'matching', requestId: request.id })
      console.error('Erreur lors du matching:', err)
      throw err
    } finally {
      isMatching.value = false
    }
  }

  /**
   * Récupère les donneurs disponibles pour une demande
   */
  const fetchAvailableDonors = async (request, options = {}) => {
    try {
      // Requête pour récupérer les propriétaires avec leurs animaux
      const { data } = await query({
        query: `
          query GetAvailableDonors($species: String!, $bloodGroup: String, $maxDistance: Float) {
            listOwners(
              filter: {
                isAvailable: { eq: true }
                location: { exists: true }
              }
              limit: 100
            ) {
              items {
                id
                name
                email
                phone
                isAvailable
                isOnline
                acceptsEmergencies
                averageResponseTime
                location {
                  latitude
                  longitude
                  address
                }
                history {
                  totalMissions
                  successfulMissions
                  cancelledMissions
                  averageDelayMinutes
                }
                animals {
                  items {
                    id
                    name
                    species
                    bloodGroup
                    weight
                    isVaccinated
                    isEligible
                    lastDonation
                  }
                }
              }
            }
          }
        `,
        variables: {
          species: request.requiredSpecies,
          bloodGroup: request.requiredBloodGroup,
          maxDistance: options.maxDistance || 100,
        },
        authMode: 'userPool',
        useCache: true,
      })

      // Transformer les données pour le moteur de matching
      const donors = data.listOwners.items.map((owner) => ({
        ...owner,
        animals: owner.animals?.items || [],
      }))

      console.log(`📊 ${donors.length} donneurs potentiels récupérés`)
      return donors
    } catch (err) {
      console.error('Erreur récupération donneurs:', err)
      throw err
    }
  }

  /**
   * Obtient les détails d'un match spécifique
   */
  const getMatchDetails = (matchId) => {
    return matchResults.value.find((match) => match.donor.id === matchId)
  }

  /**
   * Filtre les résultats par critères
   */
  const filterMatches = (filters = {}) => {
    let filtered = [...matchResults.value]

    if (filters.minScore) {
      filtered = filtered.filter((match) => match.score >= filters.minScore)
    }

    if (filters.maxDistance) {
      filtered = filtered.filter((match) => {
        const distance = matchingEngine.calculateDistance(
          match.donor.location,
          filters.clinicLocation,
        )
        return distance <= filters.maxDistance
      })
    }

    if (filters.onlineOnly) {
      filtered = filtered.filter((match) => match.donor.isOnline)
    }

    if (filters.emergencyCapable && filters.requestType === 'EMERGENCY') {
      filtered = filtered.filter((match) => match.donor.acceptsEmergencies)
    }

    return filtered
  }

  /**
   * Trie les résultats selon différents critères
   */
  const sortMatches = (sortBy = 'score') => {
    const sorted = [...matchResults.value]

    switch (sortBy) {
      case 'score':
        return sorted.sort((a, b) => b.score - a.score)
      case 'distance':
        return sorted.sort((a, b) => a.breakdown.distance - b.breakdown.distance)
      case 'availability':
        return sorted.sort((a, b) => b.breakdown.availability - a.breakdown.availability)
      case 'reliability':
        return sorted.sort((a, b) => b.breakdown.reliability - a.breakdown.reliability)
      default:
        return sorted
    }
  }

  /**
   * Obtient les statistiques du matching
   */
  const getMatchingStats = () => {
    if (!matchResults.value.length) return null

    const scores = matchResults.value.map((match) => match.score)
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length

    return {
      totalMatches: matchResults.value.length,
      averageScore: Math.round(avgScore * 100) / 100,
      bestScore: Math.max(...scores),
      worstScore: Math.min(...scores),
      highQualityMatches: matchResults.value.filter((match) => match.score >= 80).length,
      onlineDonors: matchResults.value.filter((match) => match.donor.isOnline).length,
      emergencyCapable: matchResults.value.filter((match) => match.donor.acceptsEmergencies).length,
    }
  }

  /**
   * Réinitialise les résultats
   */
  const clearResults = () => {
    matchResults.value = []
    matchMetadata.value = null
    error.value = null
  }

  /**
   * Enregistre le résultat d'une mission pour l'apprentissage ML
   */
  const recordMissionResult = async (missionData) => {
    try {
      await recordMissionOutcome(missionData)
      console.log('✅ Résultat de mission enregistré pour ML')
    } catch (err) {
      console.error('Erreur enregistrement mission ML:', err)
      // Ne pas faire échouer l'opération principale
    }
  }

  /**
   * Obtient la probabilité de succès prédite pour un match
   */
  const getMatchSuccessProbability = (match, request) => {
    try {
      const matchData = {
        scoreBreakdown: match.breakdown,
        context: matchingEngine.buildMatchContext(match.donor, request),
      }
      return predictSuccessProbability(matchData)
    } catch (err) {
      console.error('Erreur prédiction succès:', err)
      return 0.5 // Probabilité neutre
    }
  }

  /**
   * Obtient les poids ML optimisés
   */
  const getMLWeights = () => {
    try {
      return getOptimizedWeights()
    } catch (err) {
      console.error('Erreur récupération poids ML:', err)
      return null
    }
  }

  /**
   * Obtient les insights du moteur de matching
   */
  const getMatchingInsights = () => {
    try {
      return matchingEngine.getAnalyticsInsights()
    } catch (err) {
      console.error('Erreur récupération insights:', err)
      return null
    }
  }

  // Propriétés calculées
  const hasResults = computed(() => matchResults.value.length > 0)
  const bestMatch = computed(() => matchResults.value[0] || null)
  const highQualityMatches = computed(() => matchResults.value.filter((match) => match.score >= 80))
  const mlOptimizedMatches = computed(() =>
    matchResults.value.filter(
      (match) => match.successProbability && match.successProbability > 0.7,
    ),
  )
  const averageSuccessProbability = computed(() => {
    if (!matchResults.value.length) return 0
    const probabilities = matchResults.value
      .map((match) => match.successProbability)
      .filter((prob) => prob !== undefined)

    if (!probabilities.length) return 0
    return probabilities.reduce((sum, prob) => sum + prob, 0) / probabilities.length
  })

  return {
    // États
    isMatching,
    matchResults,
    matchMetadata,
    error,

    // Propriétés calculées
    hasResults,
    bestMatch,
    highQualityMatches,
    mlOptimizedMatches,
    averageSuccessProbability,

    // Actions
    findMatches,
    getMatchDetails,
    filterMatches,
    sortMatches,
    getMatchingStats,
    clearResults,
    recordMissionResult,
    getMatchSuccessProbability,
    getMLWeights,
    getMatchingInsights,

    // Utilitaires
    matchingEngine, // Exposer le moteur pour les cas avancés
  }
}
