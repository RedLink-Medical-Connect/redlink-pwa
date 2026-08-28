// Fonction 5/7 du pipeline AppSync JS de la mutation custom `submitMissionValidation`
// (`amplify/data/resource.ts`, double validation de Mission -- 2026-08-26). PREMIÈRE fonction
// qui ÉCRIT : les 4 qui la précèdent (ajoutées le 2026-08-27, docs/adr/0018) ne font que
// vérifier que l'appelant est réellement PARTIE à cette Mission, sans jamais écrire -- voir
// l'en-tête de `submit-mission-validation-resolve-parties.js`. Les renvois « fonction 1 / 2 /
// 3 » ci-dessous désignent les TROIS fonctions d'écriture historiques de ce pipeline
// (aujourd'hui 5/7, 6/7 et 7/7) : leur raisonnement est inchangé, seule leur position l'est.
//
// Même bypass `@auth` que `linkRequestToMission` (`dataSource: a.ref('Mission')` cible
// directement la table managée du modèle -- voir docs/adr/0011, section 3.2, pour la preuve
// que ça contourne ENTIÈREMENT les règles `@auth` de type ET de champ de `Mission`). La seule
// garde d'autorisation active pour cette mutation est celle posée directement dessus
// (`allow.authenticated()`, amplify/data/resource.ts) -- le ROLE réel de l'appelant
// (Veterinarian vs Owner) est déterminé ICI, dans le resolver, via `ctx.identity.groups`
// (`AppSyncIdentityCognito.groups: string[] | null`, vérifié dans
// `node_modules/@aws-appsync/utils/lib/index.d.ts`) -- JAMAIS via un argument fourni par le
// client, qui serait trivialement falsifiable (un Owner pourrait prétendre être Veterinarian
// pour écrire `clinicValidationOutcome`).
//
// ÉCART PAR RAPPORT AU PLAN INITIAL de cette sous-tâche, à signaler explicitement en revue Lead
// Dev : le plan nommait un seul fichier (`submit-mission-validation.js`), sur le modèle d'un
// unit resolver (request/response, UN SEUL appel à la source de données par invocation) comme
// `linkRequestToMission`. Impossible ici : le besoin métier est (1) écrire la validation du
// CÔTÉ appelant (write-once, conditionnel), (2) lire l'état FRAIS de L'AUTRE côté pour calculer
// le statut agrégé, (3) écrire ce statut -- trois opérations DynamoDB dont la 2e et la 3e
// dépendent du résultat de la 1re. Le plan envisageait de récupérer l'état de l'autre côté "via
// ddb.get/le résultat de l'update" -- la seconde option (faire confiance à la valeur de retour
// de CET update, en espérant qu'elle contienne l'item COMPLET, y compris les champs non
// touchés par cette écriture précise) supposerait que `ddb.update()` renvoie l'item entier
// (comportement DynamoDB `ReturnValues: ALL_NEW`) PAR DÉFAUT -- `DynamoDBUpdateInput`
// (`node_modules/@aws-appsync/utils/lib/dynamodb-helpers.d.ts`) n'expose AUCUNE option
// `returnValues` permettant de le confirmer ou de le forcer, et ce comportement est fixé par
// l'implémentation du helper (résolu côté service AppSync), non vérifiable localement sans un
// vrai déploiement (`ampx sandbox`, interdit dans le périmètre de cette sous-tâche). Plutôt que
// de coder sur une hypothèse non vérifiable, ce pipeline utilise la PREMIÈRE option du plan :
// une lecture EXPLICITE (fonction 2, `submit-mission-validation-read-mission.js`, `ddb.get()`),
// dont le comportement (GetItem renvoie l'item entier, sans ambiguïté) ne dépend d'aucune
// supposition.
//
// Vérifié pour cette sous-tâche (pas deviné) : `.handler([...])` accepte un TABLEAU de
// `a.handler.custom({...})` et compile bien en un VRAI resolver AppSync `kind: PIPELINE`
// (`node_modules/@aws-amplify/backend-data/lib/convert_js_resolvers.js`,
// `pipelineConfig.functions` -- chaque entrée du tableau devient une `CfnFunctionConfiguration`
// distincte, toutes trois sur le même `dataSource: a.ref('Mission')`). `ctx.prev.result`
// propage la valeur retournée par `response()` d'une fonction vers `request()`/`response()` de
// la suivante -- comportement standard du runtime `APPSYNC_JS` pour un pipeline resolver,
// confirmé en lisant le gabarit `js_resolver_handler.js` que le framework génère pour le
// resolver de tête (`response = (ctx) => ctx.prev.result`, exactement le mécanisme documenté
// par AWS pour un pipeline resolver JS).
//
// Rôle déterminé via `ctx.identity.groups` : `Veterinarians` -> écrit
// `clinicValidationOutcome`/`clinicValidatedAt` ; `Owners` -> écrit
// `ownerValidationOutcome`/`ownerValidatedAt`/`ownerDisputeReason` (uniquement si fourni).
// Aucun des deux groupes -> erreur explicite (`Unauthorized`), pas de comportement silencieux.
// `outcome` doit être `CONFIRMED` ou `DENIED` -- `PENDING` est l'état INITIAL (jamais écrit
// explicitement, un champ absent/`null` EST `PENDING` côté logique, voir plus bas), pas une
// soumission valide : rejeté explicitement (`InvalidOutcome`) plutôt que silencieusement accepté
// (le schéma Gen2 ne sait pas restreindre les valeurs valides d'un enum au niveau d'un argument
// de mutation à un sous-ensemble, même limite que partout ailleurs dans ce fichier -- ADR-0004).
//
// Write-once PAR CÔTÉ : condition DynamoDB `attributeExists: false` sur le champ outcome de CE
// côté -- un champ jamais écrit (donc absent de l'item DynamoDB) EST l'équivalent de `PENDING`
// (pas de `.default('PENDING')` posé au niveau schéma : vérifié que `a.enum(...).authorization`
// existe mais que `default()` sur un `a.ref()` d'enum n'apporterait rien ici, la condition
// d'écriture porte sur l'ABSENCE de l'attribut, pas sur sa valeur littérale -- un champ mis à
// `null` explicitement se comporterait différemment selon la représentation DynamoDB choisie
// par AppSync, alors qu'un champ jamais touché est SANS AMBIGUÏTÉ absent). Un second appel du
// MÊME côté (flip-flop après une première soumission) échoue avec
// `ConditionalCheckFailedException`, remonté au client comme `ALREADY_VALIDATED` (voir
// `response()` plus bas) -- pas de correction possible après coup, cohérent avec la demande
// produit (double validation, chaque côté ne vote qu'une fois).
//
// `id: { attributeExists: true }` ajouté à la MÊME condition (un objet de condition
// multi-champs est ANDé implicitement -- sémantique standard des `DynamoDBFilterObject`
// AppSync JS, cohérente avec tous les exemples de `dynamodb-helpers.d.ts`) : sans lui, un
// `missionId` invalide/inexistant satisferait quand même `attributeExists: false` (un item qui
// n'existe pas n'a par définition aucun attribut) et `ddb.update()` CRÉERAIT un item DynamoDB
// PARTIEL (upsert implicite de `UpdateItem`, comportement par défaut de DynamoDB en l'absence
// d'une condition forçant l'existence de la clé) -- un vrai bug de corruption de données, pas
// seulement un message d'erreur imprécis. Résidu mineur assumé : DynamoDB ne distingue pas,
// dans une `ConditionExpression` ANDée, laquelle des deux sous-conditions a échoué -- un
// `missionId` invalide renvoie donc le même code `ALREADY_VALIDATED` qu'une double soumission
// légitime, plutôt qu'un message "Mission introuvable" dédié. Impact limité : un `missionId`
// invalide ne peut venir que d'un appel API direct hors UI (l'UI ne propose jamais un id
// arbitraire) -- signalé ici plutôt que masqué.
//
// Hors périmètre de cette sous-tâche (mentionné pour que la suivante comprenne le contrat) :
// `MissionStatus.COMPLETED_AUTO` n'est JAMAIS écrit par ce pipeline -- seuls
// `COMPLETED`/`NO_SHOW`/`DISPUTED` (calculés "en direct" par la fonction 3,
// `submit-mission-validation-finalize-status.js`) et `PENDING_VALIDATION` (un seul côté a
// validé) le sont. `COMPLETED_AUTO` est réservé à une future Lambda planifiée (délai de 7 jours
// sans réponse d'un des deux côtés) qui n'est PAS implémentée dans cette sous-tâche.
//
// RÉSIDU DE ROBUSTESSE ASSUMÉ, signalé par le reviewer graphql-schema (MOYEN, 2026-08-26) :
// aucun chemin de récupération n'existe si la fonction 2 (`submit-mission-validation-
// read-mission.js`) ou la fonction 3 (`submit-mission-validation-finalize-status.js`) échoue
// pour une raison AUTRE que la course anticipée entre les deux côtés (ex. throttle DynamoDB
// transitoire, bug de déploiement, incident AppSync). CETTE fonction (1/3) étant write-once
// PAR CÔTÉ, un échec dur en fonction 2/3 laisse l'appelant avec sa validation DURABLEMENT
// écrite (la condition `attributeExists: false` empêche tout second appel) mais
// `Mission.status` jamais recalculé -- la Mission reste bloquée sur son statut d'avant
// l'appel (probablement `ARRIVED`/`PENDING_VALIDATION`) SANS AUCUN MOYEN de retenter côté
// client : un second `submitMissionValidation` du même côté échoue immédiatement avec
// `ALREADY_VALIDATED` (voir `response()` plus bas), avant même d'atteindre les fonctions 2/3.
// Pas de mécanisme de récupération inventé ici (ex. rendre la fonction 1 idempotente sur un
// second appel identique, ou une mutation admin de "recalcul forcé") -- disproportionné pour
// ce pilote, même logique d'acceptation que les résidus déjà actés (ADR-0004/0005/0015 : un
// compromis documenté plutôt qu'une infrastructure de résilience non demandée). Si ce résidu
// devient un vrai risque opérationnel (volume réel, incidents constatés), la fermeture la
// plus simple serait une mutation admin dédiée (groupe `Admins`, désormais provisionné) qui
// relit la Mission et réexécute UNIQUEMENT la logique des fonctions 2/3 (recalcul du statut
// à partir de l'état actuel des deux outcomes, sans toucher à `clinicValidationOutcome`/
// `ownerValidationOutcome`, déjà écrits et corrects) -- hors périmètre de cette sous-tâche.
import * as ddb from '@aws-appsync/utils/dynamodb'
import { util } from '@aws-appsync/utils'

