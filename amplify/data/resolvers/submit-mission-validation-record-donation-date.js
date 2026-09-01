// Fonction 8/8 (dernière) du pipeline AppSync JS de la mutation custom `submitMissionValidation`
// (`amplify/data/resource.ts`) -- AJOUTÉE le 2026-08-28, voir
// docs/adr/0019-server-side-last-donation-date-on-completed.md.
//
// LE BUG QU'ELLE FERME (constaté par deux sous-tâches successives, pas suspecté)
// Quand la DEUXIÈME validation d'une Mission -- celle qui la fait passer en `COMPLETED` -- est
// soumise par l'OWNER, `Animal.lastDonationDate` n'était JAMAIS écrit : le SDL compilé réserve ce
// champ aux `Veterinarians` en écriture (`ownerReadOnlyVetReadUpdate`, ADR-0003 ; l'Owner n'a que
// `[read]`), donc AUCUN code client côté Owner ne peut le porter -- constat explicite de
// `src/composables/mission-completion-side-effects.js`, qui ferme la partie faisable côté client
// (`ClinicOwnerRelation`) et pointe ICI pour le reste. Conséquence : la Frequency Rule
// (`CONTEXT.md`, `satisfiesFrequencyRule` dans `eligibility-service.js`, ADR-0003) n'était jamais
// réarmée sur ce chemin -- un animal réellement prélevé restait IMMÉDIATEMENT rééligible pour un
// nouveau don. C'est un risque médical, pas une imprécision d'affichage.
//
// POURQUOI ICI PLUTÔT QUE CÔTÉ CLIENT : ce resolver cible directement la table managée du modèle
// (`dataSource: a.ref('Animal')`) et bypasse donc entièrement le système `@auth` d'`Animal` (même
// mécanisme que `linkRequestToMission`, ADR-0011 §3.2, et que les 7 fonctions qui précèdent). Le
// serveur est le SEUL endroit qui a le droit d'écrire ce champ quel que soit l'appelant. Ça
// n'accorde aucun pouvoir nouveau à l'Owner : la VALEUR écrite est calculée par le serveur (date
// du jour), la CLÉ vient de `ctx.stash` (espace serveur, jamais un argument client), et l'écriture
// n'a lieu qu'après les 4 vérifications d'identité (ADR-0018) et seulement sur une transition
// réelle vers `COMPLETED` -- laquelle exige le vote CONFIRMED des DEUX côtés.
//
// DÉCLENCHEMENT : `ctx.stash.finalMissionStatus`, posé par la fonction 7/8
// (`submit-mission-validation-finalize-status.js`) -- `'COMPLETED'` seulement si l'écriture du
// statut de CE pipeline a RÉUSSI, `null` si sa condition optimiste a échoué (l'autre pipeline a
// écrit le statut, c'est donc SON exécution de cette fonction 8/8 qui porte l'écriture -- sinon
// les deux l'écriraient). Tout le reste (`PENDING_VALIDATION`/`NO_SHOW`/`DISPUTED`) : no-op via
// `runtime.earlyReturn()`, la source de données ET le `response()` sont sautés (contrat de
// `Runtime.earlyReturn`, `node_modules/@aws-appsync/utils/lib/index.d.ts`), donc aucune lecture ni
// écriture sur la table `Animal` n'est payée sur ces chemins -- même pattern que les fonctions
// 2/8 à 4/8. `COMPLETED_AUTO` n'apparaît jamais ici : il n'est écrit que par la Lambda planifiée,
// qui fait elle-même ses propres écritures secondaires (ADR-0016 §4).
//
// POURQUOI LA DATE VIENT DE `util.time.nowFormatted(...)` ET PAS D'`Intl`/`new Date()`
// Vérifié dans le paquet installé (`node_modules/@aws-appsync/utils/lib/time-utils.d.ts`,
// `@aws-appsync/utils@1.12.0`), pas supposé : `TimeUtils` expose une surcharge
// `nowFormatted(formatString: string, timezone: string)` -- « Returns a string of the current
// timestamp for a timezone using the specified format and timezone from String input types ».
// C'est exactement le besoin, et ça évite la question ouverte du support d'`Intl` dans le runtime
// restreint `APPSYNC_JS` (le `todayAsAWSDate()` de la Lambda,
// `mission-validation-auto-finalizer/resolve-auto-finalization-outcome.ts`, s'appuie sur
// `Intl.DateTimeFormat().formatToParts()` -- légitime dans un runtime Node complet, à NE PAS
// recopier ici sans preuve). `util.time` est fourni par le runtime AWS, pas par le paquet npm
// (`lib/index.js` n'exporte que `const util = {}` -- coquilles de types), d'où la vérification par
// les types plutôt que par exécution.
//
// FUSEAU EXPLICITE `Europe/Paris`, comme la Lambda planifiée et POUR LA MÊME RAISON : un resolver
// AppSync s'exécute côté SERVEUR (horloge UTC), pas dans le navigateur d'un vétérinaire -- la
// logique `getFullYear()/getMonth()/getDate()` que portait `todayAsAWSDate()` côté client
// (`src/composables/mission-completion-side-effects.js`, fuseau LOCAL du NAVIGATEUR, supprimée le
// 2026-08-28 -- voir plus bas) n'est pas transposable telle quelle. Sans fuseau explicite, toute
// validation soumise entre 00h00 et 02h00
// heure de Paris (22h-00h UTC en été) daterait le don de la VEILLE et raccourcirait la Frequency
// Rule d'un jour. Même bug de frontière que celui trouvé en QA sur la Phase 2.1, transposé au bon
// runtime.
// SEUL POINT NON VÉRIFIABLE LOCALEMENT (signalé, pas masqué) : le dialecte exact du
// `formatString` et l'acceptation d'un identifiant de fuseau IANA (« Europe/Paris ») par
// l'implémentation AWS de `util.time` -- ni l'un ni l'autre ne sont exécutables hors d'un vrai
// déploiement (`ampx sandbox`, interdit dans le périmètre de cette sous-tâche). `'yyyy-MM-dd'` est
// le motif canonique de la doc AppSync (patterns Java `DateTimeFormatter`, communs à `util.time`
// VTL et JS) et `Europe/Paris` est déjà utilisé tel quel sur ce backend par la planification
// EventBridge de la Lambda (`mission-validation-auto-finalizer/resource.ts`, `timezone:
// 'Europe/Paris'`). À confirmer au premier déploiement réel.
//
// GARDE ANTI-UPSERT `id: { attributeExists: true }` : identique à celle de la fonction 5/8 et à
// l'`attribute_exists(id)` de la Lambda (`updateAnimalLastDonationDate`, ADR-0016 §4). Sans elle,
// un `Mission.animalID` pointant vers un Animal supprimé/inexistant ferait CRÉER par `UpdateItem`
// un Animal partiel (`{ id, lastDonationDate, updatedAt }`, sans `ownerID`, sans espèce, sans
// groupe sanguin) -- une vraie corruption de données. Elle est plus qu'une précaution théorique
// ici : la vérification d'identité de la fonction 2/8 n'est faite que côté OWNER, donc sur le
// chemin CLINIQUE aucune fonction antérieure n'a prouvé que l'Animal existe.
//
// BEST-EFFORT, PAS CRITIQUE (décision documentée -- ADR-0019 §3, à scruter en revue)
// `response()` avale TOUTE erreur de cette écriture et renvoie la Mission telle quelle. Ce n'est
// pas une négligence, c'est le moins mauvais des deux comportements possibles à ce point précis
// du pipeline :
//   - Faire échouer la mutation (`util.error`) rendrait l'échec visible... à un appelant qui ne
//     peut RIEN en faire : son vote est déjà écrit (write-once, fonction 5/8) et un second appel
//     échouerait avec `ALREADY_VALIDATED`. Pire, `data` deviendrait `null` : côté client,
//     `useOwnerMissions`/`useMissionClosure` verraient une exception et n'exécuteraient PAS les
//     écritures secondaires qui, elles, ont encore un sens (upsert `ClinicOwnerRelation`) -- on
//     casserait un correctif existant pour signaler un échec non actionnable.
//   - `util.appendError()` (qui laisse `data` non nul) aboutit au même résultat observable dans
//     CE dépôt : les deux composables passent leurs `errors` à `throwIfGraphqlError`
//     (`src/services/graphql-error-service.js`), qui lève dès que le tableau est non vide.
// SOURCE UNIQUE DEPUIS LE 2026-08-28 (revue Lead Dev, docs/adr/0020 -- ADR-0019 §4 corrigé) :
// `applyVeterinarianCompletionSideEffects` (`src/composables/mission-completion-side-effects.js`)
// n'écrit PLUS `Animal.lastDonationDate`. ADR-0019 §4 tenait cette double écriture pour
// inoffensive ("même champ, même jour") ; elle ne l'était pas -- `closeMission()` appelle la
// mutation PUIS ses écritures secondaires, donc l'écriture CLIENT partait APRÈS celle-ci et
// l'écrasait avec la date du fuseau du NAVIGATEUR du vétérinaire, neutralisant sur ce chemin le
// correctif de fuseau ci-dessus. Le "filet" que devait constituer l'écriture client (elle, qui
// échouait bruyamment) ne compensait donc rien : il masquait cette fonction.
//
// Même raisonnement que « écriture secondaire best-effort » (`CLAUDE.md`), que la fonction 7/8
// (qui traite déjà un `ConditionalCheckFailedException` comme non bloquant après une écriture
// critique réussie) et que la Lambda planifiée (dont les 3 écritures secondaires n'échouent
// jamais l'invocation). RÉSIDU ASSUMÉ ET SIGNALÉ : un échec DynamoDB dur ici est SILENCIEUX (le
// runtime `APPSYNC_JS` n'expose aucun `console` dans les types du paquet installé, et ce dépôt
// n'a de toute façon aucun outil de suivi d'erreurs -- trou d'observabilité connu, roadmap Phase
// 5). Le cas reste strictement meilleur qu'avant : la Frequency Rule n'était JAMAIS réarmée sur
// le chemin Owner ; elle ne le sera désormais pas seulement en cas d'échec transitoire de cette
// écriture précise.
import * as ddb from '@aws-appsync/utils/dynamodb'
import { util, runtime } from '@aws-appsync/utils'

