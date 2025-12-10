<script setup>
import { ref } from 'vue'
import AutoComplete from 'primevue/autocomplete'
import { Geo } from '@aws-amplify/geo'

const emit = defineEmits(['update:modelValue', 'select'])
const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
})

const suggestions = ref([])
const selectedAddress = ref(props.modelValue)

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
    longitude: place.geometry.point[0]
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
      placeholder="Entrez votre adresse..."
      class="w-full"
      input-class="w-full !bg-zinc-200 dark:!bg-zinc-800 !border-none !p-3 rounded-md"
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
