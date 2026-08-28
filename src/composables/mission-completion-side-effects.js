import { throwIfGraphqlError } from '@/services/graphql-error-service'
import { resolveClinicOwnerRelationUpsert } from '@/services/clinic-owner-relation-service'

// ─────────────────────────────────────────────────────────────────────────────────────────
// ÉCRITURES SECONDAIRES DÉCLENCHÉES QUAND UNE MISSION ATTEINT RÉELLEMENT `COMPLETED`
// (double validation Owner + Clinic, 2026-08-27 — correctif de la passe QA de l'étape 4/5).
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Ces trois écritures (`Animal.lastDonationDate`, upsert `ClinicOwnerRelation`, incrément
// `Clinic.transfusionsDone`/`donorOwnersCount`) vivaient UNIQUEMENT dans `useMissionClosure.js`
// (côté vétérinaire). Depuis la double validation, le statut `COMPLETED` n'est plus atteint au
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
// Conséquence : le côté Owner ne peut honnêtement porter QU'UNE des trois écritures. D'où deux
// points d'entrée distincts ci-dessous plutôt qu'un paramètre "mode" : chaque appelant lit
// exactement ce qu'il fait, et on n'émet jamais une mutation dont on sait qu'elle sera refusée
// (elle ne ferait que polluer les logs sans jamais aboutir).
// Résidu ASSUMÉ, à router vers une sous-tâche backend (hors périmètre de ce correctif, qui est
// front-only) : quand l'Owner vote en second, `Animal.lastDonationDate` et les compteurs
// `Clinic` restent non écrits. Seul un chemin serveur peut les porter (le resolver
// `submitMissionValidation` au moment où il finalise en `COMPLETED`, ou une Lambda sur flux
// DynamoDB — la Lambda `mission-validation-auto-finalizer` fait DÉJÀ exactement ces trois
// écritures en SDK direct pour `COMPLETED_AUTO`, ADR-0016 §4 : le chemin existe, il n'est
// simplement pas branché sur `COMPLETED`). Verrouillé par un test dédié plutôt que masqué.
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Date du jour au format `AWSDate` (`YYYY-MM-DD`), dans le fuseau LOCAL — pas
 * `toISOString().slice(0, 10)`, qui donne la date UTC. Un vétérinaire qui clôture une
 * Mission entre ~22h et minuit UTC (0h-2h heure de Paris en été) verrait sinon
 * `Animal.lastDonationDate` daté de la veille, faussant silencieusement la Frequency Rule
 * d'un jour — trouvé par un test de frontière de fuseau horaire en QA sur la Phase 2.1.
 * (Déplacé tel quel depuis `useMissionClosure.js`, comportement inchangé.)
 */
export function todayAsAWSDate(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

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
 * @param {object} client - client Gen2 (`generateClient()`, `aws-amplify/data`)
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
 * @param {object} client - client Gen2 (`generateClient()`, `aws-amplify/data`)
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
 * Les TROIS écritures secondaires, telles que le CÔTÉ VÉTÉRINAIRE les émet quand une Mission
 * atteint réellement `COMPLETED` (`useMissionClosure.closeMission`). Comportement identique à
 * celui qui vivait en ligne dans ce composable avant l'extraction — y compris son asymétrie de
 * traitement d'erreur, délibérément préservée :
 *
 * - `Animal.lastDonationDate` est CRITIQUE, pas best-effort : son échec interrompt la séquence
 *   (les deux écritures suivantes ne partent pas) et REMONTE à l'appelant. C'est l'écriture qui
 *   réarme la Frequency Rule (CONTEXT.md, ADR-0003) — un animal réellement prélevé qui resterait
 *   éligible est un risque médical, pas une imprécision d'annuaire ; le vétérinaire doit le
 *   savoir. Contrat verrouillé par `useMissionClosure.test.js` ("propage l'erreur ... si la
 *   mutation Animal échoue").
 * - Les deux suivantes sont best-effort (voir leurs fonctions respectives).
 *
 * @param {object} client - client Gen2 (`generateClient()`, `aws-amplify/data`)
 * @param {{animalId: string, clinicID?: string, ownerID?: string}} params
 * @throws {Error} si l'écriture `Animal.lastDonationDate` échoue (et elle seule)
 */
export async function applyVeterinarianCompletionSideEffects(client, { animalId, clinicID, ownerID }) {
  // AWSDate attend `YYYY-MM-DD` (pas d'heure) — contrairement à `appointmentDatetime`/
  // `validationExpiresAt` ailleurs dans ce repo, qui sont des AWSDateTime en ISO 8601 complet.
  // Date LOCALE (todayAsAWSDate), pas UTC — voir son commentaire.
  const { errors: animalErrors } = await client.models.Animal.update({
    id: animalId,
    lastDonationDate: todayAsAWSDate(),
  })
  throwIfGraphqlError(animalErrors, 'updateAnimal')

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
 * bruit de log permanent, aucune donnée écrite, et l'illusion d'un bug corrigé. Le trou réel
 * (Frequency Rule non réarmée quand l'Owner vote en second) reste ouvert et doit être fermé
 * côté SERVEUR, seul endroit qui a les droits ; il est signalé en rapport et verrouillé par un
 * test dédié.
 *
 * Ne lève JAMAIS : au moment de l'appel, le vote de l'Owner est déjà enregistré côté serveur
 * (write-once, irréversible) — lui remonter une erreur d'annuaire lui ferait croire que sa
 * réponse n'a pas été prise en compte, et le retry n'existe pas (le second appel échouerait
 * avec `ALREADY_VALIDATED`).
 *
 * @param {object} client - client Gen2 (`generateClient()`, `aws-amplify/data`)
 * @param {{clinicID?: string, ownerID?: string}} params
 * @returns {Promise<boolean>} `true` si une nouvelle `ClinicOwnerRelation` a été créée
 */
export async function applyOwnerCompletionSideEffects(client, { clinicID, ownerID }) {
  return upsertClinicOwnerRelation(client, clinicID, ownerID)
}
