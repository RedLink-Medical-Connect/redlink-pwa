<script setup>
</script>

<template>
  <div class="min-h-[60vh] flex flex-col items-center justify-center text-center px-4 py-16">
    <span class="text-8xl font-black text-[#ff3b4e] tracking-tight mb-4">404</span>
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white mb-2">
      {{ $t('notFound.title') }}
    </h1>
    <p class="text-zinc-500 dark:text-zinc-400 mb-8 max-w-md">
      {{ $t('notFound.description') }}
    </p>
    <Button
      as="router-link"
      to="/"
      :label="$t('notFound.cta')"
      icon="pi pi-home"
      class="!bg-[#ff3b4e] !border-[#ff3b4e] hover:!bg-[#e63545] !text-white font-semibold !px-6"
    />
  </div>
</template>
