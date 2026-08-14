---
name: new-composable
description: Scaffold un nouveau composable src/composables/useXxx.js (ou un service src/services/xxx-service.js) selon les conventions exactes de ce repo — refs/computed, appels GraphQL try/catch/finally, fonction d'erreur pure exportée à côté, loadError dédié si nécessaire. Invoque quand l'utilisateur demande de créer un nouveau composable ou service.
---

# new-composable

Scaffold un composable ou un service Redlink en suivant les conventions documentées
dans `CLAUDE.md` (section "Conventions du projet"), sans les re-dériver à la main à
chaque fois.

## Avant de générer

1. Demande (ou déduis du contexte) : composable (`useXxx`) ou service
   (`xxx-service.js`) ?
   - **Composable** : logique métier + appels GraphQL, réactivité Vue, vit dans
     `src/composables/`.
   - **Service** : fonctions pures, aucune réactivité Vue, aucun appel GraphQL, aucun
     accès DOM, vit dans `src/services/`. Voir `eligibility-service.js` comme
     référence.
2. Lis un composable existant proche du domaine visé (ex. `useOwnerMissions.js`,
   `useMissionClosure.js`, `useMatchingRequests.js`) pour matcher le style local
   exact, pas seulement le patron générique ci-dessous.
3. Vérifie `src/constants/enums.js` — toute valeur de statut/type dans le nouveau
   code doit venir de là, jamais d'un littéral en dur.

## Patron composable (`useXxx.js`)

```js
import { ref } from 'vue'
import { generateClient } from 'aws-amplify/api'
// import { xxxByYyy } from '@/graphql/custom-queries' // si champs hors codegen

const client = generateClient({ authMode: 'userPool' })

export function useXxx() {
  const data = ref(null)
  const isLoading = ref(false)
  const loadError = ref(null) // seulement si un échec doit être visible à l'écran,
                               // pas juste une action en arrière-plan

  async function fetchXxx(id) {
    isLoading.value = true
    loadError.value = null
    try {
      const result = await client.graphql({ query: /* ... */, variables: { id } })
      data.value = result.data./* ... */
    } catch (error) {
      loadError.value = mapXxxErrorKey(error)
      console.error('[useXxx] fetchXxx failed', error)
    } finally {
      isLoading.value = false
    }
  }

  return { data, isLoading, loadError, fetchXxx }
}
```

## Fonction d'erreur pure — à côté, jamais inline

Le composable ne fait jamais `useI18n()`/`t()` lui-même. Il renvoie une **clé** i18n ;
le composant appelant fait `t(mapXxxErrorKey(error))`. Exporte-la séparément dans le
même fichier ou un fichier voisin, pour qu'elle reste testable sans monter de
composant `.vue` :

```js
export function mapXxxErrorKey(error) {
  if (error?.errors?.[0]?.errorType === 'Unauthorized') return 'errors.xxx.unauthorized'
  return 'errors.xxx.generic'
}
```

## Écriture secondaire best-effort (si applicable)

Si le composable fait une écriture non critique qui suit une écriture critique déjà
réussie (ex. upsert `ClinicOwnerRelation`, nettoyage de `Mission` orpheline), avale
l'erreur (log seulement, jamais de `throw`) — voir `useMissionClosure.js` et
`useOwnerMissions.js` pour des exemples réels.

## Lecture secondaire non-exclusive isolée (si applicable)

Si le composable dépend d'un critère non-exclusif dont la lecture GraphQL est
indépendante du flux principal (ex. Clinic Priority dans le matching), isole cette
lecture dans son propre `try/catch` avec repli sur une valeur neutre (`[]`, `null`) —
jamais dans le `try/catch` englobant, sinon un échec transitoire de ce seul critère
annule tout le flux. Voir `useMatchingRequests.js`.

## Patron service (`xxx-service.js`)

```js
// Fonctions pures uniquement — pas de ref/reactive, pas de generateClient(), pas de DOM.
export function computeXxx(input) {
  // ...
  return result
}
```

## Après génération

- Rappelle à l'utilisateur d'ajouter un test unitaire dans
  `src/composables/__tests__/` (composable) ou `src/services/__tests__/`
  (service) — le service est le plus haut-levier à tester (fonction pure, un seul
  call site testé, beaucoup d'appelants).
- N'invente pas de champ GraphQL hors codegen sans l'ajouter dans
  `custom-queries.js`/`custom-mutations.js` (jamais éditer
  `queries.js`/`mutations.js`/`subscriptions.js` à la main).
