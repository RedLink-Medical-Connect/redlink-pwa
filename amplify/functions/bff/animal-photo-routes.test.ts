// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import * as photoRoutes from './animal-photo-routes'
import { ACCESS_TOKEN_COOKIE } from './cookies'

/**
 * Même idiome que `clinic-routes.test.ts` : `GetUserCommand` stubbé via `.prototype.send`,
 * DynamoDB/S3 mockés au niveau MODULE (commandes réduites à `{ commandName, input }`).
 */
const cognitoSendSpy = vi.spyOn(CognitoIdentityProviderClient.prototype, 'send')

const { dynamoSendMock, s3SendMock, createPresignedPostMock, getSignedUrlMock } = vi.hoisted(() => ({
  dynamoSendMock: vi.fn(),
  s3SendMock: vi.fn(),
  createPresignedPostMock: vi.fn(),
  getSignedUrlMock: vi.fn(),
}))

vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: dynamoSendMock }) },
  GetCommand: class {
    readonly commandName = 'Get'
    constructor(readonly input: Record<string, unknown>) {}
  },
  UpdateCommand: class {
    readonly commandName = 'Update'
    constructor(readonly input: Record<string, unknown>) {}
  },
}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = s3SendMock
  },
  GetObjectCommand: class {
    readonly commandName = 'GetObject'
    constructor(readonly input: Record<string, unknown>) {}
  },
  HeadObjectCommand: class {
    readonly commandName = 'HeadObject'
    constructor(readonly input: Record<string, unknown>) {}
  },
  DeleteObjectCommand: class {
    readonly commandName = 'DeleteObject'
    constructor(readonly input: Record<string, unknown>) {}
  },
}))

vi.mock('@aws-sdk/s3-presigned-post', () => ({ createPresignedPost: createPresignedPostMock }))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: getSignedUrlMock }))

const COOKIES = [`${ACCESS_TOKEN_COOKIE}=access-token`]
const ANIMAL_ID = 'animal-1'
const CALLER_OWNER = 'sub-1::owner@example.com'
const VALID_KEY = `animal-photos/${ANIMAL_ID}/123e4567-e89b-12d3-a456-426614174000.jpg`
const OLD_KEY = `animal-photos/${ANIMAL_ID}/00000000-0000-0000-0000-000000000000.png`

function mockCaller() {
  cognitoSendSpy.mockResolvedValue({
    Username: 'owner@example.com',
    UserAttributes: [
      { Name: 'sub', Value: 'sub-1' },
      { Name: 'email', Value: 'owner@example.com' },
    ],
  } as never)
}

function mockAnimal(item: Record<string, unknown> | undefined) {
  dynamoSendMock.mockImplementation(async (command: { commandName: string }) => {
    if (command.commandName === 'Get') return { Item: item }
    return {}
  })
}

function commandsNamed(mock: typeof dynamoSendMock, name: string) {
  return mock.mock.calls.map(([command]) => command).filter((command) => command.commandName === name)
}

afterAll(() => {
  cognitoSendSpy.mockRestore()
})

beforeEach(() => {
  cognitoSendSpy.mockReset()
  dynamoSendMock.mockReset()
  s3SendMock.mockReset()
  createPresignedPostMock.mockReset()
  getSignedUrlMock.mockReset()
  process.env.ANIMAL_TABLE_NAME = 'Animal-table'
  process.env.ANIMAL_PHOTOS_BUCKET_NAME = 'photos-bucket'
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockCaller()
  getSignedUrlMock.mockResolvedValue('https://signed.example/get')
})

describe('isValidPhotoKeyForAnimal', () => {
  it('accepte exactement animal-photos/<animalId>/<uuid>.<jpg|png|webp>', () => {
    expect(photoRoutes.isValidPhotoKeyForAnimal(VALID_KEY, ANIMAL_ID)).toBe(true)
  })

  it.each([
    ['préfixe d’un autre Animal', `animal-photos/animal-2/123e4567-e89b-12d3-a456-426614174000.jpg`],
    ['remontée de répertoire', `animal-photos/${ANIMAL_ID}/../animal-2/x.jpg`],
    ['extension non autorisée', `animal-photos/${ANIMAL_ID}/123e4567-e89b-12d3-a456-426614174000.gif`],
    ['sous-dossier', `animal-photos/${ANIMAL_ID}/sub/123e4567-e89b-12d3-a456-426614174000.jpg`],
    ['pas une chaîne', 42],
  ])('refuse : %s', (_label, key) => {
    expect(photoRoutes.isValidPhotoKeyForAnimal(key, ANIMAL_ID)).toBe(false)
  })
})

