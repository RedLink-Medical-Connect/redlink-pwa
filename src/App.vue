<script setup>
import { computed, defineAsyncComponent } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const layout = computed(() => {
  const layoutName = route.meta.layout || 'AppLayout'

  return defineAsyncComponent(() => import(`@/layouts/${layoutName}.vue`))
})
</script>

<template>
  <component :is="layout">
    <RouterView />
  </component>
</template>
