import { defineFunction } from '@aws-amplify/backend'
import { CLINIC_VERIFICATION_SENDER_EMAIL } from '../clinic-verification-notifier/resource'

/**
 * Lambda de NOTIFICATION PERSONNELLE (Owner), déclenchée par le flux DynamoDB Streams de la
 * table `Request` sur `INSERT` (système de notifications, 2026-09-18) -- une Clinic vient de
 * créer une demande de don (`useClinicRequest.createNewRequest()`), notifie chaque Owner dont
 * un Animal est compatible (espèce/groupe sanguin/Frequency Rule/distance, et disponibilité RDV
 * pour les Requests `APPOINTMENT`). C'est le trou le plus critique comblé par ce système : avant
 * cette Lambda, un Owner ne découvrait une urgence compatible qu'en revenant activement sur son
 * tableau de bord (`useMatchingRequests.js`, polling passif).
 *
 * Logique de matching PORTÉE en TypeScript (`amplify/functions/shared/eligibility.ts`, pas
 * importée depuis `src/services/eligibility-service.js` -- ADR-0007, une Lambda ne peut pas
 * bundler du code frontend) : voir ce module pour le détail (4 critères exclusifs + filtre
 * disponibilité RDV) et le raisonnement de duplication assumée.
 *
 * `timeoutSeconds: 60` (pas 30 comme les autres Lambdas de ce système) : cette fonction fait un
 * `Scan` de la table `Animal` (filtré mais potentiellement large à terme) PUIS jusqu'à un
 * `GetItem` `Owner` + un `Scan` `OwnerAvailability` PAR Owner candidat -- le chemin le plus
 * coûteux en I/O de tout ce système, même famille de raisonnement que `rating-aggregation`
 * (`timeoutSeconds: 120`, qui pagine aussi un flux d'écritures multiples par cible).
 *
 * `resourceGroupName: 'data'` -- même raison que toutes les Lambdas de ce système.
 *
 * ⚠️ Destinataire dynamique (`Owner.email`) -- même risque de livraison SES que
 * `animal-donor-notifier`/`mission-notifier` (voir leurs `resource.ts`) : fonctionnera
 * pleinement seulement une fois le compte SES sorti du mode sandbox. Le badge reste fonctionnel
 * dans tous les cas.
 */
export const requestMatcherNotifier = defineFunction({
  name: 'request-matcher-notifier',
  entry: './handler.ts',
  resourceGroupName: 'data',
  timeoutSeconds: 60,
  environment: {
    SES_SENDER_EMAIL: CLINIC_VERIFICATION_SENDER_EMAIL,
  },
})
