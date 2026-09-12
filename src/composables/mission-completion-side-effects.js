import { throwIfGraphqlError } from '@/services/graphql-error-service'
import { resolveClinicOwnerRelationUpsert } from '@/services/clinic-owner-relation-service'

// ─────────────────────────────────────────────────────────────────────────────────────────
// ÉCRITURES SECONDAIRES DÉCLENCHÉES QUAND UNE MISSION ATTEINT RÉELLEMENT `COMPLETED`
// (double validation Owner + Clinic, 2026-08-27 — correctif de la passe QA de l'étape 4/5).
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Trois écritures (`Animal.lastDonationDate`, upsert `ClinicOwnerRelation`, incrément
// `Clinic.transfusionsDone`/`donorOwnersCount`) vivaient UNIQUEMENT dans `useMissionClosure.js`
// (côté vétérinaire) — la première a depuis quitté le front pour de bon (2026-08-28, ADR-0019 §4
// corrigé : elle est écrite par le pipeline serveur, ce module n'en porte plus que DEUX).
// Depuis la double validation, le statut `COMPLETED` n'est plus atteint au
// clic du vétérinaire mais au SECOND vote, quel que soit le côté qui le soumet — et dans le flux
// nominal (le vétérinaire clôture d'abord depuis RequestsView.vue), c'est l'appel de l'OWNER qui
// finalise. `useOwnerMissions.submitDonationValidation` ne déclenchait alors AUCUNE de ces
// écritures : Frequency Rule jamais réarmée (docs/adr/0003) et annuaire donneurs jamais peuplé
// pour un don pourtant confirmé par les deux parties. Bug réel trouvé et verrouillé par un test
// en passe QA (`src/composables/__tests__/mission-dual-validation.integration.test.js`).
//
// D'où ce module partagé : les deux composables l'importent, aucun n'importe l'autre (un
// composable n'importe jamais un autre composable dans ce repo).
//
// POURQUOI ICI ET PAS DANS `src/services/`
// ----------------------------------------
// `CLAUDE.md`/`.cursorrules` réservent `src/services/xxx-service.js` aux fonctions PURES (aucune
// réactivité Vue, aucun appel GraphQL, aucun accès DOM) — ces trois écritures sont précisément
// des appels GraphQL, donc un `*-service.js` serait un contresens (la décision PURE qu'elles
// contenaient, elle, est bien dans un service : `resolveClinicOwnerRelationUpsert`,
// `src/services/clinic-owner-relation-service.js`, réutilisé ici et NON dupliqué). Ce n'est pas
// non plus un composable (`useXxx.js`) : aucun état réactif, aucune ref, rien à exposer à un
// composant — juste des fonctions asynchrones qui prennent le client Gen2 en paramètre. D'où un
// module "composable-like" partagé, nommé d'après ce qu'il fait plutôt qu'en `useXxx`, posé à
// côté de ses deux seuls appelants. Choix à scruter en revue : l'alternative aurait été
// d'exposer un `useMissionCompletionSideEffects()` vide de réactivité, uniquement pour respecter
// le préfixe `use` — un composable en trompe-l'oeil.
//
// LE CLIENT GEN2 EST PASSÉ EN PARAMÈTRE (pas de `generateClient()` ici)
// --------------------------------------------------------------------
// Chaque composable a déjà le sien (`const client = generateClient()`), et le passer explicite
// la dépendance sans imposer un second client ni un ordre d'initialisation vis-à-vis
// d'`Amplify.configure()` (`src/main.js`).
//
// ⚠️ LES DEUX CÔTÉS N'ONT PAS LES MÊMES DROITS `@auth` — CE N'EST PAS SYMÉTRIQUE
// -----------------------------------------------------------------------------
// Vérifié sur le SDL compilé (`schema.transform().schema`, cf.
// `amplify/data/__tests__/resource.transform.test.ts`), pas supposé :
// - `Animal.lastDonationDate` : `{allow: owner, operations: [read]}` + Veterinarians
//   `[read, update]` (ADR-0003) — un Owner ne peut PAS l'écrire.
// - `Clinic` : `{allow: private, operations: [read]}` + Veterinarians `[create, read, update]`
//   — un Owner ne peut PAS incrémenter les compteurs.
// - `ClinicOwnerRelation` : `{allow: owner, ownerField: "ownerID"}` (ADR-0009, sans restriction
//   d'opérations) + Veterinarians — l'Owner de la ligne peut la lire ET la créer.
// Conséquence : le côté Owner ne peut honnêtement porter QUE l'upsert `ClinicOwnerRelation`.
// D'où deux points d'entrée distincts ci-dessous plutôt qu'un paramètre "mode" : chaque appelant
// lit exactement ce qu'il fait, et on n'émet jamais une mutation dont on sait qu'elle sera
// refusée (elle ne ferait que polluer les logs sans jamais aboutir).
//
// ÉTAT RÉEL DEPUIS LE 2026-08-28 (le résidu écrit ici a été fermé, ne pas le relire au passé) :
// - `Animal.lastDonationDate` : FERMÉ côté SERVEUR (commit `8c14e7d`, ADR-0019) — la 8e fonction
//   du pipeline `submitMissionValidation` l'écrit dès que la Mission atteint réellement
//   `COMPLETED`, quel que soit le côté qui vote en second. La Frequency Rule est donc réarmée
//   sur TOUS les chemins. Ce module ne l'écrit plus NULLE PART, y compris côté vétérinaire
//   (docs/adr/0019 §4 corrigé : l'écriture client, partant après celle du serveur, l'écrasait
//   avec la date du fuseau du navigateur).
// - Compteurs `Clinic` (`transfusionsDone`/`donorOwnersCount`) : SEUL résidu encore ouvert quand
//   l'Owner vote en second — ils restent non incrémentés sur ce chemin. Non fermé délibérément
//   (ADR-0019 §4) : ce sont des indicateurs de tableau de bord, dont la dérive est déjà
//   documentée, et les porter côté serveur coûterait DEUX fonctions de pipeline supplémentaires
//   (9/10 puis 10/10, le `clinicID` n'étant pas dans le stash sur le chemin Owner) pour un
//   `donorOwnersCount` qui resterait de toute façon faux (sa valeur dépend de la création ou non
//   d'une `ClinicOwnerRelation`, décidée côté client).
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Upsert best-effort d'une `ClinicOwnerRelation` (clinicID, ownerID) — voir
 * `resolveClinicOwnerRelationUpsert` (`src/services/clinic-owner-relation-service.js`) pour la
 * logique de décision, réutilisée telle quelle et jamais dupliquée.
 *
 * Best-effort au sens de `CLAUDE.md` ("écriture secondaire best-effort") : toute erreur
 * (réseau, `@auth`, GraphQL) est loguée et avalée, jamais relancée. Au moment de l'appel, le
 * vote décisif a déjà été enregistré côté serveur et le don a réellement eu lieu ;
 * `ClinicOwnerRelation` n'alimente qu'un annuaire clinique (`DonorsView.vue`), donc un échec
 * ici est un manque de confort d'annuaire, pas une perte de donnée médicale. Faire échouer
 * toute l'opération pour ça afficherait un message d'erreur trompeur (laissant croire que la
 * validation n'a pas été enregistrée) alors que l'essentiel a réussi.
 *
 * Si `clinicID`/`ownerID` sont absents : no-op silencieux + log, mêmes raisons.
 *
 * @param {object} client - client Gen2 (`generateClient()`, `@/services/bff-graphql-client`)
 * @param {string} clinicID
 * @param {string} ownerID
 * @returns {Promise<boolean>} `true` si une NOUVELLE `ClinicOwnerRelation` a été créée (donc un
 *   nouveau propriétaire donneur pour cette clinique — voir `incrementClinicStats`), `false`
 *   sinon (relation déjà existante, ids manquants, ou erreur : une incertitude sur
 *   `donorOwnersCount` est préférable à un échec remonté à l'utilisateur).
 */
export async function upsertClinicOwnerRelation(client, clinicID, ownerID) {
  if (!clinicID || !ownerID) {
    console.error(
      'Liaison clinique/propriétaire (ClinicOwnerRelation) ignorée : clinicID ou ownerID manquant.',
    )
    return false
  }

  try {
    // Pas de `selectionSet` dédié : lecture PLATE (aucune relation imbriquée traversée), le
    // sur-fetch du selectionSet par défaut (scalaires du modèle) reste négligeable — même
    // raisonnement que le `Clinic.get()` ci-dessous, inchangé depuis `useMissionClosure.js`.
    const { data, errors } = await client.models.ClinicOwnerRelation.list({
      filter: { ownerID: { eq: ownerID } },
    })
    throwIfGraphqlError(errors, 'clinicOwnerRelationsByOwnerID')

    const toCreate = resolveClinicOwnerRelationUpsert(data || [], clinicID)
    if (!toCreate) return false

    const { errors: createErrors } = await client.models.ClinicOwnerRelation.create({
      clinicID: toCreate.clinicID,
      ownerID,
      isPrimaryClinic: toCreate.isPrimaryClinic,
    })
    throwIfGraphqlError(createErrors, 'createClinicOwnerRelation')
    return true
  } catch (e) {
    console.error('Erreur liaison clinique/propriétaire (ClinicOwnerRelation) :', e)
    // Volontairement avalée, pas relancée — voir le commentaire de fonction ci-dessus.
    return false
  }
}

/**
 * Incrément best-effort des indicateurs tableau de bord vétérinaire (CdC §2.4, Phase 6.7) :
 * `Clinic.transfusionsDone` (toujours, une transfusion a réellement eu lieu) et
 * `Clinic.donorOwnersCount` (seulement si `isNewDonorOwner` — sinon ce don compterait un
 * propriétaire déjà connu de cette clinique une deuxième fois). Même traitement d'erreur
 * best-effort que `upsertClinicOwnerRelation` et pour la même raison : un échec ici est une
 * imprécision de tableau de bord, pas une perte de donnée médicale.
 *
 * Lecture-puis-écriture, pas d'incrément atomique côté serveur : course acceptée et non résolue
 * (deux Missions de la même Clinic closes à quelques instants d'écart peuvent perdre un
 * incrément), documentée depuis la Phase 6.7. La Lambda `mission-validation-auto-finalizer`, qui
 * refait la même écriture pour `COMPLETED_AUTO`, utilise elle un vrai incrément atomique
 * (`if_not_exists(x, :zero) + :one`) parce qu'elle écrit en SDK direct dans la table — écart de
 * MÉCANISME assumé et documenté (ADR-0016 §4), pas d'effet observable différent.
 *
 * @param {object} client - client Gen2 (`generateClient()`, `@/services/bff-graphql-client`)
 * @param {string} clinicID
 * @param {boolean} isNewDonorOwner
 */
export async function incrementClinicStats(client, clinicID, isNewDonorOwner) {
  if (!clinicID) {
    console.error('Incrément des indicateurs clinique ignoré : clinicID manquant.')
    return
  }

  try {
    const { data, errors } = await client.models.Clinic.get({ id: clinicID })
    throwIfGraphqlError(errors, 'getClinic')

    const current = data
    if (!current) return

    const { errors: updateErrors } = await client.models.Clinic.update({
      id: clinicID,
      transfusionsDone: (current.transfusionsDone ?? 0) + 1,
      donorOwnersCount: (current.donorOwnersCount ?? 0) + (isNewDonorOwner ? 1 : 0),
    })
    throwIfGraphqlError(updateErrors, 'updateClinic')
  } catch (e) {
    console.error('Erreur incrément des indicateurs clinique (transfusionsDone/donorOwnersCount) :', e)
    // Volontairement avalée, pas relancée — voir le commentaire de fonction ci-dessus.
  }
}

/**
 * Les écritures secondaires que le CÔTÉ VÉTÉRINAIRE émet quand une Mission atteint réellement
 * `COMPLETED` (`useMissionClosure.closeMission`).
 *
 * ⚠️ CHANGEMENT DU 2026-08-28 (revue Lead Dev, docs/adr/0020 — ADR-0019 §4 mis à jour) : elles
 * sont désormais DEUX, plus trois. `Animal.lastDonationDate` n'est PLUS écrit ici : la 8e
 * fonction du pipeline `submitMissionValidation`
 * (`amplify/data/resolvers/submit-mission-validation-record-donation-date.js`, ADR-0019) le fait
 * côté SERVEUR sur TOUS les chemins — que ce soit l'Owner ou le vétérinaire qui vote en second.
 * La garder ici n'était pas une redondance inoffensive, contrairement à ce qu'affirmait
 * ADR-0019 §4 : `closeMission()` appelle la mutation PUIS cette fonction, donc l'écriture CLIENT
 * partait APRÈS et ÉCRASAIT systématiquement celle du serveur. Elle utilisait la date du jour
 * dans le fuseau du NAVIGATEUR ; le serveur, lui, la calcule en `Europe/Paris` explicite. Un
 * vétérinaire en déplacement (ou au poste mal configuré) datait donc le don d'un jour d'écart —
 * exactement le bug de fuseau que la fonction 8/8 existe pour éviter, entièrement neutralisé sur
 * ce chemin. Le serveur est désormais la source UNIQUE de ce champ (c'est de toute façon le seul
 * endroit qui a le droit de l'écrire quel que soit l'appelant, ADR-0003/ADR-0019).
 *
 * CONSÉQUENCE À CONNAÎTRE : cette fonction n'a plus AUCUNE écriture critique. Les deux qui
 * restent (upsert `ClinicOwnerRelation`, compteurs `Clinic`) sont best-effort — elles loguent et
 * avalent leurs erreurs. Elle ne lève donc plus jamais, et son ancien contrat `@throws` (verrouillé
 * jusqu'ici par `useMissionClosure.test.js`) n'a plus d'objet ; le test correspondant a été
 * remplacé par une non-régression qui vérifie qu'aucune écriture `Animal` n'est plus émise ici.
 * `applyOwnerCompletionSideEffects` ci-dessous ne levait déjà jamais : les deux points d'entrée
 * ont enfin le même contrat d'erreur, pour la même raison (le vote est déjà enregistré côté
 * serveur, irréversible, quand ces écritures partent).
 *
 * @param {object} client - client Gen2 (`generateClient()`, `@/services/bff-graphql-client`)
 * @param {{clinicID?: string, ownerID?: string}} params
 * @returns {Promise<void>} ne lève jamais (les deux écritures sont best-effort)
 */
export async function applyVeterinarianCompletionSideEffects(client, { clinicID, ownerID }) {
  const isNewDonorOwner = await upsertClinicOwnerRelation(client, clinicID, ownerID)
  await incrementClinicStats(client, clinicID, isNewDonorOwner)
}

/**
 * La SEULE des trois écritures que le CÔTÉ OWNER a le droit d'émettre
 * (`useOwnerMissions.submitDonationValidation`, quand c'est SON vote qui fait passer la Mission
 * en `COMPLETED`) : l'upsert `ClinicOwnerRelation`, autorisé par
 * `{allow: owner, ownerField: "ownerID"}` (ADR-0009) puisque la ligne écrite est la sienne.
 *
 * `Animal.lastDonationDate` et les compteurs `Clinic` ne sont PAS tentés ici : le SDL compilé
 * les réserve aux `Veterinarians` (voir l'en-tête de ce fichier). Les émettre quand même
 * produirait une erreur `@auth` systématique, avalée par le traitement best-effort — donc du
 * bruit de log permanent, aucune donnée écrite, et l'illusion d'un bug corrigé.
 *
 * Le trou qui en découlait — Frequency Rule jamais réarmée quand l'Owner vote en second — est
 * FERMÉ depuis le 2026-08-28, côté SERVEUR (commit `8c14e7d`, ADR-0019 : 8e fonction du pipeline
 * `submitMissionValidation`, seul endroit du système qui a le droit d'écrire ce champ quel que
 * soit l'appelant). Ne subsiste sur ce chemin que la non-incrémentation des compteurs `Clinic`,
 * résidu assumé et sans enjeu médical (voir l'en-tête).
 *
 * Ne lève JAMAIS : au moment de l'appel, le vote de l'Owner est déjà enregistré côté serveur
 * (write-once, irréversible) — lui remonter une erreur d'annuaire lui ferait croire que sa
 * réponse n'a pas été prise en compte, et le retry n'existe pas (le second appel échouerait
 * avec `ALREADY_VALIDATED`).
 *
 * @param {object} client - client Gen2 (`generateClient()`, `@/services/bff-graphql-client`)
 * @param {{clinicID?: string, ownerID?: string}} params
 * @returns {Promise<boolean>} `true` si une nouvelle `ClinicOwnerRelation` a été créée
 */
export async function applyOwnerCompletionSideEffects(client, { clinicID, ownerID }) {
  return upsertClinicOwnerRelation(client, clinicID, ownerID)
}
