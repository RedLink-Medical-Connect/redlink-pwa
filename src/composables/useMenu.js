import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

export function useMenu() {
  const router = useRouter()
  const auth = useAuthStore()

  const vetItems = computed(() => [
    {
      label: 'dashboard.sidebar.requests',
      icon: 'pi pi-bolt',
      to: '/dashboard/requests',
      command: () => router.push('/dashboard/requests')
    },
    {
      label: 'dashboard.sidebar.donors',
      icon: 'pi pi-users',
      to: '/dashboard/donors',
      command: () => router.push('/dashboard/donors')
    },
    {
      label: 'dashboard.sidebar.history',
      icon: 'pi pi-history',
      to: '/dashboard/history',
      command: () => router.push('/dashboard/history')
    },
    {
      label: 'dashboard.sidebar.settings',
      icon: 'pi pi-cog',
      to: '/dashboard/settings',
      command: () => router.push('/dashboard/settings')
    }
  ])

  // MENU PROPRIÉTAIRE (Commun)
  const ownerItems = computed(() => [
    {
      label: 'dashboard.owner.tabs.dashboard',
      icon: 'pi pi-th-large',
      to: '/dashboard/board',
      command: () => router.push('/dashboard/board'),
    },
    {
      label: 'dashboard.owner.tabs.general',
      icon: 'pi pi-user',
      to: '/dashboard/profile',
      command: () => router.push('/dashboard/profile'),
    },
    {
      label: 'dashboard.owner.tabs.animals',
      icon: 'pi pi-heart',
      to: '/dashboard/animals',
      command: () => router.push('/dashboard/animals'),
    },
    {
      label: 'dashboard.owner.tabs.availability',
      icon: 'pi pi-calendar',
      to: '/dashboard/availability',
      command: () => router.push('/dashboard/availability'),
    },
  ])

  const currentMenuItems = computed(() => {
    if (auth.currentRole === 'vet') return vetItems.value
    if (auth.currentRole === 'owner') return ownerItems.value
    return []
  })

  return { vetItems, ownerItems, currentMenuItems }
}
