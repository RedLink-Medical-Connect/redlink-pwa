// Fonction 1/7 du pipeline AppSync JS de la mutation custom `submitMissionValidation`
// (`amplify/data/resource.ts`) -- AJOUTÉE le 2026-08-27 (correctif de sécurité, voir
// docs/adr/0018-submit-mission-validation-caller-must-be-party.md).
//
// POURQUOI CES 4 NOUVELLES FONCTIONS (1/7 à 4/7) EXISTENT
// Avant ce correctif, le pipeline ne vérifiait QUE l'appartenance de l'appelant à l'un des deux
// groupes Cognito (`ctx.identity.groups`, voir `submit-mission-validation-write-side.js`,
// désormais fonction 5/7) -- JAMAIS qu'il soit réellement PARTIE à CETTE Mission. Comme la
// mutation bypasse entièrement le système `@auth` de `Mission` (`dataSource: a.ref('Mission')`,
// ADR-0011 §3.2), c'était la SEULE garde existante. Trou exploitable, pas théorique :
//   - n'importe quel Owner authentifié peut lire l'`id` de TOUTE Mission active
//     (`client.models.Request.list({ selectionSet: ['mission.id'] })` -- la règle de niveau
//     modèle de `Request` accorde `read` à `allow.authenticated()`), donc voter à la place d'un
//     autre Owner sans avoir à deviner un UUID ;
//   - n'importe quel Veterinarian authentifié peut lister TOUTES les Missions du système
//     (`allow.group('Veterinarians').to(['read'])` sur `Mission`, sans notion de "ma clinique"),
//     donc voter à la place de n'importe quelle autre clinique.
// Gravité : la fonction 5/7 est WRITE-ONCE PAR CÔTÉ (`attributeExists: false`) -- un vote
// illégitime PRIVE DÉFINITIVEMENT la vraie partie du sien (aucun second appel n'est possible de
// ce côté, jamais) et peut forcer une Mission légitime en `DISPUTED`/`NO_SHOW` de façon
// irréversible. C'est ce caractère PERMANENT qui a fait écarter l'option "résidu documenté"
// (famille ADR-0004/0005/0015) au profit d'un vrai correctif.
//
// CE QUE FAIT CETTE FONCTION (aucune écriture, que des lectures)
// 1. Détermine le rôle de l'appelant AVANT tout accès à la donnée et le range dans `ctx.stash`
//    (`callerRole`), pour que les fonctions 2/7 à 4/7 n'aient pas à redériver cette précédence
//    chacune de leur côté (une divergence entre deux dérivations laisserait vérifier un côté et
//    écrire l'autre -- exactement le bug que ce correctif existe pour fermer).
//    ORDRE DE TEST IDENTIQUE à celui de la fonction 5/7 (`Veterinarians` d'abord, puis
//    `Owners`) : un appelant membre des DEUX groupes doit être vérifié sur le MÊME côté que
//    celui qu'il écrira ensuite. Pin-testé (`amplify/data/__tests__/
//    submit-mission-validation.resolvers.test.js`) plutôt que laissé à la vigilance d'un
//    futur éditeur : la 5/7 garde délibérément sa propre dérivation (elle reste correcte
//    isolément, indépendamment de l'ordre du pipeline), ce qui rend la cohérence des deux
//    vérifiable mais pas structurellement garantie.
// 2. Lit la Mission ciblée pour en extraire les DEUX identifiants dont les fonctions suivantes
//    ont besoin (`animalID` côté Owner, `requestID` côté Clinic) -- rangés eux aussi dans
//    `ctx.stash`. Le `ctx.stash` est un espace SERVEUR (`Context.stash`, `node_modules/
//    @aws-appsync/utils/lib/index.d.ts` : "made available inside each resolver and function
//    mapping template... across functions in a pipeline resolver") : aucun argument client ne
//    peut l'alimenter, contrairement à `ctx.args`.
// 3. AJOUT 2026-08-28 (docs/adr/0020) : range AUSSI le STATUT COURANT de la Mission
//    (`ctx.stash.missionStatus`), consommé par la fonction 5/8 pour refuser un vote sur une
//    Mission DÉJÀ finalisée (`COMPLETED`/`COMPLETED_AUTO`/`NO_SHOW`/`DISPUTED`/`CANCELLED`).
//    Cette fonction se contente de le RANGER, elle ne rejette pas elle-même : rejeter ici
//    ferait de la mutation un oracle d'état de Mission pour n'importe quel authentifié (le
//    rejet précéderait les vérifications d'identité des fonctions 2/8 à 4/8), exactement ce que
//    la section précédente de cet en-tête refuse pour l'EXISTENCE d'une Mission. Le rejet vit
//    donc en 5/8, APRÈS que l'appelant a été prouvé partie -- voir l'en-tête de
//    `submit-mission-validation-write-side.js` pour le raisonnement complet et pour les deux
//    alternatives atomiques (condition DynamoDB) évaluées puis écartées.
//
// Ce n'est PAS un doublon de la fonction 6/7 (`submit-mission-validation-read-mission.js`,
// ex-2/3) : celle-là relit la Mission APRÈS l'écriture du côté appelant pour que la fonction
// 7/7 calcule le statut agrégé sur un état frais. Ici la lecture est ANTÉRIEURE à toute
// écriture -- c'est le point même de l'exercice (aucun côté écrit puis annulé : le rejet doit
// précéder l'écriture write-once, sinon il ne répare rien).
//
// `consistentRead: true` : pas la même raison qu'en fonction 6/7 (là-bas c'est une nécessité de
// correction du calcul agrégé). Ici c'est pour éviter un FAUX rejet -- une réplique périmée qui
// répondrait "Mission introuvable" sur une Mission réellement existante refuserait un vote
// légitime, et ce refus n'est pas rattrapable côté client autrement qu'en réessayant. Coût
// négligeable à ce volume (une validation par Mission et par côté, pas un chemin de lecture
// chaud).
//
// `Forbidden` (nouveau code d'erreur de ce pipeline, à côté d'`Unauthorized`/`InvalidOutcome`/
// `ALREADY_VALIDATED`) est délibérément le MÊME pour "Mission introuvable" et pour "appelant non
// partie" : distinguer les deux ferait de cette mutation un oracle d'existence de Mission pour
// n'importe quel authentifié. ÉCART DE COMPORTEMENT OBSERVABLE ASSUMÉ, à signaler en revue : un
// `missionId` inexistant renvoyait jusqu'ici `ALREADY_VALIDATED` (résidu documenté dans
// l'en-tête de la fonction 5/7 -- la condition `id: { attributeExists: true }` ANDée ne dit pas
// laquelle des deux sous-conditions a échoué). Il renvoie désormais `Forbidden`, plus tôt.
// Côté front, aucun code à changer : `mapSubmitDonationValidationError` (`useOwnerMissions.js`)
// ne normalise que `ALREADY_VALIDATED`/`INVALID_OUTCOME` et retombe sur son message générique
// pour tout le reste -- et un `missionId` inexistant ne peut de toute façon venir que d'un appel
// API direct hors UI. La garde anti-upsert de la fonction 5/7 reste en place (défense en
// profondeur : elle protège toujours si ce pipeline était un jour réordonné).
import * as ddb from '@aws-appsync/utils/dynamodb'
import { util } from '@aws-appsync/utils'

