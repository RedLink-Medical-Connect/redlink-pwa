/**
 * Logique PURE de la Lambda planifiée `mission-validation-auto-finalizer` (voir `resource.ts`
 * du même dossier) : aucune I/O, aucun SDK AWS, aucune horloge implicite (`now` est toujours
 * injecté). Extraite du handler pour la même raison que `src/services/*-service.js` côté front
 * (convention `.cursorrules`, "deep modules") et pour une raison propre à cette sous-tâche :
 * c'est la SEULE copie testable de la matrice de réconciliation de la double validation dans ce
 * dépôt. La matrice de référence vit dans `amplify/data/resolvers/
 * submit-mission-validation-finalize-status.js` (runtime `APPSYNC_JS`), qu'aucun test de ce repo
 * ne peut exécuter aujourd'hui (pas de sandbox AppSync, `ampx sandbox` interdit aux agents).
 *
 * Les valeurs de statut/outcome sont des littéraux typés plutôt qu'un import : `src/constants/
 * enums.js` est du JS front (hors `include` du tsconfig backend, ADR-0007) et
 * `amplify/data/resource.ts` embarquerait tout `@aws-amplify/backend` dans le bundle esbuild de
 * la Lambda. Même arbitrage que les resolvers AppSync JS, qui écrivent eux aussi ces valeurs en
 * dur avec un commentaire -- les unions TypeScript ci-dessous donnent en prime une vérification
 * à la compilation que le resolver JS n'a pas.
 */

/** Miroir des valeurs concernées de `MissionValidationOutcome` (`amplify/data/resource.ts`). */
export type MissionValidationOutcomeValue = 'PENDING' | 'CONFIRMED' | 'DENIED'

/** Miroir des deux seules valeurs de `MissionStatus` que cette Lambda peut écrire. */
export type AutoFinalizedMissionStatus = 'COMPLETED_AUTO' | 'DISPUTED'

/** Côté (au sens double validation) qui a réellement répondu avant l'échéance. */
export type MissionValidationSide = 'CLINIC' | 'OWNER'

/**
 * Les 4 champs de `Mission` dont dépend cette décision. Volontairement TOUS optionnels et
 * `| null` : un champ jamais écrit est ABSENT de l'item DynamoDB (voir l'en-tête de
 * `submit-mission-validation-write-side.js` -- la condition write-once est
 * `attributeExists: false`, il n'existe pas de valeur `'PENDING'` littérale en base).
 */
export type MissionValidationSnapshot = {
  clinicValidationOutcome?: string | null
  clinicValidatedAt?: string | null
  ownerValidationOutcome?: string | null
  ownerValidatedAt?: string | null
}

/**
 * Raison pour laquelle une Mission en `PENDING_VALIDATION` n'est PAS finalisée automatiquement.
 * Renvoyée explicitement (plutôt qu'un simple `null`) parce que ces cas n'ont pas du tout la
 * même signification opérationnelle : `DEADLINE_NOT_REACHED` est le cas NORMAL et massif (la
 * plupart des Missions scannées chaque nuit), les trois autres sont des ANOMALIES de donnée que
 * le handler doit pouvoir logger distinctement -- en particulier `BOTH_SIDES_RESPONDED`, qui est
 * la signature exacte du résidu de robustesse documenté en tête de
 * `submit-mission-validation-write-side.js` (échec dur des fonctions 2/3 du pipeline). Sans
 * cette distinction, sa survenue réelle en production resterait invisible.
 */
export type AutoFinalizationSkipReason =
  | 'DEADLINE_NOT_REACHED'
  | 'NO_SIDE_RESPONDED'
  | 'BOTH_SIDES_RESPONDED'
  | 'NO_VALIDATION_TIMESTAMP'

export type AutoFinalizationOutcome =
  | {
      kind: 'FINALIZE'
      /** Statut à écrire (jamais `COMPLETED`/`NO_SHOW` : ceux-là supposent DEUX réponses réelles). */
      finalStatus: AutoFinalizedMissionStatus
      /** Le côté qui a réellement répondu (l'AUTRE est celui qu'on auto-confirme). */
      respondingSide: MissionValidationSide
      /** Échéance calculée (epoch ms), exposée pour le log -- aucun champ de schéma ne la porte. */
      deadlineMs: number
    }
  | { kind: 'SKIP'; reason: AutoFinalizationSkipReason }

/** Nom de la variable d'environnement -- une seule source de vérité, partagée avec le handler. */
export const MISSION_VALIDATION_TIMEOUT_DAYS_ENV_VAR = 'MISSION_VALIDATION_TIMEOUT_DAYS'

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Lit le délai de réponse (en jours) depuis l'environnement passé en paramètre (jamais
 * `process.env` lu directement ici : c'est ce qui rend cette fonction testable sans muter
 * l'environnement du processus de test).
 *
 * LÈVE si la variable est absente, vide ou non numérique -- délibérément PAS de valeur de repli.
 * Un défaut du type `?? 7` réintroduirait exactement le "délai en dur" que l'étape 2/5 demande
 * d'éviter : la configuration deviendrait facultative et une variable mal orthographiée dans
 * `resource.ts`/`backend.ts` passerait inaperçue en produisant silencieusement un autre délai
 * que celui déployé. Fail-loud, cohérent avec `post-confirmation/handler.ts` (ADR-0008/Phase
 * 7.3) : mieux vaut une invocation planifiée en échec VISIBLE dans CloudWatch qu'une
 * finalisation automatique silencieusement décalée.
 *
 * Accepte une valeur fractionnaire (ex. `'0.01'`) : utile pour vérifier le mécanisme sur un
 * environnement de test sans attendre des jours réels, sans aucune conséquence en production où
 * la valeur déployée est un entier.
 */
