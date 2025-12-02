import { createI18n } from 'vue-i18n'

import fr from '@/locales/fr.json'
import en from '@/locales/en.json'

const userLang = (navigator.languages?.[0] || navigator.language || 'fr').toLowerCase();
const defaultLocale = userLang.startsWith('fr') ? 'fr' : 'en'

const i18n = createI18n({
  legacy: false,
  locale: defaultLocale,
  fallbackLocale: 'en',
  messages: {
    fr,
    en,
  },
})

export default i18n