// Fuseau de référence métier du pilote (cliniques françaises) -- même valeur que `TIME_ZONE` de
// `mission-validation-auto-finalizer/handler.ts` et que la planification EventBridge.
const TIME_ZONE = 'Europe/Paris'
// `AWSDate` attend `YYYY-MM-DD` (pas d'heure), contrairement aux `AWSDateTime` de ce pipeline
// (`clinicValidatedAt`/`ownerValidatedAt`, `util.time.nowISO8601()`).
const AWS_DATE_FORMAT = 'yyyy-MM-dd'

export function request(ctx) {
  // Seule une transition RÉELLE vers COMPLETED réarme la Frequency Rule. `NO_SHOW`/`DISPUTED` ne
  // sont pas des dons réalisés (même règle que côté composable et côté Lambda), et
  // `PENDING_VALIDATION` signifie que le second côté n'a pas encore voté.
  if (ctx.stash.finalMissionStatus !== 'COMPLETED') {
    runtime.earlyReturn(ctx.prev.result)
  }

  const animalID = ctx.stash.missionAnimalID

  // Défense en profondeur : la fonction 1/8 rejette déjà (`Forbidden`) toute Mission sans
  // `animalID`, donc ce cas est inatteignable aujourd'hui. S'il le devenait (réordonnancement du
  // pipeline), un no-op est la bonne issue -- surtout pas une erreur remontée à l'appelant pour
  // une écriture secondaire, ni un `ddb.update()` sur une clé `undefined`.
  if (!animalID) {
    runtime.earlyReturn(ctx.prev.result)
  }

  return ddb.update({
    key: { id: animalID },
    condition: { id: { attributeExists: true } },
    update: {
      lastDonationDate: util.time.nowFormatted(AWS_DATE_FORMAT, TIME_ZONE),
      // Écrit explicitement, comme le fait la Lambda sur cette même table/ce même champ
      // (`SET lastDonationDate = :today, #updatedAt = :now`) : une écriture directe dans la table
      // managée ne passe pas par les resolvers générés qui entretiennent `updatedAt`, et une
      // ligne dont la date de dernier don change sans que `updatedAt` bouge serait subtilement
      // incohérente avec toutes les autres. (Les fonctions 5/8 et 7/8 ne le font pas sur
      // `Mission` -- écart PRÉEXISTANT, signalé en revue, pas corrigé ici : hors périmètre.)
      updatedAt: util.time.nowISO8601(),
    },
  })
}

export function response(ctx) {
  // TOUJOURS `ctx.prev.result` (la Mission), JAMAIS `ctx.result` (l'Animal) : cette fonction est
  // la DERNIÈRE du pipeline, et le resolver de tête généré par le framework renvoie littéralement
  // `ctx.prev.result` au client (`node_modules/@aws-amplify/backend-data/lib/assets/
  // js_resolver_handler.js`). Renvoyer l'Animal ferait résoudre la mutation -- typée
  // `.returns(a.ref('Mission'))` -- sur un objet d'un autre type, et les deux composables lisent
  // `data.status` juste après.
  //
  // `ctx.error` volontairement ni relayé ni transformé : voir le bloc BEST-EFFORT de l'en-tête.
  // Couvre aussi bien le `ConditionalCheckFailedException` de la garde anti-upsert (Animal
  // inexistant) qu'un échec dur (throttle, incident).
  return ctx.prev.result
}
