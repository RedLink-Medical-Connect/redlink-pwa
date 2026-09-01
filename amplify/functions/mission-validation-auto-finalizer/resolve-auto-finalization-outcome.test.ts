import { describe, it, expect } from 'vitest'
import {
  MISSION_VALIDATION_TIMEOUT_DAYS_ENV_VAR,
  resolveAutoFinalizationOutcome,
  resolveClinicOwnerRelationUpsert,
  resolveTimeoutDays,
  todayAsAWSDate,
} from './resolve-auto-finalization-outcome'

/**
 * Tests de la logique PURE de la Lambda planifiée `mission-validation-auto-finalizer`
 * (étape 2/5 de la double validation de Mission).
 *
 * Pourquoi ce fichier compte plus que la couverture habituelle : c'est la SEULE copie
 * exécutable-en-test de la matrice de réconciliation de la double validation dans ce dépôt. La
 * matrice de référence (`amplify/data/resolvers/submit-mission-validation-finalize-status.js`)
 * tourne sur le runtime `APPSYNC_JS` et n'est aujourd'hui testable dans ce repo par aucun moyen
 * (pas de sandbox AppSync, `ampx sandbox` hors périmètre agent). Une régression sur la matrice
 * automatique se verrait ici ; une régression sur la matrice "en direct" ne se verrait toujours
 * qu'en production.
 *
 * `nowMs`/`now` sont toujours injectés (aucune horloge implicite) : pas de `vi.useFakeTimers()`
 * nécessaire, et les cas de frontière (échéance à la milliseconde, changement de jour à Paris)
 * s'écrivent en clair.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** 2026-08-01T10:00:00Z, point de départ arbitraire mais fixe de tous les cas ci-dessous. */
const VALIDATED_AT = '2026-08-01T10:00:00.000Z'
const VALIDATED_AT_MS = Date.parse(VALIDATED_AT)

describe('resolveTimeoutDays — le délai vient de l’environnement, jamais du code', () => {
  it('lit la valeur de MISSION_VALIDATION_TIMEOUT_DAYS', () => {
    expect(resolveTimeoutDays({ [MISSION_VALIDATION_TIMEOUT_DAYS_ENV_VAR]: '7' })).toBe(7)
    expect(resolveTimeoutDays({ [MISSION_VALIDATION_TIMEOUT_DAYS_ENV_VAR]: '3' })).toBe(3)
  })

  // LE test demandé par le brief de cette sous-tâche ("le délai n'est jamais en dur") : ce qui
  // le garantit réellement n'est pas une inspection du source mais l'ABSENCE de valeur de repli
  // -- si un `?? 7` apparaissait un jour dans `resolveTimeoutDays`, ce cas cesserait de lever et
  // échouerait. Une variable absente/vide/mal orthographiée doit faire échouer l'invocation
  // planifiée (visible dans CloudWatch), jamais produire silencieusement un autre délai que
  // celui déployé.
  it('lève si la variable est absente (aucune valeur par défaut codée en dur)', () => {
    expect(() => resolveTimeoutDays({})).toThrow(MISSION_VALIDATION_TIMEOUT_DAYS_ENV_VAR)
  })

  it('lève si la variable est vide ou ne contient que des espaces', () => {
    expect(() => resolveTimeoutDays({ [MISSION_VALIDATION_TIMEOUT_DAYS_ENV_VAR]: '' })).toThrow()
    expect(() => resolveTimeoutDays({ [MISSION_VALIDATION_TIMEOUT_DAYS_ENV_VAR]: '   ' })).toThrow()
  })

  it.each(['sept', '7j', 'NaN', '0', '-3', 'Infinity'])(
    'lève sur une valeur non numérique ou non strictement positive (%s)',
    (raw) => {
      expect(() => resolveTimeoutDays({ [MISSION_VALIDATION_TIMEOUT_DAYS_ENV_VAR]: raw })).toThrow()
    },
  )

  it('accepte une valeur fractionnaire (vérification du mécanisme sans attendre des jours réels)', () => {
    expect(resolveTimeoutDays({ [MISSION_VALIDATION_TIMEOUT_DAYS_ENV_VAR]: '0.5' })).toBe(0.5)
  })
})

