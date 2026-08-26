// Fonction 3/3 (dernière) du pipeline `submitMissionValidation` (voir l'en-tête de
// `submit-mission-validation-write-side.js` pour le raisonnement complet du pipeline).
//
// Calcule le statut agrégé de la Mission à partir des DEUX champs de validation (lus fraîchement
// par la fonction 2, exposés ici via `ctx.prev.result`) et l'écrit. Matrice PURE, écrite en JS
// inline -- runtime `APPSYNC_JS` restreint, pas d'import externe hors `@aws-appsync/utils`, donc
// pas de réutilisation possible d'un éventuel futur module `mission-status-service.js` côté
// front même si un tel besoin de logique partagée apparaissait :
//   - CONFIRMED + CONFIRMED               -> COMPLETED
//   - DENIED + DENIED                     -> NO_SHOW
//   - CONFIRMED + DENIED (ou l'inverse)   -> DISPUTED
//   - au moins un des deux encore PENDING (champ absent/`null`) -> PENDING_VALIDATION
// `MissionStatus.COMPLETED_AUTO` n'est JAMAIS écrit ici -- réservé à une future Lambda planifiée
// (délai de 7 jours), hors périmètre de cette sous-tâche (voir aussi l'en-tête de la fonction 1).
//
// Écriture protégée par une condition optimiste (`status: { eq: <valeur lue par la fonction 2> }`)
// -- résidu de concurrence identifié et mitigé pendant cette sous-tâche (pas dans le plan
// initial, ajouté en le concevant) : si les deux côtés valident quasi simultanément, les deux
// pipelines (déclenchés indépendamment par chaque appel `submitMissionValidation`) s'exécutent
// en parallèle et peuvent chacun lire l'état de l'AUTRE côté à un instant légèrement différent.
// Sans cette garde, le pipeline le plus LENT pourrait écraser un statut déjà à jour (ex.
// `COMPLETED` déjà écrit par l'autre pipeline, qui avait une vue plus fraîche) avec son propre
// calcul obsolète (`PENDING_VALIDATION`) -- une régression PERMANENTE (rien ne la corrige
// ensuite, contrairement à une simple incohérence transitoire), donc jugée impossible à laisser
// non fermée même si sa fenêtre de course réelle est étroite en usage normal (les deux côtés
// valident généralement à des heures différentes). Avec la garde : si `status` a changé depuis
// la lecture de la fonction 2, cet update échoue (`ConditionalCheckFailedException`) -- traité
// en `response()` comme un cas NON bloquant pour l'appelant (voir plus bas), pas une erreur
// remontée au client : la validation du CÔTÉ appelant (fonction 1) a de toute façon déjà été
// durablement enregistrée avant que cette fonction 3 s'exécute ; seul le calcul DÉRIVÉ du statut
// agrégé a été doublé par l'autre pipeline, qui a nécessairement écrit un état au moins aussi
// frais que celui que CE pipeline vient de calculer.
import * as ddb from '@aws-appsync/utils/dynamodb'
import { util } from '@aws-appsync/utils'

function computeAggregateStatus(clinicOutcome, ownerOutcome) {
  const clinicDecided = clinicOutcome === 'CONFIRMED' || clinicOutcome === 'DENIED'
  const ownerDecided = ownerOutcome === 'CONFIRMED' || ownerOutcome === 'DENIED'

  if (!clinicDecided || !ownerDecided) {
    return 'PENDING_VALIDATION'
  }
  if (clinicOutcome === 'CONFIRMED' && ownerOutcome === 'CONFIRMED') {
    return 'COMPLETED'
  }
  if (clinicOutcome === 'DENIED' && ownerOutcome === 'DENIED') {
    return 'NO_SHOW'
  }
  return 'DISPUTED'
}

export function request(ctx) {
  const mission = ctx.prev.result
  const finalStatus = computeAggregateStatus(mission.clinicValidationOutcome, mission.ownerValidationOutcome)

  return ddb.update({
    key: { id: ctx.args.missionId },
    condition: { status: { eq: mission.status } },
    update: { status: finalStatus },
  })
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      // Voir l'en-tête de ce fichier : pas une vraie erreur pour l'appelant, l'autre pipeline a
      // déjà écrit un statut au moins aussi frais que celui calculé ici. Retourne l'état lu par
      // la fonction 2 (pas celui, plus frais, que l'autre pipeline vient d'écrire -- afficher
      // cet état exact demanderait une 4e fonction de lecture, non justifiée ici : le prochain
      // fetch de l'appelant, quel qu'il soit, verra l'état correct).
      return ctx.prev.result
    }
    util.error(ctx.error.message, ctx.error.type, ctx.result)
  }
  return ctx.result
}
