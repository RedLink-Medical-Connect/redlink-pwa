import { useAuthStore } from '@/stores/auth'

/**
 * Remplacement direct de `getCurrentUser()`/`deleteUser()` (`aws-amplify/auth`) -- voir
 * docs/adr/0021-bff-cognito-session-cloudfront.md §6bis. ~10 composables applicatifs
 * (`useAnimals.js`, `useOwnerProfile.js`, `useClinicSettings.js`, etc.) n'ont qu'UNE SEULE
 * ligne à changer, leur import (`from 'aws-amplify/auth'` -> `from
 * '@/services/bff-auth-session'`) : `const { userId } = await getCurrentUser()` reste
 * identique à l'octet près.
 *
 * Le navigateur ne détenant plus aucune session Cognito (tokens exclusivement dans les
 * cookies `HttpOnly` du BFF, `src/stores/auth.js`), `getCurrentUser()` ne peut plus
 * interroger un SDK local -- il lit `useAuthStore().user`, déjà peuplé par `auth.init()`
 * (appelé par le garde de navigation, `src/router/index.js`, avant que la moindre vue ne
 * monte) : une lecture synchrone de Pinia, pas un nouvel aller-retour réseau à chaque appel.
 *
 * Rejette avec `UserUnAuthenticatedException` (même nom que la vraie exception Amplify)
 * quand `user` est `null` -- reproduit le contrat "throw si pas de session" dont dépendent
 * les appelants existants (CLAUDE.md, "Résolution de contexte qui ne catch pas ses propres
 * erreurs" : une vraie absence de session doit remonter telle quelle à l'appelant).
 */
export async function getCurrentUser() {
  const authStore = useAuthStore()
  if (!authStore.user) {
    throw Object.assign(new Error('No current user'), { name: 'UserUnAuthenticatedException' })
  }
  return { userId: authStore.user.userId, username: authStore.user.username }
}

/**
 * `deleteUser()` (`useClinicSettings.js`/`useOwnerProfile.js`) : appelle la même route BFF que
 * `useAuthStore().deleteAccount()` (`/api/auth/delete-account`) -- ces deux composables gèrent
 * eux-mêmes leur propre nettoyage DB puis déconnexion/redirection (`auth.logout()`), ils
 * n'appellent pas `useAuthStore().deleteAccount()` directement (duplication préexistante à ce
 * chantier, pas introduite ici).
 */
export async function deleteUser() {
  const response = await fetch('/api/auth/delete-account', {
    method: 'POST',
    credentials: 'include',
  })
  if (!response.ok) {
    throw new Error('DELETE_ACCOUNT_FAILED')
  }
}
