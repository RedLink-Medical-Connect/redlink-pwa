import { fileURLToPath, URL } from 'node:url'
import { resolve, dirname } from 'node:path' //
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import tailwindcss from '@tailwindcss/vite'
import { PrimeVueResolver } from '@primevue/auto-import-resolver'
import Components from 'unplugin-vue-components/vite'
import { bffDevMiddleware } from './vite-plugins/bff-dev-middleware'

export default defineConfig({
  plugins: [
    // Sert /api/* avec le VRAI handler BFF pendant `npm run dev` uniquement -- sans lui, toute
    // l'authentification renvoie 404 en local depuis la migration BFF (ADR-0021 §6bis).
    bffDevMiddleware(),
    vue(),
    tailwindcss(),
    Components({
      resolvers: [
        PrimeVueResolver()
      ]
    }),
    VueI18nPlugin({
      include: resolve(dirname(fileURLToPath(import.meta.url)), './src/locales/**'),
      runtimeOnly: false
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'RedLink - Urgence Vétérinaire',
        short_name: 'RedLink',
        description: 'Mise en relation rapide pour transfusion sanguine vétérinaire',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    watch: {
      // .amplify/artifacts (sortie de build CDK, ampx sandbox) contient des milliers de
      // fichiers générés (assets Lambda, cdk.out) qui n'ont aucun rapport avec le code
      // source Vue/Vite -- les regarder épuise inutilement les inotify watchers du système
      // (ENOSPC réel constaté). Ni du code applicatif ni un déclencheur légitime de HMR.
      ignored: ['**/.amplify/**'],
    },
  },
})
