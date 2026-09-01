import { defineFunction } from '@aws-amplify/backend'

/**
 * Lambda d'AGRÉGATION DES NOTATIONS, déclenchée par le flux DynamoDB Streams de la table `Rating`
 * (2026-08-26, étape 3/5 de la double validation de Mission + notation -- voir
 * `amplify/data/resource.ts` section 3 pour le modèle `Rating`/ADR-0015, et
 * `docs/adr/0017-rating-stream-lambda-and-clinic-moderation.md` pour cette sous-tâche).
 *
 * Besoin métier : chaque Clinic/Owner doit voir SA PROPRE moyenne (nombre d'avis + note
 * moyenne), jamais les notes individuelles ni qui a noté quoi. Le `@auth` de `Rating` interdit
 * précisément à quiconque de LISTER les notes reçues par un tiers (ADR-0015 §2) -- y compris à
 * l'intéressé lui-même : aucun client ne PEUT donc calculer sa propre moyenne. L'agrégat est
 * dénormalisé sur `Clinic`/`Owner` et écrit exclusivement côté serveur, par cette fonction. Si un
 * client pouvait l'écrire, il pourrait falsifier sa propre moyenne ou saboter celle d'un tiers --
 * d'où les `.authorization()` de champ les plus restrictives du schéma (aucun rôle Cognito n'a
 * `create`/`update`, voir `clinicRatingAndModerationFieldsReadOnly`).
 *
 * TROISIÈME trigger Lambda du projet, après `post-confirmation/` (trigger Cognito, ADR-0008) et
 * `mission-validation-auto-finalizer/` (planifiée, ADR-0016) -- même forme
 * (`{resource.ts, handler.ts}` + un module PUR testé séparément), seul le déclencheur change.
 * Il n'est PAS déclarable ici : `defineFunction` n'expose que `schedule` (planificateur
 * EventBridge), aucun équivalent "flux DynamoDB" -- le câblage se fait dans `amplify/backend.ts`
 * via l'échappatoire CDK (`lambda.addEventSource(new DynamoEventSource(...))`), même famille de
 * pattern que Geo (ADR-0012/0013) et que la policy IAM de l'étape 2/5. Voir ADR-0017 §1 pour ce
 * qui a été vérifié dans les paquets installés (en particulier : les Streams sont DÉJÀ activés
 * sur toutes les tables managées Gen2, en `NEW_AND_OLD_IMAGES` -- rien à activer).
 *
 * Les DEUX seuils de modération clinique sont des variables d'environnement, seule source de
 * vérité (aucune valeur en dur dans le handler ni dans le module pur --
 * `resolveModerationThresholds()` LÈVE si l'une manque ou est hors domaine, plutôt que de
 * retomber sur un défaut qui serait exactement le "3 et 5 en dur" que ce découpage évite) :
 * - `CLINIC_MODERATION_AVERAGE_THRESHOLD` : sous cette moyenne (STRICTEMENT), et
 * - `CLINIC_MODERATION_MIN_RATING_COUNT` : à partir de ce nombre d'avis reçus (INCLUSIF),
 * la clinique est signalée (`needsAdminReview`/`needsAdminReviewSince`/`accountStatus`).
 * Chiffres issus de la demande produit, non encore calibrés avec l'école vétérinaire partenaire
 * -- même statut que `MIN_DAYS_BETWEEN_DONATIONS` (roadmap Phase 5) : les modifier = modifier ces
 * deux lignes + redéployer.
 *
 * Le seuil d'ALERTE du tableau de bord clinique (sous 3,5 étoiles avec au moins 3 avis) n'est
 * délibérément PAS ici : c'est un calcul de LECTURE sur les deux champs agrégés
 * (`averageRatingAsClinic`/`ratingCountAsClinic`), à faire côté composable (étape 4/5, hors
 * périmètre) -- aucun champ stocké, aucune écriture serveur.
 *
 * `timeoutSeconds` : 120 (défaut `defineFunction` = 3s, très insuffisant -- ce handler pagine un
 * Query DynamoDB puis fait jusqu'à 2 écritures PAR CIBLE distincte du lot). Plus court que les
 * 300s de la Lambda planifiée : un lot est plafonné à `batchSize` (voir `amplify/backend.ts`), et
 * un handler de flux qui traîne bloque la progression de son shard.
 *
 * Les autres variables d'environnement (noms des 3 tables DynamoDB managées + nom du GSI) sont
 * injectées depuis `amplify/backend.ts` via `addEnvironment()` : ce sont des tokens CDK résolus
 * seulement à la synthèse, impossibles à écrire ici en statique.
 *
 * `resourceGroupName: 'data'` -- même correctif et même raison que
 * `mission-validation-auto-finalizer/resource.ts` (voir son commentaire dédié) : sans lui, cette
 * fonction rejoint par défaut la stack imbriquée partagée de `post-confirmation`, dont `auth` a
 * besoin (trigger Cognito) -- alors que ses propres policies IAM (`amplify/backend.ts`,
 * `addToRolePolicy`/`addEventSource`, ARNs des tables `data`) dépendent de `data`, qui dépend
 * déjà de `auth` (mode Cognito de l'API AppSync). Cycle `auth -> function -> data -> auth`,
 * confirmé par un `ampx sandbox` réel en échec (`CloudformationStackCircularDependencyError`).
 */
export const ratingAggregation = defineFunction({
  name: 'rating-aggregation',
  entry: './handler.ts',
  resourceGroupName: 'data',
  timeoutSeconds: 120,
  environment: {
    CLINIC_MODERATION_AVERAGE_THRESHOLD: '3',
    CLINIC_MODERATION_MIN_RATING_COUNT: '5',
  },
})