describe('requestUploadUrl', () => {
  it('400 INVALID_FILE_TYPE pour un type non image, avant toute vérification d’identité', async () => {
    const result = await photoRoutes.requestUploadUrl({ animalId: ANIMAL_ID, contentType: 'image/gif' }, COOKIES)
    expect(result).toEqual({ statusCode: 400, body: { error: 'INVALID_FILE_TYPE' } })
    expect(cognitoSendSpy).not.toHaveBeenCalled()
  })

  it('401 sans cookie de session', async () => {
    const result = await photoRoutes.requestUploadUrl({ animalId: ANIMAL_ID, contentType: 'image/png' }, undefined)
    expect(result.statusCode).toBe(401)
  })

  it('404 ANIMAL_NOT_FOUND quand l’Animal appartient à quelqu’un d’autre (même réponse qu’un id inexistant)', async () => {
    mockAnimal({ id: ANIMAL_ID, owner: 'sub-2::other@example.com' })
    const result = await photoRoutes.requestUploadUrl({ animalId: ANIMAL_ID, contentType: 'image/png' }, COOKIES)
    expect(result).toEqual({ statusCode: 404, body: { error: 'ANIMAL_NOT_FOUND' } })
    expect(createPresignedPostMock).not.toHaveBeenCalled()
  })

  it('signe un POST limité à la taille max et au Content-Type annoncé, sous le préfixe de l’Animal', async () => {
    mockAnimal({ id: ANIMAL_ID, owner: CALLER_OWNER })
    createPresignedPostMock.mockResolvedValue({ url: 'https://s3.example/', fields: { key: 'k' } })

    const result = await photoRoutes.requestUploadUrl({ animalId: ANIMAL_ID, contentType: 'image/webp' }, COOKIES)

    expect(result.statusCode).toBe(200)
    const options = createPresignedPostMock.mock.calls[0][1]
    expect(options.Bucket).toBe('photos-bucket')
    expect(photoRoutes.isValidPhotoKeyForAnimal(options.Key, ANIMAL_ID)).toBe(true)
    expect(options.Key.endsWith('.webp')).toBe(true)
    expect(options.Conditions).toContainEqual(['content-length-range', 1, photoRoutes.MAX_PHOTO_SIZE_BYTES])
    expect(options.Conditions).toContainEqual(['eq', '$Content-Type', 'image/webp'])
    expect(result.body).toEqual({ url: 'https://s3.example/', fields: { key: 'k' }, key: options.Key })
  })
})

describe('confirmUpload', () => {
  it('400 INVALID_PHOTO_KEY pour une clé hors du préfixe de l’Animal, sans rien écrire', async () => {
    const result = await photoRoutes.confirmUpload(
      { animalId: ANIMAL_ID, key: 'animal-photos/animal-2/123e4567-e89b-12d3-a456-426614174000.jpg' },
      COOKIES,
    )
    expect(result).toEqual({ statusCode: 400, body: { error: 'INVALID_PHOTO_KEY' } })
    expect(dynamoSendMock).not.toHaveBeenCalled()
  })

  it('400 PHOTO_NOT_UPLOADED quand l’objet S3 n’existe pas -- photoKey jamais écrit', async () => {
    mockAnimal({ id: ANIMAL_ID, owner: CALLER_OWNER })
    s3SendMock.mockRejectedValue(new Error('Forbidden'))

    const result = await photoRoutes.confirmUpload({ animalId: ANIMAL_ID, key: VALID_KEY }, COOKIES)

    expect(result).toEqual({ statusCode: 400, body: { error: 'PHOTO_NOT_UPLOADED' } })
    expect(commandsNamed(dynamoSendMock, 'Update')).toHaveLength(0)
  })

  it('écrit photoKey (avec updatedAt, condition attribute_exists) puis supprime l’ancienne photo', async () => {
    mockAnimal({ id: ANIMAL_ID, owner: CALLER_OWNER, photoKey: OLD_KEY })
    s3SendMock.mockResolvedValue({})

    const result = await photoRoutes.confirmUpload({ animalId: ANIMAL_ID, key: VALID_KEY }, COOKIES)

    expect(result).toEqual({
      statusCode: 200,
      body: { photoKey: VALID_KEY, photoUrl: 'https://signed.example/get' },
    })
    const [update] = commandsNamed(dynamoSendMock, 'Update')
    expect(update.input.UpdateExpression).toBe('SET photoKey = :key, updatedAt = :now')
    expect(update.input.ConditionExpression).toBe('attribute_exists(id)')
    expect(update.input.ExpressionAttributeValues[':key']).toBe(VALID_KEY)
    const deletes = s3SendMock.mock.calls.map(([c]) => c).filter((c) => c.commandName === 'DeleteObject')
    expect(deletes.map((c) => c.input.Key)).toEqual([OLD_KEY])
  })

  it('un échec de suppression de l’ancienne photo ne fait pas échouer la confirmation (best-effort)', async () => {
    mockAnimal({ id: ANIMAL_ID, owner: CALLER_OWNER, photoKey: OLD_KEY })
    s3SendMock.mockImplementation(async (command: { commandName: string }) => {
      if (command.commandName === 'DeleteObject') throw new Error('S3 down')
      return {}
    })

    const result = await photoRoutes.confirmUpload({ animalId: ANIMAL_ID, key: VALID_KEY }, COOKIES)

    expect(result.statusCode).toBe(200)
  })

  it('ne supprime jamais une ancienne photoKey hors du préfixe de l’Animal', async () => {
    mockAnimal({
      id: ANIMAL_ID,
      owner: CALLER_OWNER,
      photoKey: 'animal-photos/animal-2/123e4567-e89b-12d3-a456-426614174000.jpg',
    })
    s3SendMock.mockResolvedValue({})

    await photoRoutes.confirmUpload({ animalId: ANIMAL_ID, key: VALID_KEY }, COOKIES)

    expect(s3SendMock.mock.calls.map(([c]) => c.commandName)).toEqual(['HeadObject'])
  })
})

