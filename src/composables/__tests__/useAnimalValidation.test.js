import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Phase 1.1 (ADR-0002) : useAnimalValidation() expose la liste (globale, voir doc du
// composable) des Animals en attente de validation vétérinaire, et l'action de
// validation elle-même — écriture scopée à isValidatedDonor + validationExpiresAt
// uniquement (validateAnimalDonorSimple).
//
// Phase 6 (section B) : `correctBloodGroup` + `mapBloodGroupCorrectionErrorKey`,
// couverts par les describe() dédiés en bas de fichier.
//
// Phase 8, sous-tâche 5 (lot 3/3) : mock migré vers le client Gen2 (`aws-amplify/data`,
// `client.models.Animal.list/update`), un mock dédié par méthode plutôt qu'un unique
// `graphqlMock` discriminé par le texte de la query (même convention que useAnimals.js/
// useClinicDonors.js, lots 1/2). Les assertions métier (contenu de `pendingAnimals.value`,
// filtrage en attente/validé/expiré, contenu EXACT des inputs de mutation, `loadError`,
// codes d'erreur) restent EXACTEMENT les mêmes qu'avant la migration — seule la forme du
// mock change. Les anciennes assertions `authMode === 'userPool'` sont retirées : ce
// paramètre n'existe plus sur `client.models.X.*` (voir CLAUDE.md / roadmap Phase 8).

const animalListMock = vi.fn()
const animalUpdateMock = vi.fn()

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Animal: {
        list: (...args) => animalListMock(...args),
        update: (...args) => animalUpdateMock(...args),
      },
    },
  }),
}))

import {
  useAnimalValidation,
  mapValidationErrorKey,
  mapBloodGroupCorrectionErrorKey,
} from '@/composables/useAnimalValidation'

const buildAnimal = (overrides = {}) => ({
  id: 'animal-1',
  name: 'Rex',
  species: 'DOG',
  breed: 'Labrador',
  bloodGroup: 'DEA 1.1-',
  isValidatedDonor: false,
  validationExpiresAt: null,
  ownerID: 'owner-1',
  ownerProfile: { firstname: 'Jean', lastname: 'Dupont' },
  ...overrides,
})

const resetAllMocks = () => {
  animalListMock.mockReset()
  animalUpdateMock.mockReset()
}

