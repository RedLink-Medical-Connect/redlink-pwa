<script setup>
import { ref, watch } from 'vue'
import AutoComplete from 'primevue/autocomplete'
import { breedsForSpecies } from '@/constants/breeds.js'

// Même pattern qu'AddressAutocomplete.vue (menu déroulant avec recherche, demande produit
// 2026-08-23) mais filtrage entièrement local sur `breedsForSpecies` -- pas d'API externe,
// contrairement à la géolocalisation. `forceSelection` volontairement absent (comportement
// par défaut de PrimeVue AutoComplete) : une race hors liste reste saisissable en texte
// libre (voir 'Autre' en fin de liste dans constants/breeds.js), la liste n'a pas besoin
// d'être strictement exhaustive pour rester utile.
defineOptions({
  inheritAttrs: false,
})

const emit = defineEmits(['update:modelValue'])
const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  // Species.DOG/Species.CAT (constants/enums.js) -- détermine quelle liste filtrer.
  species: {
    type: String,
    default: '',
  },
  ariaLabel: {
    type: String,
    default: '',
  },
  // Passthrough PrimeVue forwardé tel quel à l'`AutoComplete` interne -- même patron que
  // `AppDatePicker.vue` (`:pt="{ root, input, dropdownButton }"`, RegisterOwnerView.vue).
  // Nécessaire ici car `inheritAttrs: false` + injection manuelle de `$attrs.class` dans
  // `input-class` (ci-dessous) ne suffisent pas à aligner la hauteur de ce composant sur
  // celle d'un `Select`/`InputText` voisin : l'`AutoComplete` PrimeVue ajoute son propre
  // conteneur (`p-autocomplete`), dont le padding par défaut diffère de celui d'un `Select`
  // -- un correctif purement `class` sur l'`input` ne le rattrape pas. Défaut `{}` : aucun
  // effet sur les appelants existants (AddAnimalView.vue/ValidationsView.vue) qui ne le
  // passent pas.
  pt: {
    type: Object,
    default: () => ({}),
  },
})

const suggestions = ref([])
const selectedBreed = ref(props.modelValue)

watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal !== selectedBreed.value) {
      selectedBreed.value = newVal
    }
  },
  { immediate: true },
)

const searchBreed = (event) => {
  const query = (event.query || '').trim().toLowerCase()
  const options = breedsForSpecies(props.species)

  suggestions.value = query
    ? options.filter((breed) => breed.toLowerCase().includes(query)).slice(0, 15)
    : options.slice(0, 15)
}

const onSelect = (event) => {
  emit('update:modelValue', event.value)
}

const onInput = (event) => {
  emit('update:modelValue', event.target.value)
}
</script>

<template>
  <div class="w-full">
    <AutoComplete
      v-model="selectedBreed"
      :suggestions="suggestions"
      :placeholder="$t('common.breed_placeholder')"
      :aria-label="ariaLabel || undefined"
      :pt="pt"
      class="w-full"
      :input-class="[
        'w-full !p-3 rounded-md transition-colors',
        !$attrs.class ? '!bg-zinc-200 dark:!bg-zinc-800 !border-none' : '',
        $attrs.class,
      ]"
      @complete="searchBreed"
      @item-select="onSelect"
      @input="onInput"
    />
  </div>
</template>
