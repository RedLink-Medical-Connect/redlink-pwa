import { createApp } from 'vue'
import { createPinia } from 'pinia'
import awsConfig from '@/config/aws-config.js'
import { Amplify } from 'aws-amplify'

// Configuration AWS sécurisée via variables d'environnement
Amplify.configure(awsConfig)

import router from '@/router'
import i18n from '@/i18n.js'
import '@/assets/main.css'
import 'primeicons/primeicons.css'
import App from '@/App.vue'
import 'leaflet/dist/leaflet.css'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ConfirmationService)
app.use(ToastService)
app.use(i18n)
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.dark',
    },
  },
})

app.mount('#app')
