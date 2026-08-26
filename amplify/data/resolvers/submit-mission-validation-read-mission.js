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
//
// `consistentRead: true` (correctif graphql-schema-reviewer, ÉLEVÉ, 2026-08-26) -- OBLIGATOIRE
// ici, pas une option de confort : `GetItem` DynamoDB est éventuellement cohérent par défaut
// (`consistentRead` existe sur `GetInput`, `@aws-appsync/utils/lib/dynamodb-helpers.d.ts`, mais
// n'est PAS activé par défaut). Sans lui, cette lecture "fraîche" pourrait en réalité renvoyer
// une réplique périmée, juste après l'écriture de la fonction 1 (ou de l'autre pipeline côté
// adverse si les deux valident quasi simultanément) -- la fonction 3 calculerait alors un
// statut incorrect (ex. `PENDING_VALIDATION` alors que les deux outcomes sont déjà écrits en
// base). Gravité particulière : la fonction 1 est write-once PAR CÔTÉ (condition
// `attributeExists: false`) -- rien ne peut jamais redéclencher un second appel du même côté
// pour corriger un calcul erroné, donc une lecture périmée ici laisserait la Mission bloquée
// dans un état incohérent de façon PERMANENTE, pas seulement transitoire.
import * as ddb from '@aws-appsync/utils/dynamodb'
import { util } from '@aws-appsync/utils'

export function request(ctx) {
  return ddb.get({ key: { id: ctx.args.missionId }, consistentRead: true })
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type, ctx.result)
  }
  return ctx.result
}
