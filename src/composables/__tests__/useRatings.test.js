import { describe, it, expect, vi, beforeEach } from 'vitest'

// Notation par étoiles bidirectionnelle PRIVÉE (2026-08-26, étape 4/5) — `useRatings.js`.
//
// LE point que ce fichier doit prouver en priorité (mitigation ADR-0015 §3, promise par l'ADR
// comme étant « uniquement côté client ») : `raterID` et `raterRole` ne viennent JAMAIS d'un
// paramètre de l'appelant.
// - `raterRole` est déduit de `targetRole` et vaut donc toujours une valeur de
//   `RatingParticipantRole` — jamais une chaîne libre (le schéma ne peut pas la valider,
//   `raterRole` étant un `a.string()` pour entrer dans la clé composite).
// - `raterID` est dérivé de l'identité authentifiée courante : `getCurrentUser().userId` côté
//   Owner, `Veterinarian.clinicID` (profil relu ici) côté clinique.
// La preuve la plus forte est STRUCTURELLE : la signature de `submitRating` n'accepte ni
// `raterID` ni `raterRole` — les tests ci-dessous en passent quand même dans l'objet d'entrée et
// vérifient qu'ils ne ressortent nulle part dans ce qui est réellement écrit.

const ratingCreateMock = vi.fn()
const ratingGetMock = vi.fn()
const veterinarianGetMock = vi.fn()
const getCurrentUserMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Rating: {
        create: (...args) => ratingCreateMock(...args),
        get: (...args) => ratingGetMock(...args),
      },
      Veterinarian: { get: (...args) => veterinarianGetMock(...args) },
    },
  }),
}))

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: (...args) => getCurrentUserMock(...args),
}))

import {
  useRatings,
  mapSubmitRatingError,
  RATING_MIN_STARS,
  RATING_MAX_STARS,
} from '@/composables/useRatings'
import { RatingParticipantRole } from '@/constants/enums'

const resetAllMocks = () => {
  ratingCreateMock.mockReset()
  veterinarianGetMock.mockReset()
  getCurrentUserMock.mockReset()
  getCurrentUserMock.mockResolvedValue({ userId: 'cognito-user-1' })
  ratingCreateMock.mockImplementation(async (input) => ({
    data: { ...input },
    errors: undefined,
  }))
  veterinarianGetMock.mockResolvedValue({ data: { clinicID: 'clinic-42' }, errors: undefined })
}

const createdInput = () => ratingCreateMock.mock.calls[0][0]

