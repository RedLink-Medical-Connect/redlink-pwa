import { defineFunction } from '@aws-amplify/backend'
import { CLINIC_VERIFICATION_SENDER_EMAIL } from '../clinic-verification-notifier/resource'

/**
 * Lambda de NOTIFICATION PERSONNELLE (Owner), déclenchée par le flux DynamoDB Streams de la
 * table `Animal` sur `MODIFY` (système de notifications, 2026-09-18) -- quand un vétérinaire
 * vient de valider un Animal comme donneur (`Animal.isValidatedDonor` passe à `true`,
 * `useAnimalValidation.js`). Même famille de câblage que `clinic-verification-notifier/`
 * (accès DynamoDB direct, IAM scopée, flux DynamoDB Streams) et même discipline best-effort
 * (`retryAttempts: 0`, une notification manquée n'a aucun effet de bord sur les données -- voir
 * `handler.ts`).
 *
 * `resourceGroupName: 'data'` -- même correctif et même raison que
 * `clinic-verification-notifier/`/`rating-aggregation/` : sans lui, cette fonction rejoint par
 * défaut la stack imbriquée partagée de `post-confirmation`, dont `auth` a besoin, alors que
 * ses propres policies IAM dépendent de `data`, qui dépend déjà de `auth`. Cycle
 * `auth -> function -> data -> auth` si omis (CLAUDE.md).
 *
 * ------------------------------------------------------------------------------------------
 * ⚠️ DESTINATAIRE DYNAMIQUE (`Owner.email`) -- DIFFÉRENT DE `clinic-verification-notifier`
 * ------------------------------------------------------------------------------------------
 * `clinic-verification-notifier` envoie TOUJOURS vers `CLINIC_VERIFICATION_ADMIN_EMAIL`, la
 * SEULE adresse vérifiée en SES (mode sandbox, voir son `resource.ts`) -- donc fonctionne dès
 * aujourd'hui. Cette Lambda-ci envoie vers l'adresse email RÉELLE de l'Owner concerné (lue sur
 * `Owner.email` en base), qui n'a AUCUNE raison d'être une adresse vérifiée SES. Tant que le
 * compte SES reste en mode sandbox (décision repo owner, aucun agent n'y a accès), CHAQUE envoi
 * échouera avec `MessageRejected: Email address is not verified` -- sans casser quoi que ce
 * soit (best-effort, voir `handler.ts`) mais sans jamais atteindre l'Owner non plus. Le BADGE
 * (écriture `Notification`, indépendante de l'email) reste lui pleinement fonctionnel dans
 * tous les cas. Réel uniquement une fois le compte SES sorti du mode sandbox (action console
 * AWS du repo owner) -- documenté ici plutôt que découvert en test réel.
 */
export const animalDonorNotifier = defineFunction({
  name: 'animal-donor-notifier',
  entry: './handler.ts',
  resourceGroupName: 'data',
  timeoutSeconds: 30,
  environment: {
    SES_SENDER_EMAIL: CLINIC_VERIFICATION_SENDER_EMAIL,
  },
})
