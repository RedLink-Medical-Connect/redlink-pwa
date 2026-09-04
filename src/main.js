import { createApp } from 'vue'
import { createPinia } from 'pinia'
import outputs from '../amplify_outputs.json'
import { Amplify } from 'aws-amplify'
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito'
import { sharedInMemoryStorage } from 'aws-amplify/utils'

// Phase 8, fin de la migration Gen1 -> Gen2 : `amplify_outputs.json` remplace
// `aws-exports.js` (Gen1). Ce fichier est généré par `npx ampx sandbox` (ou
// `ampx pipeline-deploy` en CI), gitignored (voir .gitignore, ajouté sous-tâche 1) --
// n'existe pas tant que le repo owner n'a pas lancé un premier déploiement Gen2
// (aucun agent ne déploie). `npm run dev`/`npm run build` échoueront avec un module
// introuvable jusque-là -- attendu, pas un bug de cette migration.
Amplify.configure(outputs)

// Durcissement sécurité (audit Cognito/API, 2026-09-02, Groupe 2) : par défaut
// `cognitoUserPoolsTokenProvider` persiste les tokens JWT (ID/Access/Refresh) dans
// `window.localStorage` -- lisible par tout script, donc exfiltrable par un XSS. Le
// stockage cookie `HttpOnly` (seule vraie mitigation) nécessite un BFF qui n'existe
// pas dans cette architecture SPA + Amplify Gen2 (différé, voir le plan de durcissement).
// Mitigation immédiate : `sharedInMemoryStorage` (utilitaire officiel Amplify JS, pas
// une implémentation maison de `KeyValueStorageInterface`) -- les tokens ne touchent
// plus jamais le disque. Effet de bord assumé : la session ne survit pas à un
// rechargement/fermeture d'onglet (l'utilisateur doit se reconnecter).
cognitoUserPoolsTokenProvider.setKeyValueStorage(sharedInMemoryStorage)

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
