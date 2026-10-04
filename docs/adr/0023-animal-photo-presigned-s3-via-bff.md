---
status: accepted
supersedes: none
---

# Photo personnalisée d'Animal : S3 pré-signé délivré par le BFF

Un Owner peut associer une photo à chacun de ses Animals (`AnimalsView.vue`). S'il n'y en a pas,
l'icône d'espèce reste affichée. Une première version, commencée le 2026-09-04 et jamais
committée, reposait sur `defineStorage` et `aws-amplify/storage` (`uploadData`/`getUrl`/`remove`)
côté navigateur. Le BFF (ADR-0021) l'a rendue caduque avant qu'elle soit branchée : le
navigateur ne détient plus aucune session Cognito, donc plus aucun identifiant de l'identity
pool pour signer une requête S3.

## 1. Décision

Le BFF délivre des **autorisations S3 pré-signées à courte durée de vie**, après avoir vérifié
que l'appelant est propriétaire de l'Animal. Le fichier lui-même va directement du navigateur à
S3 : il ne transite jamais par le Lambda, dont les requêtes Function URL sont limitées à 6 Mo.

| Route (`amplify/functions/bff/animal-photo-routes.ts`) | Rôle |
|---|---|
| `POST /api/animals/photo/upload-url` | POST pré-signé (5 min) sur une clé `animal-photos/<animalId>/<uuid>.<ext>` |
| `POST /api/animals/photo/confirm` | `HeadObject` (l'objet existe bien), écriture de `Animal.photoKey`, suppression best-effort de l'ancienne photo |
| `POST /api/animals/photo/remove` | efface `photoKey`, puis supprime l'objet S3 en best-effort |
| `POST /api/animals/photo/urls` | GET pré-signés (15 min) pour une liste d'Animals (50 max), un seul appel par chargement de vue |

Côté front : `src/composables/useAnimalPhoto.js` (via `bffFetch`).

## 2. POST pré-signé plutôt que PUT

La politique signée d'un POST (`createPresignedPost`) fait appliquer **par S3 lui-même**
`content-length-range` (5 Mo maximum) et `Content-Type` (JPEG/PNG/WebP). Un PUT pré-signé
laisserait le client envoyer une taille arbitraire : la validation du composable ne serait
alors qu'un confort d'interface, pas une garde.

## 3. Bucket en CDK dans la stack de `bff`, pas `defineStorage`

- `defineStorage` accorde l'accès à des rôles de l'identity pool, que plus personne n'utilise,
  ou à des fonctions (`allow.resource()`). Seul `bff` touche au bucket.
- `allow.resource(bff)` ferait référencer le rôle de `bff` (stack `data`) par la stack
  `storage`. En parallèle, `addEnvironment('ANIMAL_PHOTOS_BUCKET_NAME')` ferait référencer
  `storage` par `data`. C'est un cycle, de la même famille que les deux déjà rencontrés en
  déploiement réel (voir `bff/resource.ts` et CLAUDE.md, critère `resourceGroupName`).
- `new Bucket(backend.bff.stack, ...)` : toutes les références sont internes à la stack.
  Configuration : `BLOCK_ALL`, SSE-S3, TLS obligatoire, rétention `RETAIN` (des photos
  d'utilisateurs ne doivent pas disparaître lors d'une suppression de stack).
- CORS `*` limité à `POST` : c'est la politique signée qui autorise l'écriture, pas l'origine.
  L'origine réelle (domaine CloudFront) n'est de toute façon connue qu'au déploiement.
- IAM de `bff` : `s3:PutObject`/`GetObject`/`DeleteObject` sur `animal-photos/*` uniquement,
  sans `ListBucket`, plus `dynamodb:GetItem`/`UpdateItem` sur la table `Animal`.

## 4. `Animal.photoKey` : écrit seulement par le BFF

Le champ est en lecture seule pour l'Owner et pour les Veterinarians (`animalPhotoKeyFieldAuth`,
même forme que le 4e idiome `@auth` de CLAUDE.md). Il est écrit uniquement en DynamoDB direct par
le BFF (`updatedAt` posé à la main, `ConditionExpression: attribute_exists(id)`). Si l'Owner
pouvait l'écrire via `updateAnimal`, il pourrait faire pointer son Animal vers la photo d'un
autre. En défense en profondeur, toute clé signée, écrite ou supprimée doit correspondre
exactement à `animal-photos/<animalId>/<uuid>.(jpg|png|webp)` (`isValidPhotoKeyForAnimal`).

Un Animal inexistant et un Animal appartenant à quelqu'un d'autre renvoient la même réponse
`404 ANIMAL_NOT_FOUND`.

## 5. Résidus assumés

- **Objets S3 orphelins** dans trois cas : suppression d'un Animal ou d'un compte (la cascade
  `useOwnerProfile.deleteAccount` ne connaît pas S3), upload jamais confirmé (onglet fermé entre
  le POST S3 et `/confirm`), et échec de la suppression best-effort d'une ancienne photo. Pas de
  fuite possible : sans `photoKey` qui y pointe, aucune URL n'est jamais signée pour ces objets.
  Un nettoyage (règle de cycle de vie S3 ou Lambda sur le flux `Animal` `REMOVE`) reste à faire
  si le volume le justifie.
- **Photos visibles par l'Owner seulement** : `/urls` ne signe que pour le propriétaire, alors
  que le schéma accorde `read` sur `photoKey` aux Veterinarians. Pour afficher les photos côté
  clinique (`ValidationsView.vue`/`DonorsView.vue`), il faudra vérifier l'appartenance au groupe
  `Veterinarians` côté BFF. `GetUserCommand` ne renvoie pas les groupes : ce sera une décision à
  part entière.
- **Non vérifié en déploiement réel** (aucun agent ne déploie) : CORS du bucket, POST pré-signé
  signé avec les identifiants temporaires du Lambda, et identifiants locaux du développeur en
  `npm run dev` (`vite-plugins/bff-dev-middleware.js`, variables `outputs.custom.*`).