describe('useRatings.submitRating — dérivation de raterID/raterRole (mitigation ADR-0015 §3)', () => {
  beforeEach(resetAllMocks)

  it('Owner notant la clinique (targetRole=CLINIC) : raterRole=OWNER et raterID = userId Cognito courant, sans jamais lire de profil Veterinarian', async () => {
    const { submitRating } = useRatings()

    await submitRating({
      missionId: 'mission-1',
      targetRole: RatingParticipantRole.CLINIC,
      targetID: 'clinic-42',
      stars: 5,
    })

    expect(ratingCreateMock).toHaveBeenCalledTimes(1)
    expect(createdInput()).toEqual({
      missionID: 'mission-1',
      raterID: 'cognito-user-1',
      raterRole: 'OWNER',
      targetID: 'clinic-42',
      targetRole: 'CLINIC',
      stars: 5,
    })
    expect(veterinarianGetMock).not.toHaveBeenCalled()
  })

  it("Veterinarian notant le propriétaire (targetRole=OWNER) : raterRole=CLINIC et raterID = clinicID DU PROFIL VÉTÉRINAIRE AUTHENTIFIÉ — surtout pas son propre userId Cognito", async () => {
    const { submitRating } = useRatings()

    await submitRating({
      missionId: 'mission-1',
      targetRole: RatingParticipantRole.OWNER,
      targetID: 'owner-7',
      stars: 4,
    })

    expect(veterinarianGetMock).toHaveBeenCalledWith(
      { id: 'cognito-user-1' },
      { selectionSet: ['clinicID'] },
    )
    expect(createdInput().raterID).toBe('clinic-42')
    expect(createdInput().raterRole).toBe('CLINIC')
    // Résidu Phase -1 connu (`Clinic.id === Veterinarian.id` à l'inscription) : ce test resterait
    // vert par accident si les deux valeurs coïncidaient. Elles sont volontairement distinctes
    // dans ces mocks pour que l'assertion ait un vrai pouvoir de détection.
    expect(createdInput().raterID).not.toBe('cognito-user-1')
  })

  it("un raterID / raterRole / clinicID passés en paramètre n'ont AUCUN effet : la signature ne les déclare pas, ils ne peuvent pas atteindre l'écriture", async () => {
    const { submitRating } = useRatings()

    await submitRating({
      missionId: 'mission-1',
      targetRole: RatingParticipantRole.OWNER,
      targetID: 'owner-7',
      stars: 3,
      // Tentative de forgerie exactement telle que décrite par ADR-0015 §3.
      raterID: 'clinic-DE-QUELQU-UN-D-AUTRE',
      raterRole: 'ADMIN',
      clinicID: 'clinic-DE-QUELQU-UN-D-AUTRE',
    })

    expect(createdInput().raterID).toBe('clinic-42')
    expect(createdInput().raterRole).toBe('CLINIC')
    // Aucune clé parasite ne transite vers l'API (la fonction construit son input, elle ne
    // propage jamais l'objet reçu).
    expect(Object.keys(createdInput()).sort()).toEqual(
      ['missionID', 'raterID', 'raterRole', 'stars', 'targetID', 'targetRole'].sort(),
    )
    expect(createdInput()).not.toHaveProperty('clinicID')
  })

  it("submitRating prend UN SEUL paramètre objet, et son objet d'entrée ne contient aucun champ d'identité du noteur (preuve structurelle, pas seulement comportementale)", () => {
    const { submitRating } = useRatings()

    expect(submitRating.length).toBe(1)

    // Les clés réellement déstructurées par la fonction, lues sur sa source (le bloc entre le
    // premier `{` et le premier `}` de sa signature) : si quelqu'un ajoutait `raterID` à la
    // signature, ces assertions tomberaient immédiatement — avant même qu'un test de
    // comportement ait une chance de passer à côté.
    const source = submitRating.toString()
    const destructured = source
      .slice(source.indexOf('{') + 1, source.indexOf('}'))
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)

    expect(destructured.sort()).toEqual(
      ['missionId', 'targetRole', 'targetID', 'stars', 'comment'].sort(),
    )
    expect(destructured).not.toContain('raterID')
    expect(destructured).not.toContain('raterRole')
    expect(destructured).not.toContain('clinicID')
  })

  it.each([
    [RatingParticipantRole.OWNER, RatingParticipantRole.CLINIC],
    [RatingParticipantRole.CLINIC, RatingParticipantRole.OWNER],
  ])(
    'raterRole vient toujours de RatingParticipantRole : targetRole=%s -> raterRole=%s',
    async (targetRole, expectedRaterRole) => {
      const { submitRating } = useRatings()

      await submitRating({ missionId: 'mission-1', targetRole, targetID: 'target-1', stars: 5 })

      expect(createdInput().raterRole).toBe(expectedRaterRole)
      expect(Object.values(RatingParticipantRole)).toContain(createdInput().raterRole)
    },
  )

  it('mémoïse la résolution du clinicID : deux notations vétérinaires de suite = une seule lecture de profil', async () => {
    const { submitRating } = useRatings()

    await submitRating({
      missionId: 'mission-1',
      targetRole: RatingParticipantRole.OWNER,
      targetID: 'owner-7',
      stars: 5,
    })
    await submitRating({
      missionId: 'mission-2',
      targetRole: RatingParticipantRole.OWNER,
      targetID: 'owner-8',
      stars: 4,
    })

    expect(veterinarianGetMock).toHaveBeenCalledTimes(1)
    expect(ratingCreateMock).toHaveBeenCalledTimes(2)
  })

  it("vétérinaire sans clinique rattachée : CLINIC_NOT_FOUND, aucune Rating créée (jamais de raterID vide/undefined écrit)", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    veterinarianGetMock.mockResolvedValue({ data: { clinicID: null }, errors: undefined })

    const { submitRating } = useRatings()

    await expect(
      submitRating({
        missionId: 'mission-1',
        targetRole: RatingParticipantRole.OWNER,
        targetID: 'owner-7',
        stars: 5,
      }),
    ).rejects.toThrow('CLINIC_NOT_FOUND')
    expect(ratingCreateMock).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it("une vraie erreur GraphQL sur la lecture du profil vétérinaire n'est PAS confondue avec « pas de clinique » : elle remonte telle quelle", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    veterinarianGetMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Unauthorized', errorType: 'Unauthorized' }],
    })

    const { submitRating } = useRatings()
    const error = await submitRating({
      missionId: 'mission-1',
      targetRole: RatingParticipantRole.OWNER,
      targetID: 'owner-7',
      stars: 5,
    }).catch((e) => e)

    expect(error.message).toBe('Erreur GraphQL getVeterinarian')
    expect(error.message).not.toBe('CLINIC_NOT_FOUND')
    expect(ratingCreateMock).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})

