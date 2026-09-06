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
//
// BFF Cognito (2026-09-06, docs/adr/0021-bff-cognito-session-cloudfront.md) : l'URL
// AppSync réelle (`outputs.data.url`) est remplacée par le chemin BFF, relatif au
// domaine courant -- toujours same-origin par construction (CloudFront devant SPA et
// BFF, ADR-0021 §2), fonctionne identiquement sur le domaine Hosting actuel ou un futur
// domaine dédié. Le reste de `outputs.data` (en particulier `model_introspection`, dont
// dépend le typage de `client.models.X`) reste INTACT -- voir
// `src/services/bff-graphql-client.js` pour pourquoi cette surcharge doit vivre ici
// (config globale) et pas au niveau de chaque client `generateClient()`.
//
// `aws-amplify/auth` n'est plus utilisé DU TOUT côté navigateur (ni `cognitoUserPoolsTokenProvider`/
// `sharedInMemoryStorage`, Groupe 2 du durcissement du 2026-09-02, ni aucun appel `signIn`/
// `signUp`/etc.) : la session Cognito entière vit désormais côté BFF
// (`amplify/functions/bff/`), le navigateur ne détient jamais le moindre token, même en
// mémoire -- `src/stores/auth.js` parle au BFF par `fetch()`, jamais au SDK Cognito.
Amplify.configure({
  ...outputs,
  data: { ...outputs.data, url: `${window.location.origin}/api/graphql` },
})

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
