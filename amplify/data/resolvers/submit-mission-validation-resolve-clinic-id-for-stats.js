// Fonction 9/10 du pipeline AppSync JS de la mutation custom `submitMissionValidation`
// (`amplify/data/resource.ts`) -- AJOUTÉE le 2026-09-01, voir
// docs/adr/0019-server-side-last-donation-date-on-completed.md §6.
//
// LE TROU QU'ELLE FERME (partiellement -- voir "CE QUE CETTE FONCTION NE FERME PAS" plus bas)
// `Clinic.transfusionsDone`/`donorOwnersCount` portent une `.authorization()` de champ réservée
// en écriture aux `Veterinarians` (voir `amplify/data/resource.ts`, section `Clinic`). Quand
// c'est l'OWNER qui soumet le vote décisif faisant passer une Mission en `COMPLETED` (le cas
// nominal du produit : le vétérinaire clôture d'abord depuis `RequestsView.vue`, donc l'appel de
// l'Owner finalise), AUCUN code client côté Owner ne peut porter cet incrément --
// `applyOwnerCompletionSideEffects` (`src/composables/mission-completion-side-effects.js`) ne
// tente d'ailleurs même pas l'écriture (voir son en-tête, "ce que ce module ne fait PAS").
// `transfusionsDone` restait donc sous-compté sur ce chemin -- même famille de trou que celui
// fermé pour `Animal.lastDonationDate` par la 8e fonction de ce même pipeline (ADR-0019),
// jamais fermé pour les compteurs `Clinic` faute de budget de pipeline (ADR-0019 §4, "il
// faudrait DEUX fonctions de pipeline supplémentaires -- coût jugé disproportionné à l'époque").
//
// PÉRIMÈTRE VOLONTAIREMENT ÉTROIT : SEUL `transfusionsDone`, PAS `donorOwnersCount`
// `donorOwnersCount` ne compte QUE les propriétaires réellement NOUVEAUX pour cette clinique --
// une valeur qui dépend de la création ou non d'une `ClinicOwnerRelation`, décision prise côté
// CLIENT (`resolveClinicOwnerRelationUpsert`, `src/services/clinic-owner-relation-service.js`,
// appelée par `upsertClinicOwnerRelation` dans `mission-completion-side-effects.js`). La
// reproduire fidèlement ici demanderait de dupliquer cette règle de décision dans un resolver
// `APPSYNC_JS` (qui ne peut PAS importer un service front, runtime restreint) -- un coût
// disproportionné pour un second compteur de tableau de bord une fois `transfusionsDone` (le
// compteur médicalement significatif : "combien de transfusions ont réellement eu lieu") fermé.
// `donorOwnersCount` reste donc un résidu ASSUMÉ sur ce chemin, documenté dans
// `mission-completion-side-effects.js` et dans l'amendement d'ADR-0019 §6 -- pas oublié.
//
// CETTE FONCTION (lecture seule) : résout le `clinicID` à incrémenter et le range dans
// `ctx.stash.statsClinicID`, seule source de vérité consommée par la 10e et dernière fonction
// (`submit-mission-validation-increment-transfusions-done.js`).
//
// DEUX CHEMINS, UN SEUL RÉSULTAT DANS LE STASH (pas deux clés à réconcilier en aval)
// - Chemin OWNER (`ctx.stash.callerRole === 'OWNER'`) : le `clinicID` n'est PAS encore connu à ce
//   stade du pipeline (la fonction 4/8, `verify-clinic-party`, qui lit `Request.clinicID`, est un
//   no-op côté Owner) -- il faut le lire. `ctx.stash.missionRequestID` (posé par la fonction
//   1/8, `resolve-parties.js`) sert de clé pour un `ddb.get` sur `Request`.
// - Chemin CLINIC : le `clinicID` est DÉJÀ connu (`ctx.stash.callerClinicID`, posé par la
//   fonction 3/8, `load-vet-clinic.js`) -- ce chemin n'a de toute façon pas besoin de cette
//   fermeture (voir plus bas), donc aucune lecture réseau n'est faite ; `ctx.stash.statsClinicID`
//   est simplement recopié depuis `callerClinicID` pour qu'un futur lecteur de ce stash n'ait
//   jamais à choisir entre deux clés selon le chemin -- une seule source de vérité, décision
//   documentée ici plutôt que laissée à deviner.
//
// POURQUOI PAS SUR LE CHEMIN CLINIC : sur ce chemin, `useMissionClosure.closeMission()` a déjà
// incrémenté `transfusionsDone` CÔTÉ CLIENT (`applyVeterinarianCompletionSideEffects` ->
// `incrementClinicStats`, `mission-completion-side-effects.js`) -- la clinique EST `Veterinarians`
// et a le droit d'écrire ce champ. Incrémenter une SECONDE fois ici, côté serveur, doublerait le
// compteur. D'où `runtime.earlyReturn()` inconditionnel dès que `callerRole !== 'OWNER'`, AVANT
// même de vérifier `finalMissionStatus` -- écrit en premier dans la condition ci-dessous pour que
// ce soit la première chose qu'un futur lecteur voie.
//
// DÉCLENCHEMENT (même garde que la 8e fonction, ADR-0019) : seulement sur une transition RÉELLE
// vers `COMPLETED` (`ctx.stash.finalMissionStatus`, posé par la fonction 7/8) -- `NO_SHOW`/
// `DISPUTED`/`PENDING_VALIDATION` ne sont jamais un don réellement effectué. `earlyReturn()` :
// la source de données ET le `response()` de CETTE fonction sont sautés (contrat documenté de
// `Runtime.earlyReturn`, déjà utilisé par les fonctions 2/8 à 4/8 et 8/8) -- aucune lecture n'est
// payée en dehors du chemin OWNER+COMPLETED.
//
// BEST-EFFORT, JAMAIS D'ERREUR REMONTÉE : même raisonnement que la 8e fonction (ADR-0019 §3) --
// le vote de l'appelant est déjà écrit (write-once, fonction 5/8) au moment où cette fonction
// s'exécute, une erreur ici n'est pas actionnable pour lui. Un échec de lecture de `Request`
// stashe `null` (jamais laissé `undefined`, pour que la 10e fonction distingue explicitement
// "pas de clinicID résolu" de "jamais évalué") ; la 10e fonction, qui exige un `clinicID` non nul,
// fait alors elle-même un no-op.
import * as ddb from '@aws-appsync/utils/dynamodb'
import { runtime } from '@aws-appsync/utils'

export function request(ctx) {
  if (ctx.stash.callerRole !== 'OWNER' || ctx.stash.finalMissionStatus !== 'COMPLETED') {
    runtime.earlyReturn(ctx.prev.result)
  }

  if (!ctx.stash.missionRequestID) {
    // Défense en profondeur (inatteignable aujourd'hui, comme documenté en tête de la fonction
    // 8/8 pour son propre cas analogue) : la fonction 1/8 rejette déjà toute Mission sans
    // `requestID`.
    ctx.stash.statsClinicID = null
    runtime.earlyReturn(ctx.prev.result)
  }

  return ddb.get({ key: { id: ctx.stash.missionRequestID } })
}

export function response(ctx) {
  if (ctx.error) {
    // Best-effort : voir l'en-tête. Jamais `util.error()` -- une erreur de lecture ici ne doit
    // ni faire échouer la mutation ni empêcher la 10e fonction de simplement ne rien incrémenter.
    ctx.stash.statsClinicID = null
    return ctx.prev.result
  }

  ctx.stash.statsClinicID = ctx.result?.clinicID ?? null
  return ctx.prev.result
}
