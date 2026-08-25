<script setup>
import { useLegalDocument } from '@/composables/useLegalDocument.js'

// Composant de présentation partagé par les 4 vues légales (CGUView/CGVView/
// PrivacyPolicyView/LegalNoticeView.vue) — même structure visuelle (titre, bandeau
// version, contenu markdown rendu) pour les quatre, extrait ici plutôt que dupliqué 4 fois
// (scaffolding légal/RGPD, 2026-08-25, docs/adr/0014). Les 4 vues restent des fichiers
// dédiés (demande produit explicite) mais ne sont que de fins wrappers qui lui passent des
// props littérales — voir CGUView.vue pour le plus court des quatre.
const props = defineProps({
  titleKey: { type: String, required: true },
  slug: { type: String, required: true },
  version: { type: String, required: true },
  publishedAt: { type: String, required: true },
})

const { html, isLoading, loadError, fetchDocument } = useLegalDocument(props.slug)
</script>

<template>
  <div
    class="bg-white dark:bg-zinc-950 min-h-screen text-zinc-900 dark:text-zinc-100 transition-colors duration-300"
  >
    <div class="container mx-auto px-6 py-16 max-w-3xl">
      <h1 class="text-3xl md:text-4xl font-bold mb-2 text-zinc-900 dark:text-white">
        {{ $t(titleKey) }}
      </h1>
      <p class="text-xs text-zinc-400 dark:text-zinc-500 mb-8 uppercase tracking-wider">
        {{ $t('legal.version_banner', { version, date: publishedAt }) }}
      </p>

      <div v-if="isLoading" class="flex justify-center py-16">
        <i class="pi pi-spin pi-spinner text-3xl text-[#ff3b4e]"></i>
      </div>

      <div v-else-if="loadError" class="flex flex-col items-center gap-4 py-16 text-zinc-400">
        <i class="pi pi-exclamation-triangle text-4xl text-amber-500 opacity-60"></i>
        <p>{{ $t('legal.load_error') }}</p>
        <Button
          :label="$t('dashboard.validations.retry')"
          icon="pi pi-refresh"
          text
          @click="fetchDocument"
        />
      </div>

      <div
        v-else
        class="legal-content prose prose-zinc dark:prose-invert max-w-none"
        v-html="html"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.legal-content :deep(h2) {
  font-size: 1.25rem;
  font-weight: 700;
  margin-top: 2rem;
  margin-bottom: 0.75rem;
  padding-left: 0.75rem;
  border-left: 4px solid #ff3b4e;
}
.legal-content :deep(p) {
  line-height: 1.7;
  color: rgb(82 82 91);
  margin-bottom: 1rem;
}
:global(.dark) .legal-content :deep(p) {
  color: rgb(212 212 216);
}
.legal-content :deep(ul) {
  list-style: disc;
  padding-left: 1.5rem;
  margin-bottom: 1rem;
}
.legal-content :deep(blockquote) {
  border-left: 4px solid #f59e0b;
  background: rgb(255 251 235);
  padding: 0.75rem 1rem;
  border-radius: 0.25rem;
  margin-bottom: 1.5rem;
  font-size: 0.875rem;
}
:global(.dark) .legal-content :deep(blockquote) {
  background: rgb(69 26 3 / 0.2);
}
</style>
