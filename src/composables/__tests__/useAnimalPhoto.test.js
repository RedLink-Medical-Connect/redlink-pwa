import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Photo personnalisée d'Animal (ADR-0023). `bffFetch` mocké au niveau module (même idiome que
// useClinicVeterinarians.test.js) ; `fetch` global stubbé pour le POST direct vers S3.

const bffFetchMock = vi.fn()
vi.mock('@/services/bff-fetch', () => ({
  bffFetch: (...args) => bffFetchMock(...args),
}))

import {
  useAnimalPhoto,
  validatePhotoFile,
  mapPhotoErrorKey,
  ALLOWED_PHOTO_TYPES,
  MAX_PHOTO_SIZE_BYTES,
} from '@/composables/useAnimalPhoto'

const makeFile = ({ type = 'image/jpeg', size = 1024, name = 'photo.jpg' } = {}) =>
  new File([new Uint8Array(size)], name, { type })

const fetchMock = vi.fn()

beforeEach(() => {
  bffFetchMock.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Répond aux routes BFF selon leur dernier segment (`upload-url`, `confirm`...). */
const mockBffRoutes = (responses) => {
  bffFetchMock.mockImplementation(async (path) => {
    const route = path.split('/').pop()
    return responses[route] ?? { ok: false, status: 500, data: {} }
  })
}

describe('validatePhotoFile', () => {
  it.each(ALLOWED_PHOTO_TYPES)('accepte le type %s', (type) => {
    expect(validatePhotoFile(makeFile({ type }))).toBeNull()
  })

  it('rejette un type MIME hors liste blanche (ex. PDF)', () => {
    expect(validatePhotoFile(makeFile({ type: 'application/pdf' }))).toBe('INVALID_FILE_TYPE')
  })

  it('rejette un fichier au-delà de la limite de taille', () => {
    expect(validatePhotoFile(makeFile({ size: MAX_PHOTO_SIZE_BYTES + 1 }))).toBe('FILE_TOO_LARGE')
  })

  it('accepte un fichier pile à la limite', () => {
    expect(validatePhotoFile(makeFile({ size: MAX_PHOTO_SIZE_BYTES }))).toBeNull()
  })
})

describe('mapPhotoErrorKey', () => {
  it('traduit les deux erreurs de validation en clés dédiées', () => {
    expect(mapPhotoErrorKey('INVALID_FILE_TYPE')).toBe('dashboard.owner.animals.photo.errors.invalid_type')
    expect(mapPhotoErrorKey('FILE_TOO_LARGE')).toBe('dashboard.owner.animals.photo.errors.too_large')
  })

  it('retombe sur une clé générique pour toute autre erreur (réseau, BFF, S3)', () => {
    expect(mapPhotoErrorKey('PHOTO_UPLOAD_FAILED')).toBe('dashboard.owner.animals.photo.errors.generic')
  })
})

describe('uploadAnimalPhoto', () => {
  it('refuse un fichier invalide avant tout appel réseau', async () => {
    const { uploadAnimalPhoto } = useAnimalPhoto()
    await expect(uploadAnimalPhoto(makeFile({ type: 'image/gif' }), { id: 'a1' })).rejects.toThrow(
      'INVALID_FILE_TYPE',
    )
    expect(bffFetchMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('autorisation BFF -> POST S3 (champs signés puis fichier en dernier) -> confirmation', async () => {
    mockBffRoutes({
      'upload-url': {
        ok: true,
        data: { url: 'https://s3.example/', fields: { key: 'k', Policy: 'p' }, key: 'k' },
      },
      confirm: { ok: true, data: { photoKey: 'k', photoUrl: 'https://signed/get' } },
    })
    fetchMock.mockResolvedValue({ ok: true })
    const file = makeFile({ type: 'image/png' })
    const { uploadAnimalPhoto, photoUrls, isUploadingPhoto } = useAnimalPhoto()

    const photoKey = await uploadAnimalPhoto(file, { id: 'a1' })

    expect(photoKey).toBe('k')
    expect(bffFetchMock).toHaveBeenNthCalledWith(1, '/api/animals/photo/upload-url', {
      body: { animalId: 'a1', contentType: 'image/png' },
    })
    const [s3Url, s3Init] = fetchMock.mock.calls[0]
    expect(s3Url).toBe('https://s3.example/')
    expect(s3Init.method).toBe('POST')
    expect([...s3Init.body.keys()]).toEqual(['key', 'Policy', 'file'])
    expect(bffFetchMock).toHaveBeenNthCalledWith(2, '/api/animals/photo/confirm', {
      body: { animalId: 'a1', key: 'k' },
    })
    expect(photoUrls.value).toEqual({ a1: 'https://signed/get' })
    expect(isUploadingPhoto.value).toBe(false)
  })

  it("ne confirme pas si l'envoi S3 échoue", async () => {
    mockBffRoutes({
      'upload-url': { ok: true, data: { url: 'https://s3.example/', fields: {}, key: 'k' } },
    })
    fetchMock.mockResolvedValue({ ok: false })
    const { uploadAnimalPhoto, isUploadingPhoto } = useAnimalPhoto()

    await expect(uploadAnimalPhoto(makeFile(), { id: 'a1' })).rejects.toThrow('PHOTO_UPLOAD_FAILED')
    expect(bffFetchMock).toHaveBeenCalledTimes(1)
    expect(isUploadingPhoto.value).toBe(false)
  })

  it('relaie le code d’erreur du BFF', async () => {
    mockBffRoutes({ 'upload-url': { ok: false, status: 404, data: { error: 'ANIMAL_NOT_FOUND' } } })
    const { uploadAnimalPhoto } = useAnimalPhoto()

    await expect(uploadAnimalPhoto(makeFile(), { id: 'a1' })).rejects.toThrow('ANIMAL_NOT_FOUND')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('removeAnimalPhoto', () => {
  it("appelle le BFF et retire l'URL en cache", async () => {
    mockBffRoutes({ remove: { ok: true, data: { status: 'REMOVED' } } })
    const { removeAnimalPhoto, photoUrls } = useAnimalPhoto()
    photoUrls.value = { a1: 'u1', a2: 'u2' }

    await removeAnimalPhoto({ id: 'a1' })

    expect(bffFetchMock).toHaveBeenCalledWith('/api/animals/photo/remove', { body: { animalId: 'a1' } })
    expect(photoUrls.value).toEqual({ a2: 'u2' })
  })

  it("relance l'erreur et garde l'URL en cache si le BFF échoue", async () => {
    mockBffRoutes({ remove: { ok: false, status: 500, data: { error: 'PHOTO_REMOVE_FAILED' } } })
    const { removeAnimalPhoto, photoUrls, isRemovingPhoto } = useAnimalPhoto()
    photoUrls.value = { a1: 'u1' }

    await expect(removeAnimalPhoto({ id: 'a1' })).rejects.toThrow('PHOTO_REMOVE_FAILED')
    expect(photoUrls.value).toEqual({ a1: 'u1' })
    expect(isRemovingPhoto.value).toBe(false)
  })
})

describe('loadPhotoUrls', () => {
  it("ne demande que les Animals qui ont une photoKey, en un seul appel", async () => {
    mockBffRoutes({ urls: { ok: true, data: { urls: { a1: 'u1' } } } })
    const { loadPhotoUrls, photoUrls } = useAnimalPhoto()

    await loadPhotoUrls([{ id: 'a1', photoKey: 'k1' }, { id: 'a2', photoKey: null }])

    expect(bffFetchMock).toHaveBeenCalledTimes(1)
    expect(bffFetchMock).toHaveBeenCalledWith('/api/animals/photo/urls', { body: { animalIds: ['a1'] } })
    expect(photoUrls.value).toEqual({ a1: 'u1' })
  })

  it("n'appelle pas le BFF quand aucun Animal n'a de photo", async () => {
    const { loadPhotoUrls } = useAnimalPhoto()
    await loadPhotoUrls([{ id: 'a1' }])
    expect(bffFetchMock).not.toHaveBeenCalled()
  })

  it('avale un échec (non bloquant) sans toucher aux URLs existantes', async () => {
    mockBffRoutes({ urls: { ok: false, status: 500, data: {} } })
    const { loadPhotoUrls, photoUrls } = useAnimalPhoto()
    photoUrls.value = { a9: 'u9' }

    await expect(loadPhotoUrls([{ id: 'a1', photoKey: 'k1' }])).resolves.toBeUndefined()
    expect(photoUrls.value).toEqual({ a9: 'u9' })
  })
})
