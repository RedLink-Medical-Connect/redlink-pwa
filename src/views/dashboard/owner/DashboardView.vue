<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'

// Nos Logiques
import { useMatchingRequests } from '@/composables/useMatchingRequests'
import { useOwnerMissions, mapAcceptMissionError } from '@/composables/useOwnerMissions'

const { t } = useI18n()
const router = useRouter()
const toast = useToast()

// Matching (Radar)
const {
  matches,
  isLoading: loadingMatches,
  loadError: matchesLoadError,
  searchMatches,
  startAutoRefresh,
  stopAutoRefresh,
} = useMatchingRequests()

// Missions (Pour accepter)
const { acceptMission, isLoading: loadingAccept } = useOwnerMissions()

onMounted(() => {
  searchMatches()
  // Fallback dashboard + email au vrai push PWA (hors périmètre V1, voir roadmap
  // Phase 4) : polling léger + refresh au retour de focus de l'onglet, tant que ce
  // composant reste monté (voir useMatchingRequests.startAutoRefresh).
  startAutoRefresh()
})

onUnmounted(() => {
  // Évite un interval/listener orphelin après une navigation SPA hors du dashboard.
  stopAutoRefresh()
})

const handleAccept = async (request) => {
  try {
    // On appelle la fonction d'acceptation (crée la mission dans la DB)
    // useOwnerMissions().acceptMission attend (requestId, animalId) : elle recharge la
    // Request et l'Animal elle-même plutôt que de faire confiance aux objets déjà en
    // mémoire côté client (voir ADR-0001).
    await acceptMission(request.id, request.matchingAnimal.id)

    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: "Merci ! Mission acceptée.",
      life: 3000
    })

    // On redirige vers la liste des missions pour voir les détails
    router.push('/dashboard/missions')
  } catch (e) {
    console.error(e)
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: mapAcceptMissionError(e.message),
      life: 3000
    })

    // L'état local (matches) peut être périmé : la Request ou l'Animal ont changé
    // depuis la dernière recherche, c'est précisément ce qui a causé l'erreur.
    // On rafraîchit plutôt que de laisser une carte obsolète cliquable.
    searchMatches()
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <Toast />

    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />

      <div class="grow">
        <h1 class="text-2xl font-bold text-zinc-900 dark:text-white border-l-4 border-[#ff3b4e] pl-4 mb-2">
          {{ $t('dashboard.owner.overview.title') }}
        </h1>
        <p class="text-zinc-500 dark:text-zinc-400 text-sm mb-8 ml-5">
          Bienvenue sur Redlink. Voici les urgences autour de vous.
        </p>

        <div class="mb-8">
          <div v-if="loadingMatches" class="p-12 text-center">
            <i class="pi pi-spin pi-spinner text-3xl text-[#ff3b4e]"></i>
            <p class="text-zinc-400 mt-2">Recherche d'urgences à proximité...</p>
          </div>

          <!-- Phase 7.6 (R-09, roadmap Phase 6.2) : écran le plus critique de l'app -- avant ce
               fix, un échec réel de searchMatches() affichait le même message rassurant que
               "aucune urgence détectée", indistinguable pour l'Owner. État d'erreur distinct
               (rouge/amber, jamais confondu avec le vert "tout va bien" ci-dessous). Contenu
               NEUF de ce fichier : passe par $t() plutôt que de reproduire la dette de chaînes
               françaises en dur déjà trackée sur ce fichier (CLAUDE.md) -- ne pas copier
               l'exception dans du code nouveau. -->
          <div
            v-else-if="matchesLoadError"
            role="alert"
            aria-live="assertive"
            class="bg-red-50 border border-red-200 rounded-xl p-8 text-center"
          >
            <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i class="pi pi-exclamation-triangle text-2xl text-red-600"></i>
            </div>
            <h3 class="font-bold text-red-800 text-lg">
              {{ $t('dashboard.owner.overview.load_error_title') }}
            </h3>
            <p class="text-red-600">{{ $t('dashboard.owner.overview.load_error') }}</p>
            <Button
              :label="$t('dashboard.owner.overview.retry')"
              icon="pi pi-refresh"
              text
              class="mt-2 !text-red-700 hover:!bg-red-100"
              @click="searchMatches"
            />
          </div>

          <div v-else-if="matches.length === 0" class="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
            <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i class="pi pi-check text-2xl text-green-600"></i>
            </div>
            <h3 class="font-bold text-green-800 text-lg">Aucune urgence détectée</h3>
            <p class="text-green-600">Tout est calme autour de vous. Profitez de votre journée avec vos animaux ! 🐶🐱</p>
            <Button
              label="Actualiser"
              icon="pi pi-refresh"
              text
              class="mt-2 !text-green-700 hover:!bg-green-100"
              @click="searchMatches"
            />
          </div>

          <div v-else class="grid gap-4">
            <div
              v-for="req in matches"
              :key="req.id"
              class="bg-white dark:bg-zinc-900 border border-l-4 border-zinc-200 border-l-[#ff3b4e] dark:border-zinc-800 rounded-xl p-6 shadow-sm hover:shadow-md transition-all"
            >
              <div class="flex flex-col md:flex-row justify-between items-start gap-4">
                <div class="flex-grow">
                  <div class="flex items-center gap-2 mb-2">
                    <Tag severity="danger" value="URGENCE" rounded class="font-bold" />
                    <!-- Critère 5 de l'Eligibility (Clinic Priority, CONTEXT.md) : simple
                    indicateur visuel, ne change rien à l'éligibilité elle-même — le tri
                    (useMatchingRequests.searchMatches) fait déjà remonter ces cartes en
                    premier. -->
                    <Tag v-if="req.hasClinicPriority" severity="info" :value="t('dashboard.owner.overview.known_clinic_badge')" rounded />
                    <span class="text-xs text-zinc-500 font-mono bg-zinc-100 px-2 py-1 rounded">
                      à {{ req.distanceKM }} km
                    </span>
                  </div>

                  <h3 class="font-black text-xl text-zinc-900 dark:text-white mb-1">
                    {{ req.clinic?.name || 'Clinique Vétérinaire' }}
                  </h3>

                  <p class="text-zinc-600 dark:text-zinc-300 mb-4">
                    Recherche <strong>{{ req.requiredSpecies }}</strong>
                    (Groupe <strong>{{ req.requiredBloodGroup }}</strong>)
                  </p>

                  <div class="bg-[#ff3b4e]/10 p-3 rounded-lg inline-block">
                    <p class="text-sm font-bold text-[#ff3b4e] flex items-center gap-2">
                      <i class="pi pi-heart-fill"></i>
                      Votre animal compatible : {{ req.matchingAnimal?.name }}
                    </p>
                  </div>
                </div>

                <div class="flex flex-col items-end gap-2 min-w-[150px]">
                  <Button
                    label="J'accepte d'aider"
                    icon="pi pi-check-circle"
                    class="w-full bg-[#ff3b4e]! border-[#ff3b4e]! hover:bg-[#e63545]!"
                    :loading="loadingAccept"
                    @click="handleAccept(req)"
                  />
                  <small class="text-xs text-zinc-400 text-center block">
                    Crée une mission immédiate
                  </small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
