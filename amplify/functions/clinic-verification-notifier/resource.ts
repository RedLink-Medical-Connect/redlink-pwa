import { defineFunction } from '@aws-amplify/backend'

/**
 * Lambda de NOTIFICATION ADMIN, déclenchée par le flux DynamoDB Streams de la table `Clinic`
 * (vérification d'identité vétérinaire -- RPPS + numéro d'ordre -- avant activation d'une
 * nouvelle Clinic, plan de durcissement sécurité "Différé 1", ré-audit 2026-09-04). Même
 * famille de pattern que `rating-aggregation/` (accès DynamoDB direct, IAM scopée, flux
 * DynamoDB Streams -- voir son `resource.ts` pour le détail déjà vérifié des Streams déjà
 * actifs sur toutes les tables managées Gen2), PREMIÈRE Lambda du projet à appeler SES
 * directement (`@aws-sdk/client-ses`) -- le trigger Cognito `CustomMessage`
 * (`amplify/functions/custom-message/`) ne le fait jamais lui-même, c'est Cognito qui envoie
 * l'email à partir du HTML retourné.
 *
 * `resourceGroupName: 'data'` -- même correctif et même raison que `rating-aggregation/` :
 * sans lui, cette fonction rejoint par défaut la stack imbriquée partagée de
 * `post-confirmation`, dont `auth` a besoin (trigger Cognito), alors que ses propres policies
 * IAM (`amplify/backend.ts`, `addToRolePolicy`/`addEventSource`, ARN de la table `Clinic`)
 * dépendent de `data`, qui dépend déjà de `auth`. Cycle `auth -> function -> data -> auth` si
 * omis (CLAUDE.md, confirmé par un `ampx sandbox` réel en échec sur une fonction précédente).
 *
 * ------------------------------------------------------------------------------------------
 * IDENTITÉ SES : BOOTSTRAP SANS DOMAINE VÉRIFIÉ (décision repo owner, 2026-09-15)
 * ------------------------------------------------------------------------------------------
 * Aucune infra SES n'existe encore sur ce compte AWS (aucune identité vérifiée, compte SES
 * encore en mode SANDBOX par défaut sur un nouveau compte -- à confirmer/faire vérifier par le
 * repo owner avant le premier déploiement réel, aucun agent ne déploie ni ne configure la
 * console AWS, voir CLAUDE.md). En mode sandbox, SES n'autorise l'envoi QUE vers des adresses
 * elles-mêmes vérifiées -- utiliser la MÊME adresse comme expéditeur ET destinataire
 * (`cyril.robert@vet-alfort.fr`, l'admin qui traite l'approbation) permet de démarrer avec une
 * seule identité à vérifier manuellement (console SES, "Verified identities"), sans réserver
 * un domaine dédié. Repointer `CLINIC_VERIFICATION_SENDER_EMAIL` vers une adresse `no-reply@`
 * dédiée le jour où un domaine SES est vérifié et le compte sorti du mode sandbox reste un
 * changement d'une seule ligne (voir aussi le commentaire IAM sur la policy `ses:SendEmail`
 * dans `amplify/backend.ts`, qui doit être mise à jour EN MÊME TEMPS -- l'ARN de la policy
 * est scopé à cette valeur exacte).
 */
export const CLINIC_VERIFICATION_SENDER_EMAIL = 'cyril.robert@vet-alfort.fr'
export const CLINIC_VERIFICATION_ADMIN_EMAIL = 'cyril.robert@vet-alfort.fr'

export const clinicVerificationNotifier = defineFunction({
  name: 'clinic-verification-notifier',
  entry: './handler.ts',
  resourceGroupName: 'data',
  timeoutSeconds: 30,
  environment: {
    SES_SENDER_EMAIL: CLINIC_VERIFICATION_SENDER_EMAIL,
    ADMIN_NOTIFICATION_EMAIL: CLINIC_VERIFICATION_ADMIN_EMAIL,
  },
})
