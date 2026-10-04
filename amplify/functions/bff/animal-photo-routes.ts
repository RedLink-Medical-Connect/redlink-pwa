import { randomUUID } from 'node:crypto'
import { S3Client, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { requireCaller, ownerIdentity } from './caller-identity'
import type { Caller } from './caller-identity'
import type { RouteResult } from './auth-routes'

/**
 * Routes `/api/animals/photo/*` du BFF -- photo personnalisée d'un Animal (voir
 * docs/adr/0023-animal-photo-presigned-s3-via-bff.md pour le design complet).
 *
 * POURQUOI LE BFF, ET PAS `defineStorage` + `aws-amplify/storage` CÔTÉ NAVIGATEUR
 * -----------------------------------------------------------------------------
 * Depuis ADR-0021, le navigateur ne détient plus AUCUNE session Cognito (ni JWT, ni
 * identifiants temporaires de l'identity pool) : `uploadData()`/`getUrl()` d'`aws-amplify/
 * storage` n'ont donc plus de quoi signer une requête S3. Le fichier ne transite pas pour
 * autant par ce Lambda (limite de 6 Mo par requête Function URL, coût) : le BFF vérifie
 * l'appelant puis délivre une autorisation S3 PRÉ-SIGNÉE, à durée de vie courte --
 * - upload : POST pré-signé (`createPresignedPost`), PAS un PUT pré-signé -- la politique
 *   signée d'un POST impose côté S3 lui-même `content-length-range` et `Content-Type`, là où
 *   un PUT pré-signé laisserait le navigateur envoyer une taille arbitraire ;
 * - affichage : GET pré-signé (`getSignedUrl`), consommé directement par un `<img src>`.
 *
 * `Animal.photoKey` n'est écrit QUE par ce fichier (écriture DynamoDB directe, même famille que
 * `clinic-routes.ts`) -- jamais par `client.models.Animal.update()` : le champ est en lecture
 * seule pour tous les rôles Cognito côté schéma (`animalPhotoKeyFieldAuth`,
 * `amplify/data/resource.ts`). Sans ça, un Owner pourrait faire pointer `photoKey` vers la
 * photo d'un AUTRE Animal. Défense en profondeur quand même : toute clé lue ou écrite ici doit
 * commencer par `animal-photos/<animalId>/`, l'Animal dont l'appelant est propriétaire.
 *
 * Accès réservé au PROPRIÉTAIRE de l'Animal (`Animal.owner`, même comparaison que le référent
 * dans `clinic-routes.ts`). Un Animal inexistant et un Animal appartenant à quelqu'un d'autre
 * renvoient le MÊME `404 ANIMAL_NOT_FOUND` -- ne pas révéler l'existence d'un identifiant.
 */

export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024
export const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
// Durée de vie des autorisations pré-signées : upload court (le fichier part juste après),
// affichage aligné sur le défaut d'`aws-amplify/storage` `getUrl()` (900 s) que remplace cette
// route -- `useAnimalPhoto.js` redemande les URLs à chaque chargement de la vue.
const UPLOAD_EXPIRES_SECONDS = 300
const DISPLAY_URL_EXPIRES_SECONDS = 900
const MAX_ANIMAL_IDS_PER_URL_REQUEST = 50

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

function getS3Client() {
  return new S3Client({ region: process.env.AWS_REGION })
}

function getAnimalTableName() {
  const tableName = process.env.ANIMAL_TABLE_NAME
  if (!tableName) throw new Error('ANIMAL_TABLE_NAME manquant')
  return tableName
}

function getBucketName() {
  const bucket = process.env.ANIMAL_PHOTOS_BUCKET_NAME
  if (!bucket) throw new Error('ANIMAL_PHOTOS_BUCKET_NAME manquant')
  return bucket
}

function photoKeyPrefix(animalId: string) {
  return `animal-photos/${animalId}/`
}

/**
 * Clé S3 exactement du format produit par `requestUploadUrl` pour CET Animal
 * (`animal-photos/<animalId>/<uuid>.<ext>`) -- refuse tout autre chemin, y compris un chemin
 * sous le préfixe d'un autre Animal ou contenant `..`.
 */
export function isValidPhotoKeyForAnimal(key: unknown, animalId: string): key is string {
  if (typeof key !== 'string' || !key.startsWith(photoKeyPrefix(animalId))) return false
  const fileName = key.slice(photoKeyPrefix(animalId).length)
  return /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(fileName)
}

type AnimalItem = { id: string; owner?: string; photoKey?: string }

/** L'Animal `animalId` s'il existe ET appartient à `caller`, sinon `null`. */
async function getOwnedAnimal(caller: Caller, animalId: string): Promise<AnimalItem | null> {
  const result = await documentClient.send(
    new GetCommand({ TableName: getAnimalTableName(), Key: { id: animalId } }),
  )
  const item = result.Item as AnimalItem | undefined
  if (!item || item.owner !== ownerIdentity(caller)) return null
  return item
}

async function signDisplayUrl(key: string) {
  return getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: getBucketName(), Key: key }), {
    expiresIn: DISPLAY_URL_EXPIRES_SECONDS,
  })
}

