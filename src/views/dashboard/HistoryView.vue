<script setup>
import DashboardSidebar from '@/components/dashboard/DashboardSidebar.vue'
</script>

<template>
  <div class="container mx-auto px-4 py-8 md:py-12">
    <div class="flex flex-col md:flex-row gap-8">
      <DashboardSidebar />
      <div class="flex-grow">
        <h1 class="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider mb-6">{{ $t('dashboard.history.title') }}</h1>

        <div class="space-y-4">
          <div class="bg-white dark:bg-zinc-900 p-4 rounded border border-zinc-200 dark:border-zinc-800 flex gap-4 items-center shadow-sm transition-colors duration-300">
            <div class="w-10 h-10 rounded-full bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-500 flex items-center justify-center">
              <i class="pi pi-check"></i>
            </div>
            <div>
              <p class="text-zinc-900 dark:text-white font-medium">{{ $t('dashboard.history.request_closed', { id: 102 }) }}</p>
              <p class="text-xs text-zinc-500 dark:text-zinc-400">{{ $t('dashboard.history.time_ago', { time: '2 heures' }) }}</p>
            </div>
          </div>

          <div class="bg-white dark:bg-zinc-900 p-4 rounded border border-zinc-200 dark:border-zinc-800 flex gap-4 items-center shadow-sm transition-colors duration-300">
            <div class="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-500 flex items-center justify-center">
              <i class="pi pi-user-plus"></i>
            </div>
            <div>
              <p class="text-zinc-900 dark:text-white font-medium">{{ $t('dashboard.history.donor_added', { name: 'Rex' }) }}</p>
              <p class="text-xs text-zinc-500 dark:text-zinc-400">{{ $t('dashboard.history.yesterday_at', { time: '14:30' }) }}</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>
