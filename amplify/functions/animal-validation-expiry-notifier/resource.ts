import { defineFunction } from '@aws-amplify/backend'
import { CLINIC_VERIFICATION_SENDER_EMAIL } from '../clinic-verification-notifier/resource'

/**
 * Lambda PLANIFIÉE de notification d'expiration de validation donneur (système de
 * notifications, 2026-09-18) -- même famille qu'ADR-0016
 * (`mission-validation-auto-finalizer/`, voir son `resource.ts` pour l'API `schedule` vérifiée
 * dans les types installés, non redétaillée ici).
 *
 * Besoin métier : `Animal.isValidatedDonor`/`validationExpiresAt` ne sont JAMAIS remis à jour à
 * l'expiration -- état purement VIRTUEL, calculé à la lecture côté front
 * (`isValidatedDonor()`, `eligibility-service.js`), simplification pilote assumée explicitement
 * documentée dans `useAnimalValidation.js` ("ce repo n'a pas de job planifié qui repasse
 * isValidatedDonor à false à l'expiration"). Cette Lambda NE CHANGE PAS ce comportement
 * (`isValidatedDonor` n'est JAMAIS réécrit par cette fonction) -- elle ajoute UNIQUEMENT une
 * notification best-effort à l'Owner quand une expiration est détectée, voir `handler.ts`.
 *
 * `Animal.donorValidationExpiryNotifiedAt` (`amplify/data/resource.ts`) est le nouveau champ de
 * bookkeeping qui évite de notifier deux fois la même expiration -- voir son commentaire dédié
 * pour la comparaison à `validationExpiresAt` (PAS une simple présence/absence) qui permet de
 * re-notifier correctement après une REVALIDATION suivie d'une nouvelle expiration.
 *
 * `'30 4 * * ?'` en `Europe/Paris` = tous les jours à 04h30 (après la finalisation automatique
 * des Missions à 03h15, avant les horaires d'ouverture des cliniques) -- même raisonnement de
 * fuseau explicite que `mission-validation-auto-finalizer`.
 *
 * `resourceGroupName: 'data'` -- même correctif et même raison que
 * `mission-validation-auto-finalizer`/`rating-aggregation` (cycle
 * `auth -> function -> data -> auth` si omis, CLAUDE.md).
 *
 * ⚠️ Destinataire dynamique (`Owner.email`) -- même risque de livraison SES documenté sur les
 * autres Lambdas de ce système (`animal-donor-notifier`/`mission-notifier`/
 * `request-matcher-notifier`) : fonctionnera pleinement une fois le compte SES sorti du mode
 * sandbox. Le badge reste fonctionnel dans tous les cas.
 */
export const animalValidationExpiryNotifier = defineFunction({
  name: 'animal-validation-expiry-notifier',
  entry: './handler.ts',
  resourceGroupName: 'data',
  schedule: {
    cron: '30 4 * * ?',
    timezone: 'Europe/Paris',
    description: "Notifie les Owners dont la validation donneur d'un Animal vient d'expirer",
  },
  timeoutSeconds: 120,
  environment: {
    SES_SENDER_EMAIL: CLINIC_VERIFICATION_SENDER_EMAIL,
  },
})
