<script setup>
// Page statique, publique (pas de composable/appel GraphQL) — voir roadmap Phase 6,
// section B : "Aucune page ... Mentions légales/Confidentialité nulle part dans
// l'app, malgré la collecte de PII sensible". Contenu volontairement minimal et
// explicitement marqué comme placeholder (voir Message ci-dessous) : ce prototype n'a
// pas encore d'identité légale (éditeur/hébergeur/DPO) fournie par l'école
// vétérinaire partenaire.
</script>

<template>
  <div
    class="bg-white dark:bg-zinc-950 min-h-screen text-zinc-900 dark:text-zinc-100 transition-colors duration-300"
  >
    <div class="container mx-auto px-6 py-16 max-w-3xl">
      <h1 class="text-3xl md:text-4xl font-bold mb-8 text-zinc-900 dark:text-white">
        {{ $t('legal.title') }}
      </h1>

      <Message severity="warn" :closable="false" class="mb-10">
        {{ $t('legal.placeholder_notice') }}
      </Message>

      <section class="mb-12">
        <h2 class="text-xl font-bold mb-3 border-l-4 border-[#ff3b4e] pl-3">
          {{ $t('legal.notice.title') }}
        </h2>
        <p class="text-zinc-600 dark:text-zinc-400 leading-relaxed">
          {{ $t('legal.notice.body') }}
        </p>
      </section>

      <section>
        <h2 class="text-xl font-bold mb-3 border-l-4 border-[#ff3b4e] pl-3">
          {{ $t('legal.privacy.title') }}
        </h2>
        <p class="text-zinc-600 dark:text-zinc-400 leading-relaxed mb-4">
          {{ $t('legal.privacy.intro') }}
        </p>
        <p class="text-zinc-600 dark:text-zinc-400 leading-relaxed mb-2 font-semibold">
          {{ $t('legal.privacy.data_collected_title') }}
        </p>
        <ul class="list-disc list-inside text-zinc-600 dark:text-zinc-400 leading-relaxed mb-4 space-y-1">
          <li>{{ $t('legal.privacy.data_identity') }}</li>
          <li>{{ $t('legal.privacy.data_contact') }}</li>
          <li>{{ $t('legal.privacy.data_geoloc') }}</li>
          <li>{{ $t('legal.privacy.data_animals') }}</li>
        </ul>
        <p class="text-zinc-600 dark:text-zinc-400 leading-relaxed mb-4">
          {{ $t('legal.privacy.usage') }}
        </p>
        <p class="text-zinc-600 dark:text-zinc-400 leading-relaxed">
          {{ $t('legal.privacy.rights') }}
        </p>
      </section>
    </div>
  </div>
</template>
