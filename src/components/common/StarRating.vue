<script setup>
import { RATING_MIN_STARS, RATING_MAX_STARS } from '@/composables/useRatings'

// Widget étoiles réutilisable (double validation de Mission / notation, sous-tâche UI) — même
// forme de wrapper que PhoneInput.vue/AddressAutocomplete.vue (`inheritAttrs: false`, prop
// `ariaLabel` par défaut `''`, forwardée nommément). Deux modes :
// - Interactif (`readonly` absent/false) : sélection au clic/clavier, `v-model` entier borné
//   [`RATING_MIN_STARS`, `RATING_MAX_STARS`] (importées de `useRatings.js`, jamais redéclarées
//   ici — même échelle que ce que `submitRating` accepte côté serveur).
// - Lecture seule (`readonly`) : affiche un agrégat serveur décimal (ex.
//   `Clinic.averageRatingAsClinic`/`Owner.averageRatingAsOwner`) — étoiles pleines/à moitié
//   pleines/vides (`pi-star-fill`/`pi-star-half-fill`/`pi-star`).
//
// Accessibilité (brief explicite) : `role="radiogroup"`/`role="radio"` en mode interactif (un
// seul choix possible parmi les 5 valeurs), jamais un `<div>` avec juste `@click` — chaque
// étoile est un `<button type="button">` natif, focusable et activable au clavier
// (Entrée/Espace, comportement natif du bouton). En lecture seule, les boutons sont
// `disabled` (non focusables) et le groupe porte `role="img"` : ce n'est plus un contrôle,
// juste une représentation visuelle de l'agrégat — `ariaLabel` (posé par l'appelant, ex.
// "Note moyenne de la clinique") reste le seul texte accessible du groupe.
defineOptions({
  inheritAttrs: false,
})

const emit = defineEmits(['update:modelValue'])

const props = defineProps({
  // Interactif : entier RATING_MIN_STARS..RATING_MAX_STARS (0 = aucune sélection).
  // Lecture seule : décimale (agrégat serveur).
  modelValue: {
    type: Number,
    default: 0,
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  ariaLabel: {
    type: String,
    default: '',
  },
})

const starValues = Array.from(
  { length: RATING_MAX_STARS - RATING_MIN_STARS + 1 },
  (_, i) => RATING_MIN_STARS + i,
)

const isSelected = (value) => (props.modelValue ?? 0) >= value

/**
 * Icône pi- pour l'étoile d'index `value` (1-based, base 1 = `RATING_MIN_STARS`) :
 * - pleine si `modelValue` l'atteint ou le dépasse ;
 * - à moitié pleine UNIQUEMENT en lecture seule (un choix interactif est toujours un entier,
 *   une demi-étoile ne peut donc provenir que d'un agrégat serveur décimal) ;
 * - vide sinon.
 */
const iconFor = (value) => {
  const current = props.modelValue ?? 0
  if (current >= value) return 'pi-star-fill'
  if (props.readonly && current > value - 1) return 'pi-star-half-fill'
  return 'pi-star'
}

const selectStar = (value) => {
  if (props.readonly) return
  emit('update:modelValue', value)
}
</script>

<template>
  <div
    class="inline-flex items-center gap-1"
    :class="$attrs.class"
    :role="readonly ? 'img' : 'radiogroup'"
    :aria-label="ariaLabel || undefined"
  >
    <button
      v-for="value in starValues"
      :key="value"
      type="button"
      :role="readonly ? undefined : 'radio'"
      :aria-checked="readonly ? undefined : isSelected(value)"
      :disabled="readonly"
      class="text-lg leading-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      :class="readonly ? 'cursor-default' : 'cursor-pointer'"
      @click="selectStar(value)"
    >
      <i :class="['pi', iconFor(value), 'text-amber-400 dark:text-amber-500']"></i>
    </button>
  </div>
</template>
