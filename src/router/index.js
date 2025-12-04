import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import HomeView from '@/views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),

  // OPTIMISATION 1 : Scroll en haut à chaque changement de page
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    } else {
      return { top: 0 }
    }
  },

  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView
    },
    // --- AUTH (Accessible uniquement si NON connecté) ---
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/auth/LoginView.vue'),
      meta: { layout: 'AuthLayout', guestOnly: true } // <--- Nouveau meta
    },
    {
      path: '/register',
      name: 'register-selection',
      component: () => import('@/views/auth/RegisterSelectionView.vue'),
      meta: { layout: 'AuthLayout', guestOnly: true }
    },
    {
      path: '/register/owner',
      name: 'register-owner',
      component: () => import('@/views/auth/RegisterOwnerView.vue'),
      meta: { layout: 'AuthLayout', guestOnly: true }
    },
    {
      path: '/register/clinic',
      name: 'register-clinic',
      component: () => import('@/views/auth/RegisterClinicView.vue'),
      meta: { layout: 'AuthLayout', guestOnly: true }
    },
    {
      path: '/verify-email',
      name: 'verify-email',
      component: () => import('@/views/auth/VerifyEmailView.vue'),
      meta: { layout: 'AuthLayout' } // On laisse accessible même si connecté (cas rare)
    },
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('@/views/auth/ForgotPasswordView.vue'),
      meta: { layout: 'AuthLayout', guestOnly: true }
    },

    // --- ESPACE CLINIQUE (Vétérinaires uniquement) ---
    {
      path: '/dashboard',
      redirect: '/dashboard/requests' // Redirection par défaut
    },
    {
      path: '/dashboard/settings',
      name: 'clinic-settings',
      component: () => import('@/views/dashboard/clinic/SettingsView.vue'),
      meta: { requiresAuth: true, role: 'vet' } // <--- Sécurité Rôle
    },
    {
      path: '/dashboard/requests',
      component: () => import('@/views/dashboard/clinic/RequestsView.vue'),
      meta: { requiresAuth: true, role: 'vet' }
    },
    {
      path: '/dashboard/donors',
      component: () => import('@/views/dashboard/clinic/DonorsView.vue'),
      meta: { requiresAuth: true, role: 'vet' }
    },
    {
      path: '/dashboard/history',
      component: () => import('@/views/dashboard/HistoryView.vue'),
      meta: { requiresAuth: true, role: 'vet' }
    },
    {
      path: '/dashboard/requests/new',
      name: 'clinic-request-new',
      component: () => import('@/views/dashboard/clinic/NewRequestView.vue'),
      meta: { requiresAuth: true, role: 'vet' }
    },

    // --- ESPACE PROPRIÉTAIRE (Owners uniquement) ---
    {
      path: '/profile',
      name: 'owner-profile',
      component: () => import('@/views/dashboard/owner/ProfileView.vue'),
      meta: { requiresAuth: true, role: 'owner' } // <--- Sécurité Rôle
    }
  ]
})

// --- LE GARDIEN (Navigation Guard) ---
router.beforeEach(async (to, from, next) => {
  const auth = useAuthStore()

  // 1. Initialiser l'utilisateur si on ne sait pas qui c'est (Refresh F5)
  if (!auth.user && !auth.error) {
    await auth.init()
  }

  const isAuthenticated = auth.isAuthenticated
  const userRole = auth.currentRole

  // 2. Bloquer les pages "Invités" aux utilisateurs connectés
  // (Ex: Un véto connecté ne doit pas pouvoir aller sur /login)
  if (to.meta.guestOnly && isAuthenticated) {
    if (userRole === 'vet') return next('/dashboard/requests')
    if (userRole === 'owner') return next('/profile')
    return next('/')
  }

  // 3. Vérifier l'authentification requise
  if (to.meta.requiresAuth && !isAuthenticated) {
    return next('/login')
  }

  // 4. OPTIMISATION 2 : SÉCURITÉ DES RÔLES
  // Si la route demande un rôle spécifique ('vet' ou 'owner')
  if (to.meta.role) {
    // Si on est un Owner et qu'on essaie d'aller sur une page Véto
    if (to.meta.role === 'vet' && userRole !== 'vet') {
      return next('/profile') // Retourne chez toi !
    }
    // Si on est un Véto et qu'on essaie d'aller sur une page Owner
    if (to.meta.role === 'owner' && userRole !== 'owner') {
      return next('/dashboard/requests') // Retourne au boulot !
    }
  }

  // Tout est bon, on laisse passer
  next()
})

// OPTIMISATION 3 : Nettoyage des erreurs
router.afterEach(() => {
  const auth = useAuthStore()
  auth.clearError() // On efface les messages d'erreur rouges quand on change de page
})

export default router
