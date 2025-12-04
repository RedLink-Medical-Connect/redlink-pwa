<script setup>
import AppHeader from '@/components/common/AppHeader.vue'
import AppFooter from '@/components/common/AppFooter.vue'
import AppMobileMenu from '@/components/common/AppMobileMenu.vue'
</script>

<template>
  <div class="min-h-screen flex flex-col bg-white dark:bg-zinc-950 transition-colors duration-300">
    <AppHeader />

    <main class="flex-grow pb-24 md:pb-0">
      <slot />
    </main>

    <div class="hidden md:block">
      <AppFooter />
    </div>

    <AppMobileMenu />

  </div>
</template>