export function request(ctx) {
  const { missionId, outcome, disputeReason } = ctx.args
  const groups = (ctx.identity && ctx.identity.groups) || []

  if (outcome !== 'CONFIRMED' && outcome !== 'DENIED') {
    util.error(
      `outcome invalide pour submitMissionValidation: ${outcome} (attendu CONFIRMED ou DENIED -- PENDING est un état initial, pas une soumission valide)`,
      'InvalidOutcome',
    )
  }

  const now = util.time.nowISO8601()

  if (groups.includes('Veterinarians')) {
    return ddb.update({
      key: { id: missionId },
      condition: {
        id: { attributeExists: true },
        clinicValidationOutcome: { attributeExists: false },
      },
      update: {
        clinicValidationOutcome: outcome,
        clinicValidatedAt: now,
      },
    })
  }

  if (groups.includes('Owners')) {
    const update = {
      ownerValidationOutcome: outcome,
      ownerValidatedAt: now,
    }
    // Uniquement si fourni (brief) -- un Owner qui CONFIRME n'a pas de raison de litige, seul
    // un DENIED s'accompagne typiquement d'un `disputeReason`, mais rien ne l'impose côté
    // schéma (même limite que partout ailleurs : pas de contrainte conditionnelle sur la
    // valeur d'un autre champ).
    if (disputeReason) {
      update.ownerDisputeReason = disputeReason
    }
    return ddb.update({
      key: { id: missionId },
      condition: {
        id: { attributeExists: true },
        ownerValidationOutcome: { attributeExists: false },
      },
      update,
    })
  }

  util.error(
    "Appelant non reconnu comme membre du groupe Veterinarians ni Owners -- soumission de validation refusée",
    'Unauthorized',
  )
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error(
        'Ce côté a déjà soumis sa validation pour cette Mission (ou Mission introuvable).',
        'ALREADY_VALIDATED',
        ctx.result,
      )
    }
    util.error(ctx.error.message, ctx.error.type, ctx.result)
  }
  return ctx.result
}
