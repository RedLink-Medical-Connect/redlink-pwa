import { describe, it, expect } from 'vitest'
import {
  isChunkLoadError,
  shouldReloadForChunkError,
  CHUNK_RELOAD_COOLDOWN_MS,
} from '@/services/chunk-load-error-service'

describe('isChunkLoadError', () => {
  it.each([
    // Chromium -- message exact observé en prod le 2026-10-06
    'Failed to fetch dynamically imported module: https://x.cloudfront.net/assets/RegisterOwnerView-DzOUOcMH.js',
    // Firefox
    'error loading dynamically imported module: https://x/assets/a.js',
    // WebKit / Safari iOS
    'Importing a module script failed.',
    // Préchargement CSS de Vite
    'Unable to preload CSS for /assets/RegisterOwnerView-CzCOFETd.css',
  ])('reconnaît %s', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true)
  })

  it('ignore les autres erreurs de navigation', () => {
    expect(isChunkLoadError(new Error('Navigation cancelled'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError({})).toBe(false)
  })
})

describe('shouldReloadForChunkError', () => {
  it('aucun rechargement précédent : recharge', () => {
    expect(shouldReloadForChunkError(null, 1_000_000)).toBe(true)
  })

  it('rechargement récent (dans la fenêtre) : ne recharge pas, évite la boucle', () => {
    expect(shouldReloadForChunkError(1_000_000, 1_000_000 + 2_000)).toBe(false)
  })

  it('rechargement ancien (hors fenêtre) : recharge à nouveau', () => {
    expect(
      shouldReloadForChunkError(1_000_000, 1_000_000 + CHUNK_RELOAD_COOLDOWN_MS + 1),
    ).toBe(true)
  })
})