describe('resolveAutoFinalizationOutcome — matrice de finalisation automatique', () => {
  it('côté Clinic seul, CONFIRMED, échéance dépassée -> COMPLETED_AUTO', () => {
    const outcome = resolveAutoFinalizationOutcome(
      { clinicValidationOutcome: 'CONFIRMED', clinicValidatedAt: VALIDATED_AT },
      { nowMs: VALIDATED_AT_MS + 8 * DAY_MS, timeoutDays: 7 },
    )

    expect(outcome).toEqual({
      kind: 'FINALIZE',
      finalStatus: 'COMPLETED_AUTO',
      respondingSide: 'CLINIC',
      deadlineMs: VALIDATED_AT_MS + 7 * DAY_MS,
    })
  })

  it('côté Owner seul, CONFIRMED, échéance dépassée -> COMPLETED_AUTO', () => {
    const outcome = resolveAutoFinalizationOutcome(
      { ownerValidationOutcome: 'CONFIRMED', ownerValidatedAt: VALIDATED_AT },
      { nowMs: VALIDATED_AT_MS + 8 * DAY_MS, timeoutDays: 7 },
    )

    expect(outcome).toMatchObject({
      kind: 'FINALIZE',
      finalStatus: 'COMPLETED_AUTO',
      respondingSide: 'OWNER',
    })
  })

  // Le point le plus important de la matrice : le côté silencieux est TOUJOURS auto-confirmé
  // positivement, donc un DENIED du côté qui a répondu ne peut jamais donner NO_SHOW (qui
  // supposerait deux DENIED réels) -- c'est un litige, pas une absence constatée par les deux.
  it.each([
    ['CLINIC', { clinicValidationOutcome: 'DENIED', clinicValidatedAt: VALIDATED_AT }],
    ['OWNER', { ownerValidationOutcome: 'DENIED', ownerValidatedAt: VALIDATED_AT }],
  ])('côté %s seul, DENIED, échéance dépassée -> DISPUTED (jamais NO_SHOW)', (side, mission) => {
    const outcome = resolveAutoFinalizationOutcome(mission, {
      nowMs: VALIDATED_AT_MS + 8 * DAY_MS,
      timeoutDays: 7,
    })

    expect(outcome).toMatchObject({
      kind: 'FINALIZE',
      finalStatus: 'DISPUTED',
      respondingSide: side,
    })
  })

  it('ne renvoie jamais COMPLETED ni NO_SHOW (statuts réservés à une double réponse réelle)', () => {
    const finalStatuses = [
      { clinicValidationOutcome: 'CONFIRMED', clinicValidatedAt: VALIDATED_AT },
      { clinicValidationOutcome: 'DENIED', clinicValidatedAt: VALIDATED_AT },
      { ownerValidationOutcome: 'CONFIRMED', ownerValidatedAt: VALIDATED_AT },
      { ownerValidationOutcome: 'DENIED', ownerValidatedAt: VALIDATED_AT },
    ].map((mission) =>
      resolveAutoFinalizationOutcome(mission, {
        nowMs: VALIDATED_AT_MS + 30 * DAY_MS,
        timeoutDays: 7,
      }),
    )

    for (const outcome of finalStatuses) {
      expect(outcome.kind).toBe('FINALIZE')
      expect(['COMPLETED_AUTO', 'DISPUTED']).toContain(
        outcome.kind === 'FINALIZE' ? outcome.finalStatus : null,
      )
    }
  })
})

