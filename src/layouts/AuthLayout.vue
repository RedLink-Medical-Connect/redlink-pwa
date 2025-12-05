<script setup>
import AppHeader from '@/components/common/AppHeader.vue'
import AppFooter from '@/components/common/AppFooter.vue'
</script>

<template>
  <div class="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 transition-colors duration-300">
    <AppHeader />

    <main class="flex-grow container mx-auto px-4 py-12 md:py-20 flex items-center justify-center">
      <slot />
    </main>

    <AppFooter />
  </div>
</template>
