<script setup>
import { useI18n } from 'vue-i18n'

const { locale } = useI18n()

const toggleLanguage = () => {
  locale.value = locale.value === 'fr' ? 'en' : 'fr'
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-8 p-4">

    <h1 class="text-4xl font-bold text-slate-800 text-center">
      {{ $t('home.title') }}
    </h1>

    <div class="flex flex-col sm:flex-row gap-4 w-full max-w-md">
      <Button
        :label="$t('home.vet_button')"
        icon="pi pi-briefcase"
        class="w-full p-button-lg"
      />

      <Button
        :label="$t('home.owner_button')"
        icon="pi pi-heart"
        severity="secondary"
        class="w-full p-button-lg"
      />
    </div>

    <button
      @click="toggleLanguage"
      class="text-sm text-slate-500 underline hover:text-slate-800 transition"
    >
      Switch Language ({{ locale.toUpperCase() }})
    </button>

  </div>
</template>
