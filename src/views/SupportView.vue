<script setup>
// Page statique, publique (pas de composable/appel GraphQL) — voir roadmap Phase 6,
// section B. Le bloc FAQ réutilise les clés `home.faq.*` (déjà traduites fr/en)
// plutôt que de dupliquer le contenu sous un nouveau namespace `support.faq.*`.
</script>

<template>
  <div
    class="bg-white dark:bg-zinc-950 min-h-screen text-zinc-900 dark:text-zinc-100 transition-colors duration-300"
  >
    <div class="container mx-auto px-6 py-16 max-w-3xl">
      <h1 class="text-3xl md:text-4xl font-bold mb-4 text-zinc-900 dark:text-white">
        {{ $t('support.title') }}
      </h1>
      <p class="text-zinc-600 dark:text-zinc-400 leading-relaxed mb-12">
        {{ $t('support.intro') }}
      </p>

      <section class="mb-12">
        <h2 class="text-xl font-bold mb-3 border-l-4 border-[#ff3b4e] pl-3">
          {{ $t('support.contact.title') }}
        </h2>
        <p class="text-zinc-600 dark:text-zinc-400 leading-relaxed">
          {{ $t('support.contact.body') }}
        </p>
      </section>

      <section>
        <h2 class="text-xl font-bold mb-1 border-l-4 border-[#ff3b4e] pl-3">
          {{ $t('home.faq.title') }}
        </h2>
        <p class="text-zinc-500 mt-2 mb-4 text-sm">{{ $t('home.faq.label') }}</p>

        <Accordion class="flex flex-col gap-4">
          <AccordionPanel value="0" class="border-b border-zinc-200 dark:border-zinc-800">
            <AccordionHeader
              class="!bg-transparent !text-zinc-900 dark:!text-zinc-200 !font-semibold hover:!text-[#ff3b4e] !p-4 !pl-0"
              >{{ $t('home.faq.q1') }}</AccordionHeader
            >
            <AccordionContent class="!bg-transparent !text-zinc-600 dark:!text-zinc-400 !pb-4 !pl-0"
              >{{ $t('home.faq.a1') }}</AccordionContent
            >
          </AccordionPanel>
          <AccordionPanel value="1" class="border-b border-zinc-200 dark:border-zinc-800">
            <AccordionHeader
              class="!bg-transparent !text-zinc-900 dark:!text-zinc-200 !font-semibold hover:!text-[#ff3b4e] !p-4 !pl-0"
              >{{ $t('home.faq.q2') }}</AccordionHeader
            >
            <AccordionContent class="!bg-transparent !text-zinc-600 dark:!text-zinc-400 !pb-4 !pl-0"
              >{{ $t('home.faq.a2') }}</AccordionContent
            >
          </AccordionPanel>
          <AccordionPanel value="2" class="border-b border-zinc-200 dark:border-zinc-800">
            <AccordionHeader
              class="!bg-transparent !text-zinc-900 dark:!text-zinc-200 !font-semibold hover:!text-[#ff3b4e] !p-4 !pl-0"
              >{{ $t('home.faq.q3') }}</AccordionHeader
            >
            <AccordionContent class="!bg-transparent !text-zinc-600 dark:!text-zinc-400 !pb-4 !pl-0"
              >{{ $t('home.faq.a3') }}</AccordionContent
            >
          </AccordionPanel>
        </Accordion>
      </section>
    </div>
  </div>
</template>
