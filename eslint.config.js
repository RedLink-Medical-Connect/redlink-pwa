import js from '@eslint/js'
import globals from 'globals'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'
import vueI18n from '@intlify/eslint-plugin-vue-i18n'

export default [
  {
    name: 'app/files-to-ignore',
    ignores: ['**/dist/**', '**/dist-ssr/**', '**/coverage/**'],
  },

  js.configs.recommended,

  ...pluginVue.configs['flat/recommended'],

  ...vueI18n.configs['flat/recommended'],
  {
    name: 'app/i18n-rules',
    files: ['src/**/*.{js,vue}'],
    settings: {
      'vue-i18n': {
        localeDir: './src/locales/*.{json,json5,yaml,yml}',
        messageSyntaxVersion: '^9.0.0'
      }
    },
    rules: {
      // Bloque le commit si une clé est utilisée dans le code mais n'existe pas dans le JSON
      '@intlify/vue-i18n/no-missing-keys': 'error',
      // (Optionnel) Avertit si une clé dans le JSON n'est jamais utilisée
      '@intlify/vue-i18n/no-unused-keys': ['warn', { src: './src', extensions: ['.js', '.vue'] }]
    }
  },

  {
    name: 'app/files-to-lint',
    files: ['**/*.{js,mjs,jsx,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
      'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
      'vue/multi-word-component-names': 'off',
    },
  },

  skipFormatting,
]
