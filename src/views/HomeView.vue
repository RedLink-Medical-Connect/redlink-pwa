<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const stats = ref([
  { value: '246', label: 'home.stats.requests', color: 'bg-red-500' },
  { value: '6 324', label: 'home.stats.animals', color: 'bg-white' },
  { value: '12', label: 'home.stats.time', color: 'bg-red-500' },
])

const testimonials = computed(() => [
  { id: 1, author: 'Dr Petton', role: t('home.testimonial.roles.vet') },
  { id: 2, author: 'Clinique St-Bernard', role: t('home.testimonial.roles.partner') },
  { id: 3, author: 'Dr House', role: t('home.testimonial.roles.emergency') },
])
</script>

<template>
  <div
    class="bg-white dark:bg-zinc-950 min-h-screen text-zinc-900 dark:text-zinc-100 selection:bg-red-500 selection:text-white transition-colors duration-300"
  >
    <section class="relative pt-20 pb-32 overflow-hidden">
      <div class="container mx-auto px-6 relative z-10">
        <div class="max-w-3xl">
          <h1
            class="text-5xl md:text-6xl font-bold leading-tight mb-6 text-zinc-900 dark:text-white"
          >
            {{ $t('home.hero.title') }}
          </h1>
          <p
            class="text-zinc-600 dark:text-zinc-400 text-lg md:text-xl mb-10 max-w-2xl leading-relaxed"
          >
            {{ $t('home.hero.subtitle') }}
          </p>

          <div class="flex flex-col sm:flex-row gap-4">
              <Button
                as="router-link"
                to="/register/owner"
                :label="$t('home.hero.cta_primary')"
                class="!bg-[#ff3b4e] !border-[#ff3b4e] hover:!bg-[#e63545] !text-white font-bold !px-8 !py-3 !text-lg shadow-lg"
              />
              <Button
                as="router-link"
                to="/register/clinic"
                :label="$t('home.hero.cta_secondary')"
                variant="outlined"
                class="!text-zinc-700 dark:!text-zinc-300 !border-zinc-300 dark:!border-zinc-700 hover:!bg-zinc-100 dark:hover:!bg-zinc-800 hover:!text-black dark:hover:!text-white !px-8 !py-3"
              />
          </div>
        </div>
      </div>
    </section>

    <section class="py-20 bg-zinc-50 dark:bg-zinc-900/50">
      <div class="container mx-auto px-6">
        <h2 class="text-3xl font-bold text-center mb-16 text-zinc-900 dark:text-white">
          {{ $t('home.steps.title') }}
        </h2>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div
            class="bg-white dark:bg-zinc-900 p-8 rounded-2xl shadow-sm dark:shadow-none border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition duration-300"
          >
            <span class="text-5xl font-bold text-zinc-200 dark:text-zinc-800 mb-4 block">1</span>
            <h3 class="text-xl font-bold mb-3 text-zinc-900 dark:text-white">
              {{ $t('home.steps.1_title') }}
            </h3>
            <p class="text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {{ $t('home.steps.1_desc') }}
            </p>
          </div>
          <div
            class="bg-white dark:bg-zinc-900 p-8 rounded-2xl shadow-sm dark:shadow-none border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition duration-300"
          >
            <span class="text-5xl font-bold text-zinc-200 dark:text-zinc-800 mb-4 block">2</span>
            <h3 class="text-xl font-bold mb-3 text-zinc-900 dark:text-white">
              {{ $t('home.steps.2_title') }}
            </h3>
            <p class="text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {{ $t('home.steps.2_desc') }}
            </p>
          </div>
          <div
            class="bg-white dark:bg-zinc-900 p-8 rounded-2xl shadow-sm dark:shadow-none border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition duration-300"
          >
            <span class="text-5xl font-bold text-zinc-200 dark:text-zinc-800 mb-4 block">3</span>
            <h3 class="text-xl font-bold mb-3 text-zinc-900 dark:text-white">
              {{ $t('home.steps.3_title') }}
            </h3>
            <p class="text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {{ $t('home.steps.3_desc') }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <section class="py-24">
      <div class="container mx-auto px-6">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <h2 class="text-3xl font-bold mb-2 text-zinc-900 dark:text-white">
              {{ $t('home.why.title') }}
            </h2>
            <p class="text-zinc-500 mb-8">{{ $t('home.why.subtitle') }}</p>
              <Button
                as="router-link"
                to="/register/owner"
                :label="$t('home.why.cta')"
                class="!bg-[#ff3b4e] !border-[#ff3b4e] hover:!bg-[#e63545] mb-10"
              />

            <ul class="space-y-4 text-zinc-700 dark:text-zinc-300">
              <li class="flex gap-3">
                <i class="pi pi-bolt text-red-500 mt-1"></i> {{ $t('home.why.points.fast') }}
              </li>
              <li class="flex gap-3">
                <i class="pi pi-filter text-orange-400 mt-1"></i> {{ $t('home.why.points.target') }}
              </li>
              <li class="flex gap-3">
                <i class="pi pi-eye text-blue-400 mt-1"></i> {{ $t('home.why.points.transparent') }}
              </li>
              <li class="flex gap-3">
                <i class="pi pi-lock text-green-500 mt-1"></i> {{ $t('home.why.points.secure') }}
              </li>
              <li class="flex gap-3">
                <i class="pi pi-heart text-[#ff3b4e] mt-1"></i> {{ $t('home.why.points.useful') }}
              </li>
            </ul>
          </div>

          <div class="space-y-8">
            <div class="grid grid-cols-2 gap-4">
              <div
                v-for="(stat, index) in stats"
                :key="index"
                class="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm dark:shadow-none"
                :class="{ 'col-span-2': index === 1 }"
              >
                <div class="w-10 h-1 mb-4 rounded-full" :class="stat.color"></div>
                <div class="text-4xl md:text-5xl font-bold mb-2 text-zinc-900 dark:text-white">
                  {{ stat.value }}
                </div>
                <div class="text-zinc-500 text-sm uppercase tracking-wider">
                  {{ $t(stat.label) }}
                </div>
              </div>
            </div>
            <Carousel
              :value="testimonials"
              :num-visible="1"
              :num-scroll="1"
              circular
              :autoplay-interval="5000"
              :show-navigators="true"
              :show-indicators="true"
              class="testimonial-carousel"
            >
              <template #item="slotProps">
                <div
                  class="bg-[#ff3b4e] p-8 rounded-xl text-white relative overflow-hidden h-full mx-1"
                >
                  <i class="pi pi-comments text-6xl absolute top-4 right-4 text-white/20"></i>
                  <p class="text-lg font-medium leading-relaxed mb-6 relative z-10 min-h-[80px]">
                    {{ $t('home.testimonial.text') }}
                  </p>
                  <div class="flex items-center gap-3">
                    <Avatar icon="pi pi-user" class="!bg-white/20 !text-white" shape="circle" />
                    <div class="flex flex-col">
                      <span class="font-bold leading-tight">{{ slotProps.data.author }}</span>
                      <span class="text-xs text-white/70">{{ slotProps.data.role }}</span>
                    </div>
                  </div>
                </div>
              </template>
            </Carousel>
          </div>
        </div>
      </div>
    </section>

    <section
      class="py-12 border-y border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950/50"
    >
      <div class="container mx-auto px-6 text-center">
        <h3 class="text-zinc-500 mb-8 uppercase tracking-widest text-sm font-semibold">
          {{ $t('home.trust') }}
        </h3>
        <div
          class="flex flex-wrap justify-center items-center gap-12 opacity-50 grayscale hover:grayscale-0 transition-all duration-500 text-zinc-800 dark:text-white"
        >
          <span class="text-xl font-bold font-serif">AniCura</span>
          <span class="text-xl font-bold tracking-tighter">MOUSTACHES</span>
          <span class="text-xl font-black italic"
            >VETO<span class="text-red-600">URGENCE</span></span
          >
          <span class="text-xl font-bold flex items-center gap-1"
            ><i class="pi pi-box"></i> Hackavet</span
          >
        </div>
      </div>
    </section>

    <section
      class="py-24 bg-gradient-to-b from-white to-zinc-100 dark:from-zinc-950 dark:to-zinc-900"
    >
      <div class="container mx-auto px-6">
        <div
          class="bg-zinc-900 rounded-3xl p-8 md:p-16 border border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-12 relative overflow-hidden mb-24 text-white"
        >
          <div
            class="absolute top-0 right-0 w-64 h-64 bg-red-600/10 blur-[100px] rounded-full pointer-events-none"
          ></div>
          <div class="max-w-xl relative z-10">
            <h2 class="text-3xl md:text-4xl font-bold mb-4">{{ $t('home.join.title') }}</h2>
            <p class="text-zinc-400 mb-8 text-lg">{{ $t('home.join.subtitle') }}</p>
            <div class="flex flex-wrap gap-4">
                <Button
                  as="router-link"
                  to="/register/owner"
                  :label="$t('home.hero.cta_primary')"
                  class="!bg-[#ff3b4e] !border-[#ff3b4e]"
                />
                <Button
                  as="router-link"
                  to="/register/clinic"
                  :label="$t('home.hero.cta_secondary')"
                  variant="text"
                  class="!text-zinc-400 hover:!text-white"
                />
            </div>
          </div>
          <div class="relative w-40 h-40 md:w-56 md:h-56 flex-shrink-0">
            <div
              class="absolute inset-0 bg-gradient-to-br from-[#ff3b4e] to-[#990000] rounded-full rounded-tr-none rotate-45 shadow-[0_0_50px_rgba(255,59,78,0.4)] border-4 border-white/5"
            ></div>
            <div class="absolute top-1/4 left-1/4 w-12 h-12 bg-white/20 blur-xl rounded-full"></div>
          </div>
        </div>

        <div class="max-w-3xl mx-auto">
          <div class="flex flex-col md:flex-row gap-8">
            <div class="md:w-1/3">
              <h2 class="text-2xl font-bold leading-tight text-zinc-900 dark:text-white">
                {{ $t('home.faq.title') }}
              </h2>
              <p class="text-zinc-500 mt-2 text-sm">FAQ</p>
            </div>

            <div class="md:w-2/3">
              <Accordion class="flex flex-col gap-4">
                <AccordionPanel value="0" class="border-b border-zinc-200 dark:border-zinc-800">
                  <AccordionHeader
                    class="!bg-transparent !text-zinc-900 dark:!text-zinc-200 !font-semibold hover:!text-[#ff3b4e] !p-4 !pl-0"
                    >{{ $t('home.faq.q1') }}</AccordionHeader
                  >
                  <AccordionContent
                    class="!bg-transparent !text-zinc-600 dark:!text-zinc-400 !pb-4 !pl-0"
                    >{{ $t('home.faq.a1') }}</AccordionContent
                  >
                </AccordionPanel>
                <AccordionPanel value="1" class="border-b border-zinc-200 dark:border-zinc-800">
                  <AccordionHeader
                    class="!bg-transparent !text-zinc-900 dark:!text-zinc-200 !font-semibold hover:!text-[#ff3b4e] !p-4 !pl-0"
                    >{{ $t('home.faq.q2') }}</AccordionHeader
                  >
                  <AccordionContent
                    class="!bg-transparent !text-zinc-600 dark:!text-zinc-400 !pb-4 !pl-0"
                    >{{ $t('home.faq.a2') }}</AccordionContent
                  >
                </AccordionPanel>
                <AccordionPanel value="2" class="border-b border-zinc-200 dark:border-zinc-800">
                  <AccordionHeader
                    class="!bg-transparent !text-zinc-900 dark:!text-zinc-200 !font-semibold hover:!text-[#ff3b4e] !p-4 !pl-0"
                    >{{ $t('home.faq.q3') }}</AccordionHeader
                  >
                  <AccordionContent
                    class="!bg-transparent !text-zinc-600 dark:!text-zinc-400 !pb-4 !pl-0"
                    >{{ $t('home.faq.a3') }}</AccordionContent
                  >
                </AccordionPanel>
              </Accordion>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Styles inchangés pour le carrousel */
:deep(.p-accordion-header-link) {
  background: transparent !important;
}
:deep(.p-accordion-content) {
  background: transparent !important;
}
:deep(.p-carousel-indicator-list) {
  margin-top: 1rem;
  gap: 0.5rem;
  justify-content: center;
}
:deep(.p-carousel-indicator-button) {
  background-color: #3f3f46 !important;
  width: 8px !important;
  height: 8px !important;
  border-radius: 50%;
  transition: all 0.3s;
}
:deep(.p-carousel-indicator.p-carousel-indicator-active .p-carousel-indicator-button) {
  background-color: #ff3b4e !important;
  width: 20px !important;
  border-radius: 4px;
}
:deep(.p-carousel-content) {
  position: relative;
}
:deep(.p-carousel-prev),
:deep(.p-carousel-next) {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  margin: 0;
  background-color: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: white;
  transition: all 0.2s ease;
}
:deep(.p-carousel-prev) {
  left: 1rem;
}
:deep(.p-carousel-next) {
  right: 1rem;
}
:deep(.p-carousel-prev:hover),
:deep(.p-carousel-next:hover) {
  background-color: rgba(255, 255, 255, 0.4);
  transform: translateY(-50%) scale(1.1);
}
</style>
