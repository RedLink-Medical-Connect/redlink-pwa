import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Phase 1.1 (ADR-0002) : useAnimalValidation() expose la liste (globale, voir doc du
// composable) des Animals en attente de validation vétérinaire, et l'action de
// validation elle-même — écriture scopée à isValidatedDonor + validationExpiresAt
// uniquement (validateAnimalDonorSimple).

const graphqlMock = vi.fn()

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}))

import { useAnimalValidation, mapValidationErrorKey } from '@/composables/useAnimalValidation'
import { listAnimalsForValidation } from '@/graphql/custom-queries'

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

describe('useAnimalValidation.fetchPendingValidations', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

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

    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('ListAnimalsForValidation')) {
        return {
          data: {
            listAnimals: { items: [stillValidByOneSecond, expiredByOneSecond, expiresExactlyNow] },
          },
        }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { fetchPendingValidations, pendingAnimals } = useAnimalValidation()
    await fetchPendingValidations()

    expect(pendingAnimals.value.map((a) => a.id).sort()).toEqual(
      ['animal-boundary-exact-now', 'animal-boundary-just-expired'].sort(),
    )
  })

  it("n'envoie aucun filtre de scoping (ownerID/clinicID) : appelle bien la query globale listAnimalsForValidation sans `variables`, conformément à la portée volontairement globale documentée dans useAnimalValidation.js", async () => {
    let capturedArgs = null

    graphqlMock.mockImplementation(async (args) => {
      capturedArgs = args
      return { data: { listAnimals: { items: [] } } }
    })

    const { fetchPendingValidations } = useAnimalValidation()
    await fetchPendingValidations()

    expect(capturedArgs.query).toBe(listAnimalsForValidation)
    expect(capturedArgs.authMode).toBe('userPool')
    // Aucune variable envoyée : pas de filter/ownerID/clinicID — la restriction de portée
    // ne peut venir que d'@auth côté schéma, jamais d'un filtre client.
    expect(capturedArgs.variables).toBeUndefined()
    // La query elle-même ne déclare aucun paramètre sur l'opération ni de `filter` sur
    // listAnimals — non plus juste "le mock l'accepte", mais la query réellement envoyée.
    expect(listAnimalsForValidation).toContain('query ListAnimalsForValidation {')
    expect(listAnimalsForValidation).toContain('listAnimals {')
  })

  it('inclut un Animal jamais validé (isValidatedDonor: false)', async () => {
    const neverValidated = buildAnimal({ id: 'animal-never', isValidatedDonor: false, validationExpiresAt: null })

    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('ListAnimalsForValidation')) {
        return { data: { listAnimals: { items: [neverValidated] } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

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

    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('ListAnimalsForValidation')) {
        return { data: { listAnimals: { items: [expired] } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

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

    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('ListAnimalsForValidation')) {
        return { data: { listAnimals: { items: [valid] } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

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

    graphqlMock.mockImplementation(async ({ query }) => {
      if (query.includes('ListAnimalsForValidation')) {
        return { data: { listAnimals: { items: [neverValidated, expired, valid] } } }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { fetchPendingValidations, pendingAnimals } = useAnimalValidation()
    await fetchPendingValidations()

    expect(pendingAnimals.value.map((a) => a.id).sort()).toEqual(['animal-expired', 'animal-never'])
  })

  it('authMode userPool, isLoading true pendant le chargement puis false, et gère une erreur réseau sans throw', async () => {
    let sawLoadingDuringCall = false
    graphqlMock.mockImplementation(async ({ authMode }) => {
      expect(authMode).toBe('userPool')
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

    graphqlMock.mockImplementation(async () => {
      throw new Error('network down')
    })

    const { fetchPendingValidations, loadError, pendingAnimals } = useAnimalValidation()
    expect(loadError.value).toBe(false)

    await fetchPendingValidations()

    expect(loadError.value).toBe(true)
    expect(pendingAnimals.value).toEqual([])

    // Un rechargement réussi (ex. après un clic sur "Réessayer") efface l'état d'erreur —
    // loadError ne doit pas rester bloqué à true indéfiniment.
    graphqlMock.mockImplementation(async () => ({ data: { listAnimals: { items: [] } } }))
    await fetchPendingValidations()

    expect(loadError.value).toBe(false)

    consoleErrorSpy.mockRestore()
  })
})

describe('useAnimalValidation.validateAnimal', () => {
  beforeEach(() => {
    graphqlMock.mockReset()
  })

  it("appelle la mutation avec un input contenant EXACTEMENT id/isValidatedDonor/validationExpiresAt (rien d'autre, surtout pas bloodGroup)", async () => {
    let capturedInput = null

    graphqlMock.mockImplementation(async ({ query, variables }) => {
      if (query.includes('UpdateAnimal')) {
        capturedInput = variables.input
        return {
          data: {
            updateAnimal: {
              id: variables.input.id,
              isValidatedDonor: variables.input.isValidatedDonor,
              validationExpiresAt: variables.input.validationExpiresAt,
            },
          },
        }
      }
      throw new Error(`Unexpected graphql call in test: ${query.slice(0, 60)}`)
    })

    const { validateAnimal } = useAnimalValidation()
    await validateAnimal('animal-1')

    expect(capturedInput).not.toBeNull()
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

      expect(graphqlMock).not.toHaveBeenCalled()
      expect(isValidating.value).toBe(false)
      // La liste locale n'est pas modifiée : la validation a été refusée, pas acceptée.
      expect(pendingAnimals.value.map((a) => a.id)).toEqual(['animal-1'])
    },
  )

  it('valide normalement un animal dont le bloodGroup connu localement est renseigné et différent de UNKNOWN', async () => {
    graphqlMock.mockImplementation(async ({ variables }) => ({
      data: { updateAnimal: { ...variables.input } },
    }))

    const { validateAnimal, pendingAnimals } = useAnimalValidation()
    pendingAnimals.value = [buildAnimal({ id: 'animal-1', bloodGroup: 'DEA 1.1-' })]

    await expect(validateAnimal('animal-1')).resolves.toBeUndefined()
    expect(graphqlMock).toHaveBeenCalledTimes(1)
  })

  it('calcule validationExpiresAt à ~1 an dans le futur (ISO 8601 / AWSDateTime)', async () => {
    const before = Date.now()
    let capturedInput = null

    graphqlMock.mockImplementation(async ({ variables }) => {
      capturedInput = variables.input
      return { data: { updateAnimal: { ...variables.input } } }
    })

    const { validateAnimal } = useAnimalValidation()
    await validateAnimal('animal-1')
    const after = Date.now()

    const expiresAtMs = new Date(capturedInput.validationExpiresAt).getTime()
    const oneYearMs = 365 * 24 * 60 * 60 * 1000

    expect(expiresAtMs).toBeGreaterThanOrEqual(before + oneYearMs - 5000)
    expect(expiresAtMs).toBeLessThanOrEqual(after + oneYearMs + 5000)
    // Format ISO 8601, cohérent avec le reste du repo (ex. appointmentDatetime dans
    // useOwnerMissions.js).
    expect(capturedInput.validationExpiresAt).toBe(new Date(expiresAtMs).toISOString())
  })

  it('retire l’Animal validé de pendingAnimals.value au succès (les autres restent affichés)', async () => {
    graphqlMock.mockImplementation(async ({ variables }) => ({
      data: { updateAnimal: { ...variables.input } },
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

  it('authMode userPool, isValidating true pendant l’appel puis false, propage l’erreur sans modifier pendingAnimals au échec', async () => {
    graphqlMock.mockImplementation(async ({ authMode }) => {
      expect(authMode).toBe('userPool')
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

  it('isValidating est un ref distinct de isLoading', () => {
    const { isValidating, isLoading } = useAnimalValidation()
    expect(isValidating).not.toBe(isLoading)
  })

  it("valide un animalId absent de pendingAnimals.value (ex. déjà validé dans un autre onglet/session) sans planter : la mutation part quand même (le backend/@auth reste juge), et le filtre local est un no-op qui laisse la liste inchangée", async () => {
    let capturedInput = null
    graphqlMock.mockImplementation(async ({ variables }) => {
      capturedInput = variables.input
      return { data: { updateAnimal: { ...variables.input } } }
    })

    const { validateAnimal, pendingAnimals } = useAnimalValidation()
    pendingAnimals.value = [buildAnimal({ id: 'animal-2' }), buildAnimal({ id: 'animal-3' })]

    await expect(validateAnimal('animal-absent-ailleurs')).resolves.toBeUndefined()

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
