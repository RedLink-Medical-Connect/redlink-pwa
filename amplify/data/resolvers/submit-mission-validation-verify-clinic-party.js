// Fonction 4/7 du pipeline `submitMissionValidation` -- SECONDE moitié du côté CLINIC de la
// vérification d'identité, la seule qui rejette (voir l'en-tête de
// `submit-mission-validation-resolve-parties.js`, fonction 1/7, et docs/adr/0018).
//
// `dataSource: a.ref('Request')`. VÉRIFICATION : `Request.clinicID === ctx.stash.callerClinicID`
// (le `clinicID` du `Veterinarian` appelant, lu en fonction 3/7).
//
// PÉRIMÈTRE DE LA GARANTIE, à lire avant de conclure qu'elle est trop large : la partie
// vérifiée est la CLINIQUE, pas le vétérinaire individuel -- n'importe quel vétérinaire de la
// clinique émettrice de la `Request` peut soumettre la validation côté clinique. C'est le
// modèle métier, pas une approximation : `CONTEXT.md` définit une Request comme "un besoin de
// sang exprimé par une Clinic", et rien dans le schéma ne rattache une Mission à un
// vétérinaire nommément avant sa clôture. Le confinement obtenu est celui qui manquait :
// un vétérinaire de la clinique B ne peut plus voter sur les Missions de la clinique A.
//
// La `Request` est lue par son `id` primaire (`ctx.stash.missionRequestID`, posé par la
// fonction 1/7 depuis `Mission.requestID`) -- jamais par un argument client, qui permettrait de
// faire pointer la vérification vers une Request quelconque de sa propre clinique tout en
// écrivant sur la Mission d'une autre.
import * as ddb from '@aws-appsync/utils/dynamodb'
import { util, runtime } from '@aws-appsync/utils'

const FORBIDDEN_MESSAGE =
  "Vous n'êtes pas partie à cette Mission -- soumission de validation refusée."

export function request(ctx) {
  if (ctx.stash.callerRole !== 'CLINIC') {
    runtime.earlyReturn(ctx.prev.result)
  }

  return ddb.get({ key: { id: ctx.stash.missionRequestID }, consistentRead: true })
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type, ctx.result)
  }

  const request = ctx.result
  const callerClinicID = ctx.stash.callerClinicID

  // `!callerClinicID` ne devrait jamais être vrai ici (la fonction 3/7 a déjà rejeté ce cas),
  // mais le tester coûte une ligne et évite qu'une comparaison `undefined === undefined`
  // devienne un jour un laissez-passer si l'ordre du pipeline changeait.
  if (!request || !request.clinicID || !callerClinicID || request.clinicID !== callerClinicID) {
    util.error(FORBIDDEN_MESSAGE, 'Forbidden')
  }

  return ctx.prev.result
}
