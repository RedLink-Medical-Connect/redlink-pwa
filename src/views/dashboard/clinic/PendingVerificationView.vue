<script setup>
import { useAuthStore } from '@/stores/auth'

// Écran d'attente pour une Clinic dont `verificationStatus` est encore `PENDING` (plan de
// durcissement sécurité "Différé 1") -- garde de navigation posée dans
// `src/router/index.js`, redirige ici toute route `role: 'vet'` tant que la vérification
// RPPS/numéro d'ordre n'a pas été validée par un Admin. Aucune donnée à charger ici : la
// garde a déjà fait l'aller-retour GraphQL nécessaire avant d'arriver sur cette page.
const auth = useAuthStore()
</script>

<template>
  <div class="min-h-[60vh] flex flex-col items-center justify-center text-center px-4 py-16">
    <span class="pi pi-clock text-6xl text-[#ff3b4e] mb-4" />
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white mb-2">
      {{ $t('pendingVerification.title') }}
    </h1>
    <p class="text-zinc-500 dark:text-zinc-400 mb-8 max-w-md">
      {{ $t('pendingVerification.description') }}
    </p>
    <Button
      :label="$t('menu.logout')"
      icon="pi pi-sign-out"
      variant="outlined"
      class="!text-zinc-600 dark:!text-zinc-300 !border-zinc-300 dark:!border-zinc-600"
      @click="auth.logout()"
    />
  </div>
</template>