describe('useRatings.submitRating — validation des entrées (seules gardes existantes, le schéma ne borne aucune valeur)', () => {
  beforeEach(resetAllMocks)

  it.each(['ADMIN', 'owner', '', null, undefined, 'VETERINARIAN'])(
    'targetRole invalide (%s) : INVALID_TARGET_ROLE avant tout appel réseau',
    async (targetRole) => {
      const { submitRating } = useRatings()

      await expect(
        submitRating({ missionId: 'mission-1', targetRole, targetID: 'target-1', stars: 5 }),
      ).rejects.toThrow('INVALID_TARGET_ROLE')
      expect(ratingCreateMock).not.toHaveBeenCalled()
      expect(getCurrentUserMock).not.toHaveBeenCalled()
    },
  )

  it.each([0, -1, 6, 3.5, '4', NaN, null, undefined])(
    'stars invalide (%s) : INVALID_STARS avant tout appel réseau',
    async (stars) => {
      const { submitRating } = useRatings()

      await expect(
        submitRating({
          missionId: 'mission-1',
          targetRole: RatingParticipantRole.CLINIC,
          targetID: 'clinic-42',
          stars,
        }),
      ).rejects.toThrow('INVALID_STARS')
      expect(ratingCreateMock).not.toHaveBeenCalled()
    },
  )

  it.each([RATING_MIN_STARS, 3, RATING_MAX_STARS])('stars=%s est accepté (bornes incluses)', async (stars) => {
    const { submitRating } = useRatings()

    await submitRating({
      missionId: 'mission-1',
      targetRole: RatingParticipantRole.CLINIC,
      targetID: 'clinic-42',
      stars,
    })

    expect(createdInput().stars).toBe(stars)
  })

  it.each([
    [undefined, 'clinic-42'],
    ['mission-1', undefined],
    ['', 'clinic-42'],
    ['mission-1', ''],
  ])('missionId=%s / targetID=%s : INVALID_RATING_TARGET', async (missionId, targetID) => {
    const { submitRating } = useRatings()

    await expect(
      submitRating({
        missionId,
        targetRole: RatingParticipantRole.CLINIC,
        targetID,
        stars: 5,
      }),
    ).rejects.toThrow('INVALID_RATING_TARGET')
    expect(ratingCreateMock).not.toHaveBeenCalled()
  })

  it('commentaire : trimé quand fourni, et la clé est absente quand il est vide ou fait uniquement d’espaces', async () => {
    const { submitRating } = useRatings()

    await submitRating({
      missionId: 'mission-1',
      targetRole: RatingParticipantRole.CLINIC,
      targetID: 'clinic-42',
      stars: 5,
      comment: '  Accueil parfait  ',
    })
    expect(ratingCreateMock.mock.calls[0][0].comment).toBe('Accueil parfait')

    await submitRating({
      missionId: 'mission-2',
      targetRole: RatingParticipantRole.CLINIC,
      targetID: 'clinic-42',
      stars: 5,
      comment: '   ',
    })
    expect(ratingCreateMock.mock.calls[1][0]).not.toHaveProperty('comment')
  })
})

describe('useRatings.submitRating — doublon, erreurs, état de chargement', () => {
  beforeEach(resetAllMocks)

  it('seconde notation du même côté sur la même Mission (clé composite missionID+raterRole) : RATING_ALREADY_SUBMITTED', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Le resolver de création généré conditionne le PutItem sur l'absence de chaque composante
    // de la clé du modèle -> une clé déjà prise remonte en
    // DynamoDB:ConditionalCheckFailedException (voir isDuplicateRatingError, useRatings.js).
    ratingCreateMock.mockResolvedValue({
      data: null,
      errors: [
        {
          errorType: 'DynamoDB:ConditionalCheckFailedException',
          message: 'The conditional request failed',
        },
      ],
    })

    const { submitRating, isSubmitting } = useRatings()

    await expect(
      submitRating({
        missionId: 'mission-1',
        targetRole: RatingParticipantRole.CLINIC,
        targetID: 'clinic-42',
        stars: 5,
      }),
    ).rejects.toThrow('RATING_ALREADY_SUBMITTED')
    expect(isSubmitting.value).toBe(false)
    consoleErrorSpy.mockRestore()
  })

  it("une autre erreur GraphQL (Unauthorized) n'est PAS travestie en RATING_ALREADY_SUBMITTED", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unauthorizedErrors = [{ errorType: 'Unauthorized', message: 'Unauthorized' }]
    ratingCreateMock.mockResolvedValue({ data: null, errors: unauthorizedErrors })

    const { submitRating } = useRatings()
    const error = await submitRating({
      missionId: 'mission-1',
      targetRole: RatingParticipantRole.CLINIC,
      targetID: 'clinic-42',
      stars: 5,
    }).catch((e) => e)

    expect(error.message).not.toBe('RATING_ALREADY_SUBMITTED')
    expect(error.errors).toEqual(unauthorizedErrors)
    consoleErrorSpy.mockRestore()
  })

  it('panne réseau (exception JS sans .errors) : propagée telle quelle', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ratingCreateMock.mockRejectedValue(new Error('Network error'))

    const { submitRating, isSubmitting } = useRatings()

    await expect(
      submitRating({
        missionId: 'mission-1',
        targetRole: RatingParticipantRole.CLINIC,
        targetID: 'clinic-42',
        stars: 5,
      }),
    ).rejects.toThrow('Network error')
    expect(isSubmitting.value).toBe(false)
    consoleErrorSpy.mockRestore()
  })

  it('isSubmitting : true pendant l’écriture, false après succès ; retourne la Rating créée', async () => {
    let duringCall = null
    const { submitRating, isSubmitting } = useRatings()
    ratingCreateMock.mockImplementation(async (input) => {
      duringCall = isSubmitting.value
      return { data: { ...input, createdAt: '2026-08-26T10:00:00.000Z' }, errors: undefined }
    })

    const created = await submitRating({
      missionId: 'mission-1',
      targetRole: RatingParticipantRole.CLINIC,
      targetID: 'clinic-42',
      stars: 5,
    })

    expect(duringCall).toBe(true)
    expect(isSubmitting.value).toBe(false)
    expect(created).toMatchObject({ missionID: 'mission-1', raterRole: 'OWNER' })
  })

  it('logue une erreur contextuelle en français avant de propager', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ratingCreateMock.mockRejectedValue(new Error('boom'))

    const { submitRating } = useRatings()
    await expect(
      submitRating({
        missionId: 'mission-1',
        targetRole: RatingParticipantRole.CLINIC,
        targetID: 'clinic-42',
        stars: 5,
      }),
    ).rejects.toThrow()

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('notation'),
      expect.any(Error),
    )
    consoleErrorSpy.mockRestore()
  })
})

