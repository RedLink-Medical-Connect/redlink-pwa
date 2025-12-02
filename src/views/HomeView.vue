<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMouse } from '@vueuse/core'
import { LMap, LTileLayer, LMarker } from '@vue-leaflet/vue-leaflet'

const { locale } = useI18n()
const toggleLanguage = () => {
  locale.value = locale.value === 'fr' ? 'en' : 'fr'
}

const { x, y } = useMouse()

const zoom = ref(6)
const center = ref([46.603354, 1.888334])
</script>

<template>
  <div class="min-h-screen bg-slate-50 p-8 flex flex-col gap-8">

    <div class="text-center space-y-2">
      <h1 class="text-4xl font-bold text-slate-800 flex items-center justify-center gap-3">
        <i class="pi pi-verified text-green-500 text-3xl"></i>
        {{ $t('home.title') }}
      </h1>
      <p class="text-slate-500">{{ $t('home.subtitle') }}</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto w-full">

      <Card class="shadow-lg">
        <template #title>{{ $t('cards.i18n.title') }}</template>
        <template #content>
          <div class="flex flex-col gap-4">
            <p>
              {{ $t('cards.i18n.currentLanguage') }} :
              <Badge :value="locale.toUpperCase()" severity="info" />
            </p>
            <div class="flex gap-2">
              <Button @click="toggleLanguage" :label="$t('buttons.changeLanguage')" icon="pi pi-globe" />
              <Button :label="$t('buttons.danger')" severity="danger" icon="pi pi-trash" outlined />
            </div>
          </div>
        </template>
      </Card>

      <Card class="shadow-lg">
        <template #title>{{ $t('cards.mouse.title') }}</template>
        <template #content>
          <div class="flex flex-col gap-2">
            <p>{{ $t('cards.mouse.moveMouse') }}</p>
            <div class="flex gap-4 text-xl font-mono text-blue-600">
              <span>X: {{ x }}</span>
              <span>Y: {{ y }}</span>
            </div>
          </div>
        </template>
      </Card>

      <Card class="shadow-lg col-span-1 md:col-span-2">
        <template #title>{{ $t('cards.map.title') }}</template>
        <template #content>
          <div class="h-64 w-full rounded-lg overflow-hidden border border-slate-300 relative z-0">
            <l-map ref="map" v-model:zoom="zoom" :center="center" :use-global-leaflet="false">
              <l-tile-layer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                layer-type="base"
                name="OpenStreetMap"
              ></l-tile-layer>
              <l-marker :lat-lng="[48.8566, 2.3522]"></l-marker>
            </l-map>
          </div>
        </template>
      </Card>

    </div>
  </div>
</template>
