import { describe, it, expect } from 'vitest'
import { throwIfGraphqlError, resolveOrThrowOnFailure } from '@/services/graphql-error-service'

// Phase 8, sous-tâche 5 (extraction post-lot 1, recommandation Lead Dev finding #3) :
// couvre les deux helpers en isolation -- fonctions pures, exactement le genre de fichier
// que ce service existe pour rendre testable sans monter un composable/mocker un client
// GraphQL. Les 4 composables du lot 1 (useAnimals.js/useOwnerProfile.js/
// useOwnerAvailability.js/useRegistrationCompletion.js) gardent leurs propres tests
// inchangés -- le rétrofit ne change que l'implémentation interne, pas le comportement
// observable.

describe('throwIfGraphqlError', () => {
  it("ne fait rien (ne lève pas) quand errors est absent (undefined)", () => {
    expect(() => throwIfGraphqlError(undefined, 'getOwner')).not.toThrow()
  })

  it('ne fait rien (ne lève pas) quand errors est null', () => {
    expect(() => throwIfGraphqlError(null, 'getOwner')).not.toThrow()
  })

  it("lève une Error au message 'Erreur GraphQL <opName>' quand errors est présent", () => {
    expect(() => throwIfGraphqlError([{ message: 'Not Authorized' }], 'getOwner')).toThrow(
      'Erreur GraphQL getOwner',
    )
  })

  it("porte le tableau errors d'origine sur la propriété .errors de l'exception levée", () => {
    const errors = [{ message: 'Not Authorized to access getOwner' }]
    try {
      throwIfGraphqlError(errors, 'getOwner')
      throw new Error('devait lever')
    } catch (e) {
      expect(e.errors).toBe(errors)
    }
  })

  it('interpole opName tel quel dans le message, sans transformation', () => {
    expect(() => throwIfGraphqlError([{ message: 'x' }], 'createAnimal')).toThrow(
      'Erreur GraphQL createAnimal',
    )
  })
})

describe('resolveOrThrowOnFailure', () => {
  it('retourne data quand errors est absent (succès plein)', () => {
    const data = { id: 'animal-1', name: 'Rex' }
    expect(resolveOrThrowOnFailure({ data, errors: undefined }, 'updateAnimal')).toBe(data)
  })

  it("retourne data quand errors est présent MAIS data exploitable (succès partiel)", () => {
    const data = { id: 'animal-1', name: 'Rex modifié' }
    const errors = [{ message: 'Impossible de résoudre une relation annexe' }]
    expect(resolveOrThrowOnFailure({ data, errors }, 'updateAnimal')).toBe(data)
  })

  it('lève une Error quand errors est présent ET data est null (échec réel)', () => {
    const errors = [{ message: 'Not Authorized to access updateAnimal' }]
    expect(() => resolveOrThrowOnFailure({ data: null, errors }, 'updateAnimal')).toThrow(
      'Erreur GraphQL updateAnimal',
    )
  })

  it('lève une Error quand errors est présent ET data est undefined (échec réel)', () => {
    const errors = [{ message: 'Not Authorized to access deleteAnimal' }]
    expect(() => resolveOrThrowOnFailure({ data: undefined, errors }, 'deleteAnimal')).toThrow(
      'Erreur GraphQL deleteAnimal',
    )
  })

  it("porte le tableau errors d'origine sur la propriété .errors de l'exception levée sur échec réel", () => {
    const errors = [{ message: 'Not Authorized to access deleteAnimal' }]
    try {
      resolveOrThrowOnFailure({ data: null, errors }, 'deleteAnimal')
      throw new Error('devait lever')
    } catch (e) {
      expect(e.errors).toBe(errors)
    }
  })

  it("ne lève pas quand ni data ni errors ne sont présents (réponse vide légitime)", () => {
    expect(() => resolveOrThrowOnFailure({ data: null, errors: undefined }, 'getOwner')).not.toThrow()
    expect(resolveOrThrowOnFailure({ data: null, errors: undefined }, 'getOwner')).toBeNull()
  })
})