// Message unique pour tous les rejets d'identité du pipeline (fonctions 1/7 à 4/7) : ne révèle
// ni l'existence de la Mission, ni quelle vérification précise a échoué.
const FORBIDDEN_MESSAGE =
  "Vous n'êtes pas partie à cette Mission -- soumission de validation refusée."

export function request(ctx) {
  const identity = ctx.identity || {}
  const groups = identity.groups || []

  if (!identity.sub) {
    util.error(FORBIDDEN_MESSAGE, 'Forbidden')
  }

  if (groups.includes('Veterinarians')) {
    ctx.stash.callerRole = 'CLINIC'
  } else if (groups.includes('Owners')) {
    ctx.stash.callerRole = 'OWNER'
  } else {
    // Même message et même code qu'en fonction 5/7 (qui garde sa propre garde) : un appelant
    // hors des deux groupes est rejeté ici, avant la moindre lecture.
    util.error(
      'Appelant non reconnu comme membre du groupe Veterinarians ni Owners -- soumission de validation refusée',
      'Unauthorized',
    )
  }

  return ddb.get({ key: { id: ctx.args.missionId }, consistentRead: true })
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type, ctx.result)
  }

  const mission = ctx.result

  // `animalID`/`requestID` sont `required` au schéma : une Mission qui n'en porterait pas est
  // soit inexistante, soit corrompue. Dans les deux cas on ne PEUT pas établir que l'appelant
  // est partie -- fail-closed, jamais "on laisse passer faute de mieux".
  if (!mission || !mission.animalID || !mission.requestID) {
    util.error(FORBIDDEN_MESSAGE, 'Forbidden')
  }

  ctx.stash.missionAnimalID = mission.animalID
  ctx.stash.missionRequestID = mission.requestID
  // Statut COURANT, lu en `consistentRead` juste au-dessus (docs/adr/0020). `status` est
  // `required` au schéma : une Mission qui n'en porterait pas est corrompue, et la fonction 5/8
  // traite ce cas en fail-closed (elle refuse le vote plutôt que de le laisser passer sans
  // garde). Volontairement PAS de rejet ici -- voir le point 3 de l'en-tête.
  ctx.stash.missionStatus = mission.status

  return mission
}
