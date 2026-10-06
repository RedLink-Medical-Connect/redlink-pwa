import { describe, it, expect, vi } from 'vitest'

// Resolver AppSync JS `listActiveClinics` -- même technique que
// `submit-mission-validation.resolvers.test.js` : `@aws-appsync/utils` et
// `@aws-appsync/utils/dynamodb` sont des coquilles vides dans le paquet npm (implémentations
// côté runtime AWS), doublées ici pour exercer `request()`/`response()` sans AppSync. Ne prouve
// ni le marshalling DynamoDB réel ni le comportement exact du filtre `Scan` côté AWS.

vi.mock('@aws-appsync/utils/dynamodb', () => ({
  scan: (payload) => ({ operation: 'Scan', payload }),
}))

const utilError = vi.fn((message) => {
  throw new Error(message)
})
vi.mock('@aws-appsync/utils', () => ({ util: { error: (...a) => utilError(...a) } }))

import { request, response } from '../resolvers/list-active-clinics.js'

describe('list-active-clinics request()', () => {
  it('scanne la table Clinic en filtrant verificationStatus = ACTIVE, côté serveur', () => {
    const req = request({ args: {} })
    expect(req.operation).toBe('Scan')
    expect(req.payload.filter).toEqual({ verificationStatus: { eq: 'ACTIVE' } })
    expect(req.payload.nextToken).toBeNull()
  })

  it('transmet le nextToken de pagination', () => {
    expect(request({ args: { nextToken: 'tok' } }).payload.nextToken).toBe('tok')
  })
})

describe('list-active-clinics response()', () => {
  it('ne renvoie QUE id/name/address, jamais les autres attributs de l’item DynamoDB', () => {
    const out = response({
      result: {
        items: [
          {
            id: 'c1',
            name: 'Clinique A',
            address: '1 rue X',
            email: 'secret@clinic.fr',
            phone: '0102030405',
            rpps: '123',
            owner: 'sub::user',
            verificationStatus: 'ACTIVE',
            averageRatingAsClinic: 2.1,
          },
          { id: 'c2', name: 'Clinique B' },
        ],
        nextToken: 'next',
      },
    })

    expect(out).toEqual({
      items: [
        { id: 'c1', name: 'Clinique A', address: '1 rue X' },
        { id: 'c2', name: 'Clinique B', address: null },
      ],
      nextToken: 'next',
    })
  })

  it('page vide (filtre post-Scan) : items [] et nextToken null', () => {
    expect(response({ result: {} })).toEqual({ items: [], nextToken: null })
  })

  it('erreur DynamoDB : remontée via util.error', () => {
    expect(() =>
      response({ error: { message: 'boom', type: 'DynamoDB:Error' }, result: null }),
    ).toThrow('boom')
    expect(utilError).toHaveBeenCalledWith('boom', 'DynamoDB:Error')
  })
})
