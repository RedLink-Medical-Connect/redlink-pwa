import { defineFunction } from '@aws-amplify/backend'

/**
 * Trigger PostConfirmation Gen2 — remplace la fonction Lambda Gen1
 * `redlinkpwa056b43b0056b43b0PostConfirmation` (`amplify/backend/function/...`).
 * Voir ADR-0008 pour ce qui change dans le handler lui-même (plus de
 * création paresseuse des groupes Cognito, ils sont déclarés statiquement
 * par `amplify/auth/resource.ts`).
 */
export const postConfirmation = defineFunction({
  name: 'post-confirmation',
  entry: './handler.ts',
})
