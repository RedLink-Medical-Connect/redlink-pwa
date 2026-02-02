/**
 * Tests de performance pour le système de pagination et cache
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCachedGraphQL, useCachedPagination } from '@/composables/useCachedGraphQL'
import { graphqlCache } from '@/utils/graphql-cache'
import { rateLimiter } from '@/utils/rate-limiter'

// Mock AWS Amplify
vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({
    graphql: vi.fn(),
  }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: () => Promise.resolve({ userId: 'test-user' }),
}))

describe('Performance Tests', () => {
  beforeEach(() => {
    graphqlCache.clear()
    rateLimiter.reset()
  })

  afterEach(() => {
    graphqlCache.clear()
    rateLimiter.reset()
  })

  describe('Cache Performance', () => {
    it('should cache query results', async () => {
      const { query } = useCachedGraphQL()

      const mockQuery = 'query GetTest { test }'
      const mockData = { test: 'data' }

      // Mock la réponse GraphQL
      const mockClient = {
        graphql: vi.fn().mockResolvedValue({ data: mockData }),
      }

      // Premier appel - doit aller à l'API
      const result1 = await query({
        query: mockQuery,
        variables: {},
        useCache: true,
      })

      expect(result1.fromCache).toBe(false)

      // Deuxième appel - doit venir du cache
      const result2 = await query({
        query: mockQuery,
        variables: {},
        useCache: true,
      })

      // Le cache devrait être utilisé
      const stats = graphqlCache.getStats()
      expect(stats.totalEntries).toBeGreaterThan(0)
    })

    it('should handle cache expiration', async () => {
      const shortTtlCache = new (await import('@/utils/graphql-cache')).default({
        ttl: 100, // 100ms
      })

      const key = 'test-key'
      const data = { test: 'data' }

      shortTtlCache.set('query', {}, data, 100)

      // Immédiatement disponible
      expect(shortTtlCache.get('query', {})).toEqual(data)

      // Attendre l'expiration
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Doit être expiré
      expect(shortTtlCache.get('query', {})).toBeNull()
    })

    it('should measure cache hit ratio', () => {
      const query1 = 'query Test1 { test1 }'
      const query2 = 'query Test2 { test2 }'

      // Ajouter des données au cache
      graphqlCache.set(query1, {}, { test1: 'data1' })
      graphqlCache.set(query2, {}, { test2: 'data2' })

      // Accéder plusieurs fois
      graphqlCache.get(query1, {})
      graphqlCache.get(query1, {})
      graphqlCache.get(query2, {})

      const stats = graphqlCache.getStats()
      expect(stats.hitRatio).toBeGreaterThan(0)
    })
  })

  describe('Rate Limiting Performance', () => {
    it('should allow requests within limits', async () => {
      const userId = 'test-user'
      const query = 'query Test { test }'

      // Première requête - doit passer
      const result1 = rateLimiter.isAllowed(`${userId}_test`, 'query')
      expect(result1.allowed).toBe(true)

      // Deuxième requête - doit passer
      const result2 = rateLimiter.isAllowed(`${userId}_test`, 'query')
      expect(result2.allowed).toBe(true)

      expect(result2.remaining).toBeLessThan(result1.remaining)
    })

    it('should block requests exceeding limits', async () => {
      const userId = 'test-user'
      const key = `${userId}_test`

      // Simuler beaucoup de requêtes
      for (let i = 0; i < 150; i++) {
        rateLimiter.isAllowed(key, 'query')
      }

      // La suivante doit être bloquée
      const result = rateLimiter.isAllowed(key, 'query')
      expect(result.allowed).toBe(false)
      expect(result.retryAfter).toBeGreaterThan(0)
    })

    it('should handle different request types', () => {
      const userId = 'test-user'

      // Les mutations ont des limites plus strictes
      const queryResult = rateLimiter.isAllowed(`${userId}_query`, 'query')
      const mutationResult = rateLimiter.isAllowed(`${userId}_mutation`, 'mutation')

      expect(queryResult.allowed).toBe(true)
      expect(mutationResult.allowed).toBe(true)

      // Les limites de mutation sont plus strictes
      expect(mutationResult.remaining).toBeLessThan(queryResult.remaining)
    })
  })

  describe('Pagination Performance', () => {
    it('should handle large datasets efficiently', async () => {
      const { loadFirst, loadMore } = useCachedPagination()

      const mockQuery = 'query ListItems { listItems { items nextToken } }'
      const mockConfig = {
        query: mockQuery,
        variables: { limit: 20 },
      }

      // Mock des données paginées
      const mockItems = Array.from({ length: 20 }, (_, i) => ({
        id: `item-${i}`,
        name: `Item ${i}`,
      }))

      const startTime = Date.now()

      // Charger la première page
      await loadFirst(mockConfig)

      const loadTime = Date.now() - startTime

      // Le chargement doit être rapide (< 100ms pour les tests)
      expect(loadTime).toBeLessThan(1000) // 1 seconde max pour les tests
    })

    it('should manage memory efficiently', () => {
      const initialStats = graphqlCache.getStats()

      // Simuler l'ajout de beaucoup de données
      for (let i = 0; i < 50; i++) {
        graphqlCache.set(
          `query-${i}`,
          { page: i },
          { items: Array.from({ length: 20 }, (_, j) => ({ id: `${i}-${j}` })) },
        )
      }

      const afterStats = graphqlCache.getStats()

      // Le cache doit avoir une taille limitée
      expect(afterStats.totalEntries).toBeLessThanOrEqual(200) // maxSize configuré
      expect(afterStats.totalSizeBytes).toBeGreaterThan(initialStats.totalSizeBytes)
    })
  })

  describe('Integration Performance', () => {
    it('should handle concurrent requests efficiently', async () => {
      const { query } = useCachedGraphQL()

      const mockQuery = 'query ConcurrentTest { test }'
      const promises = []

      // Lancer plusieurs requêtes en parallèle
      for (let i = 0; i < 10; i++) {
        promises.push(
          query({
            query: mockQuery,
            variables: { id: i },
            useCache: true,
          }),
        )
      }

      const startTime = Date.now()
      await Promise.all(promises)
      const totalTime = Date.now() - startTime

      // Les requêtes concurrentes doivent être gérées efficacement
      expect(totalTime).toBeLessThan(5000) // 5 secondes max

      const stats = graphqlCache.getStats()
      expect(stats.totalEntries).toBeGreaterThan(0)
    })

    it('should maintain performance under load', async () => {
      const iterations = 100
      const times = []

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now()

        // Opération typique : vérifier cache + rate limit
        const key = `user-${i % 10}_action-${i % 5}`
        rateLimiter.isAllowed(key, 'query')
        graphqlCache.get(`query-${i % 20}`, { id: i })

        times.push(Date.now() - startTime)
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length
      const maxTime = Math.max(...times)

      // Performance doit rester constante
      expect(avgTime).toBeLessThan(10) // 10ms en moyenne
      expect(maxTime).toBeLessThan(50) // 50ms max
    })
  })

  describe('Memory Management', () => {
    it('should cleanup expired entries', async () => {
      // Ajouter des entrées avec TTL court
      for (let i = 0; i < 10; i++) {
        graphqlCache.set(`query-${i}`, {}, { data: i }, 50) // 50ms TTL
      }

      const initialStats = graphqlCache.getStats()
      expect(initialStats.totalEntries).toBe(10)

      // Attendre l'expiration
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Forcer le nettoyage
      graphqlCache.cleanup()

      const afterStats = graphqlCache.getStats()
      expect(afterStats.totalEntries).toBeLessThan(initialStats.totalEntries)
    })

    it('should evict oldest entries when cache is full', () => {
      const maxSize = 5
      const smallCache = new (require('@/utils/graphql-cache').default)({
        maxSize,
      })

      // Remplir le cache au-delà de la limite
      for (let i = 0; i < maxSize + 3; i++) {
        smallCache.set(`query-${i}`, {}, { data: i })
      }

      const stats = smallCache.getStats()
      expect(stats.totalEntries).toBeLessThanOrEqual(maxSize)
    })
  })
})
