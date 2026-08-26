import { describe, it, expect } from 'vitest'
import {
  CLINIC_MODERATION_AVERAGE_THRESHOLD_ENV_VAR,
  CLINIC_MODERATION_MIN_RATING_COUNT_ENV_VAR,
  collectAggregationTargets,
  computeRatingAggregate,
  exceedsModerationThreshold,
  resolveModerationThresholds,
} from './resolve-rating-aggregation'

/**
 * Tests de la logique PURE de la Lambda `rating-aggregation` (étape 3/5 de la double validation
 * de Mission + notation). Même découpage que `resolve-auto-finalization-outcome.test.ts` (étape
 * 2/5) : tout ce qui décide quelque chose est ici, sans I/O ni horloge implicite.
 *
 * Les deux bornes du seuil de modération sont volontairement pin-testées des DEUX côtés
 * (exactement au seuil, juste en dessous, juste au-dessus) : la règle produit ("sous 3 étoiles ET
 * minimum 5 avis") est dissymétrique -- STRICT sur la moyenne, INCLUSIF sur le volume -- et rien
 * dans le code ne le rappellerait si un futur passage inversait l'un des deux.
 */

/** Seuils de référence : ceux réellement déployés (`resource.ts` de la fonction). */
const THRESHOLDS = { minRatingCount: 5, averageThreshold: 3 }

describe('resolveModerationThresholds — les seuils viennent de l’environnement, jamais du code', () => {
  it('lit les deux variables', () => {
    expect(
      resolveModerationThresholds({
        [CLINIC_MODERATION_MIN_RATING_COUNT_ENV_VAR]: '5',
        [CLINIC_MODERATION_AVERAGE_THRESHOLD_ENV_VAR]: '3',
      }),
    ).toEqual({ minRatingCount: 5, averageThreshold: 3 })
  })

  it('accepte un seuil de moyenne fractionnaire (ex. 3,5) sans le tronquer', () => {
    expect(
      resolveModerationThresholds({
        [CLINIC_MODERATION_MIN_RATING_COUNT_ENV_VAR]: '3',
        [CLINIC_MODERATION_AVERAGE_THRESHOLD_ENV_VAR]: '3.5',
      }),
    ).toEqual({ minRatingCount: 3, averageThreshold: 3.5 })
  })

  // Le vrai garde-fou du "aucun seuil en dur" n'est pas une inspection du source mais l'ABSENCE
  // de valeur de repli : si un `?? 3` apparaissait, ces cas cesseraient de lever.
  it('lève si une des deux variables est absente (aucune valeur par défaut)', () => {
    expect(() =>
      resolveModerationThresholds({ [CLINIC_MODERATION_AVERAGE_THRESHOLD_ENV_VAR]: '3' }),
    ).toThrow(CLINIC_MODERATION_MIN_RATING_COUNT_ENV_VAR)
    expect(() =>
      resolveModerationThresholds({ [CLINIC_MODERATION_MIN_RATING_COUNT_ENV_VAR]: '5' }),
    ).toThrow(CLINIC_MODERATION_AVERAGE_THRESHOLD_ENV_VAR)
    expect(() => resolveModerationThresholds({})).toThrow()
  })

  it.each(['', '   ', 'cinq', 'NaN', '0', '-1', '2.5'])(
    'lève sur un volume minimum invalide (%s) — entier >= 1 attendu',
    (raw) => {
      expect(() =>
        resolveModerationThresholds({
          [CLINIC_MODERATION_MIN_RATING_COUNT_ENV_VAR]: raw,
          [CLINIC_MODERATION_AVERAGE_THRESHOLD_ENV_VAR]: '3',
        }),
      ).toThrow()
    },
  )

  it.each(['', 'trois', '0', '-3', '5.5', 'Infinity'])(
    'lève sur un seuil de moyenne hors du domaine ]0, 5] (%s)',
    (raw) => {
      expect(() =>
        resolveModerationThresholds({
          [CLINIC_MODERATION_MIN_RATING_COUNT_ENV_VAR]: '5',
          [CLINIC_MODERATION_AVERAGE_THRESHOLD_ENV_VAR]: raw,
        }),
      ).toThrow()
    },
  )
})

