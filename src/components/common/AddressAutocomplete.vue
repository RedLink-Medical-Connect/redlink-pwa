<script setup>
import { ref, watch } from 'vue'
import AutoComplete from 'primevue/autocomplete'
import { Geo } from '@aws-amplify/geo'

defineOptions({
  inheritAttrs: false,
})

const emit = defineEmits(['update:modelValue', 'select'])
const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  // Accessible name du champ, pour un formulaire qui n'affiche pas de <label> visible
  // (PrimeVue AutoComplete expose `ariaLabel` en prop dédiée, cf. RegisterOwnerView.vue).
  ariaLabel: {
    type: String,
    default: '',
  },
})

const suggestions = ref([])
const selectedAddress = ref(props.modelValue)

watch(() => props.modelValue, (newVal) => {
  if (newVal !== selectedAddress.value) {
    selectedAddress.value = newVal
  }
}, { immediate: true })

const searchAddress = async (event) => {
  if (!event.query || event.query.length < 3) return

  try {
    const results = await Geo.searchByText(event.query, { maxResults: 5 })

    suggestions.value = results.map((place) => ({
      label: place.label,
      value: place,
      geometry: place.geometry,
    }))
  } catch (error) {
    console.error('Erreur géo:', error)
  }
}

const onSelect = (event) => {
  const place = event.value

  const data = {
    address: place.label,
    latitude: place.geometry.point[1],
    longitude: place.geometry.point[0],
  }

  emit('update:modelValue', place.label)
  emit('select', data)
}
</script>

<template>
  <div class="w-full">
    <AutoComplete
      v-model="selectedAddress"
      :suggestions="suggestions"
      option-label="label"
      :placeholder="$t('common.address_placeholder')"
      :aria-label="ariaLabel || undefined"
      class="w-full"
      :input-class="[
        'w-full !p-3 rounded-md transition-colors',
        !$attrs.class ? '!bg-zinc-200 dark:!bg-zinc-800 !border-none' : '',
        $attrs.class,
      ]"
      @complete="searchAddress"
      @item-select="onSelect"
      @input="emit('update:modelValue', $event.target.value)"
    >
      <template #option="slotProps">
        <div class="flex items-center gap-2">
          <i class="pi pi-map-marker text-[#ff3b4e]"></i>
          <span class="text-sm">{{ slotProps.option.label }}</span>
        </div>
      </template>
    </AutoComplete>
  </div>
</template>
