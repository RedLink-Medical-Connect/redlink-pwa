<script setup>
import { ref, watch } from 'vue'
import { AsYouType, isValidPhoneNumber } from 'libphonenumber-js'

defineOptions({
  inheritAttrs: false
})

const emit = defineEmits(['update:modelValue', 'valid'])

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  // Accessible name du champ, pour un formulaire qui n'affiche pas de <label> visible
  // (PrimeVue InputText forwarde aria-label sur l'<input> natif — cf. RegisterOwnerView.vue).
  ariaLabel: {
    type: String,
    default: ''
  }
})

const phone = ref(props.modelValue)
const isValid = ref(true)

watch(() => props.modelValue, (newVal) => {
  phone.value = newVal
}, { immediate: true })

const handleInput = (event) => {
  const rawValue = event.target.value
  const asYouType = new AsYouType('FR')
  const formatted = asYouType.input(rawValue)

  phone.value = formatted
  emit('update:modelValue', formatted)

  const valid = isValidPhoneNumber(formatted, 'FR')
  isValid.value = valid
  emit('valid', valid)
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <InputText
      v-model="phone"
      placeholder="06 12 34 56 78"
      :aria-label="ariaLabel || undefined"
      :class="[
        'w-full !p-3 rounded-md transition-colors',
        !$attrs.class ? '!bg-zinc-200 dark:!bg-zinc-800 !border-none' : '',
        $attrs.class,
        !isValid && phone.length > 0 ? '!border !border-red-500 ring-1 ring-red-500' : ''
      ]"
      @input="handleInput"
    />
    <small v-if="!isValid && phone.length > 0" class="text-red-500 text-xs font-bold ml-1">
      {{ $t('errors.invalid_phone') }}
    </small>
  </div>
</template>
