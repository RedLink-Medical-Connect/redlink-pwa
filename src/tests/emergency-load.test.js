/**
 * Tests de charge pour le système de notifications d'urgence
 * Sprint 3.4 - Optimisation et Finalisation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { emergencyNotificationService } from '@/services/emergency-notification-service'

// Mock des services externes
vi.mock('@/services/notification-service', () => ({
  notificationService: {
    sendNotification: vi.fn().mockResolvedValue({ sent: true }),
  },
}))

vi.mock('@/utils/monitoring', () => ({
  useMonitoring: () => ({
    recordMetric: vi.fn(),
    recordError: vi.fn(),
  }),
}))

describe("Tests de Charge - Système d'Urgence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    // Nettoyer toutes les escalades actives
    emergencyNotificationService.activeEscalations.clear()
  })

  it('devrait gérer 100 urgences simultanées', async () => {
    const emergencies = []
    const startTime = Date.now()

    // Créer 100 urgences simultanées
    for (let i = 0; i < 100; i++) {
      const emergencyPromise = emergencyNotificationService.sendEmergencyNotification({
        urgencyLevel: i % 3 === 0 ? 'CRITICAL' : i % 2 === 0 ? 'URGENT' : 'HIGH',
        type: 'EMERGENCY_ALERT',
        title: `Urgence de charge ${i}`,
        message: `Test de charge numéro ${i}`,
        targetUsers: [`user-${i}`],
        missionId: `mission-${i}`,
      })
      emergencies.push(emergencyPromise)
    }

    // Attendre que toutes les urgences soient créées
    const results = await Promise.all(emergencies)

    const endTime = Date.now()
    const duration = endTime - startTime

    // Vérifications
    expect(results).toHaveLength(100)
    expect(results.every((r) => r.sent)).toBe(true)
    expect(duration).toBeLessThan(5000) // Moins de 5 secondes
    expect(emergencyNotificationService.activeEscalations.size).toBe(100)

    console.log(`✅ 100 urgences créées en ${duration}ms`)
  })

  it('devrait maintenir les performances avec escalade simultanée', async () => {
    const criticalEmergencies = []

    // Créer 50 urgences critiques
    for (let i = 0; i < 50; i++) {
      const emergency = await emergencyNotificationService.sendEmergencyNotification({
        urgencyLevel: 'CRITICAL',
        type: 'EMERGENCY_ALERT',
        title: `Urgence critique ${i}`,
        message: `Test escalade ${i}`,
        targetUsers: [`user-${i}`],
      })
      criticalEmergencies.push(emergency.emergencyId)
    }

    // Simuler le passage du temps pour déclencher l'escalade niveau 2 (5min)
    vi.advanceTimersByTime(300000) // 5 minutes

    // Vérifier que les escalades sont actives
    expect(emergencyNotificationService.activeEscalations.size).toBe(50)

    // Accuser réception de la moitié
    for (let i = 0; i < 25; i++) {
      const success = emergencyNotificationService.acknowledgeEmergency(
        criticalEmergencies[i],
        `user-${i}`,
        'READ',
      )
      expect(success).toBe(true)
    }

    // Vérifier les statistiques
    const stats = emergencyNotificationService.getEmergencyStats()
    expect(stats.activeEmergencies).toBe(50)
    expect(stats.acknowledgedEmergencies).toBe(25)
    expect(stats.pendingEmergencies).toBe(25)

    console.log('✅ Escalade simultanée gérée avec succès')
  })

  it('devrait optimiser la mémoire avec nettoyage automatique', async () => {
    // Créer beaucoup d'urgences
    for (let i = 0; i < 200; i++) {
      await emergencyNotificationService.sendEmergencyNotification({
        urgencyLevel: 'HIGH',
        type: 'EMERGENCY_ALERT',
        title: `Urgence mémoire ${i}`,
        message: `Test mémoire ${i}`,
        targetUsers: [`user-${i}`],
      })
    }

    expect(emergencyNotificationService.activeEscalations.size).toBe(200)

    // Accuser réception de toutes les urgences
    const emergencyIds = Array.from(emergencyNotificationService.activeEscalations.keys())
    for (const emergencyId of emergencyIds) {
      emergencyNotificationService.acknowledgeEmergency(emergencyId, 'user', 'READ')
    }

    // Nettoyer les escalades terminées
    for (const emergencyId of emergencyIds) {
      emergencyNotificationService.cleanupEscalation(emergencyId)
    }

    // Vérifier que la mémoire est libérée
    expect(emergencyNotificationService.activeEscalations.size).toBe(0)

    console.log('✅ Nettoyage mémoire optimisé')
  })

  it('devrait gérer les pics de charge avec rate limiting', async () => {
    const startTime = performance.now()
    const promises = []

    // Simuler un pic de 500 urgences en 1 seconde
    for (let i = 0; i < 500; i++) {
      const promise = emergencyNotificationService.sendEmergencyNotification({
        urgencyLevel: 'URGENT',
        type: 'EMERGENCY_ALERT',
        title: `Pic de charge ${i}`,
        message: `Test pic ${i}`,
        targetUsers: [`user-${i % 10}`], // 10 utilisateurs différents
      })
      promises.push(promise)
    }

    const results = await Promise.allSettled(promises)
    const endTime = performance.now()

    const successful = results.filter((r) => r.status === 'fulfilled').length
    const failed = results.filter((r) => r.status === 'rejected').length

    // Au moins 80% doivent réussir même avec rate limiting
    expect(successful).toBeGreaterThan(400)
    expect(endTime - startTime).toBeLessThan(10000) // Moins de 10 secondes

    console.log(
      `✅ Pic de charge: ${successful} succès, ${failed} échecs en ${Math.round(endTime - startTime)}ms`,
    )
  })

  it('devrait maintenir la cohérence des données sous charge', async () => {
    const emergencyIds = []

    // Créer des urgences avec différents niveaux
    for (let i = 0; i < 100; i++) {
      const urgencyLevel = ['CRITICAL', 'URGENT', 'HIGH'][i % 3]
      const result = await emergencyNotificationService.sendEmergencyNotification({
        urgencyLevel,
        type: 'EMERGENCY_ALERT',
        title: `Test cohérence ${i}`,
        message: `Urgence ${urgencyLevel} ${i}`,
        targetUsers: [`user-${i}`],
      })
      emergencyIds.push({ id: result.emergencyId, level: urgencyLevel })
    }

    // Vérifier la cohérence des données
    const stats = emergencyNotificationService.getEmergencyStats()
    expect(stats.activeEmergencies).toBe(100)
    expect(stats.acknowledgedEmergencies).toBe(0)

    // Accuser réception de manière aléatoire
    const toAcknowledge = emergencyIds.slice(0, 60)
    for (const emergency of toAcknowledge) {
      const success = emergencyNotificationService.acknowledgeEmergency(
        emergency.id,
        'user',
        'READ',
      )
      expect(success).toBe(true)
    }

    // Vérifier la cohérence après modifications
    const updatedStats = emergencyNotificationService.getEmergencyStats()
    expect(updatedStats.activeEmergencies).toBe(100)
    expect(updatedStats.acknowledgedEmergencies).toBe(60)
    expect(updatedStats.pendingEmergencies).toBe(40)

    console.log('✅ Cohérence des données maintenue sous charge')
  })

  it("devrait optimiser les timeouts d'escalade", async () => {
    const emergencyIds = []

    // Créer des urgences critiques
    for (let i = 0; i < 10; i++) {
      const result = await emergencyNotificationService.sendEmergencyNotification({
        urgencyLevel: 'CRITICAL',
        type: 'EMERGENCY_ALERT',
        title: `Test timeout ${i}`,
        message: `Urgence timeout ${i}`,
        targetUsers: [`user-${i}`],
      })
      emergencyIds.push(result.emergencyId)
    }

    // Vérifier que les timeouts sont configurés
    emergencyIds.forEach((id) => {
      const escalationData = emergencyNotificationService.activeEscalations.get(id)
      expect(escalationData).toBeDefined()
      expect(escalationData.escalationTimeouts.length).toBeGreaterThan(0)
    })

    // Simuler l'accusé de réception rapide
    const fastAcknowledge = emergencyIds.slice(0, 5)
    fastAcknowledge.forEach((id) => {
      emergencyNotificationService.acknowledgeEmergency(id, 'user', 'READ')
    })

    // Vérifier que les timeouts sont nettoyés
    fastAcknowledge.forEach((id) => {
      const escalationData = emergencyNotificationService.activeEscalations.get(id)
      expect(escalationData.acknowledged).toBe(true)
    })

    console.log('✅ Optimisation des timeouts validée')
  })

  it('devrait mesurer les métriques de performance', async () => {
    const metrics = {
      creationTime: [],
      acknowledgmentTime: [],
      escalationTime: [],
    }

    // Test de performance sur 50 urgences
    for (let i = 0; i < 50; i++) {
      const startCreate = performance.now()

      const result = await emergencyNotificationService.sendEmergencyNotification({
        urgencyLevel: 'URGENT',
        type: 'EMERGENCY_ALERT',
        title: `Métrique ${i}`,
        message: `Test métrique ${i}`,
        targetUsers: [`user-${i}`],
      })

      const endCreate = performance.now()
      metrics.creationTime.push(endCreate - startCreate)

      // Accuser réception immédiatement
      const startAck = performance.now()
      emergencyNotificationService.acknowledgeEmergency(result.emergencyId, 'user', 'READ')
      const endAck = performance.now()
      metrics.acknowledgmentTime.push(endAck - startAck)
    }

    // Calculer les moyennes
    const avgCreation =
      metrics.creationTime.reduce((a, b) => a + b, 0) / metrics.creationTime.length
    const avgAcknowledgment =
      metrics.acknowledgmentTime.reduce((a, b) => a + b, 0) / metrics.acknowledgmentTime.length

    // Vérifier les performances
    expect(avgCreation).toBeLessThan(100) // Moins de 100ms pour créer
    expect(avgAcknowledgment).toBeLessThan(50) // Moins de 50ms pour accuser réception

    console.log(
      `✅ Métriques: Création ${avgCreation.toFixed(2)}ms, Accusé ${avgAcknowledgment.toFixed(2)}ms`,
    )
  })
})

describe('Tests de Stress - Escalade Automatique', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    emergencyNotificationService.activeEscalations.clear()
  })

  it("devrait gérer l'escalade de 1000 urgences critiques", async () => {
    const emergencyIds = []

    // Créer 1000 urgences critiques
    for (let i = 0; i < 1000; i++) {
      const result = await emergencyNotificationService.sendEmergencyNotification({
        urgencyLevel: 'CRITICAL',
        type: 'EMERGENCY_ALERT',
        title: `Stress test ${i}`,
        message: `Urgence stress ${i}`,
        targetUsers: [`user-${i % 100}`], // 100 utilisateurs différents
      })
      emergencyIds.push(result.emergencyId)
    }

    expect(emergencyNotificationService.activeEscalations.size).toBe(1000)

    // Simuler 5 minutes pour déclencher l'escalade niveau 2
    vi.advanceTimersByTime(300000)

    // Vérifier que toutes les escalades sont toujours actives
    expect(emergencyNotificationService.activeEscalations.size).toBe(1000)

    // Accuser réception de 50% des urgences
    for (let i = 0; i < 500; i++) {
      emergencyNotificationService.acknowledgeEmergency(emergencyIds[i], 'user', 'READ')
    }

    const stats = emergencyNotificationService.getEmergencyStats()
    expect(stats.acknowledgedEmergencies).toBe(500)
    expect(stats.pendingEmergencies).toBe(500)

    console.log('✅ Stress test 1000 urgences réussi')
  })

  it('devrait maintenir la stabilité avec escalade maximale', async () => {
    // Créer une urgence critique qui va jusqu'à l'escalade maximale
    const result = await emergencyNotificationService.sendEmergencyNotification({
      urgencyLevel: 'CRITICAL',
      type: 'EMERGENCY_ALERT',
      title: 'Test escalade maximale',
      message: 'Urgence non répondue',
      targetUsers: ['user-test'],
      fallbackUsers: ['fallback-1', 'fallback-2'],
    })

    const emergencyId = result.emergencyId

    // Simuler le passage de temps pour atteindre l'escalade maximale
    // Niveau 1: 0s, Niveau 2: 5min, Niveau 3: 10min, Niveau 4: 15min, Niveau 5: 20min
    vi.advanceTimersByTime(1200000) // 20 minutes

    const escalationData = emergencyNotificationService.activeEscalations.get(emergencyId)
    expect(escalationData).toBeDefined()
    expect(escalationData.maxEscalationReached).toBe(true)

    console.log('✅ Escalade maximale gérée avec stabilité')
  })
})
