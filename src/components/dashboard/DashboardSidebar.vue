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
      class="flex flex-col gap-1 bg-white dark:bg-zinc-900 rounded-lg p-2 border border-zinc-200 dark:border-zinc-800 transition-colors duration-300"
    >
      <router-link
        v-for="item in currentMenuItems"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-all duration-200"
        :class="
          route.path.startsWith(item.to)
            ? '!bg-[#ff3b4e] !text-white shadow-md shadow-red-500/20'
            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white'
        "
      >
        <i :class="item.icon"></i>
        <span>{{ t(item.label) }}</span>
      </router-link>
    </nav>
  </div>
</template>