describe('removePhoto', () => {
  it('efface photoKey puis supprime l’objet S3', async () => {
    mockAnimal({ id: ANIMAL_ID, owner: CALLER_OWNER, photoKey: VALID_KEY })
    s3SendMock.mockResolvedValue({})

    const result = await photoRoutes.removePhoto({ animalId: ANIMAL_ID }, COOKIES)

    expect(result).toEqual({ statusCode: 200, body: { status: 'REMOVED' } })
    const [update] = commandsNamed(dynamoSendMock, 'Update')
    expect(update.input.UpdateExpression).toBe('REMOVE photoKey SET updatedAt = :now')
    expect(s3SendMock.mock.calls[0][0].input).toEqual({ Bucket: 'photos-bucket', Key: VALID_KEY })
  })

  it('404 pour l’Animal de quelqu’un d’autre, sans rien écrire', async () => {
    mockAnimal({ id: ANIMAL_ID, owner: 'sub-2::other@example.com', photoKey: VALID_KEY })

    const result = await photoRoutes.removePhoto({ animalId: ANIMAL_ID }, COOKIES)

    expect(result.statusCode).toBe(404)
    expect(commandsNamed(dynamoSendMock, 'Update')).toHaveLength(0)
    expect(s3SendMock).not.toHaveBeenCalled()
  })
})

describe('getPhotoUrls', () => {
  it('ne signe que les photos des Animals de l’appelant, omet les autres sans erreur', async () => {
    const items: Record<string, Record<string, unknown>> = {
      a1: { id: 'a1', owner: CALLER_OWNER, photoKey: 'animal-photos/a1/123e4567-e89b-12d3-a456-426614174000.jpg' },
      a2: { id: 'a2', owner: CALLER_OWNER },
      a3: { id: 'a3', owner: 'sub-2::other@example.com', photoKey: 'animal-photos/a3/123e4567-e89b-12d3-a456-426614174000.jpg' },
    }
    dynamoSendMock.mockImplementation(async (command: { input: { Key: { id: string } } }) => ({
      Item: items[command.input.Key.id],
    }))

    const result = await photoRoutes.getPhotoUrls({ animalIds: ['a1', 'a2', 'a3', 'missing'] }, COOKIES)

    expect(result).toEqual({ statusCode: 200, body: { urls: { a1: 'https://signed.example/get' } } })
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1)
  })

  it('400 au-delà de 50 identifiants', async () => {
    const animalIds = Array.from({ length: 51 }, (_, i) => `a${i}`)
    const result = await photoRoutes.getPhotoUrls({ animalIds }, COOKIES)
    expect(result).toEqual({ statusCode: 400, body: { error: 'TOO_MANY_ANIMAL_IDS' } })
  })
})
