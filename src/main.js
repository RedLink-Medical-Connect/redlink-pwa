import { createApp } from 'vue'
import { createPinia } from 'pinia'
import outputs from '../amplify_outputs.json'
import { Amplify } from 'aws-amplify'

// Phase 8, fin de la migration Gen1 -> Gen2 : `amplify_outputs.json` remplace
// `aws-exports.js` (Gen1). Ce fichier est généré par `npx ampx sandbox` (ou
// `ampx pipeline-deploy` en CI), gitignored (voir .gitignore, ajouté sous-tâche 1) --
// n'existe pas tant que le repo owner n'a pas lancé un premier déploiement Gen2
// (aucun agent ne déploie). `npm run dev`/`npm run build` échoueront avec un module
// introuvable jusque-là -- attendu, pas un bug de cette migration.
Amplify.configure(outputs)

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
app.use(ConfirmationService);
app.use(ToastService);
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