describe('useAnimalValidation.fetchPendingValidations', () => {
  beforeEach(resetAllMocks)

  afterEach(() => {
    vi.useRealTimers()
  })

  it("frontière stricte de la comparaison temporelle : une validation qui expire dans quelques secondes reste exclue (pas en attente), une qui a expiré il y a quelques secondes ou exactement 'maintenant' revient en attente — pas seulement testé avec des dates lointaines (2099/2020) qui masqueraient un off-by-one", async () => {
    vi.useFakeTimers()
    const now = new Date('2026-08-13T12:00:00.000Z')
    vi.setSystemTime(now)

    const stillValidByOneSecond = buildAnimal({
      id: 'animal-boundary-still-valid',
      isValidatedDonor: true,
      validationExpiresAt: new Date(now.getTime() + 1000).toISOString(),
    })
    const expiredByOneSecond = buildAnimal({
      id: 'animal-boundary-just-expired',
      isValidatedDonor: true,
      validationExpiresAt: new Date(now.getTime() - 1000).toISOString(),
    })
    // Expire exactement à l'instant présent : isValidatedDonor() compare avec `>` strict
    // (eligibility-service.js), donc "expire maintenant" doit être traité comme expiré,
    // pas comme encore valide.
    const expiresExactlyNow = buildAnimal({
      id: 'animal-boundary-exact-now',
      isValidatedDonor: true,
      validationExpiresAt: now.toISOString(),
    })

    animalListMock.mockResolvedValue({
      data: [stillValidByOneSecond, expiredByOneSecond, expiresExactlyNow],
      errors: undefined,
    })

    const { fetchPendingValidations, pendingAnimals } = useAnimalValidation()
    await fetchPendingValidations()

    expect(pendingAnimals.value.map((a) => a.id).sort()).toEqual(
      ['animal-boundary-exact-now', 'animal-boundary-just-expired'].sort(),
    )
  })

  it("n'envoie aucun filtre de scoping (ownerID/clinicID) : liste globale via client.models.Animal.list(), conformément à la portée volontairement globale documentée dans useAnimalValidation.js", async () => {
    animalListMock.mockResolvedValue({ data: [], errors: undefined })

    const { fetchPendingValidations } = useAnimalValidation()
    await fetchPendingValidations()

    expect(animalListMock).toHaveBeenCalledTimes(1)
    const callArgs = animalListMock.mock.calls[0][0]
    // Aucun `filter` (ownerID/clinicID) : la restriction de portée ne peut venir que
    // d'@auth côté schéma, jamais d'un filtre client.
    expect(callArgs.filter).toBeUndefined()
    // selectionSet reprend EXACTEMENT les champs de la query Gen1 d'origine (voir
    // useAnimalValidation.js) — vérifié ici plutôt que supposé.
    expect(callArgs.selectionSet).toEqual([
      'id',
      'name',
      'species',
      'breed',
      'bloodGroup',
      'isValidatedDonor',
      'validationExpiresAt',
      'ownerID',
      'ownerProfile.firstname',
      'ownerProfile.lastname',
    ])
  })

  it('inclut un Animal jamais validé (isValidatedDonor: false)', async () => {
    const neverValidated = buildAnimal({ id: 'animal-never', isValidatedDonor: false, validationExpiresAt: null })

    animalListMock.mockResolvedValue({ data: [neverValidated], errors: undefined })

    const { fetchPendingValidations, pendingAnimals } = useAnimalValidation()
    await fetchPendingValidations()

    expect(pendingAnimals.value.map((a) => a.id)).toEqual(['animal-never'])
  })

  it('inclut un Animal dont la validation a expiré (isValidatedDonor: true mais validationExpiresAt dans le passé)', async () => {
    const expired = buildAnimal({
      id: 'animal-expired',
      isValidatedDonor: true,
      validationExpiresAt: '2020-01-01T00:00:00.000Z',
    })

    animalListMock.mockResolvedValue({ data: [expired], errors: undefined })

    const { fetchPendingValidations, pendingAnimals } = useAnimalValidation()
    await fetchPendingValidations()

    expect(pendingAnimals.value.map((a) => a.id)).toEqual(['animal-expired'])
  })

  it("n'inclut PAS un Animal Validated Donor à jour (isValidatedDonor: true, validationExpiresAt dans le futur)", async () => {
    const valid = buildAnimal({
      id: 'animal-valid',
      isValidatedDonor: true,
      validationExpiresAt: '2099-01-01T00:00:00.000Z',
    })

    animalListMock.mockResolvedValue({ data: [valid], errors: undefined })

    const { fetchPendingValidations, pendingAnimals } = useAnimalValidation()
    await fetchPendingValidations()

    expect(pendingAnimals.value).toEqual([])
  })

  it('mélange les trois cas : ne garde que les deux animaux en attente (jamais validé + expiré), pas le valide', async () => {
    const neverValidated = buildAnimal({ id: 'animal-never', isValidatedDonor: false, validationExpiresAt: null })
    const expired = buildAnimal({
      id: 'animal-expired',
      isValidatedDonor: true,
      validationExpiresAt: '2020-01-01T00:00:00.000Z',
    })
    const valid = buildAnimal({
      id: 'animal-valid',
      isValidatedDonor: true,
      validationExpiresAt: '2099-01-01T00:00:00.000Z',
    })

    animalListMock.mockResolvedValue({ data: [neverValidated, expired, valid], errors: undefined })

    const { fetchPendingValidations, pendingAnimals } = useAnimalValidation()
    await fetchPendingValidations()

    expect(pendingAnimals.value.map((a) => a.id).sort()).toEqual(['animal-expired', 'animal-never'])
  })

  it('isLoading true pendant le chargement puis false, et gère une erreur réseau sans throw', async () => {
    let sawLoadingDuringCall = false
    animalListMock.mockImplementation(async () => {
      sawLoadingDuringCall = true
      throw new Error('network down')
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { fetchPendingValidations, isLoading } = useAnimalValidation()
    expect(isLoading.value).toBe(false)

    const promise = fetchPendingValidations()
    expect(isLoading.value).toBe(true)
    await promise

    expect(sawLoadingDuringCall).toBe(true)
    expect(isLoading.value).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it("loadError distingue un échec de chargement d'une file d'attente réellement vide (relevé en Lead Dev review : sans ça, un vétérinaire ne peut pas faire la différence)", async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    animalListMock.mockImplementation(async () => {
      throw new Error('network down')
    })

    const { fetchPendingValidations, loadError, pendingAnimals } = useAnimalValidation()
    expect(loadError.value).toBe(false)

    await fetchPendingValidations()

    expect(loadError.value).toBe(true)
    expect(pendingAnimals.value).toEqual([])

    // Un rechargement réussi (ex. après un clic sur "Réessayer") efface l'état d'erreur —
    // loadError ne doit pas rester bloqué à true indéfiniment.
    animalListMock.mockImplementation(async () => ({ data: [], errors: undefined }))
    await fetchPendingValidations()

    expect(loadError.value).toBe(false)

    consoleErrorSpy.mockRestore()
  })

  it("un succès partiel GraphQL (`data` exploitable malgré `errors`) n'est PAS traité comme une erreur : throwIfGraphqlError ne lève que si `errors` est présent, peu importe `data`", async () => {
    // Cas absent en Gen1 (où `client.graphql()` levait directement une exception pour toute
    // erreur GraphQL, jamais un `{ data, errors }` résolu avec les deux à la fois) mais que
    // `client.models.Animal.list()` peut désormais renvoyer -- voir le JSDoc de
    // graphql-error-service.js. `fetchPendingValidations` utilise `throwIfGraphqlError`
    // (jamais `resolveOrThrowOnFailure`), donc `errors` présent doit lever même si `data`
    // est exploitable.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    animalListMock.mockResolvedValue({
      data: [buildAnimal({ id: 'animal-1' })],
      errors: [{ message: 'partial failure' }],
    })

    const { fetchPendingValidations, loadError, pendingAnimals } = useAnimalValidation()
    await fetchPendingValidations()

    expect(loadError.value).toBe(true)
    expect(pendingAnimals.value).toEqual([])
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})

describe('useAnimalValidation.validateAnimal', () => {
  beforeEach(resetAllMocks)

  it("appelle la mutation avec un input contenant EXACTEMENT id/isValidatedDonor/validationExpiresAt (rien d'autre, surtout pas bloodGroup)", async () => {
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { ...input },
      errors: undefined,
    }))

    const { validateAnimal } = useAnimalValidation()
    await validateAnimal('animal-1')

    expect(animalUpdateMock).toHaveBeenCalledTimes(1)
    const capturedInput = animalUpdateMock.mock.calls[0][0]
    expect(Object.keys(capturedInput).sort()).toEqual(
      ['id', 'isValidatedDonor', 'validationExpiresAt'].sort(),
    )
    expect(capturedInput.id).toBe('animal-1')
    expect(capturedInput.isValidatedDonor).toBe(true)
  })

  it.each([
    ['absent (chaîne vide)', ''],
    ['non renseigné (null)', null],
    ["littéral 'UNKNOWN'", 'UNKNOWN'],
  ])(
    "refuse la validation (BLOOD_GROUP_UNKNOWN) sans appeler la mutation quand le bloodGroup connu localement est %s — CONTEXT.md interdit un Validated Donor à groupe sanguin inconnu",
    async (_label, bloodGroup) => {
      const { validateAnimal, pendingAnimals, isValidating } = useAnimalValidation()
      pendingAnimals.value = [buildAnimal({ id: 'animal-1', bloodGroup })]

      await expect(validateAnimal('animal-1')).rejects.toThrow('BLOOD_GROUP_UNKNOWN')

      expect(animalUpdateMock).not.toHaveBeenCalled()
      expect(isValidating.value).toBe(false)
      // La liste locale n'est pas modifiée : la validation a été refusée, pas acceptée.
      expect(pendingAnimals.value.map((a) => a.id)).toEqual(['animal-1'])
    },
  )

  it('valide normalement un animal dont le bloodGroup connu localement est renseigné et différent de UNKNOWN', async () => {
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { ...input },
      errors: undefined,
    }))

    const { validateAnimal, pendingAnimals } = useAnimalValidation()
    pendingAnimals.value = [buildAnimal({ id: 'animal-1', bloodGroup: 'DEA 1.1-' })]

    await expect(validateAnimal('animal-1')).resolves.toBeUndefined()
    expect(animalUpdateMock).toHaveBeenCalledTimes(1)
  })

  it('calcule validationExpiresAt à ~1 an dans le futur (ISO 8601 / AWSDateTime)', async () => {
    const before = Date.now()

    animalUpdateMock.mockImplementation(async (input) => ({
      data: { ...input },
      errors: undefined,
    }))

    const { validateAnimal } = useAnimalValidation()
    await validateAnimal('animal-1')
    const after = Date.now()

    const capturedInput = animalUpdateMock.mock.calls[0][0]
    const expiresAtMs = new Date(capturedInput.validationExpiresAt).getTime()
    const oneYearMs = 365 * 24 * 60 * 60 * 1000

    expect(expiresAtMs).toBeGreaterThanOrEqual(before + oneYearMs - 5000)
    expect(expiresAtMs).toBeLessThanOrEqual(after + oneYearMs + 5000)
    // Format ISO 8601, cohérent avec le reste du repo (ex. appointmentDatetime dans
    // useOwnerMissions.js).
    expect(capturedInput.validationExpiresAt).toBe(new Date(expiresAtMs).toISOString())
  })

  it('retire l’Animal validé de pendingAnimals.value au succès (les autres restent affichés)', async () => {
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { ...input },
      errors: undefined,
    }))

    const { validateAnimal, pendingAnimals } = useAnimalValidation()
    pendingAnimals.value = [
      buildAnimal({ id: 'animal-1' }),
      buildAnimal({ id: 'animal-2' }),
      buildAnimal({ id: 'animal-3' }),
    ]

    await validateAnimal('animal-1')

    expect(pendingAnimals.value.map((a) => a.id)).toEqual(['animal-2', 'animal-3'])
  })

  it('isValidating true pendant l’appel puis false, propage l’erreur sans modifier pendingAnimals au échec', async () => {
    animalUpdateMock.mockImplementation(async () => {
      throw new Error('boom')
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { validateAnimal, isValidating, pendingAnimals } = useAnimalValidation()
    pendingAnimals.value = [buildAnimal({ id: 'animal-1' })]

    expect(isValidating.value).toBe(false)
    const promise = validateAnimal('animal-1')
    expect(isValidating.value).toBe(true)

    await expect(promise).rejects.toThrow('boom')

    expect(isValidating.value).toBe(false)
    expect(pendingAnimals.value.map((a) => a.id)).toEqual(['animal-1'])
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('propage une erreur GraphQL résolue (`{ data: null, errors }`, pas d’exception JS rejetée) comme un échec — throwIfGraphqlError synthétise l’exception', async () => {
    animalUpdateMock.mockResolvedValue({
      data: null,
      errors: [{ message: 'Not Authorized to access updateAnimal on type Animal' }],
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { validateAnimal, isValidating, pendingAnimals } = useAnimalValidation()
    pendingAnimals.value = [buildAnimal({ id: 'animal-1' })]

    await expect(validateAnimal('animal-1')).rejects.toThrow('Erreur GraphQL updateAnimal')

    expect(isValidating.value).toBe(false)
    // Rejeté avant le filtre local : l'Animal reste dans pendingAnimals.
    expect(pendingAnimals.value.map((a) => a.id)).toEqual(['animal-1'])

    consoleErrorSpy.mockRestore()
  })

  it('isValidating est un ref distinct de isLoading', () => {
    const { isValidating, isLoading } = useAnimalValidation()
    expect(isValidating).not.toBe(isLoading)
  })

  it("valide un animalId absent de pendingAnimals.value (ex. déjà validé dans un autre onglet/session) sans planter : la mutation part quand même (le backend/@auth reste juge), et le filtre local est un no-op qui laisse la liste inchangée", async () => {
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { ...input },
      errors: undefined,
    }))

    const { validateAnimal, pendingAnimals } = useAnimalValidation()
    pendingAnimals.value = [buildAnimal({ id: 'animal-2' }), buildAnimal({ id: 'animal-3' })]

    await expect(validateAnimal('animal-absent-ailleurs')).resolves.toBeUndefined()

    const capturedInput = animalUpdateMock.mock.calls[0][0]
    expect(capturedInput.id).toBe('animal-absent-ailleurs')
    expect(pendingAnimals.value.map((a) => a.id).sort()).toEqual(['animal-2', 'animal-3'])
  })
})

// Extraite de ValidationsView.vue pendant la QA pass de feat/animal-validation-ui : ce repo
// n'a aucun précédent de test de composant `.vue` (voir la Lead Dev review de
// feat/wire-eligibility-engine), donc le mapping code-d'erreur -> clé i18n vit ici comme
// fonction pure, testable sans monter de composant — même raisonnement que
// mapAcceptMissionError dans useOwnerMissions.js/useOwnerMissions.spec.js. Retourne une CLÉ
// i18n (pas le texte traduit) : contrairement à mapAcceptMissionError (qui retourne du
// français en dur, dette connue trackée sur DashboardView.vue dans CLAUDE.md),
// ValidationsView.vue passe déjà correctement par vue-i18n ailleurs — cette fonction reste
// hors contexte de composant donc ne peut pas appeler `t()` elle-même, mais ne réintroduit
// pas la dette pour autant : l'appelant fait `t(mapValidationErrorKey(e.message))`.
describe('mapValidationErrorKey', () => {
  it('mappe BLOOD_GROUP_UNKNOWN vers sa clé i18n spécifique', () => {
    expect(mapValidationErrorKey('BLOOD_GROUP_UNKNOWN')).toBe(
      'dashboard.validations.toasts.blood_group_unknown',
    )
  })

  it('retombe sur la clé générique pour un code non reconnu (erreur réseau, @auth...)', () => {
    expect(mapValidationErrorKey('Network request failed')).toBe(
      'dashboard.validations.toasts.generic_error',
    )
    expect(mapValidationErrorKey(undefined)).toBe('dashboard.validations.toasts.generic_error')
  })

  it('les deux clés retournées existent réellement dans fr.json et en.json (pas une clé qui déclencherait le warning ESLint @intlify/vue-i18n/no-missing-keys)', () => {
    const fr = JSON.parse(readFileSync(resolve(process.cwd(), 'src/locales/fr.json'), 'utf-8'))
    const en = JSON.parse(readFileSync(resolve(process.cwd(), 'src/locales/en.json'), 'utf-8'))

    const resolveKey = (obj, key) => key.split('.').reduce((acc, part) => acc?.[part], obj)

    for (const code of ['BLOOD_GROUP_UNKNOWN', 'SOME_UNKNOWN_CODE']) {
      const key = mapValidationErrorKey(code)
      expect(resolveKey(fr, key)).toBeTypeOf('string')
      expect(resolveKey(en, key)).toBeTypeOf('string')
    }
  })
})

// Phase 6 (section B) : useAnimalValidation.correctBloodGroup — corrige un
// Animal.bloodGroup saisi par erreur par l'Owner (nouvelle règle @auth au niveau champ
// sur bloodGroup, voir schema.graphql). N'écrit QUE bloodGroup
// (updateAnimalBloodGroupSimple) — jamais isValidatedDonor/validationExpiresAt, qui
// restent le rôle exclusif de validateAnimal (voir describe ci-dessus).
describe('useAnimalValidation.correctBloodGroup', () => {
  beforeEach(resetAllMocks)

  it('appelle la mutation avec un input contenant EXACTEMENT id/bloodGroup (rien d’autre, surtout pas isValidatedDonor/validationExpiresAt)', async () => {
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { ...input },
      errors: undefined,
    }))

    const { correctBloodGroup } = useAnimalValidation()
    await correctBloodGroup('animal-1', 'DEA 1.1-')

    expect(animalUpdateMock).toHaveBeenCalledTimes(1)
    const capturedInput = animalUpdateMock.mock.calls[0][0]
    expect(Object.keys(capturedInput).sort()).toEqual(['bloodGroup', 'id'].sort())
    expect(capturedInput.id).toBe('animal-1')
    expect(capturedInput.bloodGroup).toBe('DEA 1.1-')
  })

  it.each([
    ['absent (chaîne vide)', ''],
    ['non renseigné (null)', null],
    ["littéral 'UNKNOWN'", 'UNKNOWN'],
  ])(
    'refuse la correction (BLOOD_GROUP_UNKNOWN) sans appeler la mutation quand la nouvelle valeur est %s',
    async (_label, bloodGroup) => {
      const { correctBloodGroup, isCorrectingBloodGroup } = useAnimalValidation()

      await expect(correctBloodGroup('animal-1', bloodGroup)).rejects.toThrow(
        'BLOOD_GROUP_UNKNOWN',
      )

      expect(animalUpdateMock).not.toHaveBeenCalled()
      expect(isCorrectingBloodGroup.value).toBe(false)
    },
  )

  it('met à jour pendingAnimals.value localement avec la nouvelle valeur au succès (les autres animaux restent inchangés)', async () => {
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { ...input },
      errors: undefined,
    }))

    const { correctBloodGroup, pendingAnimals } = useAnimalValidation()
    pendingAnimals.value = [
      buildAnimal({ id: 'animal-1', bloodGroup: 'UNKNOWN' }),
      buildAnimal({ id: 'animal-2', bloodGroup: 'A' }),
    ]

    await correctBloodGroup('animal-1', 'DEA 1.1+')

    expect(pendingAnimals.value.find((a) => a.id === 'animal-1').bloodGroup).toBe('DEA 1.1+')
    expect(pendingAnimals.value.find((a) => a.id === 'animal-2').bloodGroup).toBe('A')
  })

  it('corrige un animalId absent de pendingAnimals.value sans planter : la mutation part quand même, le filtre local est un no-op', async () => {
    animalUpdateMock.mockImplementation(async (input) => ({
      data: { ...input },
      errors: undefined,
    }))

    const { correctBloodGroup, pendingAnimals } = useAnimalValidation()
    pendingAnimals.value = [buildAnimal({ id: 'animal-2' })]

    await expect(correctBloodGroup('animal-absent-ailleurs', 'B')).resolves.toBeUndefined()

    const capturedInput = animalUpdateMock.mock.calls[0][0]
    expect(capturedInput.id).toBe('animal-absent-ailleurs')
    expect(pendingAnimals.value.map((a) => a.id)).toEqual(['animal-2'])
  })

  it('isCorrectingBloodGroup true pendant l’appel puis false, propage l’erreur sans modifier pendingAnimals au échec', async () => {
    animalUpdateMock.mockImplementation(async () => {
      throw new Error('boom')
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { correctBloodGroup, isCorrectingBloodGroup, pendingAnimals } = useAnimalValidation()
    pendingAnimals.value = [buildAnimal({ id: 'animal-1', bloodGroup: 'UNKNOWN' })]

    expect(isCorrectingBloodGroup.value).toBe(false)
    const promise = correctBloodGroup('animal-1', 'DEA 1.1-')
    expect(isCorrectingBloodGroup.value).toBe(true)

    await expect(promise).rejects.toThrow('boom')

    expect(isCorrectingBloodGroup.value).toBe(false)
    expect(pendingAnimals.value.find((a) => a.id === 'animal-1').bloodGroup).toBe('UNKNOWN')
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('isCorrectingBloodGroup est un ref distinct de isLoading et isValidating', () => {
    const { isCorrectingBloodGroup, isLoading, isValidating } = useAnimalValidation()
    expect(isCorrectingBloodGroup).not.toBe(isLoading)
    expect(isCorrectingBloodGroup).not.toBe(isValidating)
  })

  it(
    'GAP RÉSIDUEL ASSUMÉ (Phase 6 section B, voir le commentaire au-dessus de bloodGroup ' +
      'dans schema.graphql) : correctBloodGroup ne vérifie PAS isValidatedDonor — appelée ' +
      "directement (comme le ferait n'importe quel appel GraphQL hors UI) sur un Animal " +
      "DÉJÀ validé, la mutation part quand même et réussit, sans erreur ni déclenchement " +
      "d'une re-validation. La seule protection existante contre ce cas est côté UI " +
      "(ValidationsView.vue n'expose l'éditeur inline de bloodGroup que pour les lignes de " +
      "pendingAnimals) — ce composable, lui, ne fait aucune différence entre un Animal en " +
      "attente et un Animal déjà validé. Ce test documente le comportement actuel plutôt " +
      "que de le supposer : s'il se met à échouer parce qu'un garde-fou a été ajouté, " +
      "remplacer ce test par un test du nouveau comportement plutôt que le supprimer.",
    async () => {
      animalUpdateMock.mockImplementation(async (input) => ({
        data: { ...input },
        errors: undefined,
      }))

      const { correctBloodGroup, pendingAnimals } = useAnimalValidation()
      // Un Animal déjà validé ne devrait normalement jamais figurer dans pendingAnimals
      // (fetchPendingValidations ne charge que les Animals en attente) — mais rien
      // n'empêche techniquement un appelant d'invoquer correctBloodGroup(animalId, ...)
      // avec l'id d'un Animal déjà validé, hors de ce flux UI.
      pendingAnimals.value = [
        buildAnimal({
          id: 'animal-deja-valide',
          bloodGroup: 'A',
          isValidatedDonor: true,
          validationExpiresAt: '2027-01-01T00:00:00.000Z',
        }),
      ]

      await expect(correctBloodGroup('animal-deja-valide', 'DEA 1.1+')).resolves.toBeUndefined()

      const capturedInput = animalUpdateMock.mock.calls[0][0]
      expect(capturedInput).toEqual({ id: 'animal-deja-valide', bloodGroup: 'DEA 1.1+' })
      expect(pendingAnimals.value[0].bloodGroup).toBe('DEA 1.1+')
      // isValidatedDonor n'est ni lu ni modifié par correctBloodGroup : le statut de
      // validation reste inchangé alors que le bloodGroup qu'il avait validé a changé
      // sous lui, sans déclencher de re-validation.
      expect(pendingAnimals.value[0].isValidatedDonor).toBe(true)
    },
  )
})

// Même raisonnement que mapValidationErrorKey (voir sa doc ci-dessus) : fonction pure
// dédiée à correctBloodGroup, extraite de ValidationsView.vue pour rester testable sans
// monter de composant.
describe('mapBloodGroupCorrectionErrorKey', () => {
  it('mappe BLOOD_GROUP_UNKNOWN vers la même clé i18n que mapValidationErrorKey (même garde-fou, même message)', () => {
    expect(mapBloodGroupCorrectionErrorKey('BLOOD_GROUP_UNKNOWN')).toBe(
      'dashboard.validations.toasts.blood_group_unknown',
    )
  })

  it('retombe sur une clé générique DISTINCTE de celle de mapValidationErrorKey pour un code non reconnu (erreur réseau, @auth...) — la correction et la validation sont deux actions différentes', () => {
    expect(mapBloodGroupCorrectionErrorKey('Network request failed')).toBe(
      'dashboard.validations.toasts.blood_group_correction_error',
    )
    expect(mapBloodGroupCorrectionErrorKey(undefined)).toBe(
      'dashboard.validations.toasts.blood_group_correction_error',
    )
    expect(mapBloodGroupCorrectionErrorKey('Network request failed')).not.toBe(
      mapValidationErrorKey('Network request failed'),
    )
  })

  it('les deux clés retournées existent réellement dans fr.json et en.json (pas une clé qui déclencherait le warning ESLint @intlify/vue-i18n/no-missing-keys)', () => {
    const fr = JSON.parse(readFileSync(resolve(process.cwd(), 'src/locales/fr.json'), 'utf-8'))
    const en = JSON.parse(readFileSync(resolve(process.cwd(), 'src/locales/en.json'), 'utf-8'))

    const resolveKey = (obj, key) => key.split('.').reduce((acc, part) => acc?.[part], obj)

    for (const code of ['BLOOD_GROUP_UNKNOWN', 'SOME_UNKNOWN_CODE']) {
      const key = mapBloodGroupCorrectionErrorKey(code)
      expect(resolveKey(fr, key)).toBeTypeOf('string')
      expect(resolveKey(en, key)).toBeTypeOf('string')
    }
  })
})
