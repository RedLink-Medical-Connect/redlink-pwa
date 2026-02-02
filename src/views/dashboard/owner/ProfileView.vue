<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import PhoneInput from '@/components/common/PhoneInput.vue'
import AddressAutocomplete from '@/components/common/AddressAutocomplete.vue'

import { useOwnerProfile } from '@/composables/useOwnerProfile'

const { t } = useI18n()
const toast = useToast()

const { form, isLoading, isSaving, fetchProfile, updateProfile, deleteAccount } = useOwnerProfile()

const showDeleteConfirm = ref(false)

const onAddressSelect = (data) => {
  form.value.address = data.address
  form.value.latitude = data.latitude
  form.value.longitude = data.longitude
}

const onSave = async () => {
  try {
    await updateProfile()
    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t('dashboard.profile.toasts.saved'),
      life: 3000,
    })
  } catch (e) {
    console.error(e)
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t('dashboard.profile.toasts.save_failed'),
      life: 3000,
    })
  }
}

const onDelete = async () => {
  try {
    await deleteAccount()
    toast.add({
      severity: 'info',
      summary: t('common.deleted'),
      detail: t('dashboard.profile.toasts.deleted'),
      life: 3000,
    })
  } catch (e) {
    console.error(e)
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t('dashboard.profile.toasts.delete_failed'),
      life: 5000,
    })
    showDeleteConfirm.value = false
  }
}

onMounted(() => {
  fetchProfile().catch(() => {
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t('dashboard.profile.toasts.load_failed'),
      life: 3000,
    })
  })
})
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <Toast />

    <Dialog
      v-model:visible="showDeleteConfirm"
      modal
      :header="$t('dashboard.profile.dialog.title')"
      :style="{ width: '350px' }"
    >
      <div class="flex items-center gap-3 mb-4">
        <i class="pi pi-exclamation-triangle text-red-600 text-3xl"></i>
        <span class="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
          {{ $t('dashboard.profile.dialog.confirm') }}
        </span>
      </div>
      <template #footer>
        <Button
          :label="$t('common.cancel')"
          text
          class="!text-zinc-500"
          @click="showDeleteConfirm = false"
        />
        <Button
          :label="$t('dashboard.profile.dialog.confirm_action')"
          severity="danger"
          :loading="isSaving"
          @click="onDelete"
        />
      </template>
    </Dialog>

    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />

      <div class="flex-grow space-y-6">
        <div>
          <h1
            class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider border-l-4 border-[#ff3b4e] pl-4"
          >
            {{ $t('dashboard.owner.tabs.general') }}
          </h1>
        </div>

        <div v-if="isLoading" class="p-12 text-center">
          <i class="pi pi-spin pi-spinner text-4xl text-[#ff3b4e]"></i>
        </div>

        <div
          v-else
          class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 md:p-8 shadow-sm animate-fade-in"
        >
          <form class="flex flex-col gap-6 max-w-3xl" @submit.prevent="onSave">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{
                  $t('dashboard.owner.general.firstname')
                }}</label>
                <InputText
                  v-model="form.firstname"
                  class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !p-3"
                />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-zinc-500 uppercase">{{
                  $t('dashboard.owner.general.lastname')
                }}</label>
                <InputText
                  v-model="form.lastname"
                  class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !p-3"
                />
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs font-bold text-zinc-500 uppercase">{{
                $t('dashboard.owner.general.email')
              }}</label>
              <InputText
                v-model="form.email"
                disabled
                class="!bg-zinc-100 dark:!bg-zinc-900 !text-zinc-400 !border-zinc-200 dark:!border-zinc-800 !p-3 cursor-not-allowed"
              />
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs font-bold text-zinc-500 uppercase">{{
                $t('dashboard.owner.general.phone')
              }}</label>
              <PhoneInput
                v-model="form.phone"
                class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !p-3"
              />
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs font-bold text-zinc-500 uppercase">{{
                $t('dashboard.profile.address_label')
              }}</label>
              <AddressAutocomplete
                :model-value="form.address"
                class="!bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800 !p-3"
                @select="onAddressSelect"
              />
            </div>

            <div
              class="p-6 bg-zinc-50 dark:bg-zinc-950/50 rounded-lg border border-zinc-200 dark:border-zinc-800"
            >
              <label class="text-sm font-bold text-zinc-700 dark:text-white uppercase mb-4 block">
                {{ $t('dashboard.profile.distance_label') }}
                <span class="text-[#ff3b4e]">{{ form.maxTravelDistance }} {{ $t('common.km') }}</span>
              </label>
              <Slider v-model="form.maxTravelDistance" :min="5" :max="100" class="w-full" />
            </div>

            <div class="flex justify-end pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <Button
                type="submit"
                :label="$t('common.save')"
                icon="pi pi-check"
                :loading="isSaving"
                class="!bg-[#ff3b4e] !border-[#ff3b4e] font-bold px-6"
              />
            </div>
          </form>
        </div>

        <div
          class="border border-red-200 bg-red-50 dark:bg-red-900/10 p-6 rounded-xl mt-8 flex flex-col md:flex-row items-center justify-between gap-4"
        >
          <div>
            <h3 class="text-red-600 font-bold mb-1">{{ $t('dashboard.profile.danger_zone') }}</h3>
            <p class="text-sm text-red-600/70">{{ $t('dashboard.profile.danger_desc') }}</p>
          </div>
          <Button
            :label="$t('dashboard.profile.delete_account')"
            severity="danger"
            outlined
            icon="pi pi-trash"
            @click="showDeleteConfirm = true"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.4s ease-out;
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
