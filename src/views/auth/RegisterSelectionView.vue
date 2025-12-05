<script setup>
// Pas de logique, juste de la navigation
</script>

<template>
  <div class="max-w-4xl w-full text-center">
    <h1 class="text-3xl md:text-4xl font-bold text-zinc-900 dark:text-white uppercase tracking-wider mb-4">
      {{ $t('auth.selection.title') }}
    </h1>
    <p class="text-zinc-500 dark:text-zinc-400 mb-12">{{ $t('auth.selection.subtitle') }}</p>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">

      <router-link to="/register/owner" class="group relative overflow-hidden bg-zinc-900 rounded-2xl p-1 h-80 flex flex-col transition-transform hover:-translate-y-2">
        <div class="absolute inset-0">
          <img src="https://images.unsplash.com/photo-1543466835-00a7907e9de1?q=80&w=1000&auto=format&fit=crop" class="w-full h-full object-cover opacity-60 group-hover:opacity-40 transition-opacity duration-500" />
          <div class="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent"></div>
        </div>

        <div class="relative z-10 flex flex-col items-center justify-end h-full p-8 text-white">
          <i class="pi pi-heart text-4xl mb-4 text-[#ff3b4e]"></i>
          <h3 class="text-2xl font-bold uppercase mb-2">{{ $t('auth.selection.owner_btn') }}</h3>
          <p class="text-sm text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-100">
            {{ $t('auth.selection.owner_desc') }}
          </p>
        </div>
      </router-link>

      <router-link to="/register/clinic" class="group relative overflow-hidden bg-zinc-900 rounded-2xl p-1 h-80 flex flex-col transition-transform hover:-translate-y-2">
        <div class="absolute inset-0">
          <img src="https://images.unsplash.com/photo-1628009368231-7bb7cfcb0def?q=80&w=1000&auto=format&fit=crop" class="w-full h-full object-cover opacity-60 group-hover:opacity-40 transition-opacity duration-500" />
          <div class="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent"></div>
        </div>

        <div class="relative z-10 flex flex-col items-center justify-end h-full p-8 text-white">
          <i class="pi pi-briefcase text-4xl mb-4 text-[#ff3b4e]"></i>
          <h3 class="text-2xl font-bold uppercase mb-2">{{ $t('auth.selection.clinic_btn') }}</h3>
          <p class="text-sm text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-100">
            {{ $t('auth.selection.clinic_desc') }}
          </p>
        </div>
      </router-link>

    </div>
  </div>
</template>
