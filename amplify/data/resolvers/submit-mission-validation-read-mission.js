// Fonction 2/3 du pipeline `submitMissionValidation` (voir l'en-tête de
// `submit-mission-validation-write-side.js` pour le raisonnement complet du pipeline -- bypass
// `@auth`, choix d'un pipeline à 3 fonctions plutôt qu'un unit resolver, pourquoi une lecture
// EXPLICITE plutôt que de faire confiance à la valeur de retour de l'update de la fonction 1).
//
// Lecture FRAÎCHE de la Mission (après l'écriture conditionnelle du côté appelant par la
// fonction 1) via `ddb.get()` -- GetItem renvoie l'item COMPLET sans ambiguïté, contrairement au
// comportement non confirmable localement de la valeur de retour de `ddb.update()`. Sert
// uniquement à donner à la fonction 3 (calcul + écriture du statut agrégé) une vue certainement
// à jour des DEUX côtés (`clinicValidationOutcome`/`ownerValidationOutcome`), quel que soit
// celui qui vient d'écrire.
import * as ddb from '@aws-appsync/utils/dynamodb'
import { util } from '@aws-appsync/utils'

export function request(ctx) {
  return ddb.get({ key: { id: ctx.args.missionId } })
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type, ctx.result)
  }
  return ctx.result
}
