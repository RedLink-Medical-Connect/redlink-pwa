/**
 * Logique PURE de la Lambda `rating-aggregation` (voir `resource.ts` du même dossier pour le
 * pourquoi/le déclencheur, `handler.ts` pour les I/O) : aucune I/O, aucun SDK AWS, aucune horloge
 * implicite. Extraite du handler pour la même raison que `src/services/*-service.js` côté front
 * (convention `.cursorrules`, "deep modules") et que `resolve-auto-finalization-outcome.ts`
 * (étape 2/5) : c'est la seule partie de cette Lambda qu'un test peut exécuter, et c'est celle
 * qui porte la RÈGLE MÉTIER (moyenne, seuil de modération, dédoublonnage d'un lot d'événements).
 *
 * Les valeurs de rôle sont des littéraux typés plutôt qu'un import : `src/constants/enums.js` est
 * du JS front (hors `include` du tsconfig backend, ADR-0007) et `amplify/data/resource.ts`
 * embarquerait tout `@aws-amplify/backend` dans le bundle esbuild de la Lambda -- même arbitrage
 * que le module pur de l'étape 2/5 et que les resolvers AppSync JS.
 */

/** Miroir des deux valeurs de `RatingParticipantRole` (`amplify/data/resource.ts`). */
export type RatingParticipantRoleValue = 'OWNER' | 'CLINIC'

const RATING_PARTICIPANT_ROLES: readonly string[] = ['OWNER', 'CLINIC']

/**
 * Ce que le handler retient d'UN enregistrement du flux DynamoDB de la table `Rating`, une fois
 * les `AttributeValue` bruts lus (`record.dynamodb.NewImage.targetID.S`, voir `handler.ts`).
 * Volontairement tolérant (`?`/`| null`) : un événement d'un autre type (`MODIFY`/`REMOVE`) ou
 * une image incomplète ne doit jamais faire planter l'invocation, seulement être ignorée et
 * comptée.
 */
export type RatingStreamRecordSnapshot = {
  eventName?: string | null
  targetID?: string | null
  targetRole?: string | null
}

/** Une cible (Clinic ou Owner) dont les agrégats doivent être recalculés. */
export type RatingAggregationTarget = {
  targetID: string
  targetRole: RatingParticipantRoleValue
}

/**
 * Comptes des enregistrements NON retenus, par raison -- exposés (plutôt qu'ignorés en silence)
 * pour que le handler puisse les logger : `nonInsert` est ATTENDU (voir ci-dessous), `invalid`
 * est une anomalie de donnée, `duplicates` est le cas nominal d'un lot qui contient plusieurs
 * notations pour la même cible.
 */
export type IgnoredRatingStreamRecords = {
  nonInsert: number
  invalid: number
  duplicates: number
}

export type RatingAggregate = {
  count: number
  /** Moyenne ARRONDIE à 2 décimales -- voir `computeRatingAggregate`. */
  average: number
}

export type ModerationThresholds = {
  minRatingCount: number
  averageThreshold: number
}

/** Noms des variables d'environnement -- une seule source de vérité, partagée avec le handler. */
export const CLINIC_MODERATION_MIN_RATING_COUNT_ENV_VAR = 'CLINIC_MODERATION_MIN_RATING_COUNT'
export const CLINIC_MODERATION_AVERAGE_THRESHOLD_ENV_VAR = 'CLINIC_MODERATION_AVERAGE_THRESHOLD'

/**
 * Lit les deux seuils de modération clinique depuis l'environnement passé en paramètre (jamais
 * `process.env` lu directement ici : c'est ce qui rend cette fonction testable sans muter
 * l'environnement du processus de test).
 *
 * LÈVE si une des deux variables est absente, vide ou hors domaine -- délibérément PAS de valeur
 * de repli, exactement le même arbitrage que `resolveTimeoutDays()` (étape 2/5, ADR-0016 §2) :
 * un `?? 3` réintroduirait le seuil en dur que cette configuration cherche à éviter, et une
 * variable mal orthographiée modérerait silencieusement les cliniques sur un autre seuil que
 * celui déployé. Ces deux chiffres (3 étoiles, 5 avis) viennent d'une demande produit non encore
 * calibrée avec l'école vétérinaire partenaire -- même statut que `MIN_DAYS_BETWEEN_DONATIONS`
 * (roadmap Phase 5) et que `MISSION_VALIDATION_TIMEOUT_DAYS` : ils doivent pouvoir bouger sans
 * toucher une ligne de logique.
 *
 * `minRatingCount` : entier >= 1 (un seuil de volume à 0 signifierait "modère dès la première
 * note", ce que la demande produit exclut explicitement -- "2 mauvais avis isolés ne doivent rien
 * déclencher"). `averageThreshold` : dans `]0, 5]`, le domaine réel d'une note en étoiles.
 */
