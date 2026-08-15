<script setup>
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

// Bouton central "urgence" (le plus visuellement mis en avant de la nav mobile :
// icône éclair + animation pulse) — décision Phase 6.3, pas de route `/emergency`
// dédiée dans ce produit, donc on adapte la cible au rôle connecté plutôt que
// d'inventer une nouvelle route/vue :
// - Veterinarian : création d'une nouvelle Request, exact miroir du CTA flashy
//   "Nouvelle demande" déjà présent côté desktop (AppHeader.vue, même icône
//   pi-bolt + même animation `animate-pulse-slow`).
// - Owner : son tableau de bord (`/dashboard/board`), décrit ailleurs dans ce repo
//   comme le "radar d'urgence" de l'Owner (roadmap Phase 6.2) — l'écran qui montre
//   les Requests urgentes compatibles avec ses animaux.
// - Visiteur non connecté : aucune action "urgence" n'existe avant inscription/
//   connexion. On retombe sur le CTA public le plus proche en prominence visuelle
//   côté desktop (AppHeader.vue "Devenir donneur", même style rouge plein) plutôt
//   que sur `/login`, déjà couvert par le bouton "compte" ci-dessous.
// NB: `auth.currentRole` retombe par défaut sur 'owner' même déconnecté (voir
// `stores/auth.js`) — on teste `auth.isAuthenticated` en premier (comme
// AppHeader.vue) pour ne pas traiter un visiteur non connecté comme un Owner.
const emergencyLink = computed(() => {
  if (!auth.isAuthenticated) return '/register/owner'
  if (auth.currentRole === 'vet') return '/dashboard/requests/new'
  return '/dashboard/board'
})

// Bouton "compte" — pointe vers la page de compte/profil réelle du rôle connecté
// plutôt que vers `/login` une fois authentifié (avant ce correctif, restait figé
// sur `/login` même pour un utilisateur déjà connecté). Le menu complet (dont la
// déconnexion) reste accessible via l'avatar d'AppHeader.vue, non masqué sur
// mobile — cette nav ne duplique pas ses fonctions, juste un accès rapide au
// pouce vers l'écran de compte pertinent.
const accountLink = computed(() => {
  if (!auth.isAuthenticated) return '/login'
  if (auth.currentRole === 'vet') return '/dashboard/settings'
  return '/dashboard/profile'
})
</script>

<template>
  <nav class="md:hidden fixed bottom-0 left-0 w-full bg-white/90 backdrop-blur-md border-t border-zinc-200/60 shadow-[0_-5px_15px_rgba(0,0,0,0.03)] z-[100] px-6 py-2 pb-safe">
    <div class="flex justify-between items-end">

      <router-link to="/" class="group flex flex-col items-center gap-1 w-16 pt-2 text-zinc-400 hover:text-[#ff3b4e] aria-[current=page]:text-[#ff3b4e] transition-colors">
        <i class="pi pi-home text-xl group-aria-[current=page]:scale-110 transition-transform duration-200"></i>
        <span class="text-[10px] font-medium tracking-wide">{{ $t('layout.mobile.home') }}</span>
      </router-link>

      <div class="relative -top-6 group">
        <div class="absolute inset-0 bg-white rounded-full -m-1.5 opacity-0 group-hover:opacity-100 transition"></div>

        <router-link :to="emergencyLink" class="relative flex items-center justify-center w-16 h-16 bg-gradient-to-br from-[#ff3b4e] to-[#d92e40] rounded-full shadow-xl shadow-red-500/30 text-white hover:scale-105 active:scale-95 transition-all duration-300" :aria-label="$t('layout.mobile.emergency')">
          <i class="pi pi-bolt text-3xl animate-pulse-slow"></i>
        </router-link>
      </div>

      <router-link :to="accountLink" class="group flex flex-col items-center gap-1 w-16 pt-2 text-zinc-400 hover:text-[#ff3b4e] aria-[current=page]:text-[#ff3b4e] transition-colors">
        <i class="pi pi-user text-xl group-aria-[current=page]:scale-110 transition-transform duration-200"></i>
        <span class="text-[10px] font-medium tracking-wide">{{ $t('layout.mobile.account') }}</span>
      </router-link>

    </div>
  </nav>
</template>

<style scoped>
/* Animation douce pour l'icône urgence */
.animate-pulse-slow {
  animation: pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .8; }
}

/* Padding safe area pour iPhone X et + */
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 20px);
}
</style>
