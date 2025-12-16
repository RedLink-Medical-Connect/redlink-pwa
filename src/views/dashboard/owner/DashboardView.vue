<script setup>
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import { useOwnerMissions } from '@/composables/useOwnerMissions'
import { useToast } from 'primevue/usetoast'

const { t } = useI18n()
const toast = useToast()
const { missions, isLoading, isAccepting, fetchAvailableMissions, acceptMission } =
  useOwnerMissions()

onMounted(() => {
  fetchAvailableMissions()
})

const formatDate = (dateString) => {
  if (!dateString) return t('dashboard.owner.missions.asap')
  return new Date(dateString).toLocaleDateString(t('common.locale'), {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const handleAccept = async (mission) => {
  try {
    const heroName = await acceptMission(mission)

    toast.add({
      severity: 'success',
      summary: t('dashboard.owner.missions.toasts.accepted_title'),
      detail: t('dashboard.owner.missions.toasts.accepted_detail', { name: heroName }),
      life: 5000,
    })
  } catch (e) {
    if (e.message === 'NO_MATCHING_ANIMAL') {
      toast.add({
        severity: 'warn',
        summary: t('dashboard.owner.missions.toasts.incompatible_title'),
        detail: t('dashboard.owner.missions.toasts.incompatible_detail'),
        life: 5000,
      })
    } else {
      toast.add({
        severity: 'error',
        summary: t('common.error'),
        detail: t('dashboard.owner.missions.toasts.accept_failed'),
        life: 3000,
      })
    }
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <Toast />
    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />

      <div class="flex-grow">
        <div class="mb-8">
          <h1
            class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider border-l-4 border-[#ff3b4e] pl-4"
          >
            {{ $t('dashboard.owner.missions.title') }}
          </h1>
          <p class="text-zinc-500 mt-2 ml-5 text-sm">
            {{ $t('dashboard.owner.missions.subtitle') }}
          </p>
        </div>

        <div v-if="isLoading" class="flex justify-center py-12">
          <i class="pi pi-spin pi-spinner text-4xl text-[#ff3b4e]"></i>
        </div>

        <div
          v-else-if="missions.length === 0"
          class="flex flex-col items-center justify-center py-12 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800"
        >
          <div
            class="w-20 h-20 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4"
          >
            <i class="pi pi-check text-3xl text-green-500"></i>
          </div>
          <h3 class="text-lg font-bold text-zinc-900 dark:text-white">
            {{ $t('dashboard.owner.missions.empty_title') }}
          </h3>
          <p class="text-zinc-500 text-sm">
            {{ $t('dashboard.owner.missions.empty_subtitle') }}
          </p>
        </div>

        <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
          <div
            v-for="mission in missions"
            :key="mission.id"
            class="relative overflow-hidden bg-white dark:bg-zinc-900 rounded-xl border transition-all duration-300 hover:shadow-lg group"
            :class="
              mission.requestType === 'EMERGENCY'
                ? 'border-red-200 dark:border-red-900/30'
                : 'border-zinc-200 dark:border-zinc-800'
            "
          >
            <div class="absolute top-0 right-0 p-4">
              <Tag
                :value="mission.requestType === 'EMERGENCY' ? 'URGENCE VITALE' : 'RDV PROGRAMMÉ'"
                :severity="mission.requestType === 'EMERGENCY' ? 'danger' : 'info'"
                class="!text-[10px] font-bold shadow-sm"
              />
            </div>

            <div class="p-6">
              <div class="flex items-start gap-4 mb-4">
                <div
                  class="w-12 h-12 rounded-full flex items-center justify-center text-white shadow-md shrink-0"
                  :class="mission.requestType === 'EMERGENCY' ? 'bg-[#ff3b4e]' : 'bg-blue-500'"
                >
                  <i
                    :class="
                      mission.requestType === 'EMERGENCY'
                        ? 'pi pi-heart-fill animate-pulse'
                        : 'pi pi-calendar'
                    "
                  ></i>
                </div>
                <div>
                  <h3 class="font-bold text-lg text-zinc-900 dark:text-white leading-tight">
                    {{
                      $t('dashboard.owner.missions.card.title', {
                        species:
                          mission.requiredSpecies === 'DOG'
                            ? $t('request.species.dog')
                            : $t('request.species.cat'),
                      })
                    }}
                    <span class="text-zinc-400 font-normal">
                      {{ $t('dashboard.owner.missions.card.blood', { group: mission.requiredBloodGroup }) }}
                    </span>
                  </h3>
                  <p class="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                    <i class="pi pi-map-marker"></i> Clinique de Lausanne (2.5 km)
                  </p>
                </div>
              </div>

              <div class="space-y-3 mb-6">
                <div
                  class="flex justify-between items-center text-sm py-2 border-b border-zinc-100 dark:border-zinc-800"
                >
                  <span class="text-zinc-500">
                    {{ $t('dashboard.owner.missions.card.quantity') }}
                  </span>
                  <span class="font-semibold text-zinc-900 dark:text-white"
                    >{{ mission.quantity }} ml</span
                  >
                </div>
                <div
                  class="flex justify-between items-center text-sm py-2 border-b border-zinc-100 dark:border-zinc-800"
                >
                  <span class="text-zinc-500">
                    {{ $t('dashboard.owner.missions.card.date') }}
                  </span>
                  <span
                    class="font-semibold"
                    :class="
                      mission.requestType === 'EMERGENCY'
                        ? 'text-red-500'
                        : 'text-zinc-900 dark:text-white'
                    "
                  >
                    {{
                      mission.requestType === 'EMERGENCY'
                        ? $t('dashboard.owner.missions.card.immediately')
                        : formatDate(mission.createdAt)
                    }}
                  </span>
                </div>
              </div>

              <Button
                @click="handleAccept(mission)"
                :label="$t('dashboard.owner.missions.card.accept_cta')"
                :loading="isAccepting"
                :icon="mission.requestType === 'EMERGENCY' ? 'pi pi-bolt' : 'pi pi-check'"
                class="w-full font-bold shadow-md transition-transform active:scale-95"
                :class="
                  mission.requestType === 'EMERGENCY'
                    ? '!bg-[#ff3b4e] !border-[#ff3b4e] hover:!bg-[#e63545]'
                    : '!bg-zinc-900 !border-zinc-900 dark:!bg-white dark:!text-zinc-900'
                "
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.5s ease-out;
}
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
