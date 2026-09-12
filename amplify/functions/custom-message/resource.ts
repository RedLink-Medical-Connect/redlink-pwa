import { defineFunction } from '@aws-amplify/backend'

/**
 * Trigger Cognito `CustomMessage` -- design de marque + i18n pour les emails d'inscription et
 * de mot de passe oublié. Voir `handler.ts` pour le détail du dispatch et
 * docs/adr/0022-branded-transactional-emails.md pour le raisonnement de cette sous-tâche.
 */
export const customMessage = defineFunction({
  name: 'custom-message',
  entry: './handler.ts',
})