export function resolveModerationThresholds(
  env: Record<string, string | undefined>,
): ModerationThresholds {
  const minRatingCount = parseRequiredNumber(env, CLINIC_MODERATION_MIN_RATING_COUNT_ENV_VAR)
  const averageThreshold = parseRequiredNumber(env, CLINIC_MODERATION_AVERAGE_THRESHOLD_ENV_VAR)

  if (!Number.isInteger(minRatingCount) || minRatingCount < 1) {
    throw new Error(
      `Variable d'environnement ${CLINIC_MODERATION_MIN_RATING_COUNT_ENV_VAR} invalide : "${env[CLINIC_MODERATION_MIN_RATING_COUNT_ENV_VAR]}" (attendu un entier >= 1).`,
    )
  }
  if (averageThreshold <= 0 || averageThreshold > 5) {
    throw new Error(
      `Variable d'environnement ${CLINIC_MODERATION_AVERAGE_THRESHOLD_ENV_VAR} invalide : "${env[CLINIC_MODERATION_AVERAGE_THRESHOLD_ENV_VAR]}" (attendu un nombre d'étoiles dans ]0, 5]).`,
    )
  }

  return { minRatingCount, averageThreshold }
}

function parseRequiredNumber(env: Record<string, string | undefined>, name: string): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      `Variable d'environnement ${name} manquante : les seuils de modération clinique n'ont aucune valeur par défaut (voir amplify/functions/rating-aggregation/resource.ts).`,
    )
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Variable d'environnement ${name} invalide : "${raw}" (attendu un nombre).`)
  }
  return parsed
}

function isKnownRole(role: string | null | undefined): role is RatingParticipantRoleValue {
  return typeof role === 'string' && RATING_PARTICIPANT_ROLES.includes(role)
}

/**
 * Réduit un lot d'événements du flux `Rating` à la liste des cibles DISTINCTES à recalculer.
 *
 * Trois filtrages, tous délibérés :
 * - **`INSERT` uniquement.** `Rating` est write-once par construction (`.identifier(['missionID',
 *   'raterRole'])` interdit la seconde `create` du même rôle sur la même Mission, et son `@auth`
 *   n'accorde `update`/`delete` à personne -- ADR-0015) : un `MODIFY`/`REMOVE` applicatif
 *   n'existe pas. Le filtre est POURTANT posé ici en plus du filtre d'`EventSourceMapping`
 *   (`amplify/backend.ts`, `FilterCriteria` sur `eventName`) : une suppression administrative
 *   directe en console DynamoDB, ou un futur relâchement du filtre d'infrastructure, ne doit pas
 *   se traduire par un recalcul non testé (un `REMOVE` porte son image dans `OldImage`, pas
 *   `NewImage` -- il serait de toute façon compté `invalid` ici).
 * - **Cible exploitable.** `targetID` non vide ET `targetRole` dans les valeurs connues. Un
 *   `targetRole` hors énumération est bloqué par le type GraphQL côté écriture (contrairement à
 *   `raterRole`, résidu ADR-0015), mais l'écriture peut aussi venir d'ailleurs (console AWS,
 *   futur script) : une valeur inconnue est ignorée plutôt que traitée comme un OWNER par défaut.
 * - **Dédoublonnage `(targetRole, targetID)`.** Deux notations reçues par la MÊME cible dans le
 *   MÊME lot ne déclenchent qu'UN seul recalcul : chaque recalcul repart de l'intégralité des
 *   notes (Query sur le GSI), donc traiter la cible deux fois écrirait deux fois la même valeur
 *   -- au mieux inutile (coût, écritures DynamoDB doublées), au pire trompeur si les deux
 *   écritures s'entrelacent avec une autre invocation. L'ordre de première apparition est
 *   conservé (déterministe, donc testable).
 */