/**
 * Suppression S3 best-effort (même idiome qu'"écriture secondaire best-effort", CLAUDE.md) :
 * n'est appelée qu'APRÈS la mise à jour de `photoKey` en base, la partie critique -- un objet
 * orphelin est un résidu de stockage, jamais une erreur visible par l'utilisateur.
 */
async function deleteObjectBestEffort(key: string) {
  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: getBucketName(), Key: key }))
  } catch (err) {
    console.error('animal-photo: suppression S3 best-effort en échec :', err)
  }
}

function readAnimalId(body: Record<string, unknown>): string | null {
  return typeof body.animalId === 'string' && body.animalId ? body.animalId : null
}

/**
 * `POST /api/animals/photo/upload-url` -- `{ animalId, contentType }` ->
 * `{ url, fields, key }`, à envoyer tel quel en `multipart/form-data` vers S3
 * (`fields` d'abord, le fichier en DERNIER champ, `file`).
 */
export async function requestUploadUrl(
  body: Record<string, unknown>,
  cookies: string[] | undefined,
): Promise<RouteResult> {
  const animalId = readAnimalId(body)
  if (!animalId) return { statusCode: 400, body: { error: 'MISSING_ANIMAL_ID' } }
  const contentType = typeof body.contentType === 'string' ? body.contentType : ''
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType]
  if (!extension) return { statusCode: 400, body: { error: 'INVALID_FILE_TYPE' } }

  const caller = await requireCaller(cookies)
  if (!caller) return { statusCode: 401, body: { error: 'NOT_AUTHENTICATED' } }

  try {
    const animal = await getOwnedAnimal(caller, animalId)
    if (!animal) return { statusCode: 404, body: { error: 'ANIMAL_NOT_FOUND' } }

    const key = `${photoKeyPrefix(animalId)}${randomUUID()}.${extension}`
    const { url, fields } = await createPresignedPost(getS3Client(), {
      Bucket: getBucketName(),
      Key: key,
      Conditions: [
        ['content-length-range', 1, MAX_PHOTO_SIZE_BYTES],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: UPLOAD_EXPIRES_SECONDS,
    })
    return { statusCode: 200, body: { url, fields, key } }
  } catch (err) {
    console.error('requestUploadUrl error:', err)
    return { statusCode: 500, body: { error: 'PHOTO_UPLOAD_URL_FAILED' } }
  }
}

/**
 * `POST /api/animals/photo/confirm` -- `{ animalId, key }` -> `{ photoKey, photoUrl }`. À
 * appeler une fois l'upload S3 terminé : vérifie que l'objet existe réellement (un client ne
 * peut pas faire pointer `photoKey` vers un fichier jamais envoyé), écrit `photoKey`, puis
 * supprime l'ancienne photo en best-effort.
 */
