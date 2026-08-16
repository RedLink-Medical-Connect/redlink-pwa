import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import HomeView from '@/views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),

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
      component: HomeView,
    },
    // --- PAGES STATIQUES PUBLIQUES (Support, mentions légales) ---
    {
      path: '/support',
      name: 'support',
      component: () => import('@/views/SupportView.vue'),
    },
    {
      path: '/legal',
      name: 'legal',
      component: () => import('@/views/LegalView.vue'),
    },
    // --- AUTH (Accessible uniquement si NON connecté) ---
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/auth/LoginView.vue'),
      meta: { layout: 'AuthLayout', guestOnly: true },
    },
    {
      path: '/register',
      name: 'register-selection',
      component: () => import('@/views/auth/RegisterSelectionView.vue'),
      meta: { layout: 'AuthLayout', guestOnly: true },
    },
    {
      path: '/register/owner',
      name: 'register-owner',
      component: () => import('@/views/auth/RegisterOwnerView.vue'),
      meta: { layout: 'AuthLayout', guestOnly: true },
    },
    {
      path: '/register/clinic',
      name: 'register-clinic',
      component: () => import('@/views/auth/RegisterClinicView.vue'),
      meta: { layout: 'AuthLayout', guestOnly: true },
    },
    {
      path: '/verify-email',
      name: 'verify-email',
      component: () => import('@/views/auth/VerifyEmailView.vue'),
      meta: { layout: 'AuthLayout' },
    },
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('@/views/auth/ForgotPasswordView.vue'),
      meta: { layout: 'AuthLayout', guestOnly: true },
    },

    // --- ESPACE CLINIQUE (Vétérinaires uniquement) ---
    {
      path: '/dashboard',
      redirect: '/dashboard/requests',
    },
    {
      path: '/dashboard/settings',
      name: 'clinic-settings',
      component: () => import('@/views/dashboard/clinic/SettingsView.vue'),
      meta: { requiresAuth: true, role: 'vet' },
    },
    {
      path: '/dashboard/requests',
      component: () => import('@/views/dashboard/clinic/RequestsView.vue'),
      meta: { requiresAuth: true, role: 'vet' },
    },
    {
      path: '/dashboard/donors',
      component: () => import('@/views/dashboard/clinic/DonorsView.vue'),
      meta: { requiresAuth: true, role: 'vet' },
    },
    {
      path: '/dashboard/validations',
      component: () => import('@/views/dashboard/clinic/ValidationsView.vue'),
      meta: { requiresAuth: true, role: 'vet' },
    },
    {
      path: '/dashboard/history',
      component: () => import('@/views/dashboard/HistoryView.vue'),
      meta: { requiresAuth: true, role: 'vet' },
    },
    {
      path: '/dashboard/requests/new',
      name: 'clinic-request-new',
      component: () => import('@/views/dashboard/clinic/NewRequestView.vue'),
      meta: { requiresAuth: true, role: 'vet' },
    },

    // --- ESPACE PROPRIÉTAIRE (Owners uniquement) ---
    {
      path: '/dashboard/profile',
      name: 'owner-profile',
      component: () => import('@/views/dashboard/owner/ProfileView.vue'),
      meta: { requiresAuth: true, role: 'owner' },
    },
    {
      path: '/dashboard/board',
      name: 'owner-dashboard',
      component: () => import('@/views/dashboard/owner/DashboardView.vue'),
      meta: { requiresAuth: true, role: 'owner' },
    },
    {
      path: '/dashboard/animals',
      name: 'animals',
      component: () => import('@/views/dashboard/owner/AnimalsView.vue'),
      meta: { requiresAuth: true, role: 'owner' },
    },
    {
      path: '/dashboard/animals/add',
      name: 'add-animal',
      component: () => import('@/views/dashboard/owner/AddAnimalView.vue'),
      meta: { requiresAuth: true, role: 'owner' },
    },
    {
      path: '/dashboard/availability',
      name: 'availability',
      component: () => import('@/views/dashboard/owner/AvailabilityView.vue'),
      meta: { requiresAuth: true, role: 'owner' },
    },
    {
      path: '/dashboard/missions',
      name: 'missions',
      component: () => import('@/views/dashboard/owner/MissionsView.vue'),
      meta: { requiresAuth: true, role: 'owner' },
    },
    { path: '/test-stripe', component: () => import('@/views/TestStripe.vue') },

    // --- CATCH-ALL (404) ---
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
    },
  ],
})

// --- LE GARDIEN (Navigation Guard) ---
router.beforeEach(async (to, from, next) => {
  const auth = useAuthStore()

  if (!auth.user && !auth.error) {
    await auth.init()
  }

  const isAuthenticated = auth.isAuthenticated
  const userRole = auth.currentRole

  if (to.meta.guestOnly && isAuthenticated) {
    if (userRole === 'vet') return next('/dashboard/requests')
    if (userRole === 'owner') return next('/dashboard/profile')
    return next('/')
  }

  if (to.meta.requiresAuth && !isAuthenticated) {
    return next('/login')
  }

  if (to.meta.role) {
    if (to.meta.role === 'vet' && userRole !== 'vet') {
      return next('/dashboard/profile')
    }
    if (to.meta.role === 'owner' && userRole !== 'owner') {
      return next('/dashboard/requests')
    }
  }
  next()
})

router.afterEach(() => {
  const auth = useAuthStore()
  auth.clearError()
})

export default router