export function resolveTimeoutDays(env: Record<string, string | undefined>): number {
  const raw = env[MISSION_VALIDATION_TIMEOUT_DAYS_ENV_VAR]

  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      `Variable d'environnement ${MISSION_VALIDATION_TIMEOUT_DAYS_ENV_VAR} manquante : le délai de finalisation automatique n'a aucune valeur par défaut (voir amplify/functions/mission-validation-auto-finalizer/resource.ts).`,
    )
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Variable d'environnement ${MISSION_VALIDATION_TIMEOUT_DAYS_ENV_VAR} invalide : "${raw}" (attendu un nombre de jours strictement positif).`,
    )
  }

  return parsed
}

function isDecided(outcome: string | null | undefined): outcome is 'CONFIRMED' | 'DENIED' {
  return outcome === 'CONFIRMED' || outcome === 'DENIED'
}

/** `Date.parse` d'un AWSDateTime, ou `null` si absent/illisible (jamais `NaN` en sortie). */
function parseTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Décide si une Mission en `PENDING_VALIDATION` doit être finalisée automatiquement, et avec
 * quel statut. Renvoie `{ kind: 'SKIP' }` = NE RIEN FAIRE (le handler passe à la Mission
 * suivante sans aucune écriture) -- c'est le comportement par défaut de tous les cas douteux :
 * cette Lambda écrit un statut TERMINAL sur une donnée médicale, un faux positif ne se rattrape
 * pas.
 *
 * Échéance : `MIN(clinicValidatedAt, ownerValidatedAt)` en ignorant celui des deux qui est
 * absent/`null`, plus `timeoutDays`. AUCUN champ `validationDeadline` n'existe côté schéma
 * (choix d'architecture délibéré, voir `resource.ts`) -- elle est dérivée ici, jamais persistée.
 * En pratique un seul des deux horodatages est renseigné quand la Mission est en
 * `PENDING_VALIDATION` ; le `MIN` est écrit dans le cas général plutôt que "prends celui qui
 * existe" pour rester correct même sur une donnée incohérente (les deux renseignés).
 * Comparaison INCLUSIVE (`now >= échéance`) : à la milliseconde exacte, le délai est écoulé.
 *
 * Cas renvoyant `SKIP`, tous délibérés :
 * - AUCUN des deux côtés n'a répondu (aucun outcome décidé) : ne devrait pas exister en
 *   `PENDING_VALIDATION` (le resolver n'y fait passer une Mission qu'APRÈS une première
 *   soumission), mais une Mission fabriquée directement par un Owner peut porter n'importe quel
 *   statut à la création (résidu ADR-0004, explicitement non fermé). Auto-confirmer les DEUX
 *   côtés à partir de rien fabriquerait une transfusion qui n'a peut-être jamais eu lieu --
 *   avec des effets de bord réels (`Animal.lastDonationDate`, Frequency Rule, compteurs
 *   clinique). Défense en profondeur : le handler ne finalise que ce qui a une trace.
 * - LES DEUX côtés ont répondu : la fonction 3/3 du resolver a déjà calculé le statut agrégé
 *   (`COMPLETED`/`NO_SHOW`/`DISPUTED`) ; si la Mission est quand même restée en
 *   `PENDING_VALIDATION`, c'est le résidu de robustesse documenté en tête de
 *   `submit-mission-validation-write-side.js` (échec dur des fonctions 2/3). Le rattraper ICI
 *   reviendrait à écrire `COMPLETED_AUTO`/`DISPUTED` là où le vrai calcul aurait pu donner
 *   `COMPLETED` ou `NO_SHOW` -- deux statuts que cette Lambda n'a pas le droit d'écrire (elle
 *   suppose toujours une auto-confirmation POSITIVE du côté silencieux, hypothèse fausse ici où
 *   les deux côtés ont réellement voté). Le résidu reste ouvert, il n'est pas AGGRAVÉ.
 * - Aucun horodatage exploitable : sans point de départ, il n'y a pas d'échéance à comparer.
 * - Échéance non atteinte.
 *
 * Matrice, quand un seul côté a répondu et que l'échéance est dépassée (le côté silencieux est
 * traité comme s'il avait confirmé) :
 * - répondant `CONFIRMED` (+ silencieux auto-`CONFIRMED`) -> `COMPLETED_AUTO`
 * - répondant `DENIED`    (+ silencieux auto-`CONFIRMED`) -> `DISPUTED`
 * `COMPLETED_AUTO` plutôt que `COMPLETED` : la distinction est le SEUL enregistrement du fait
 * que la seconde validation n'a jamais eu lieu (aucun champ n'est falsifié pour faire croire à
 * une réponse du côté silencieux -- voir le handler, qui n'écrit QUE `status`).
 */
export function resolveAutoFinalizationOutcome(
  mission: MissionValidationSnapshot,
  options: { nowMs: number; timeoutDays: number },
): AutoFinalizationOutcome {
  const { nowMs, timeoutDays } = options

  const clinicDecided = isDecided(mission.clinicValidationOutcome)
  const ownerDecided = isDecided(mission.ownerValidationOutcome)

  if (clinicDecided && ownerDecided) {
    return { kind: 'SKIP', reason: 'BOTH_SIDES_RESPONDED' }
  }
  if (!clinicDecided && !ownerDecided) {
    return { kind: 'SKIP', reason: 'NO_SIDE_RESPONDED' }
  }

  const timestamps = [
    parseTimestamp(mission.clinicValidatedAt),
    parseTimestamp(mission.ownerValidatedAt),
  ].filter((value): value is number => value !== null)

  if (timestamps.length === 0) {
    return { kind: 'SKIP', reason: 'NO_VALIDATION_TIMESTAMP' }
  }

  const deadlineMs = Math.min(...timestamps) + timeoutDays * MILLISECONDS_PER_DAY
  if (nowMs < deadlineMs) {
    return { kind: 'SKIP', reason: 'DEADLINE_NOT_REACHED' }
  }

  const respondingSide: MissionValidationSide = clinicDecided ? 'CLINIC' : 'OWNER'
  const respondingOutcome = clinicDecided
    ? mission.clinicValidationOutcome
    : mission.ownerValidationOutcome

  return {
    kind: 'FINALIZE',
    finalStatus: respondingOutcome === 'CONFIRMED' ? 'COMPLETED_AUTO' : 'DISPUTED',
    respondingSide,
    deadlineMs,
  }
}

/**
 * Date du jour au format `AWSDate` (`YYYY-MM-DD`) dans le fuseau `timeZone`, pour
 * `Animal.lastDonationDate` (voir le handler). Équivalent Lambda de `todayAsAWSDate()`
 * (`src/composables/useMissionClosure.js`), qui s'appuie sur `getFullYear()/getMonth()/getDate()`
 * -- c'est-à-dire le fuseau LOCAL du navigateur du vétérinaire. Une Lambda tourne en UTC et ne
 * peut PAS être basculée via la variable d'environnement `TZ` (variable réservée côté AWS
 * Lambda), d'où le fuseau explicite via `Intl` plutôt qu'une réécriture des mêmes appels
 * `Date` locaux, qui daterait le don de la veille pour toute exécution entre 00h et 02h heure
 * de Paris. Même bug de frontière de fuseau que celui trouvé en QA sur la Phase 2 (voir le
 * commentaire de `todayAsAWSDate` côté front), transposé au bon runtime.
 *
 * `formatToParts` plutôt qu'un `format()` sur une locale supposée produire `YYYY-MM-DD` : les
 * parties sont assemblées explicitement, sans dépendre du format d'une locale.
 */
export function todayAsAWSDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const get = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value

  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * Décide s'il faut créer une `ClinicOwnerRelation` pour (clinicID, ownerID), et avec quelle
 * valeur d'`isPrimaryClinic`, à partir de la liste COMPLÈTE des relations existantes de cet
 * Owner (toutes cliniques confondues).
 *
 * DUPLICATION ASSUMÉE de `resolveClinicOwnerRelationUpsert`
 * (`src/services/clinic-owner-relation-service.js`) -- choix d'architecture du plan de cette
 * feature, à scruter en revue : les deux runtimes n'ont aucun module partageable (le front est
 * du JS pur hors du `tsconfig` backend, ADR-0007, et importer un service front dans un bundle
 * Lambda mélangerait deux périmètres de déploiement). L'alternative (déclencher ces écritures
 * secondaires depuis un flux DynamoDB Streams unique, consommé par les deux chemins) a été
 * jugée disproportionnée pour 3 petites écritures best-effort. Toute évolution de la règle doit
 * donc être appliquée AUX DEUX ENDROITS -- d'où ce pointeur croisé explicite plutôt qu'une
 * copie muette.
 *
 * Même course acceptée non résolue que côté front (lecture puis écriture, pas de contrainte
 * d'unicité composite `(clinicID, ownerID)` au niveau du schéma).
 */
export function resolveClinicOwnerRelationUpsert(
  existingRelations: ReadonlyArray<{ clinicID?: string | null }>,
  clinicID: string,
): { clinicID: string; isPrimaryClinic: boolean } | null {
  const alreadyLinkedToThisClinic = existingRelations.some(
    (relation) => relation.clinicID === clinicID,
  )
  if (alreadyLinkedToThisClinic) return null

  return { clinicID, isPrimaryClinic: existingRelations.length === 0 }
}
