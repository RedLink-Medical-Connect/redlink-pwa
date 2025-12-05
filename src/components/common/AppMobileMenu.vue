<script setup>
</script>

<template>
  <nav class="md:hidden fixed bottom-0 left-0 w-full bg-white/90 backdrop-blur-md border-t border-zinc-200/60 shadow-[0_-5px_15px_rgba(0,0,0,0.03)] z-[100] px-6 py-2 pb-safe">
    <div class="flex justify-between items-end">

      <router-link to="/" class="group flex flex-col items-center gap-1 w-16 pt-2 text-zinc-400 hover:text-[#ff3b4e] aria-[current=page]:text-[#ff3b4e] transition-colors">
        <i class="pi pi-home text-xl group-aria-[current=page]:scale-110 transition-transform duration-200"></i>
        <span class="text-[10px] font-medium tracking-wide">{{ $t('layout.mobile.home') }}</span>
      </router-link>

      <div class="relative -top-6 group">
        <div class="absolute inset-0 bg-white rounded-full -m-1.5 opacity-0 group-hover:opacity-100 transition"></div>

        <router-link to="/emergency" class="relative flex items-center justify-center w-16 h-16 bg-gradient-to-br from-[#ff3b4e] to-[#d92e40] rounded-full shadow-xl shadow-red-500/30 text-white hover:scale-105 active:scale-95 transition-all duration-300" :aria-label="$t('layout.mobile.emergency')">
          <i class="pi pi-bolt text-3xl animate-pulse-slow"></i>
        </router-link>
      </div>

      <router-link to="/login" class="group flex flex-col items-center gap-1 w-16 pt-2 text-zinc-400 hover:text-[#ff3b4e] aria-[current=page]:text-[#ff3b4e] transition-colors">
        <i class="pi pi-user text-xl group-aria-[current=page]:scale-110 transition-transform duration-200"></i>
        <span class="text-[10px] font-medium tracking-wide">{{ $t('layout.mobile.account') }}</span>
      </router-link>

    </div>
  </nav>
</template>

<style scoped>
/* Animation douce pour l'icône urgence */
.animate-pulse-slow {
  animation: pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .8; }
}

/* Padding safe area pour iPhone X et + */
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 20px);
}
</style>
