---
name: i18n-audit
description: Audite l'état i18n du repo (clés manquantes/inutilisées via @intlify/eslint-plugin-vue-i18n, chaînes françaises en dur hors $t()) et rapporte sans corriger en masse. Invoque sur demande explicite de l'utilisateur (ex. "/i18n-audit", "audite les i18n", "où en est la dette i18n") — jamais automatiquement, CLAUDE.md demande une confirmation avant correction en masse.
disable-model-invocation: true
---

# i18n-audit

Audit i18n du repo Redlink — état des lieux uniquement, aucune correction
automatique. `CLAUDE.md` documente une dette i18n connue et trackée
(`DashboardView.vue` a des chaînes françaises en dur) et demande explicitement une
confirmation avant toute correction en masse : ce skill rend l'étape d'audit
délibérée, jamais silencieuse.

## Étapes

1. **Clés manquantes/inutilisées** — lance la règle ESLint dédiée sur tout le repo
   (via le MCP `eslint` si disponible, sinon `npx eslint . --rule
   '@intlify/vue-i18n/no-missing-keys: error'`) :
   ```bash
   npx eslint . --rulesdir node_modules/@intlify/eslint-plugin-vue-i18n
   ```
   En pratique, la config existante suffit — `no-missing-keys` est déjà `error` et
   `no-unused-keys` déjà `warn` dans `eslint.config.js`. Filtre juste sur ces deux
   règles dans la sortie.

2. **Chaînes en dur** — cherche du texte français hors `$t()`/`t()` dans `src/**/*.vue`
   et `src/**/*.js` :
   ```bash
   grep -rnE "['\"][A-ZÀ-Ý][a-zà-ÿ' ]{3,}['\"]" src --include='*.vue' --include='*.js' \
     | grep -vE "\\\$?t\\(|i18n|locales/"
   ```
   Ce grep produit des faux positifs (noms de variables, commentaires) — filtre-les à
   la lecture, ne les liste pas comme dette.

3. **Comparaison `fr.json`/`en.json`** — vérifie que les deux fichiers de
   `src/locales/` ont bien les mêmes clés (une clé présente dans l'un et absente de
   l'autre est un bug silencieux en prod, pas juste une incohérence de style).

## Rapport

Un rapport, pas un diff :
- Clés manquantes (`no-missing-keys`) : fichier, ligne, clé attendue.
- Clés inutilisées (`no-unused-keys`) : liste, avec le fichier `fr.json`/`en.json`
  concerné.
- Chaînes en dur détectées, groupées par fichier — signale explicitement si
  `DashboardView.vue` en a de nouvelles au-delà de la dette déjà connue (régression)
  vs. seulement les mêmes déjà trackées (pas une régression).
- Clés désynchronisées entre `fr.json` et `en.json`.

Termine en demandant explicitement à l'utilisateur s'il veut corriger tout, une
partie, ou rien — jamais de correction automatique dans ce skill.
