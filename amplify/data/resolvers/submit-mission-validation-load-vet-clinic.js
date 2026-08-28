// Fonction 3/7 du pipeline `submitMissionValidation` -- PREMIÈRE moitié du côté CLINIC de la
// vérification d'identité (voir l'en-tête de `submit-mission-validation-resolve-parties.js`,
// fonction 1/7, et docs/adr/0018).
//
// `dataSource: a.ref('Veterinarian')`. Cette branche demande DEUX lectures dans deux tables
// différentes (le `clinicID` du vétérinaire appelant ICI, celui de la `Request` de la Mission
// en fonction 4/7), donc deux fonctions de pipeline : une fonction AppSync ne cible qu'une
// seule source de données. Aucune des deux ne peut être évitée -- rien dans la table `Mission`
// ne relie une Mission à un vétérinaire AVANT sa validation (`validatedByVeterinarianID` n'est
// écrit qu'après, et pas par ce pipeline).
//
// `ctx.identity.sub` sert de clé primaire de `Veterinarian` : convention applicative établie de
// ce dépôt, déjà documentée sur le modèle lui-même (`amplify/data/resource.ts`, "id = Cognito
// sub") et appliquée par `completeVetRegistration` (`useRegistrationCompletion.js`,
// `client.models.Veterinarian.create({ id: cognitoUserId, ... })`).
//
// Un membre du groupe `Veterinarians` SANS ligne `Veterinarian` (inscription interrompue au
// milieu de ses écritures -- cas réel, R-25 de `docs/audit/BACKLOG.md`) est rejeté :
// fail-closed. Il ne peut de toute façon être partie à aucune Mission tant que son profil
// n'existe pas.
import * as ddb from '@aws-appsync/utils/dynamodb'
import { util, runtime } from '@aws-appsync/utils'

const FORBIDDEN_MESSAGE =
  "Vous n'êtes pas partie à cette Mission -- soumission de validation refusée."

export function request(ctx) {
  if (ctx.stash.callerRole !== 'CLINIC') {
    runtime.earlyReturn(ctx.prev.result)
  }

  return ddb.get({ key: { id: ctx.identity.sub }, consistentRead: true })
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type, ctx.result)
  }

  const veterinarian = ctx.result

  if (!veterinarian || !veterinarian.clinicID) {
    util.error(FORBIDDEN_MESSAGE, 'Forbidden')
  }

  // Rangé dans le stash (espace serveur, inaccessible au client) pour la comparaison faite en
  // fonction 4/7 contre le `clinicID` de la `Request` de cette Mission.
  ctx.stash.callerClinicID = veterinarian.clinicID

  return ctx.prev.result
}
