<script setup>
import { ref, onMounted } from 'vue'
import { useToast } from 'primevue/usetoast'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import { useOwnerAvailability } from '@/composables/useOwnerAvailability'
import { DAYS_OF_WEEK, getDayLabel } from '@/constants/date-constants'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const toast = useToast()
const { availabilities, isLoading, fetchAvailabilities, addAvailability, removeAvailability } =
  useOwnerAvailability()

const selectedDay = ref(null)
const startTime = ref(null)
const endTime = ref(null)
const isSubmitting = ref(false)

onMounted(() => {
  fetchAvailabilities()
})

const formatTime = (date) => {
  if (!date) return null
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

const handleAdd = async () => {
  if (selectedDay.value === null || !startTime.value || !endTime.value) {
    toast.add({
      severity: 'warn',
      summary: t('dashboard.owner.availability.toasts.missing_fields'),
      detail: t('dashboard.owner.availability.toasts.fill'),
      life: 3000,
    })
    return
  }

  if (startTime.value >= endTime.value) {
    toast.add({
      severity: 'error',
      summary: t('dashboard.owner.availability.toasts.error'),
      detail: t('dashboard.owner.availability.toasts.end_date_after_start_date'),
      life: 3000,
    })
    return
  }

  isSubmitting.value = true
  try {
    await addAvailability(selectedDay.value, formatTime(startTime.value), formatTime(endTime.value))
    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t('dashboard.owner.availability.toasts.slot_added'),
      life: 3000,
    })

    startTime.value = null
    endTime.value = null
  } catch {
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t('dashboard.owner.availability.toasts.add_failed'),
      life: 3000,
    })
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <Toast />
    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />

      <div class="flex-grow">
        <h1
          class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider border-l-4 border-[#ff3b4e] pl-4 mb-8"
        >
          {{ $t('dashboard.owner.availability.title') }}
        </h1>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div class="lg:col-span-1">
            <div
              class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm sticky top-6"
            >
              <h3
                class="font-bold text-lg mb-4 text-zinc-900 dark:text-white flex items-center gap-2"
              >
                <i class="pi pi-plus-circle text-[#ff3b4e]"></i>
                {{ $t('dashboard.owner.availability.form.add_title') }}
              </h3>

              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                  <label class="text-xs font-bold uppercase text-zinc-500">
                    {{ $t('dashboard.owner.availability.form.day_label') }}
                  </label>
                  <Select
                    v-model="selectedDay"
                    :options="DAYS_OF_WEEK"
                    option-label="label"
                    option-value="value"
                    :placeholder="$t('dashboard.owner.availability.form.day_placeholder')"
                    class="w-full"
                  />
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div class="flex flex-col gap-2">
                    <label class="text-xs font-bold uppercase text-zinc-500">
                      {{ $t('dashboard.owner.availability.form.start_label') }}
                    </label>
                    <Calendar
                      v-model="startTime"
                      time-only
                      show-icon
                      icon-display="input"
                      step-minute="30"
                      :placeholder="$t('dashboard.owner.availability.form.start_placeholder')"
                      class="w-full"
                      input-class="w-full !bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800"
                    />
                  </div>
                  <div class="flex flex-col gap-2">
                    <label class="text-xs font-bold uppercase text-zinc-500">
                      {{ $t('dashboard.owner.availability.form.end_label') }}
                    </label>
                    <Calendar
                      v-model="endTime"
                      time-only
                      show-icon
                      icon-display="input"
                      step-minute="30"
                      :placeholder="$t('dashboard.owner.availability.form.end_placeholder')"
                      class="w-full"
                      input-class="w-full !bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800"
                    />
                  </div>
                </div>

                <Button
                  :label="$t('dashboard.owner.availability.form.save_button')"
                  icon="pi pi-check"
                  class="w-full !bg-[#ff3b4e] !border-[#ff3b4e] mt-2"
                  :loading="isSubmitting"
                  @click="handleAdd"
                />
              </div>
            </div>
          </div>

          <div class="lg:col-span-2">
            <div
              v-if="availabilities.length === 0 && !isLoading"
              class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-6 text-center"
            >
              <i class="pi pi-info-circle text-2xl text-blue-500 mb-2"></i>
              <h3 class="font-bold text-blue-700 dark:text-blue-400">
                {{ $t('dashboard.owner.availability.empty.title') }}
              </h3>
              <p class="text-sm text-blue-600/80 dark:text-blue-400/80 mt-1">
                {{ $t('dashboard.owner.availability.empty.description') }}
              </p>
            </div>

            <div v-if="isLoading" class="flex justify-center py-10">
              <i class="pi pi-spin pi-spinner text-3xl text-[#ff3b4e]"></i>
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="slot in availabilities"
                :key="slot.id"
                class="flex items-center justify-between bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-lg shadow-sm hover:border-[#ff3b4e] transition-colors group"
              >
                <div class="flex items-center gap-4">
                  <div
                    class="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center font-black text-zinc-400 text-sm uppercase"
                  >
                    {{ getDayLabel(slot.dayOfWeek).substring(0, 3) }}
                  </div>

                  <div>
                    <p class="font-bold text-zinc-900 dark:text-white text-lg leading-tight">
                      {{ getDayLabel(slot.dayOfWeek) }}
                    </p>
                    <div class="flex items-center gap-2 text-sm text-zinc-500 mt-1">
                      <span
                        class="bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-zinc-700 dark:text-zinc-300 font-mono"
                      >
                        {{ slot.startTime.substring(0, 5) }}
                      </span>
                      <i class="pi pi-arrow-right text-[10px]"></i>
                      <span
                        class="bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-zinc-700 dark:text-zinc-300 font-mono"
                      >
                        {{ slot.endTime.substring(0, 5) }}
                      </span>
                    </div>
                  </div>
                </div>

                <Button
                  icon="pi pi-trash"
                  text
                  rounded
                  severity="danger"
                  class="opacity-50 group-hover:opacity-100 transition-opacity"
                  @click="removeAvailability(slot.id)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