export async function confirmUpload(
  body: Record<string, unknown>,
  cookies: string[] | undefined,
): Promise<RouteResult> {
  const animalId = readAnimalId(body)
  if (!animalId) return { statusCode: 400, body: { error: 'MISSING_ANIMAL_ID' } }
  if (!isValidPhotoKeyForAnimal(body.key, animalId)) {
    return { statusCode: 400, body: { error: 'INVALID_PHOTO_KEY' } }
  }
  const key = body.key

  const caller = await requireCaller(cookies)
  if (!caller) return { statusCode: 401, body: { error: 'NOT_AUTHENTICATED' } }

  try {
    const animal = await getOwnedAnimal(caller, animalId)
    if (!animal) return { statusCode: 404, body: { error: 'ANIMAL_NOT_FOUND' } }

    try {
      await getS3Client().send(new HeadObjectCommand({ Bucket: getBucketName(), Key: key }))
    } catch {
      // Sans `s3:ListBucket` (volontairement non accordé, `amplify/backend.ts`), S3 répond 403
      // et non 404 pour un objet absent -- les deux signifient ici "upload jamais arrivé".
      return { statusCode: 400, body: { error: 'PHOTO_NOT_UPLOADED' } }
    }

    // Écrit en direct (bypass AppSync) : `updatedAt` posé à la main (CLAUDE.md, "Lambda +
    // accès DynamoDB direct"). `attribute_exists(id)` : l'Animal a pu être supprimé entre la
    // lecture ci-dessus et cette écriture -- ne jamais recréer une ligne partielle.
    await documentClient.send(
      new UpdateCommand({
        TableName: getAnimalTableName(),
        Key: { id: animalId },
        UpdateExpression: 'SET photoKey = :key, updatedAt = :now',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeValues: { ':key': key, ':now': new Date().toISOString() },
      }),
    )

    if (animal.photoKey && animal.photoKey !== key && isValidPhotoKeyForAnimal(animal.photoKey, animalId)) {
      await deleteObjectBestEffort(animal.photoKey)
    }

    return { statusCode: 200, body: { photoKey: key, photoUrl: await signDisplayUrl(key) } }
  } catch (err) {
    console.error('confirmUpload error:', err)
    return { statusCode: 500, body: { error: 'PHOTO_CONFIRM_FAILED' } }
  }
}

/** `POST /api/animals/photo/remove` -- `{ animalId }` : efface `photoKey` puis l'objet S3. */
export async function removePhoto(
  body: Record<string, unknown>,
  cookies: string[] | undefined,
): Promise<RouteResult> {
  const animalId = readAnimalId(body)
  if (!animalId) return { statusCode: 400, body: { error: 'MISSING_ANIMAL_ID' } }

  const caller = await requireCaller(cookies)
  if (!caller) return { statusCode: 401, body: { error: 'NOT_AUTHENTICATED' } }

  try {
    const animal = await getOwnedAnimal(caller, animalId)
    if (!animal) return { statusCode: 404, body: { error: 'ANIMAL_NOT_FOUND' } }

    await documentClient.send(
      new UpdateCommand({
        TableName: getAnimalTableName(),
        Key: { id: animalId },
        UpdateExpression: 'REMOVE photoKey SET updatedAt = :now',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeValues: { ':now': new Date().toISOString() },
      }),
    )

    if (animal.photoKey && isValidPhotoKeyForAnimal(animal.photoKey, animalId)) {
      await deleteObjectBestEffort(animal.photoKey)
    }

    return { statusCode: 200, body: { status: 'REMOVED' } }
  } catch (err) {
    console.error('removePhoto error:', err)
    return { statusCode: 500, body: { error: 'PHOTO_REMOVE_FAILED' } }
  }
}

/**
 * `POST /api/animals/photo/urls` -- `{ animalIds: string[] }` -> `{ urls: { [animalId]: url } }`.
 * Un Animal absent, qui n'appartient pas à l'appelant ou sans photo est simplement omis de
 * `urls` (jamais une erreur de toute la requête) : le front retombe alors sur l'icône espèce.
 */
export async function getPhotoUrls(
  body: Record<string, unknown>,
  cookies: string[] | undefined,
): Promise<RouteResult> {
  const animalIds = Array.isArray(body.animalIds)
    ? [...new Set(body.animalIds.filter((id): id is string => typeof id === 'string' && id !== ''))]
    : null
  if (!animalIds) return { statusCode: 400, body: { error: 'MISSING_ANIMAL_IDS' } }
  if (animalIds.length > MAX_ANIMAL_IDS_PER_URL_REQUEST) {
    return { statusCode: 400, body: { error: 'TOO_MANY_ANIMAL_IDS' } }
  }

  const caller = await requireCaller(cookies)
  if (!caller) return { statusCode: 401, body: { error: 'NOT_AUTHENTICATED' } }

  try {
    const entries = await Promise.all(
      animalIds.map(async (animalId) => {
        const animal = await getOwnedAnimal(caller, animalId)
        if (!animal || !isValidPhotoKeyForAnimal(animal.photoKey, animalId)) return null
        return [animalId, await signDisplayUrl(animal.photoKey)] as const
      }),
    )
    const urls = Object.fromEntries(entries.filter((entry) => entry !== null))
    return { statusCode: 200, body: { urls } }
  } catch (err) {
    console.error('getPhotoUrls error:', err)
    return { statusCode: 500, body: { error: 'PHOTO_URLS_FAILED' } }
  }
}