describe('resolveAutoFinalizationOutcome — calcul de l’échéance', () => {
  it("n'est pas dépassée avant MIN(validatedAt) + timeoutDays", () => {
    const outcome = resolveAutoFinalizationOutcome(
      { clinicValidationOutcome: 'CONFIRMED', clinicValidatedAt: VALIDATED_AT },
      { nowMs: VALIDATED_AT_MS + 7 * DAY_MS - 1, timeoutDays: 7 },
    )

    expect(outcome).toEqual({ kind: 'SKIP', reason: 'DEADLINE_NOT_REACHED' })
  })

  it('est atteinte à la milliseconde exacte (comparaison inclusive)', () => {
    const outcome = resolveAutoFinalizationOutcome(
      { clinicValidationOutcome: 'CONFIRMED', clinicValidatedAt: VALIDATED_AT },
      { nowMs: VALIDATED_AT_MS + 7 * DAY_MS, timeoutDays: 7 },
    )

    expect(outcome.kind).toBe('FINALIZE')
  })

  // Complète la frontière ci-dessus (passe QA, 2026-08-27) : les trois points contigus
  // -1 ms / échéance exacte / +1 ms sont désormais tous couverts, donc un basculement de
  // `<` en `<=` (ou l'inverse) est détecté quel que soit le sens de l'erreur.
  it('est dépassée une milliseconde APRÈS l’échéance', () => {
    const outcome = resolveAutoFinalizationOutcome(
      { clinicValidationOutcome: 'CONFIRMED', clinicValidatedAt: VALIDATED_AT },
      { nowMs: VALIDATED_AT_MS + 7 * DAY_MS + 1, timeoutDays: 7 },
    )

    expect(outcome).toMatchObject({
      kind: 'FINALIZE',
      finalStatus: 'COMPLETED_AUTO',
      deadlineMs: VALIDATED_AT_MS + 7 * DAY_MS,
    })
  })

  // Le délai est un PARAMÈTRE, pas une constante : la même Mission, au même instant, bascule
  // d'un côté ou de l'autre selon la seule valeur de MISSION_VALIDATION_TIMEOUT_DAYS.
  it('la même Mission au même instant dépend uniquement du délai configuré', () => {
    const mission = { clinicValidationOutcome: 'CONFIRMED', clinicValidatedAt: VALIDATED_AT }
    const nowMs = VALIDATED_AT_MS + 8 * DAY_MS
    const env = (days: string) => ({ [MISSION_VALIDATION_TIMEOUT_DAYS_ENV_VAR]: days })

    expect(
      resolveAutoFinalizationOutcome(mission, { nowMs, timeoutDays: resolveTimeoutDays(env('7')) })
        .kind,
    ).toBe('FINALIZE')
    expect(
      resolveAutoFinalizationOutcome(mission, { nowMs, timeoutDays: resolveTimeoutDays(env('30')) }),
    ).toEqual({ kind: 'SKIP', reason: 'DEADLINE_NOT_REACHED' })
  })

  // Donnée incohérente (les deux horodatages renseignés alors qu'un seul côté a un outcome
  // décidé) : l'échéance part du PLUS ANCIEN, comme le veut le MIN, jamais du plus récent.
  it('prend le MIN des deux horodatages quand les deux sont présents', () => {
    const earlier = VALIDATED_AT_MS
    const later = VALIDATED_AT_MS + 5 * DAY_MS

    const outcome = resolveAutoFinalizationOutcome(
      {
        clinicValidationOutcome: 'CONFIRMED',
        clinicValidatedAt: new Date(later).toISOString(),
        ownerValidatedAt: new Date(earlier).toISOString(),
      },
      { nowMs: earlier + 7 * DAY_MS, timeoutDays: 7 },
    )

    expect(outcome).toMatchObject({ kind: 'FINALIZE', deadlineMs: earlier + 7 * DAY_MS })
  })
})

