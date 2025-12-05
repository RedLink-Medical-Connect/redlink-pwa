<script setup>
import { ref } from 'vue'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'

const activeTab = ref('general')

const ownerForm = ref({
  firstname: 'Jean',
  lastname: 'Dupont',
  email: 'jean.dupont@gmail.com',
  phone: '06 12 34 56 78',
  address: '42 Avenue de la République',
  zip: '69002',
  city: 'Lyon'
})

const animals = ref([
  { id: 1, name: 'Rex', species: 'Chien', breed: 'Labrador', age: 4, weight: 32, bloodGroup: 'DEA 1.1-', status: 'active' },
  { id: 2, name: 'Mina', species: 'Chat', breed: 'Européen', age: 2, weight: 4.5, bloodGroup: 'A', status: 'pause' }
])

const preferences = ref({
  distance: 30,
  vacationMode: false
})

const tabs = [
  { id: 'general', label: 'dashboard.owner.tabs.general' },
  { id: 'animals', label: 'dashboard.owner.tabs.animals' },
  { id: 'availability', label: 'dashboard.owner.tabs.availability' }
]
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">

    <div class="flex flex-col md:flex-row gap-8">

      <DashboardSidebar />

      <div class="flex-grow">

        <div class="bg-white dark:bg-zinc-900 rounded-t-lg border-b border-zinc-200 dark:border-zinc-800 p-2 flex flex-wrap gap-1 transition-colors duration-300">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="px-4 py-2 text-[10px] md:text-xs font-bold uppercase rounded transition-colors"
            :class="activeTab === tab.id
              ? 'bg-[#ff3b4e] text-white shadow-md'
              : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'"
            @click="activeTab = tab.id"
          >
            {{ $t(tab.label) }}
          </button>
        </div>

        <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-b-lg p-6 md:p-10 animate-fade-in min-h-[500px] shadow-sm transition-colors duration-300">

          <form v-if="activeTab === 'general'" class="flex flex-col gap-6 max-w-3xl">
            <h2 class="text-xl font-bold text-zinc-900 dark:text-white mb-4 border-l-4 border-[#ff3b4e] pl-3">
              {{ $t('dashboard.owner.tabs.general') }}
            </h2>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('dashboard.owner.general.firstname') }}</label>
                <InputText v-model="ownerForm.firstname" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('dashboard.owner.general.lastname') }}</label>
                <InputText v-model="ownerForm.lastname" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('dashboard.owner.general.email') }}</label>
              <InputText v-model="ownerForm.email" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('dashboard.owner.general.phone') }}</label>
              <InputText v-model="ownerForm.phone" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('dashboard.owner.general.address') }}</label>
              <InputText v-model="ownerForm.address" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
            </div>

            <div class="grid grid-cols-2 gap-6">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('dashboard.owner.general.zip') }}</label>
                <InputText v-model="ownerForm.zip" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('dashboard.owner.general.city') }}</label>
                <InputText v-model="ownerForm.city" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
              </div>
            </div>

            <div class="flex justify-end mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800">
              <Button :label="$t('common.save')" class="!bg-[#ff3b4e] !border-[#ff3b4e] font-bold px-8" />
            </div>
          </form>

          <div v-else-if="activeTab === 'animals'" class="flex flex-col gap-6">
            <h2 class="text-xl font-bold text-zinc-900 dark:text-white mb-2 border-l-4 border-[#ff3b4e] pl-3">
              {{ $t('dashboard.owner.tabs.animals') }}
            </h2>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div v-for="animal in animals" :key="animal.id" class="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 relative group hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors shadow-sm">
                <div class="flex justify-between items-start mb-4">
                  <div class="flex items-center gap-3">
                    <div class="w-12 h-12 bg-white dark:bg-zinc-800 rounded-full flex items-center justify-center text-2xl shadow-sm">
                      {{ animal.species === 'Chien' ? '🐶' : '🐱' }}
                    </div>
                    <div>
                      <h3 class="text-lg font-bold text-zinc-900 dark:text-white leading-none">{{ animal.name }}</h3>
                      <span class="text-xs text-zinc-500">{{ animal.breed }}</span>
                    </div>
                  </div>
                  <Tag :value="animal.bloodGroup" severity="danger" rounded />
                </div>

                <div class="grid grid-cols-2 gap-4 text-sm text-zinc-500 mb-4">
                  <div class="bg-white dark:bg-zinc-900 p-2 rounded text-center border border-zinc-100 dark:border-zinc-800">
                    <span class="block font-bold text-zinc-900 dark:text-white">{{ animal.weight }} {{ $t('common.kg') }}</span>
                    <span class="text-[10px] uppercase">{{ $t('common.weight') }}</span>
                  </div>
                  <div class="bg-white dark:bg-zinc-900 p-2 rounded text-center border border-zinc-100 dark:border-zinc-800">
                    <span class="block font-bold text-zinc-900 dark:text-white">{{ animal.age }} {{ $t('common.years') }}</span>
                    <span class="text-[10px] uppercase">{{ $t('common.age') }}</span>
                  </div>
                </div>

                <Button :label="$t('common.edit')" icon="pi pi-pencil" size="small" variant="outlined" class="w-full !text-zinc-500 dark:!text-zinc-400 !border-zinc-300 dark:!border-zinc-700 hover:!bg-zinc-100 dark:hover:!bg-zinc-800 hover:!text-zinc-900 dark:hover:!text-white" />
              </div>

              <div class="border-2 border-dashed border-zinc-300 dark:border-zinc-800 rounded-xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[#ff3b4e] hover:bg-red-50 dark:hover:bg-red-500/5 transition-all group min-h-[200px]">
                <div class="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center group-hover:bg-[#ff3b4e] transition-colors">
                  <i class="pi pi-plus text-xl text-zinc-400 dark:text-zinc-500 group-hover:text-white"></i>
                </div>
                <span class="text-sm font-bold text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-white uppercase tracking-wider">
                  {{ $t('dashboard.owner.animals.add_btn') }}
                </span>
              </div>
            </div>
          </div>

          <div v-else-if="activeTab === 'availability'" class="flex flex-col gap-8 max-w-2xl">
            <h2 class="text-xl font-bold text-zinc-900 dark:text-white border-l-4 border-[#ff3b4e] pl-3">
              {{ $t('dashboard.owner.tabs.availability') }}
            </h2>

            <div class="bg-zinc-50 dark:bg-zinc-950 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800">
              <label class="text-sm font-bold text-zinc-500 uppercase mb-6 block">
                {{ $t('dashboard.owner.availability.distance_label') }}
                <span class="text-[#ff3b4e] text-lg ml-2">{{ preferences.distance }} km</span>
              </label>
              <Slider v-model="preferences.distance" :min="5" :max="100" class="w-full" />
              <div class="flex justify-between text-xs text-zinc-500 mt-2">
                <span>{{ $t('dashboard.owner.availability.min_distance') }}</span>
                <span>{{ $t('dashboard.owner.availability.max_distance') }}</span>
              </div>
            </div>

            <div class="bg-zinc-50 dark:bg-zinc-950 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h4 class="text-zinc-900 dark:text-white font-bold">{{ $t('dashboard.owner.availability.vacation_mode') }}</h4>
                <p class="text-xs text-zinc-500 mt-1">{{ $t('dashboard.owner.availability.vacation_mode_desc') }}</p>
              </div>
              <ToggleSwitch v-model="preferences.vacationMode" />
            </div>
          </div>

        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.animate-fade-in { animation: fadeIn 0.4s ease-out; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
</style>
