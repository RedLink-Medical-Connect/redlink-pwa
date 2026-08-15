import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// Phase 6.3 : la nav mobile ne reflétait jamais l'état connecté/rôle (3 liens
// statiques) et son bouton "urgence" pointait vers '/emergency', une route
// inexistante (page blanche au clic). Ce fichier est le premier test de composant
// `.vue` de ce repo (`@vue/test-utils` était installé mais jamais utilisé) --
// justifié ici parce que la logique testée (choix de route selon rôle/état
// connecté) vit uniquement dans ce composant : `.cursorrules` interdit à un
// composable de faire de la navigation, donc il n'existe pas de seam
// composable/service équivalent pour cette régression précise.

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(),
  fetchUserAttributes: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  confirmSignUp: vi.fn(),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
  deleteUser: vi.fn(),
}))

// useAuthStore() (src/stores/auth.js) importe le vrai singleton `@/router`
// uniquement pour ses helpers login/logout -- stubbé pour ne pas entraîner tout
// le graphe de vues de l'appli dans ce test (même pattern que
// useMatchingRequests.test.js).
vi.mock('@/router', () => ({
  default: { push: vi.fn() },
}))

import AppMobileMenu from '@/components/common/AppMobileMenu.vue'
import { useAuthStore } from '@/stores/auth'

const mountMenu = () =>
  mount(AppMobileMenu, {
    global: {
      stubs: { RouterLink: RouterLinkStub },
      mocks: { $t: (key) => key },
    },
  })

// Ordre dans le template : accueil, urgence (bouton central), compte.
const linkTargets = (wrapper) =>
  wrapper.findAllComponents(RouterLinkStub).map((link) => link.props('to'))

describe('AppMobileMenu (Phase 6.3 - nav mobile role-aware)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('routes an anonymous visitor to the public donor CTA and to /login, never to /emergency', () => {
    const wrapper = mountMenu()
    const [home, emergency, account] = linkTargets(wrapper)

    expect(home).toBe('/')
    expect(emergency).toBe('/register/owner')
    expect(account).toBe('/login')
  })

  it('routes an authenticated Veterinarian to the new-Request flow (mirrors AppHeader.vue CTA) and to their settings', () => {
    const auth = useAuthStore()
    auth.user = { attributes: { profile: 'vet' } }

    const wrapper = mountMenu()
    const [, emergency, account] = linkTargets(wrapper)

    expect(emergency).toBe('/dashboard/requests/new')
    expect(account).toBe('/dashboard/settings')
  })

  it('routes an authenticated Owner to their dashboard (the "radar d\'urgence") and to their profile', () => {
    const auth = useAuthStore()
    auth.user = { attributes: { profile: 'owner' } }

    const wrapper = mountMenu()
    const [, emergency, account] = linkTargets(wrapper)

    expect(emergency).toBe('/dashboard/board')
    expect(account).toBe('/dashboard/profile')
  })

  it('never links anywhere to the removed /emergency route, in any auth state', () => {
    const auth = useAuthStore()
    auth.user = { attributes: { profile: 'vet' } }

    const wrapper = mountMenu()

    expect(linkTargets(wrapper)).not.toContain('/emergency')
  })
})
