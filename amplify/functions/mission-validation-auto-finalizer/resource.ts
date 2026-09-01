import { defineFunction } from '@aws-amplify/backend'

/**
 * Lambda PLANIFIÉE de finalisation automatique des Missions restées en `PENDING_VALIDATION`
 * (2026-08-26, étape 2/5 de la double validation de Mission -- voir
 * `amplify/data/resource.ts` section 5 et les 3 resolvers `submit-mission-validation-*.js`
 * pour l'étape 1/5).
 *
 * Besoin métier : `submitMissionValidation` fait passer une Mission en `PENDING_VALIDATION`
 * dès qu'UN SEUL des deux côtés (Owner ou Clinic) a soumis sa validation. Si l'autre côté ne
 * répond JAMAIS, rien ne débloque la Mission -- la fonction 1/3 du pipeline est write-once par
 * côté, donc même l'appelant initial ne peut plus rien faire. Cette Lambda traite la partie
 * silencieuse comme une auto-confirmation POSITIVE après N jours, puis applique la même matrice
 * de réconciliation que la fonction 3/3 du resolver (voir
 * `resolve-auto-finalization-outcome.ts`, la copie PURE et TESTABLE de cette matrice).
 *
 * Deuxième trigger Lambda du projet après `post-confirmation/` -- même forme
 * (`{resource.ts, handler.ts}`, TypeScript, `defineFunction`, voir ADR-0008), seule la façon
 * dont il est invoqué change (planificateur EventBridge au lieu d'un trigger Cognito), donc pas
 * de référence depuis `amplify/auth/resource.ts` : `defineBackend` (`amplify/backend.ts`) suffit
 * à provisionner la fonction ET son planning.
 *
 * API `schedule` VÉRIFIÉE dans les types/le code installés, pas devinée (MCP `context7`
 * indisponible dans cette session ; `amplify-docs` n'indexe que Gen1, limitation permanente
 * documentée dans CLAUDE.md) :
 * - `node_modules/@aws-amplify/backend-function/lib/factory.d.ts` : `FunctionProps.schedule?:
 *   FunctionSchedule | FunctionSchedule[]`, avec `FunctionSchedule = TimeInterval | CronSchedule`
 *   et `ZonedCronSchedule = { cron: CronScheduleExpression; timezone: string; description?: ... }`.
 *   `CronScheduleExpression` accepte 5 ou 6 champs (`min heure jour-du-mois mois jour-de-semaine
 *   [année]`, syntaxe EventBridge -- pas la syntaxe cron Unix à 5 champs stricte).
 * - `node_modules/@aws-amplify/backend-function/lib/schedule_parser.js` (`validateCron`) :
 *   `day-of-month` ET `day-of-week` ne peuvent pas être renseignés tous les deux, l'un des deux
 *   DOIT être `?` -- d'où le `?` en 5e position ci-dessous. `timezone` par défaut `'UTC'` si
 *   omis (`DEFAULT_TIMEZONE`), et le planning est monté sur `aws-cdk-lib/aws-scheduler`
 *   (EventBridge Scheduler), pas sur une règle EventBridge classique.
 *
 * `'15 3 * * ?'` en `Europe/Paris` = tous les jours à 03h15, heure de Paris. Une fois par jour
 * (point de départ raisonnable demandé par le plan) à une heure creuse pour une clinique
 * vétérinaire ; fuseau explicite plutôt que le défaut UTC pour que "3h du matin" reste 3h du
 * matin LOCALES été comme hiver -- même préoccupation que `todayAsAWSDate()` côté front
 * (`useMissionClosure.js`), où un décalage UTC fait dater un don de la veille. La granularité
 * exacte n'a AUCUN impact sur la correction du résultat : l'échéance est calculée en heures
 * réelles depuis `MIN(clinicValidatedAt, ownerValidatedAt)`, pas comptée en nombre
 * d'exécutions -- une exécution ratée est rattrapée telle quelle par la suivante.
 *
 * `MISSION_VALIDATION_TIMEOUT_DAYS` est la SEULE source de vérité du délai (aucune valeur en
 * dur dans le handler ni dans la fonction pure -- `resolveTimeoutDays()` lève si la variable est
 * absente/invalide, plutôt que de retomber sur un défaut qui serait exactement le "7 en dur"
 * que ce découpage cherche à éviter). Modifier le délai = modifier cette ligne + redéployer,
 * sans toucher une ligne de logique.
 *
 * Les autres variables d'environnement (noms des 5 tables DynamoDB managées + nom du GSI) sont
 * injectées depuis `amplify/backend.ts` via `addEnvironment()` : ce sont des tokens CDK résolus
 * seulement à la synthèse, impossibles à écrire ici en statique.
 *
 * `timeoutSeconds` : 300 (défaut `defineFunction` = 3s, très insuffisant -- ce handler pagine un
 * Query DynamoDB puis fait jusqu'à 5 écritures par Mission en retard). Reste largement sous la
 * limite Lambda (900s) ; le planificateur ne se superpose pas (une exécution par jour).
 *
 * `resourceGroupName: 'data'` -- correctif post-déploiement réel (2026-09-01) : sans lui, cette
 * fonction (et `rating-aggregation`) atterrit par défaut dans la même stack imbriquée partagée
 * que `post-confirmation` (trigger Cognito, dont `auth` a besoin de l'ARN -- `auth` dépend donc
 * de cette stack "function"). Les policies IAM ajoutées dans `amplify/backend.ts`
 * (`addToRolePolicy`, ARNs des tables `data`) font l'inverse : cette stack "function" dépend de
 * `data`. Et `data` dépend déjà de `auth` (mode d'authentification Cognito de l'API AppSync,
 * comportement Gen2 standard) -- d'où un cycle `auth -> function -> data -> auth`, rejeté par
 * CloudFormation (`CloudformationStackCircularDependencyError`, confirmé par un vrai `ampx
 * sandbox` échoué). `resourceGroupName: 'data'` place directement cette fonction DANS la stack
 * `data` : ses références aux tables deviennent des références INTRA-stack (plus de dépendance
 * croisée function -> data), ce qui casse le cycle -- résolution suggérée par le message
 * d'erreur d'Amplify lui-même ("If your function is used as data resolver or calls data API,
 * you should assign this function to data stack").
 */
export const missionValidationAutoFinalizer = defineFunction({
  name: 'mission-validation-auto-finalizer',
  entry: './handler.ts',
  resourceGroupName: 'data',
  schedule: {
    cron: '15 3 * * ?',
    timezone: 'Europe/Paris',
    description:
      'Finalisation automatique des Missions restées en PENDING_VALIDATION au-delà du délai de réponse',
  },
  timeoutSeconds: 300,
  environment: {
    MISSION_VALIDATION_TIMEOUT_DAYS: '7',
  },
})
