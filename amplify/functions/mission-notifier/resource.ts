import { defineFunction } from '@aws-amplify/backend'
import {
  CLINIC_VERIFICATION_SENDER_EMAIL,
  CLINIC_VERIFICATION_ADMIN_EMAIL,
} from '../clinic-verification-notifier/resource'

/**
 * Lambda de NOTIFICATION (personnelle ET broadcast Admins selon l'événement), déclenchée par
 * le flux DynamoDB Streams de la table `Mission` sur `INSERT` + `MODIFY` (système de
 * notifications, 2026-09-18). Couvre TROIS événements distincts, tous sur la même table
 * source :
 * - `INSERT` : un Owner vient d'accepter une Request (`Mission.create()`,
 *   `useOwnerMissions.acceptMission()`) -> notifie la Clinic (`MISSION_ACCEPTED`).
 * - `MODIFY`, transition `status` -> `PENDING_VALIDATION` : un côté de la double validation
 *   vient de voter (`submitMissionValidation`) -> relance l'AUTRE côté
 *   (`MISSION_VALIDATION_REMINDER`).
 * - `MODIFY`, transition `status` -> `DISPUTED` : les deux côtés ont voté en désaccord ->
 *   broadcast Admins (`MISSION_DISPUTED`).
 *
 * Une seule Lambda plutôt que trois : même déclencheur exact (flux `Mission`), même famille
 * d'accès DynamoDB direct (`GetItem` sur `Request`/`Clinic`/`Animal`/`Owner` selon la branche) --
 * voir `handler.ts` pour le détail des trois branches et la comparaison Old/New faite DANS le
 * handler (défense en profondeur, même discipline que `rating-aggregation`).
 *
 * `resourceGroupName: 'data'` -- même raison que toutes les Lambdas de ce système (cycle
 * `auth -> function -> data -> auth` si omis, CLAUDE.md).
 *
 * ⚠️ Deux modes de destinataire d'email différents, même distinction que `resource.ts` d'
 * `animal-donor-notifier` : `MISSION_DISPUTED` va vers `CLINIC_VERIFICATION_ADMIN_EMAIL` (la
 * SEULE adresse vérifiée SES -- fonctionne dès aujourd'hui), `MISSION_ACCEPTED`/
 * `MISSION_VALIDATION_REMINDER` vont vers l'adresse RÉELLE de la Clinic/de l'Owner concerné
 * (lue en base) -- échoueront tant que le compte SES reste en mode sandbox (décision repo
 * owner). Le badge (écriture `Notification`) reste fonctionnel dans tous les cas.
 */
export const missionNotifier = defineFunction({
  name: 'mission-notifier',
  entry: './handler.ts',
  resourceGroupName: 'data',
  timeoutSeconds: 30,
  environment: {
    SES_SENDER_EMAIL: CLINIC_VERIFICATION_SENDER_EMAIL,
    ADMIN_NOTIFICATION_EMAIL: CLINIC_VERIFICATION_ADMIN_EMAIL,
  },
})
