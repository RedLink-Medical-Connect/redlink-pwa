import { ref } from 'vue'
import { bffFetch } from '@/services/bff-fetch'

// Photo personnalisée d'Animal -- voir docs/adr/0023-animal-photo-presigned-s3-via-bff.md.
// Le navigateur n'a aucun identifiant AWS depuis le BFF (ADR-0021) : chaque accès S3 passe par
// une autorisation pré-signée délivrée par `/api/animals/photo/*`
// (`amplify/functions/bff/animal-photo-routes.ts`), qui vérifie que l'appelant est propriétaire
// de l'Animal. Le fichier, lui, part DIRECTEMENT du navigateur vers S3 (POST pré-signé), jamais
// au travers du BFF. `Animal.photoKey` n'est écrit que par le BFF (`/confirm`, `/remove`) --
// jamais via `client.models.Animal.update()` (champ en lecture seule côté schéma).

// Même limites que le BFF (`MAX_PHOTO_SIZE_BYTES`/`EXTENSION_BY_CONTENT_TYPE`,
// `animal-photo-routes.ts`) -- dupliquées ici pour refuser un fichier AVANT tout appel réseau ;
// la politique du POST pré-signé reste la garde réelle côté S3.
export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024
export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const PHOTO_ERROR_KEYS = {
  INVALID_FILE_TYPE: 'dashboard.owner.animals.photo.errors.invalid_type',
  FILE_TOO_LARGE: 'dashboard.owner.animals.photo.errors.too_large',
}

/**
 * Traduit le `.message` d'une erreur levée par `uploadAnimalPhoto`/`removeAnimalPhoto` en clé
 * i18n -- fonction pure, testable sans monter de composant (même convention que
 * `mapValidationErrorKey`, `useAnimalValidation.js`).
 *
 * @param {string} errorMessage
 * @returns {string} une clé i18n, à passer à `t()`
 */
export function mapPhotoErrorKey(errorMessage) {
  return PHOTO_ERROR_KEYS[errorMessage] || 'dashboard.owner.animals.photo.errors.generic'
}

/**
 * Validation d'un fichier choisi via un `<input type="file">`, avant tout appel réseau.
 *
 * @param {File} file
 * @returns {string|null} un code d'erreur (voir `PHOTO_ERROR_KEYS`), ou `null` si valide.
 */
export function validatePhotoFile(file) {
  if (!file) return null
  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) return 'INVALID_FILE_TYPE'
  if (file.size > MAX_PHOTO_SIZE_BYTES) return 'FILE_TOO_LARGE'
  return null
}

/** Appelle une route `/api/animals/photo/*` et lève le code d'erreur du BFF sur échec. */
async function callPhotoRoute(path, body) {
  const { ok, data } = await bffFetch(`/api/animals/photo/${path}`, { body })
  if (!ok) throw new Error(data?.error || 'PHOTO_REQUEST_FAILED')
  return data
}

export function useAnimalPhoto() {
  const isUploadingPhoto = ref(false)
  const isRemovingPhoto = ref(false)
  // `animalId -> url` : URL GET pré-signée (900 s), jamais persistée -- redemandée à chaque
  // chargement de la vue.
  const photoUrls = ref({})

  /**
   * Résout les URLs d'affichage des Animals de `animals` qui ont un `photoKey`, en UN appel.
   * "Lecture secondaire non-exclusive isolée" (CLAUDE.md) : un échec est loggé, jamais relancé
   * -- il dégrade l'affichage vers l'icône espèce, jamais toute la liste d'Animals.
   *
   * @param {Array<{id: string, photoKey?: string|null}>} animals
   */
  const loadPhotoUrls = async (animals) => {
    const animalIds = (animals || []).filter((a) => a.photoKey).map((a) => a.id)
    if (animalIds.length === 0) return
    try {
      const { urls } = await callPhotoRoute('urls', { animalIds })
      photoUrls.value = { ...photoUrls.value, ...urls }
    } catch (e) {
      console.error('Erreur résolution URLs photos animaux (non bloquant) :', e)
    }
  }

  /**
   * Upload `file` comme photo de `animal` : autorisation pré-signée (BFF) -> POST direct vers
   * S3 -> confirmation (BFF, écrit `photoKey` et supprime l'ancienne photo).
   *
   * @param {File} file
   * @param {{id: string}} animal
   * @returns {Promise<string>} la nouvelle `photoKey`.
   */
  const uploadAnimalPhoto = async (file, animal) => {
    const validationError = validatePhotoFile(file)
    if (validationError) throw new Error(validationError)

    isUploadingPhoto.value = true
    try {
      const { url, fields, key } = await callPhotoRoute('upload-url', {
        animalId: animal.id,
        contentType: file.type,
      })

      // S3 exige les champs de la politique signée AVANT le fichier, qui doit être le
      // dernier champ du formulaire.
      const form = new FormData()
      for (const [name, value] of Object.entries(fields)) form.append(name, value)
      form.append('file', file)
      const s3Response = await fetch(url, { method: 'POST', body: form })
      if (!s3Response.ok) throw new Error('PHOTO_UPLOAD_FAILED')

      const { photoKey, photoUrl } = await callPhotoRoute('confirm', { animalId: animal.id, key })
      photoUrls.value = { ...photoUrls.value, [animal.id]: photoUrl }
      return photoKey
    } finally {
      isUploadingPhoto.value = false
    }
  }

  /**
   * Retire la photo de `animal` (le BFF efface `photoKey` puis l'objet S3).
   *
   * @param {{id: string}} animal
   */
  const removeAnimalPhoto = async (animal) => {
    isRemovingPhoto.value = true
    try {
      await callPhotoRoute('remove', { animalId: animal.id })
      const nextPhotoUrls = { ...photoUrls.value }
      delete nextPhotoUrls[animal.id]
      photoUrls.value = nextPhotoUrls
    } finally {
      isRemovingPhoto.value = false
    }
  }

  return {
    photoUrls,
    isUploadingPhoto,
    isRemovingPhoto,
    loadPhotoUrls,
    uploadAnimalPhoto,
    removeAnimalPhoto,
  }
}