describe('computeRatingAggregate — moyenne recalculée intégralement, jamais incrémentale', () => {
  it('compte et moyenne une liste de notes', () => {
    expect(computeRatingAggregate([5, 4, 3])).toEqual({ count: 3, average: 4 })
    expect(computeRatingAggregate([1])).toEqual({ count: 1, average: 1 })
  })

  it('arrondit la moyenne à 2 décimales (valeur stockée = valeur qui décide du flag)', () => {
    // 10/3 = 3.3333... -> 3.33
    expect(computeRatingAggregate([4, 3, 3])).toEqual({ count: 3, average: 3.33 })
    // 2/3 = 0.6666... -> 0.67 (arrondi, pas troncature)
    expect(computeRatingAggregate([1, 1, 0])).toEqual({ count: 3, average: 0.67 })
  })

  it('renvoie un agrégat neutre (0/0) sur une liste vide — jamais NaN', () => {
    expect(computeRatingAggregate([])).toEqual({ count: 0, average: 0 })
  })

  // Fail-soft assumé (voir la doc de la fonction) : `stars` est `required` au schéma, mais une
  // seule valeur aberrante rendrait toute la moyenne NaN et écraserait un agrégat valide.
  it('ignore les valeurs inexploitables sans contaminer la moyenne ni le compte', () => {
    expect(computeRatingAggregate([5, null, undefined, 3])).toEqual({ count: 2, average: 4 })
    expect(computeRatingAggregate([5, 'pas un nombre', 1])).toEqual({ count: 2, average: 3 })
    expect(computeRatingAggregate([null, undefined])).toEqual({ count: 0, average: 0 })
  })

  it('accepte une note sérialisée en chaîne numérique (tolérance de lecture DynamoDB)', () => {
    expect(computeRatingAggregate(['4', '2'])).toEqual({ count: 2, average: 3 })
  })
})

describe('exceedsModerationThreshold — "sous 3 étoiles ET minimum 5 avis", bornes comprises', () => {
  it('signale 10 avis à 2,9 (moyenne sous le seuil, volume largement atteint)', () => {
    expect(exceedsModerationThreshold({ count: 10, average: 2.9 }, THRESHOLDS)).toBe(true)
  })

  it('signale EXACTEMENT 5 avis sous le seuil (borne de volume INCLUSIVE)', () => {
    expect(exceedsModerationThreshold({ count: 5, average: 2.99 }, THRESHOLDS)).toBe(true)
  })

  it('ne signale PAS 5 avis à EXACTEMENT 3,0 (borne de moyenne STRICTE : 3 n’est pas "sous 3")', () => {
    expect(exceedsModerationThreshold({ count: 5, average: 3 }, THRESHOLDS)).toBe(false)
  })

  it('ne signale PAS 4 avis à 2,0 — volume insuffisant, quelle que soit la moyenne', () => {
    expect(exceedsModerationThreshold({ count: 4, average: 2 }, THRESHOLDS)).toBe(false)
    expect(exceedsModerationThreshold({ count: 4, average: 1 }, THRESHOLDS)).toBe(false)
    expect(exceedsModerationThreshold({ count: 1, average: 1 }, THRESHOLDS)).toBe(false)
  })

  it('ne signale PAS une cible sans aucun avis (agrégat neutre)', () => {
    expect(exceedsModerationThreshold({ count: 0, average: 0 }, THRESHOLDS)).toBe(false)
  })

  it('suit les seuils passés en paramètre, pas des constantes internes', () => {
    const strict = { minRatingCount: 1, averageThreshold: 4.5 }
    expect(exceedsModerationThreshold({ count: 1, average: 4 }, strict)).toBe(true)
    expect(exceedsModerationThreshold({ count: 1, average: 4 }, THRESHOLDS)).toBe(false)
  })
})

