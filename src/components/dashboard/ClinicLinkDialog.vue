<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import AutoComplete from 'primevue/autocomplete'
import { useClinicLink, mapClinicLinkErrorKey } from '@/composables/useClinicLink'
import { filterClinics } from '@/services/clinic-search-service'

// Popup facultative proposée à un Owner juste après la vérification de son email
// (`VerifyEmailView.vue` -> `ProfileView.vue`, `CLINIC_LINK_PROMPT_QUERY_KEY`) : se lier directement à UNE
// clinique de l'app. Voir `useClinicLink.js` pour la relation écrite et son interaction avec la
// validation vétérinaire.
const visible = defineModel('visible', { type: Boolean, default: false })

const { t } = useI18n()
const toast = useToast()
const { clinics, isLoading, isLinking, loadError, fetchClinics, linkToClinic } = useClinicLink()

const selectedClinic = ref(null)
const suggestions = ref([])
const linkError = ref(null)

watch(
  visible,
  (isVisible) => {
    if (isVisible && !clinics.value.length) fetchClinics()
  },
  { immediate: true },
)

const searchClinics = (event) => {
  suggestions.value = filterClinics(clinics.value, event.query)
}

const onConfirm = async () => {
  if (!selectedClinic.value?.id) return
  linkError.value = null
  try {
    await linkToClinic(selectedClinic.value.id)
    toast.add({
      severity: 'success',
      summary: t('common.success'),
      detail: t('dashboard.clinic_link.toast_linked', { name: selectedClinic.value.name }),
      life: 3000,
    })
    visible.value = false
  } catch (e) {
    console.error(e)
    linkError.value = mapClinicLinkErrorKey(e)
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="$t('dashboard.clinic_link.title')"
    :style="{ width: '32rem' }"
    :breakpoints="{ '640px': '92vw' }"
  >
    <p class="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed mb-4">
      {{ $t('dashboard.clinic_link.description') }}
    </p>

    <Message v-if="loadError" severity="error" class="mb-3">
      {{ $t('dashboard.clinic_link.errors.load') }}
    </Message>
    <Message v-if="linkError" severity="error" class="mb-3">
      {{ $t(linkError) }}
    </Message>

    <label for="clinic-link-search" class="block text-sm font-semibold mb-2">
      {{ $t('dashboard.clinic_link.label') }}
    </label>
    <AutoComplete
      v-model="selectedClinic"
      input-id="clinic-link-search"
      :suggestions="suggestions"
      option-label="name"
      dropdown
      force-selection
      :loading="isLoading"
      :disabled="isLoading || !!loadError"
      :placeholder="$t('dashboard.clinic_link.placeholder')"
      class="w-full"
      input-class="w-full"
      @complete="searchClinics"
    >
      <template #option="{ option }">
        <div class="flex flex-col">
          <span class="font-semibold text-sm">{{ option.name }}</span>
          <span v-if="option.address" class="text-xs text-zinc-500">{{ option.address }}</span>
        </div>
      </template>
      <template #empty>
        <span class="text-sm text-zinc-500">{{ $t('dashboard.clinic_link.no_result') }}</span>
      </template>
    </AutoComplete>

    <template #footer>
      <Button
        :label="$t('dashboard.clinic_link.later')"
        text
        class="!text-zinc-500"
        :disabled="isLinking"
        @click="visible = false"
      />
      <Button
        :label="$t('dashboard.clinic_link.confirm')"
        icon="pi pi-link"
        class="!bg-[#ff3b4e] !border-[#ff3b4e] hover:!bg-[#e63545]"
        :loading="isLinking"
        :disabled="!selectedClinic?.id"
        @click="onConfirm"
      />
    </template>
  </Dialog>
</template>
