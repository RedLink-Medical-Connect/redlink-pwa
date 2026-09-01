// Fonction 10/10 (DERNIÈRE) du pipeline AppSync JS de la mutation custom
// `submitMissionValidation` (`amplify/data/resource.ts`) -- AJOUTÉE le 2026-09-01, voir
// docs/adr/0019-server-side-last-donation-date-on-completed.md §6 et l'en-tête de la fonction
// 9/10 (`submit-mission-validation-resolve-clinic-id-for-stats.js`) pour le trou fermé, son
// périmètre volontairement étroit (SEUL `transfusionsDone`, jamais `donorOwnersCount`) et
// pourquoi ce chemin ne s'exécute JAMAIS côté Clinic (déjà couvert côté client,
// `mission-completion-side-effects.js`).
//
// PLAFOND ATTEINT : ce pipeline consomme désormais 10 fonctions -- le maximum AppSync pour un
// resolver de pipeline. Toute future écriture secondaire de ce pipeline devra retirer une
// fonction existante ou changer de mécanisme (voir ADR-0019 §4/§6).
//
// `dataSource: a.ref('Clinic')` -- cible directement la table managée du modèle et bypasse donc
// entièrement le système `@auth` de `Clinic` (même mécanisme que la fonction 8/8 sur `Animal`,
// ADR-0011 §3.2). Aucun pouvoir nouveau accordé à l'Owner : la CLÉ vient de
// `ctx.stash.statsClinicID` (espace serveur, résolu en lecture seule par la fonction 9/10 à
// partir de `ctx.stash.missionRequestID` -- jamais un argument client), et l'écriture n'a lieu
// qu'après les 4 vérifications d'identité (ADR-0018) et seulement sur une transition réelle vers
// `COMPLETED` votée par l'Owner (double CONFIRMED requis).
//
// INCRÉMENT ATOMIQUE (`operations.increment`), PAS lire-puis-écrire
// Vérifié dans le paquet installé plutôt que supposé (`node_modules/@aws-appsync/utils/lib/
// dynamodb-helpers.d.ts`, `@aws-appsync/utils@1.12.0`) : `operations.increment(by?: number):
// DynamoDBOperationIncrement`, exemple d'usage donné par les types eux-mêmes ("import { update,
// operations } from '@aws-appsync/utils/dynamodb'"). Écart de MÉCANISME assumé avec
// `incrementClinicStats` (`mission-completion-side-effects.js`, lire-puis-écrire côté client, qui
// documente lui-même la course qui en découle) -- ici l'atomicité est disponible sans lecture
// préalable ni infrastructure supplémentaire, puisqu'on écrit déjà en direct dans la table (même
// écart de mécanisme, même raison, que celui déjà documenté entre la Lambda planifiée et ce même
// composable, ADR-0016 §4).
//
// GARDE ANTI-UPSERT `id: { attributeExists: true }` : identique à celle de la fonction 8/8 et à
// celle de la Lambda planifiée pour la même table (ADR-0016 §4). Sans elle, un `clinicID` résolu
// vers une Clinic supprimée entre-temps ferait CRÉER par `UpdateItem` une Clinic partielle
// (`{ id, transfusionsDone, updatedAt }`, sans nom/RPPS/coordonnées...) -- vraie corruption de
// données, pas théorique : aucune fonction de ce pipeline ne vérifie que la Clinic résolue par la
// fonction 9/10 existe encore.
//
// **CETTE FONCTION EST LA DERNIÈRE DU PIPELINE : `response()` DOIT renvoyer `ctx.prev.result`
// (la Mission), JAMAIS `ctx.result` (la Clinic écrite ici)** -- la mutation est typée
// `.returns(a.ref('Mission'))` et les deux composables appelants (`useOwnerMissions.js` via
// `submitDonationValidation`, `useMissionClosure.js` via `closeMission`) lisent `data.status`
// juste après l'appel. Même contrat, même risque documenté, que la fonction 8/8.
//
// BEST-EFFORT, PAS CRITIQUE (même doctrine que la fonction 8/8, ADR-0019 §3, et la fonction 9/10
// ci-avant) : `response()` avale TOUTE erreur (condition anti-upsert non satisfaite, throttle,
// incident) et renvoie la Mission telle quelle. Le vote de l'appelant est déjà écrit
// (write-once) et irréversible au moment où cette fonction s'exécute -- lui remonter une erreur
// non actionnable romprait aussi, côté client, l'exécution de l'upsert `ClinicOwnerRelation` qui
// suit (même risque que documenté en tête de la fonction 8/8). Résidu assumé : un échec DynamoDB
// dur ici est silencieux (le runtime `APPSYNC_JS` n'expose aucun `console`, et ce dépôt n'a de
// toute façon aucun outil de suivi d'erreurs -- trou d'observabilité connu, roadmap Phase 5).
import { update, operations } from '@aws-appsync/utils/dynamodb'
import { util, runtime } from '@aws-appsync/utils'

export function request(ctx) {
  if (ctx.stash.finalMissionStatus !== 'COMPLETED' || !ctx.stash.statsClinicID) {
    runtime.earlyReturn(ctx.prev.result)
  }

  return update({
    key: { id: ctx.stash.statsClinicID },
    condition: { id: { attributeExists: true } },
    update: {
      transfusionsDone: operations.increment(1),
      updatedAt: util.time.nowISO8601(),
    },
  })
}

export function response(ctx) {
  // TOUJOURS `ctx.prev.result` (la Mission), JAMAIS `ctx.result` (la Clinic) -- voir l'en-tête.
  // `ctx.error` volontairement ni relayé ni transformé : best-effort, voir l'en-tête.
  return ctx.prev.result
}
