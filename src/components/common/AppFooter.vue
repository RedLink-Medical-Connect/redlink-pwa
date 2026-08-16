<script setup>
const currentYear = new Date().getFullYear();
</script>

<template>
  <footer class="bg-[#ff3b4e] text-white pt-16 flex flex-col">

    <div class="container mx-auto px-6 mb-12 relative z-10">
      <div class="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-12">

        <div class="md:col-span-3 flex flex-col gap-3">
          <h4 class="font-bold text-lg border-l-4 border-white pl-3">{{ $t('layout.footer.clinic_section') }}</h4>
          <nav class="flex flex-col gap-2 mt-2">
            <a href="#" class="text-white/80 hover:text-white transition text-sm block">{{ $t('layout.footer.team') }}</a>
            <router-link to="/support" class="text-white/80 hover:text-white transition text-sm block">{{ $t('layout.footer.contact') }}</router-link>
            <a href="#" class="text-white/80 hover:text-white transition text-sm block">{{ $t('layout.footer.about') }}</a>
          </nav>
        </div>

        <div class="md:col-span-3 flex flex-col gap-3">
          <h4 class="font-bold text-lg border-l-4 border-white pl-3">{{ $t('layout.footer.legal_section') }}</h4>
          <nav class="flex flex-col gap-2 mt-2">
            <router-link to="/legal" class="text-white/80 hover:text-white transition text-sm block">{{ $t('layout.footer.terms') }}</router-link>
            <router-link to="/legal" class="text-white/80 hover:text-white transition text-sm block">{{ $t('layout.footer.privacy') }}</router-link>
          </nav>
        </div>

        <div class="md:col-span-6 bg-white/10 p-6 rounded-xl backdrop-blur-sm border border-white/10">
          <h4 class="font-bold text-lg mb-2 flex items-center gap-2">
            <i class="pi pi-comments text-xl"></i>
            {{ $t('layout.footer.question_title') }}
          </h4>
          <p class="text-white/90 text-sm mb-4 leading-relaxed">{{ $t('layout.footer.question_desc') }}</p>

          <div class="flex gap-2">
            <InputText
              :placeholder="$t('layout.footer.email_placeholder')"
              class="w-full !bg-white !text-zinc-800 !border-transparent placeholder:!text-zinc-400 focus:!ring-2 focus:!ring-white/50"
            />
            <Button
              :label="$t('layout.footer.send')"
              class="!bg-zinc-900 !text-white !border-zinc-900 font-bold hover:!bg-black px-6"
            />
          </div>
        </div>

      </div>
    </div>

    <div class="w-full text-center select-none pointer-events-none mt-auto overflow-hidden">
      <span class="text-[16vw] font-black leading-[0.8] tracking-tighter block text-white opacity-20 transform translate-y-2">
        RedLink
      </span>
    </div>

    <div class="bg-black/20 py-4 z-20 border-t border-white/10">
      <div class="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center text-xs text-white/70 gap-2">

        <p>&copy; {{ currentYear }} {{ $t('layout.footer.company') }}. {{ $t('layout.footer.rights_reserved') }}</p>

        <div class="flex gap-4">
          <span>
            {{ $t('layout.footer.made_with') }}
            <i class="pi pi-heart-fill text-[10px] mx-1 text-red-300"></i>
            {{ $t('layout.footer.in_france') }}
          </span>
          <span class="opacity-50">{{ $t('layout.footer.version') }}</span>
        </div>

      </div>
    </div>

  </footer>
</template>
