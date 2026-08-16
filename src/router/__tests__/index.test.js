import { describe, it, expect } from 'vitest'

// Phase 6.3 : ajout d'une route catch-all ('/:pathMatch(.*)*' -> 'not-found') pour
// qu'une URL inconnue (ex. l'ancienne cible cassée '/emergency' de AppMobileMenu.vue,
// ou une entrée manuelle) affiche un écran dédié plutôt qu'une page blanche.
//
// `router.resolve(...)` résout une location sans naviguer -> ça n'exécute jamais le
// guard `router.beforeEach` (qui appelle `useAuthStore().init()`, donc Amplify Auth) :
// pas besoin de mocker aws-amplify/auth ni Pinia pour ce test.
import router from '@/router/index.js'

describe('router (Phase 6.3 - catch-all 404)', () => {
  it('resolves an arbitrary unknown path to the not-found route', () => {
    const resolved = router.resolve('/this-route-does-not-exist')
    expect(resolved.name).toBe('not-found')
  })

  it('resolves the old broken AppMobileMenu.vue target (/emergency) to not-found instead of a blank page', () => {
    const resolved = router.resolve('/emergency')
    expect(resolved.name).toBe('not-found')
  })

  it('resolves the old broken VerifyEmailView.vue redirect target (/register/selection) to not-found', () => {
    const resolved = router.resolve('/register/selection')
    expect(resolved.name).toBe('not-found')
  })

  it('keeps /register resolving to register-selection, the real route VerifyEmailView.vue now redirects to', () => {
    const resolved = router.resolve('/register')
    expect(resolved.name).toBe('register-selection')
  })
})

// Phase 6.B (dette secondaire) : pages statiques Support/Contact/FAQ et Mentions
// légales/Confidentialité, absentes malgré la collecte de PII sensible. Publiques
// (pas de `meta.requiresAuth`/`role`) — accessibles avant/sans connexion, comme la home.
describe('router (Phase 6.B - pages légales/support)', () => {
  it('resolves /support to the support route, with no auth requirement', () => {
    const resolved = router.resolve('/support')
    expect(resolved.name).toBe('support')
    expect(resolved.meta.requiresAuth).toBeUndefined()
  })

  it('resolves /legal to the legal route, with no auth requirement', () => {
    const resolved = router.resolve('/legal')
    expect(resolved.name).toBe('legal')
    expect(resolved.meta.requiresAuth).toBeUndefined()
  })
})