describe('resolveAutoFinalizationOutcome — cas défensifs (aucune écriture)', () => {
  it('les DEUX côtés ont déjà répondu -> BOTH_SIDES_RESPONDED (le resolver seul peut trancher ce cas)', () => {
    const outcome = resolveAutoFinalizationOutcome(
      {
        clinicValidationOutcome: 'CONFIRMED',
        clinicValidatedAt: VALIDATED_AT,
        ownerValidationOutcome: 'DENIED',
        ownerValidatedAt: VALIDATED_AT,
      },
      { nowMs: VALIDATED_AT_MS + 365 * DAY_MS, timeoutDays: 7 },
    )

    expect(outcome).toEqual({ kind: 'SKIP', reason: 'BOTH_SIDES_RESPONDED' })
  })

  it('les deux côtés ont répondu et sont d’accord -> toujours BOTH_SIDES_RESPONDED, jamais COMPLETED_AUTO', () => {
    const outcome = resolveAutoFinalizationOutcome(
      {
        clinicValidationOutcome: 'CONFIRMED',
        clinicValidatedAt: VALIDATED_AT,
        ownerValidationOutcome: 'CONFIRMED',
        ownerValidatedAt: VALIDATED_AT,
      },
      { nowMs: VALIDATED_AT_MS + 365 * DAY_MS, timeoutDays: 7 },
    )

    expect(outcome).toEqual({ kind: 'SKIP', reason: 'BOTH_SIDES_RESPONDED' })
  })

  it('aucun côté n’a répondu -> NO_SIDE_RESPONDED (jamais une double auto-confirmation)', () => {
    const outcome = resolveAutoFinalizationOutcome(
      {},
      { nowMs: VALIDATED_AT_MS + 365 * DAY_MS, timeoutDays: 7 },
    )

    expect(outcome).toEqual({ kind: 'SKIP', reason: 'NO_SIDE_RESPONDED' })
  })

  it('un horodatage sans outcome décidé ne suffit pas à finaliser', () => {
    const outcome = resolveAutoFinalizationOutcome(
      { clinicValidatedAt: VALIDATED_AT },
      { nowMs: VALIDATED_AT_MS + 365 * DAY_MS, timeoutDays: 7 },
    )

    expect(outcome).toEqual({ kind: 'SKIP', reason: 'NO_SIDE_RESPONDED' })
  })

  // 'PENDING' n'est jamais écrit en base (un champ absent EST 'PENDING', voir
  // submit-mission-validation-write-side.js) -- mais s'il l'était, il ne doit pas compter comme
  // une réponse. Idem pour toute valeur inattendue.
  it.each(['PENDING', null, undefined, '', 'CONFIRMEDD'])(
    'un outcome %s ne compte pas comme une réponse',
    (outcomeValue) => {
      const outcome = resolveAutoFinalizationOutcome(
        {
          clinicValidationOutcome: outcomeValue,
          clinicValidatedAt: VALIDATED_AT,
          ownerValidationOutcome: 'CONFIRMED',
          ownerValidatedAt: VALIDATED_AT,
        },
        { nowMs: VALIDATED_AT_MS + 365 * DAY_MS, timeoutDays: 7 },
      )

      expect(outcome).toMatchObject({ kind: 'FINALIZE', respondingSide: 'OWNER' })
    },
  )

  it.each([undefined, null, '', 'pas-une-date'])(
    'un côté a répondu mais son horodatage est %s -> NO_VALIDATION_TIMESTAMP',
    (timestamp) => {
      const outcome = resolveAutoFinalizationOutcome(
        { clinicValidationOutcome: 'CONFIRMED', clinicValidatedAt: timestamp },
        { nowMs: VALIDATED_AT_MS + 365 * DAY_MS, timeoutDays: 7 },
      )

      expect(outcome).toEqual({ kind: 'SKIP', reason: 'NO_VALIDATION_TIMESTAMP' })
    },
  )
})

describe('todayAsAWSDate — date locale de la clinique, pas la date UTC de la Lambda', () => {
  // Le bug de frontière trouvé en QA sur la Phase 2 (useMissionClosure.js), transposé au runtime
  // Lambda (qui, lui, tourne en UTC et ne peut pas être basculé via la variable TZ, réservée).
  it('heure d’été : 23h30 UTC est déjà le lendemain à Paris', () => {
    expect(todayAsAWSDate(new Date('2026-08-26T23:30:00.000Z'), 'Europe/Paris')).toBe('2026-08-27')
    expect(todayAsAWSDate(new Date('2026-08-26T23:30:00.000Z'), 'UTC')).toBe('2026-08-26')
  })

  it('heure d’hiver : 23h30 UTC est aussi le lendemain à Paris (UTC+1)', () => {
    expect(todayAsAWSDate(new Date('2026-01-14T23:30:00.000Z'), 'Europe/Paris')).toBe('2026-01-15')
  })

  it('format AWSDate strict (YYYY-MM-DD, mois/jour sur deux chiffres)', () => {
    expect(todayAsAWSDate(new Date('2026-03-05T12:00:00.000Z'), 'Europe/Paris')).toBe('2026-03-05')
  })
})

describe('resolveClinicOwnerRelationUpsert — copie backend de la règle front (duplication assumée)', () => {
  // Même règle que `src/services/clinic-owner-relation-service.js` (dupliquée faute de module
  // partageable entre les deux runtimes, choix d'architecture documenté). Ces cas sont l'image
  // de ceux du service front : si l'un des deux dérive, ce fichier le montre.
  it('relation déjà existante pour CETTE clinique -> pas de doublon', () => {
    expect(resolveClinicOwnerRelationUpsert([{ clinicID: 'clinic-1' }], 'clinic-1')).toBeNull()
  })

  it('toute première relation de cet Owner -> isPrimaryClinic true', () => {
    expect(resolveClinicOwnerRelationUpsert([], 'clinic-1')).toEqual({
      clinicID: 'clinic-1',
      isPrimaryClinic: true,
    })
  })

  it('Owner déjà rattaché à une AUTRE clinique -> isPrimaryClinic false', () => {
    expect(resolveClinicOwnerRelationUpsert([{ clinicID: 'clinic-2' }], 'clinic-1')).toEqual({
      clinicID: 'clinic-1',
      isPrimaryClinic: false,
    })
  })
})