describe('collectAggregationTargets — filtrage et dédoublonnage d’un lot du flux Rating', () => {
  const insert = (targetID: string, targetRole: string) => ({
    eventName: 'INSERT',
    targetID,
    targetRole,
  })

  it('retient une cible par enregistrement INSERT exploitable, dans l’ordre d’apparition', () => {
    const { targets, ignored } = collectAggregationTargets([
      insert('clinic-1', 'CLINIC'),
      insert('owner-1', 'OWNER'),
    ])
    expect(targets).toEqual([
      { targetID: 'clinic-1', targetRole: 'CLINIC' },
      { targetID: 'owner-1', targetRole: 'OWNER' },
    ])
    expect(ignored).toEqual({ nonInsert: 0, invalid: 0, duplicates: 0 })
  })

  // LE cas demandé par le brief : deux notations pour la MÊME cible dans le MÊME lot ne doivent
  // déclencher qu'UN seul recalcul (donc une seule écriture), pas deux.
  it('dédoublonne deux INSERT visant la même cible dans le même lot', () => {
    const { targets, ignored } = collectAggregationTargets([
      insert('clinic-1', 'CLINIC'),
      insert('clinic-1', 'CLINIC'),
      insert('clinic-1', 'CLINIC'),
    ])
    expect(targets).toEqual([{ targetID: 'clinic-1', targetRole: 'CLINIC' }])
    expect(ignored.duplicates).toBe(2)
  })

  it('ne confond PAS deux cibles de rôles différents portant le même id', () => {
    // Cas réaliste sur ce schéma : `Clinic.id === Veterinarian.id` à l'inscription (résidu connu
    // Phase -1), donc un id peut exister des deux côtés. C'est la raison d'être de la sort key
    // `targetRole` du GSI.
    const { targets } = collectAggregationTargets([
      insert('id-partage', 'CLINIC'),
      insert('id-partage', 'OWNER'),
    ])
    expect(targets).toEqual([
      { targetID: 'id-partage', targetRole: 'CLINIC' },
      { targetID: 'id-partage', targetRole: 'OWNER' },
    ])
  })

  it('ignore tout événement qui n’est pas un INSERT (Rating est write-once)', () => {
    const { targets, ignored } = collectAggregationTargets([
      { eventName: 'MODIFY', targetID: 'clinic-1', targetRole: 'CLINIC' },
      { eventName: 'REMOVE', targetID: 'clinic-1', targetRole: 'CLINIC' },
      { eventName: undefined, targetID: 'clinic-1', targetRole: 'CLINIC' },
    ])
    expect(targets).toEqual([])
    expect(ignored.nonInsert).toBe(3)
  })

  it('ignore une image sans targetID exploitable', () => {
    const { targets, ignored } = collectAggregationTargets([
      { eventName: 'INSERT', targetID: null, targetRole: 'CLINIC' },
      { eventName: 'INSERT', targetID: '   ', targetRole: 'CLINIC' },
      { eventName: 'INSERT', targetRole: 'CLINIC' },
    ])
    expect(targets).toEqual([])
    expect(ignored.invalid).toBe(3)
  })

  it('ignore un targetRole inconnu plutôt que de le traiter comme un OWNER par défaut', () => {
    const { targets, ignored } = collectAggregationTargets([
      { eventName: 'INSERT', targetID: 'x', targetRole: 'VETERINARIAN' },
      { eventName: 'INSERT', targetID: 'x', targetRole: 'clinic' },
      { eventName: 'INSERT', targetID: 'x', targetRole: null },
    ])
    expect(targets).toEqual([])
    expect(ignored.invalid).toBe(3)
  })

  it('traite un lot vide sans lever', () => {
    expect(collectAggregationTargets([])).toEqual({
      targets: [],
      ignored: { nonInsert: 0, invalid: 0, duplicates: 0 },
    })
  })

  it('conserve les cibles valides d’un lot mixte', () => {
    const { targets, ignored } = collectAggregationTargets([
      { eventName: 'MODIFY', targetID: 'clinic-1', targetRole: 'CLINIC' },
      insert('clinic-1', 'CLINIC'),
      { eventName: 'INSERT', targetID: '', targetRole: 'OWNER' },
      insert('owner-9', 'OWNER'),
      insert('clinic-1', 'CLINIC'),
    ])
    expect(targets).toEqual([
      { targetID: 'clinic-1', targetRole: 'CLINIC' },
      { targetID: 'owner-9', targetRole: 'OWNER' },
    ])
    expect(ignored).toEqual({ nonInsert: 1, invalid: 1, duplicates: 1 })
  })
})
