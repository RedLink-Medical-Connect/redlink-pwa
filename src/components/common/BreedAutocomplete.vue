<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AutoComplete from 'primevue/autocomplete'
import { breedsForSpecies, breedLabel, OTHER_BREED_CODE } from '@/constants/breeds.js'

// Même pattern qu'AddressAutocomplete.vue (menu déroulant avec recherche, demande produit
// 2026-08-23) mais filtrage entièrement local sur `breedsForSpecies` -- pas d'API externe,
// contrairement à la géolocalisation. `forceSelection` volontairement absent (comportement
// par défaut de PrimeVue AutoComplete) : une race hors liste reste saisissable en texte
// libre (voir 'Autre' en fin de liste dans constants/breeds.js), la liste n'a pas besoin
// d'être strictement exhaustive pour rester utile.
//
// Refonte 2026-09-01 : `props.modelValue`/l'événement émis portent désormais un CODE de
// race stable (ex. 'BERGER_ALLEMAND', constants/breeds.js), plus le libellé affiché
// directement -- la liste était figée en français quel que soit `locale`. `option-label`
// pose les suggestions comme des objets `{code, label}` (doc PrimeVue AutoComplete :
// "the component maintains the full object instance as the selected model value" tant
// qu'aucun `optionValue` n'existe pour ce composant, contrairement à `Select`) ; `selectedBreed`
// (v-model interne) ne porte JAMAIS cet objet -- toujours une chaîne (le libellé affiché),
// même pattern que `selectedAddress` dans AddressAutocomplete.vue, pour que la saisie libre
// (texte tapé, sans sélection dans la liste) reste affichée telle quelle par l'AutoComplete
// PrimeVue sous-jacent.
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

const { t, te, locale } = useI18n()

const suggestions = ref([])
const selectedBreed = ref(breedLabel(props.modelValue, t, te))

// Réagit aussi à `locale` (pas seulement `props.modelValue`) : une race déjà sélectionnée
// doit se retraduire quand l'utilisateur change de langue, sans que la valeur stockée
// (le code) ne bouge -- c'est ce qui manquait avant cette refonte.
watch(
  () => [props.modelValue, locale.value],
  ([newVal]) => {
    selectedBreed.value = breedLabel(newVal, t, te)
  },
  { immediate: true },
)

const searchBreed = (event) => {
  const query = (event.query || '').trim().toLowerCase()
  const options = breedsForSpecies(props.species).map((code) => ({
    code,
    label: breedLabel(code, t, te),
  }))

  suggestions.value = query
    ? options.filter((option) => option.label.toLowerCase().includes(query)).slice(0, 15)
    : options.slice(0, 15)
}

const onSelect = (event) => {
  const { code, label } = event.value
  selectedBreed.value = label
  // OTHER_BREED_CODE ('Autre'/'Other') n'est pas un vrai code de race -- émettre son
  // libellé plutôt que le sentinel laisse le champ en texte libre modifiable, à
  // l'identique du comportement d'avant cette refonte.
  emit('update:modelValue', code === OTHER_BREED_CODE ? label : code)
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
      option-label="label"
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