describe('useRatings.checkRatingExists — pré-check "déjà noté" (extrait de MissionsView.vue, revue a11y/lead-dev du 2026-08-31)', () => {
  beforeEach(() => {
    resetAllMocks()
    ratingGetMock.mockReset()
  })

  it("renvoie true quand une Rating existe déjà pour (missionID, raterRole), avec un selectionSet réduit à missionID", async () => {
    ratingGetMock.mockResolvedValue({ data: { missionID: 'mission-1' }, errors: undefined })
    const { checkRatingExists } = useRatings()

    const exists = await checkRatingExists('mission-1', RatingParticipantRole.OWNER)

    expect(exists).toBe(true)
    expect(ratingGetMock).toHaveBeenCalledWith(
      { missionID: 'mission-1', raterRole: RatingParticipantRole.OWNER },
      { selectionSet: ['missionID'] },
    )
  })

  it("renvoie false quand aucune Rating n'existe pour cette clé (cas légitime, pas une erreur)", async () => {
    ratingGetMock.mockResolvedValue({ data: null, errors: undefined })
    const { checkRatingExists } = useRatings()

    await expect(checkRatingExists('mission-1', RatingParticipantRole.OWNER)).resolves.toBe(false)
  })

  it("une vraie erreur GraphQL n'est PAS avalée ici : elle remonte à l'appelant (convention 'résolution de contexte', CLAUDE.md)", async () => {
    ratingGetMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Unauthorized', errorType: 'Unauthorized' }],
    })
    const { checkRatingExists } = useRatings()

    await expect(checkRatingExists('mission-1', RatingParticipantRole.OWNER)).rejects.toThrow(
      'Erreur GraphQL getRating',
    )
  })

  it('fonctionne symétriquement pour raterRole=CLINIC (signature générique, pas de OWNER codé en dur)', async () => {
    ratingGetMock.mockResolvedValue({ data: { missionID: 'mission-2' }, errors: undefined })
    const { checkRatingExists } = useRatings()

    const exists = await checkRatingExists('mission-2', RatingParticipantRole.CLINIC)

    expect(exists).toBe(true)
    expect(ratingGetMock).toHaveBeenCalledWith(
      { missionID: 'mission-2', raterRole: RatingParticipantRole.CLINIC },
      { selectionSet: ['missionID'] },
    )
  })
})

describe('mapSubmitRatingError', () => {
  it('traduit chaque code connu en message utilisateur dédié', () => {
    expect(mapSubmitRatingError('RATING_ALREADY_SUBMITTED')).toContain('déjà noté')
    expect(mapSubmitRatingError('INVALID_STARS')).toContain(String(RATING_MAX_STARS))
    expect(mapSubmitRatingError('CLINIC_NOT_FOUND')).toContain('clinique')
  })

  it('retombe sur le fallback pour un code inconnu', () => {
    expect(mapSubmitRatingError('BOOM')).toBe('Impossible d’enregistrer votre note.')
    expect(mapSubmitRatingError('BOOM', 'repli custom')).toBe('repli custom')
  })
})