export function collectAggregationTargets(
  records: ReadonlyArray<RatingStreamRecordSnapshot>,
): { targets: RatingAggregationTarget[]; ignored: IgnoredRatingStreamRecords } {
  const targets: RatingAggregationTarget[] = []
  const seen = new Set<string>()
  const ignored: IgnoredRatingStreamRecords = { nonInsert: 0, invalid: 0, duplicates: 0 }

  for (const record of records ?? []) {
    if (record?.eventName !== 'INSERT') {
      ignored.nonInsert += 1
      continue
    }

    const targetID = typeof record.targetID === 'string' ? record.targetID.trim() : ''
    if (targetID === '' || !isKnownRole(record.targetRole)) {
      ignored.invalid += 1
      continue
    }

    const key = `${record.targetRole}#${targetID}`
    if (seen.has(key)) {
      ignored.duplicates += 1
      continue
    }

    seen.add(key)
    targets.push({ targetID, targetRole: record.targetRole })
  }

  return { targets, ignored }
}

/**
 * Moyenne + nombre d'avis à partir de TOUTES les notes reçues par une cible (le contenu complet
 * de la requête sur le GSI `(targetID, targetRole)`, jamais un calcul incrémental sur l'ancienne
 * moyenne). Recalculer intégralement plutôt qu'incrémenter est ce qui rend l'écriture
 * IDEMPOTENTE : un rejeu du même lot (retry d'`EventSourceMapping`, voir `handler.ts`) réécrit la
 * même valeur, là où un `+1`/moyenne glissante incrémentale dériverait à chaque rejeu.
 *
 * Les valeurs non numériques sont ignorées et n'entrent PAS dans `count` : `stars` est
 * `a.integer().required()` côté schéma, donc ce cas ne devrait pas exister -- mais une seule
 * valeur aberrante rendrait toute la moyenne `NaN`, écrasant silencieusement un agrégat valide
 * pour toutes les notes suivantes. Fail-soft ici (on agrège ce qui est exploitable) plutôt que
 * fail-loud : l'alternative bloquerait indéfiniment les agrégats d'une cible à cause d'une seule
 * ligne corrompue.
 *
 * Moyenne ARRONDIE à 2 décimales, et c'est cette valeur arrondie qui sert AUSSI à la décision de
 * modération (`exceedsModerationThreshold`) : ce qui est stocké doit expliquer le flag. Sans cet
 * alignement, une moyenne brute de 2.9999 stockée "3" pourrait déclencher une revue admin que la
 * valeur affichée contredirait.
 */
export function computeRatingAggregate(
  starsValues: ReadonlyArray<number | string | null | undefined>,
): RatingAggregate {
  const usable = (starsValues ?? [])
    .map((value) => (typeof value === 'string' ? Number(value) : value))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  if (usable.length === 0) {
    return { count: 0, average: 0 }
  }

  const total = usable.reduce((sum, value) => sum + value, 0)
  return { count: usable.length, average: Math.round((total / usable.length) * 100) / 100 }
}

/**
 * Décide si une CLINIC doit être signalée à la modération admin -- jamais un Owner (aucune
 * logique de modération de ce côté, hors périmètre du plan).
 *
 * Règle produit : "sous 3 étoiles ET minimum 5 avis reçus". Traduite littéralement, avec les deux
 * bornes explicitement dissymétriques (pin-testées dans le fichier de test voisin) :
 * - `count >= minRatingCount` : INCLUSIF ("minimum 5 avis" = 5 avis suffisent).
 * - `average < averageThreshold` : STRICT ("sous 3 étoiles" = 3.0 pile n'est pas "sous 3").
 * Le seuil de volume existe pour que deux mauvais avis isolés ne déclenchent rien -- il est donc
 * évalué en PREMIER, et aucune moyenne, si basse soit-elle, ne peut le contourner.
 *
 * Ne dit RIEN de la sortie de revue : cette fonction ne renvoie jamais "il faut retirer le flag".
 * Une clinique dont la moyenne remonte reste `needsAdminReview` jusqu'à décision admin (interface
 * non construite, comme pour les Missions `DISPUTED`) -- effacer automatiquement la trace d'un
 * passage sous le seuil retirerait à la modération l'information même qu'elle doit examiner.
 */
export function exceedsModerationThreshold(
  aggregate: RatingAggregate,
  thresholds: ModerationThresholds,
): boolean {
  return (
    aggregate.count >= thresholds.minRatingCount && aggregate.average < thresholds.averageThreshold
  )
}
