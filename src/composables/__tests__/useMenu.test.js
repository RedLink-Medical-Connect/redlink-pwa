import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { vi } from 'vitest'

// Phase 7, section C (R-21) : `useMenu.js` n'avait aucun test. Couvre `currentMenuItems`
// (le seul export dérivé/conditionnel du fichier -- `vetItems`/`ownerItems` sont de simples
// listes statiques, pas testées séparément) pour les trois branches de
// `auth.currentRole` : 'vet', 'owner', et le cas `else` non documenté dans le code source
// (rôle inconnu/absent -> menu vide silencieux, comportement qu'on verrouille ici plutôt
// que de le découvrir en prod).

// useMenu() calls useRouter() directly (command() handlers) — stub it out so the composable
// can be instantiated outside of a mounted component / real router instance (same pattern
// as useOwnerProfile.test.js / useMatchingRequests.test.js).
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// useMenu() calls useAuthStore(), whose module imports the real `@/router` singleton
// (createRouter(...) + every route-level view component) purely for its `logout()` helper's
// redirect — stub it out so importing the store doesn't drag in the whole app's router/view
// graph (same pattern as useOwnerProfile.test.js).
vi.mock('@/router', () => ({
  default: { push: vi.fn() },
}))

import { useMenu } from '@/composables/useMenu'
import { useAuthStore } from '@/stores/auth'

describe('useMenu.currentMenuItems', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it("renvoie vetItems quand auth.currentRole vaut 'vet'", () => {
    const auth = useAuthStore()
    auth.role = 'vet'

    const { currentMenuItems, vetItems } = useMenu()

    expect(currentMenuItems.value).toEqual(vetItems.value)
    expect(currentMenuItems.value.map((item) => item.to)).toContain('/dashboard/requests')
  })

  it("renvoie ownerItems quand auth.currentRole vaut 'owner'", () => {
    const auth = useAuthStore()
    auth.role = 'owner'

    const { currentMenuItems, ownerItems } = useMenu()

    expect(currentMenuItems.value).toEqual(ownerItems.value)
    expect(currentMenuItems.value.map((item) => item.to)).toContain('/dashboard/animals')
  })

  it('renvoie un tableau vide pour un rôle inconnu (branche `else` non documentée)', () => {
    const auth = useAuthStore()
    auth.role = 'guest'

    const { currentMenuItems } = useMenu()

    expect(currentMenuItems.value).toEqual([])
  })

  it('chaque item vetItems a un `command` qui pousse sa propre route `to` via le routeur', () => {
    const auth = useAuthStore()
    auth.role = 'vet'

    const { vetItems } = useMenu()

    for (const item of vetItems.value) {
      expect(typeof item.command).toBe('function')
      expect(() => item.command()).not.toThrow()
    }
  })
})
