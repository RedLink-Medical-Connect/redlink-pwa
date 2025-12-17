<script setup>
  import { computed } from 'vue'

  const props = defineProps({
  modelValue: {
  type: String,
  default: null
},
  placeholder: String,
  dateFormat: {
  type: String,
  default: 'dd/mm/yy'
},
  minDate: Date,
  maxDate: Date
})

  const emit = defineEmits(['update:modelValue'])

  const formatDateForAWS = (dateObj) => {
  if (!dateObj) return null
  const d = new Date(dateObj)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

  const dateProxy = computed({
  get() {
  return props.modelValue ? new Date(props.modelValue) : null
},
  set(val) {
  const formatted = formatDateForAWS(val)
  emit('update:modelValue', formatted)
}
})
</script>

<template>
  <Calendar
    v-model="dateProxy"
  :date-format="dateFormat"
  :placeholder="placeholder"
  :manual-input="false"
  show-icon
  icon-display="input"
  class="w-full"
  input-class="w-full !bg-zinc-50 dark:!bg-zinc-950 !border-zinc-300 dark:!border-zinc-800"
  v-bind="$attrs"
  />
</template>
