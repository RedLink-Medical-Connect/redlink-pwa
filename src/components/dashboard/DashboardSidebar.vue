<script setup>
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useMenu } from '@/composables/useMenu.js'

const route = useRoute()
const { t } = useI18n()
const { currentMenuItems } = useMenu()
</script>

<template>
  <div class="flex flex-col gap-2 w-full md:w-64 flex-shrink-0">
    <nav
      class="dashboard-sidebar-scroll flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-visible bg-white dark:bg-zinc-900 rounded-lg p-2 border border-zinc-200 dark:border-zinc-800 transition-colors duration-300"
    >
      <router-link
        v-for="item in currentMenuItems"
        :key="item.to"
        :to="item.to"
        class="flex flex-col md:flex-row items-center md:items-center justify-center md:justify-start gap-1 md:gap-3 px-3 py-2 md:px-4 md:py-3 rounded-md text-xs md:text-sm font-medium transition-all duration-200 flex-shrink-0 md:flex-shrink whitespace-nowrap"
        :class="
          route.path.startsWith(item.to)
            ? '!bg-[#ff3b4e] !text-white shadow-md shadow-red-500/20'
            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white'
        "
      >
        <i :class="item.icon" class="text-base md:text-sm"></i>
        <span>{{ t(item.label) }}</span>
      </router-link>
    </nav>
  </div>
</template>

<style scoped>
.dashboard-sidebar-scroll {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.dashboard-sidebar-scroll::-webkit-scrollbar {
  display: none;
}
</style>
