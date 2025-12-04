<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
// Auto-import: InputText, Textarea, Select, DatePicker, Button, Tag...

const { t } = useI18n()
const step = ref(1) // 1 = Choix, 2 = Formulaire
const requestType = ref('') // 'emergency' ou 'appointment'

// Données du formulaire
const form = ref({
  patientName: '',
  species: null,
  breed: '',
  weight: null,
  bloodGroup: null,
  quantity: null,
  date: null,
  details: ''
})

// Options pour les selects (traduites)
const speciesOptions = computed(() => [
  { label: t('request.species.dog'), value: 'dog' },
  { label: t('request.species.cat'), value: 'cat' }
])

const bloodOptions = computed(() => {
  if (form.value.species === 'cat') return ['A', 'B', 'AB']
  if (form.value.species === 'dog') return ['DEA 1.1-', 'DEA 1.1+', 'Dal', 'Kai']
  return []
})

const selectType = (type) => {
  requestType.value = type
  step.value = 2
}

const handleSubmit = () => {
  // Ici on connectera le Store plus tard
  // TODO: Implémenter l'envoi de la demande au backend
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <div class="flex flex-col md:flex-row gap-8">

      <DashboardSidebar />

      <div class="flex-grow">

        <div class="mb-8">
          <h1 class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider border-l-4 border-[#ff3b4e] pl-4">
            {{ $t('request.title') }}
          </h1>
          <p v-if="step === 1" class="text-zinc-500 mt-2 ml-5">{{ $t('request.step1_subtitle') }}</p>
        </div>

        <div v-if="step === 1" class="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">

          <div
            class="group cursor-pointer relative overflow-hidden rounded-2xl border-2 border-[#ff3b4e] bg-red-50 dark:bg-red-900/10 p-8 hover:bg-[#ff3b4e] transition-all duration-300 shadow-lg hover:shadow-red-500/30"
            @click="selectType('emergency')"
          >
            <div class="absolute -right-10 -bottom-10 w-40 h-40 bg-[#ff3b4e]/20 rounded-full blur-3xl group-hover:bg-white/20 transition-colors"></div>

            <div class="relative z-10 flex flex-col h-full">
              <div class="flex justify-between items-start mb-6">
                <div class="w-14 h-14 rounded-full bg-[#ff3b4e] text-white flex items-center justify-center text-2xl shadow-md group-hover:bg-white group-hover:text-[#ff3b4e] transition-colors">
                  <i class="pi pi-bolt"></i>
                </div>
                <Tag :value="$t('request.emergency.badge')" severity="danger" class="uppercase text-[10px]" />
              </div>

              <h3 class="text-xl font-black text-zinc-900 dark:text-white mb-2 uppercase group-hover:text-white">
                {{ $t('request.emergency.title') }}
              </h3>
              <p class="text-sm text-zinc-600 dark:text-zinc-300 group-hover:text-white/90 leading-relaxed">
                {{ $t('request.emergency.desc') }}
              </p>
            </div>
          </div>

          <div
            class="group cursor-pointer relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-8 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all duration-300 shadow-sm hover:shadow-blue-500/20"
            @click="selectType('appointment')"
          >
            <div class="relative z-10 flex flex-col h-full">
              <div class="flex justify-between items-start mb-6">
                <div class="w-14 h-14 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 flex items-center justify-center text-2xl group-hover:bg-blue-500 group-hover:text-white transition-colors">
                  <i class="pi pi-calendar"></i>
                </div>
                <Tag :value="$t('request.appointment.badge')" severity="info" class="uppercase text-[10px]" />
              </div>

              <h3 class="text-xl font-black text-zinc-900 dark:text-white mb-2 uppercase group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {{ $t('request.appointment.title') }}
              </h3>
              <p class="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {{ $t('request.appointment.desc') }}
              </p>
            </div>
          </div>

        </div>

        <div v-else class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 md:p-8 animate-slide-up shadow-sm">

          <div class="flex items-center justify-between mb-8 pb-4 border-b border-zinc-100 dark:border-zinc-800">
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 rounded-full flex items-center justify-center text-white shadow-md"
                :class="requestType === 'emergency' ? 'bg-[#ff3b4e]' : 'bg-blue-500'"
              >
                <i :class="requestType === 'emergency' ? 'pi pi-bolt' : 'pi pi-calendar'"></i>
              </div>
              <h2 class="text-lg font-bold text-zinc-900 dark:text-white uppercase">
                {{ requestType === 'emergency' ? $t('request.form.title_emergency') : $t('request.form.title_appointment') }}
              </h2>
            </div>
            <Button
              :label="$t('request.form.back')"
              icon="pi pi-arrow-left"
              variant="text"
              size="small"
              class="!text-zinc-500 hover:!text-zinc-800 dark:hover:!text-white"
              @click="step = 1"
            />
          </div>

          <form class="flex flex-col gap-6 max-w-3xl" @submit.prevent="handleSubmit">

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('request.form.patient_name') }}</label>
                <InputText v-model="form.patientName" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div class="flex flex-col gap-2">
                  <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('request.form.species') }}</label>
                  <Select
                    v-model="form.species"
                    :options="speciesOptions"
                    option-label="label"
                    option-value="value"
                    :placeholder="$t('request.form.select_placeholder')"
                    class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white"
                  />
                </div>
                <div class="flex flex-col gap-2">
                  <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('request.form.breed') }}</label>
                  <InputText v-model="form.breed" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('request.form.weight') }}</label>
                <InputNumber v-model="form.weight" suffix=" kg" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white focus:!border-[#ff3b4e]" input-class="!bg-transparent !border-none" />
              </div>

              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('request.form.blood_group') }}</label>
                <Select
                  v-model="form.bloodGroup"
                  :options="bloodOptions"
                  :disabled="!form.species"
                  :placeholder="$t('request.form.select_blood_placeholder')"
                  class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white"
                />
              </div>

              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('request.form.quantity') }}</label>
                <InputNumber v-model="form.quantity" suffix=" ml" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white focus:!border-[#ff3b4e]" input-class="!bg-transparent !border-none" />
              </div>
            </div>

            <div v-if="requestType === 'appointment'" class="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-900/30 grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase">{{ $t('request.form.date_label') }}</label>
                <DatePicker v-model="form.date" show-icon class="w-full" input-class="!bg-white dark:!bg-zinc-900 !border-blue-200 dark:!border-blue-800" />
              </div>
              <div class="flex flex-col justify-center text-sm text-blue-600 dark:text-blue-400">
                <i class="pi pi-info-circle mb-1"></i>
                {{ $t('request.appointment.info') }}
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs font-bold text-zinc-500 uppercase">{{ $t('request.form.details') }}</label>
              <Textarea v-model="form.details" rows="3" class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !text-zinc-900 dark:!text-white !p-3 focus:!border-[#ff3b4e]" />
            </div>

            <div class="pt-6 mt-2 border-t border-zinc-200 dark:border-zinc-800">
              <Button
                type="submit"
                :label="requestType === 'emergency' ? $t('request.form.submit_emergency') : $t('request.form.submit_appointment')"
                :icon="requestType === 'emergency' ? 'pi pi-megaphone' : 'pi pi-search'"
                class="w-full md:w-auto !text-white font-bold px-8 py-3 shadow-lg transition-transform hover:scale-105"
                :class="requestType === 'emergency' ? '!bg-[#ff3b4e] !border-[#ff3b4e] hover:!bg-[#e63545]' : '!bg-blue-600 !border-blue-600 hover:!bg-blue-700'"
              />
            </div>

          </form>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in { animation: fadeIn 0.4s ease-out; }
.animate-slide-up { animation: slideUp 0.4s ease-out; }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
</style>
