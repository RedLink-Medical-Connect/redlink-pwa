<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDark, useToggle } from '@vueuse/core'
import { useAuthStore } from '@/stores/auth'

const { t, locale } = useI18n()
const router = useRouter()
const isDark = useDark()
const toggleDark = useToggle(isDark)
const auth = useAuthStore()

const menu = ref(null)

import { useMenu } from '@/composables/useMenu'

const { currentMenuItems } = useMenu()

const languages = ref([
  { label: 'FR', value: 'fr' },
  { label: 'EN', value: 'en' },
])

watch(locale, (newLang) => {
  localStorage.setItem('user-locale', newLang)
})

const menuItems = computed(() => {
  const items = []

  items.push({
    label: auth.user?.attributes?.name || t(auth.currentRole === 'vet' ? 'roles.vet' : 'roles.owner'),
    icon: 'pi pi-user',
    disabled: true,
    class: 'font-bold opacity-100 mb-2',
  })
  items.push({ separator: true })

  currentMenuItems.value.forEach((item) => {
    items.push({
      label: t(item.label),
      icon: item.icon,
      command: item.command,
    })
  })

  items.push({ separator: true })

  items.push({
    label: t('menu.logout'),
    icon: 'pi pi-sign-out',
    class: 'text-red-500',
    command: () => auth.logout(),
  })

  return items
})

const toggleMenu = (event) => {
  menu.value.toggle(event)
}
</script>

<template>
  <header
    class="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 h-16 sticky top-0 z-50 transition-all duration-300"
  >
    <div class="container mx-auto px-4 h-full flex items-center justify-between">
      <div class="flex items-center gap-4 mr-auto">
        <router-link to="/" class="flex items-center gap-2 group">
          <span
            class="text-2xl font-bold text-[#ff3b4e] tracking-tight group-hover:opacity-90 transition"
          >
            RedLink
          </span>
        </router-link>
      </div>

      <nav class="hidden md:flex items-center gap-3">
        <div v-if="!auth.isAuthenticated" class="flex items-center gap-3">
          <div
            class="flex items-center gap-2 mr-4 border-r border-zinc-200 dark:border-zinc-700 pr-4"
          >
            <Button
              as="router-link"
              to="/register/owner"
              :label="$t('layout.header.donor_btn')"
              class="!bg-[#ff3b4e] !border-[#ff3b4e] hover:!bg-[#e63545] !text-white font-semibold !px-4"
              size="small"
            />
            <Button
              as="router-link"
              to="/register/clinic"
              :label="$t('layout.header.clinic_btn')"
              variant="outlined"
              class="!text-zinc-600 dark:!text-zinc-300 !border-zinc-300 dark:!border-zinc-600 hover:!bg-zinc-100 dark:hover:!bg-zinc-800 hover:!text-zinc-900 dark:hover:!text-white transition-colors"
              size="small"
            />
          </div>
          <Button
            as="router-link"
            to="/login"
            :label="$t('layout.header.login_btn')"
            icon="pi pi-user"
            variant="text"
            class="!text-zinc-600 dark:!text-white hover:!bg-zinc-100 dark:hover:!bg-zinc-800"
            size="small"
          />
        </div>

        <div v-else class="flex items-center gap-4 mr-4">
          <div class="mr-4 border-r border-zinc-200 dark:border-zinc-700 pr-4">
            <Button
              v-if="auth.currentRole === 'vet'"
              :label="$t('layout.header.new_request')"
              icon="pi pi-bolt"
              class="!bg-[#ff3b4e] !border-[#ff3b4e] hover:!bg-[#e63545] !text-white font-bold !px-4 shadow-lg shadow-red-500/20 animate-pulse-slow"
              size="small"
              @click="router.push('/dashboard/requests/new')"
            />
            <Button
              v-if="auth.currentRole === 'owner'"
              as="router-link"
              to="/dashboard/animals/add"
              :label="$t('layout.header.add_animal')"
              icon="pi pi-plus"
              variant="outlined"
              class="!text-[#ff3b4e] !border-[#ff3b4e] hover:!bg-red-50 dark:hover:!bg-red-900/10 font-bold !px-4"
              size="small"
            />
          </div>
        </div>
      </nav>

      <div class="flex items-center gap-2">
        <div v-if="auth.isAuthenticated" class="flex items-center gap-3">
          <div class="flex flex-col items-end text-right">
            <span class="text-sm font-bold text-zinc-800 dark:text-white leading-none">
              {{ auth.user?.attributes?.name || auth.user?.username }}
            </span>
            <span class="text-[10px] text-zinc-500 uppercase tracking-wider">
              {{ auth.currentRole === 'vet' ? $t('roles.vet') : $t('roles.owner') }}
            </span>
          </div>
          <Avatar
            icon="pi pi-user"
            class="cursor-pointer !bg-zinc-100 dark:!bg-zinc-800 !text-zinc-600 dark:!text-white hover:ring-2 hover:ring-[#ff3b4e] transition"
            shape="circle"
            aria-haspopup="true"
            aria-controls="overlay_menu"
            @click="toggleMenu"
          />
        </div>
        <Button
          :icon="isDark ? 'pi pi-sun' : 'pi pi-moon'"
          variant="text"
          class="!text-zinc-600 dark:!text-zinc-400 hover:!text-yellow-500 dark:hover:!text-yellow-400"
          @click="toggleDark()"
        />
        <Select
          v-model="locale"
          :options="languages"
          option-label="label"
          option-value="value"
          class="!bg-transparent !border-none !shadow-none !text-zinc-600 dark:!text-zinc-400 font-bold w-18"
          :pt="{
             label: { class: '!px-2 !py-1' },
             dropdown: { class: '!w-4' },
             overlay: { class: '!bg-white dark:!bg-zinc-900 !border-zinc-200 dark:!border-zinc-700' },
             option: { class: 'hover:!bg-zinc-100 dark:hover:!bg-zinc-800 !text-zinc-700 dark:!text-zinc-200' }
          }"
        />
      </div>

      <Menu id="overlay_menu" ref="menu" :model="menuItems" :popup="true" class="mt-2 w-64">
        <template #item="{ item, props }">
          <a
            v-if="!item.separator"
            v-bind="props.action"
            class="flex items-center gap-2 w-full p-2"
          >
            <span :class="item.icon" />
            <span class="ml-2">{{ item.label }}</span>
            <Badge v-if="item.badge" :value="item.badge" severity="danger" class="ml-auto" />
          </a>
        </template>
      </Menu>
    </div>
  </header>
</template>

<style scoped>
@keyframes pulse-slow {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.02);
  }
}
.animate-pulse-slow {
  animation: pulse-slow 3s infinite ease-in-out;
}
</style>
