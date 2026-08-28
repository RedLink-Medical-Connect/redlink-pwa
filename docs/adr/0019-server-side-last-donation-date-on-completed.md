---
status: accepted
supersedes: none (ferme le résidu signalé par ADR-0018 §4 côté écriture secondaire, et le
  « résidu à router vers une sous-tâche backend » de `src/composables/mission-completion-side-effects.js`)
amended: 2026-08-28 — §3 et §4 (la « double écriture sans danger » n'en était pas une :
  l'écriture client écrasait celle du serveur ; elle est retirée, voir §4)
---

# `Animal.lastDonationDate` écrit par le pipeline `submitMissionValidation` (8e fonction)

Correctif du 2026-08-28 sur la branche `feat/mission-dual-validation-and-ratings`. Il ferme la
moitié restante d'un bug **constaté** (pas suspecté) par deux sous-tâches successives :
`09b87c1` (écritures secondaires côté Owner, front-only) documente explicitement qu'elle ne peut
PAS le fermer, et pointe vers ce chemin serveur comme le seul possible.

## 1. Le bug : la Frequency Rule n'était jamais réarmée quand l'Owner votait en second

Depuis la double validation (ADR-0015), une Mission n'atteint `COMPLETED` qu'au **second** vote,
quel que soit le côté qui le soumet. Dans le flux nominal, le vétérinaire clôture d'abord depuis
`RequestsView.vue` : c'est donc l'appel de l'**Owner** qui finalise.

Or `Animal.lastDonationDate` porte une `.authorization()` de champ
(`ownerReadOnlyVetReadUpdate`, ADR-0003) : l'Owner n'a que `[read]`, l'écriture est réservée aux
`Veterinarians`. Vérifié sur le SDL compilé par la sous-tâche précédente, pas supposé. Aucun code
client côté Owner ne peut donc porter cette écriture — l'émettre quand même ne produirait qu'une
erreur `@auth` systématique, avalée par le traitement best-effort (bruit de log permanent, aucune
donnée écrite, illusion de correctif).

Conséquence, sur le chemin le plus fréquent : la **Frequency Rule** (`CONTEXT.md`,
`satisfiesFrequencyRule` dans `eligibility-service.js`, ADR-0003) n'était **jamais** réarmée. Un
animal réellement prélevé restait immédiatement rééligible pour un nouveau don. C'est un risque
médical, pas une imprécision d'affichage — et c'est ce qui distingue ce trou des résidus assumés
de la famille ADR-0004/0005/0015.

Ni la Lambda planifiée ni « la prochaine action côté clinique » ne rattrapent le cas : la Lambda
ne traite que les Missions restées en `PENDING_VALIDATION` (`COMPLETED_AUTO`, ADR-0016), et le
write-once par côté empêche la clinique de revoter.

## 2. La décision : une 8e fonction de pipeline, source `Animal` (7 -> 8)

`amplify/data/resolvers/submit-mission-validation-record-donation-date.js`, ajoutée **après** la
fonction de finalisation du statut :

| # | fichier (`amplify/data/resolvers/`) | `dataSource` | rôle |
|---|---|---|---|
| 1-4 | `resolve-parties` / `verify-owner-party` / `load-vet-clinic` / `verify-clinic-party` | `Mission`/`Animal`/`Veterinarian`/`Request` | vérification d'identité (ADR-0018, inchangée) |
| 5 | `write-side` | `Mission` | écriture write-once du côté appelant (inchangée) |
| 6 | `read-mission` | `Mission` | relecture fraîche (inchangée) |
| 7 | `finalize-status` | `Mission` | statut agrégé + **`ctx.stash.finalMissionStatus`** (seul ajout) |
| 8 | `record-donation-date` | `Animal` | `Animal.lastDonationDate` si et seulement si 7 vient d'écrire `COMPLETED` |

Le resolver cible directement la table managée du modèle (`dataSource: a.ref('Animal')`) et
bypasse donc entièrement le système `@auth` d'`Animal` (mécanisme démontré par ADR-0011 §3.2,
déjà utilisé par les 7 fonctions précédentes). **Le serveur est le seul endroit du système qui a
le droit d'écrire ce champ quel que soit l'appelant.**

Ça n'accorde aucun pouvoir nouveau à l'Owner : la **valeur** écrite est calculée par le serveur
(date du jour), la **clé** vient de `ctx.stash.missionAnimalID` (espace serveur, jamais un
argument client), l'écriture n'a lieu qu'**après** les 4 vérifications d'identité d'ADR-0018, et
seulement sur une transition réelle vers `COMPLETED` — laquelle exige le vote `CONFIRMED` des
DEUX côtés. Un Owner ne peut donc pas dater un animal qui n'est pas le sien, ni le sien à volonté
(et l'effet de cette écriture est de rendre l'animal *moins* éligible, pas plus).

### Déclenchement par `ctx.stash`, pas par relecture du statut

La fonction 7 range dans `ctx.stash.finalMissionStatus` le statut qu'elle vient d'écrire, et le
remet à `null` si sa condition optimiste a échoué (`ConditionalCheckFailedException` : c'est
l'**autre** pipeline qui a écrit le statut, donc SA propre fonction 8 qui porte l'écriture — sans
ça, une double validation quasi simultanée daterait le don deux fois).

Deux alternatives écartées :
- **Relire `ctx.prev.result.status`** : à ce point du pipeline, `ctx.prev.result` est la valeur de
  retour de `ddb.update()`, dont l'en-tête de la fonction 5 documente qu'on ne peut PAS vérifier
  localement qu'elle contient l'item complet (`ReturnValues: ALL_NEW` — `DynamoDBUpdateInput`
  n'expose aucune option `returnValues`). Coder sur cette hypothèse est précisément ce que la
  sous-tâche d'origine avait refusé de faire.
- **Redériver la matrice de réconciliation dans la fonction 8** : rouvrirait le risque de
  divergence entre deux dérivations de la même règle — le problème que la fonction 1 évite déjà
  pour le rôle de l'appelant (ADR-0018 §2).

`runtime.earlyReturn(ctx.prev.result)` sur tout autre statut : la source de données ET le
`response()` sont sautés, donc aucune lecture/écriture sur `Animal` n'est payée sur les chemins
`PENDING_VALIDATION`/`NO_SHOW`/`DISPUTED` (contrat documenté de `Runtime.earlyReturn`,
`node_modules/@aws-appsync/utils/lib/index.d.ts`, déjà utilisé par les fonctions 2 à 4).

### Fuseau horaire : `util.time.nowFormatted`, PAS `Intl`

Vérifié dans le paquet installé (`node_modules/@aws-appsync/utils/lib/time-utils.d.ts`,
`@aws-appsync/utils@1.12.0`), pas supposé : `TimeUtils` expose la surcharge
`nowFormatted(formatString: string, timezone: string)` — *« Returns a string of the current
timestamp for a timezone using the specified format and timezone from String input types »*.
C'est exactement le besoin, et ça **évite entièrement la question du support d'`Intl`** dans le
runtime restreint `APPSYNC_JS` : le `todayAsAWSDate()` de la Lambda
(`mission-validation-auto-finalizer/resolve-auto-finalization-outcome.ts`) s'appuie sur
`Intl.DateTimeFormat().formatToParts()`, légitime dans un runtime Node complet, à ne pas recopier
ici sans preuve.

Fuseau **explicite** `Europe/Paris`, comme la Lambda et pour la même raison : un resolver
s'exécute côté serveur (horloge UTC), pas dans le navigateur d'un vétérinaire — la logique
`getFullYear()/getMonth()/getDate()` de `todayAsAWSDate()`
(`src/composables/mission-completion-side-effects.js`, fuseau LOCAL du navigateur — helper
**supprimé le 2026-08-28**, voir §4) n'est pas transposable. Sans fuseau explicite, toute validation soumise entre 00h00 et 02h00 heure de Paris
daterait le don de la veille et raccourcirait la Frequency Rule d'un jour (même bug de frontière
que celui trouvé en QA sur la Phase 2.1).

**Point non vérifiable localement, signalé plutôt que masqué** : le dialecte exact du
`formatString` et l'acceptation d'un identifiant IANA (`Europe/Paris`) par l'implémentation AWS de
`util.time` ne sont pas exécutables hors d'un déploiement réel (`ampx sandbox`, hors périmètre
d'un agent). `'yyyy-MM-dd'` est le motif canonique de la doc AppSync (patterns Java
`DateTimeFormatter`, communs à `util.time` VTL et JS) et `Europe/Paris` est déjà utilisé tel quel
sur ce backend (planification EventBridge de la Lambda). **À confirmer au premier déploiement
réel** : une erreur de format/fuseau se manifesterait à l'exécution de la fonction 8, pas au
`tsc`/aux tests.

### Garde anti-upsert

`condition: { id: { attributeExists: true } }`, identique à celle de la fonction 5 et à
l'`attribute_exists(id)` de la Lambda. Sans elle, un `Mission.animalID` pointant vers un Animal
supprimé ferait **créer** par `UpdateItem` un Animal partiel (`{ id, lastDonationDate, updatedAt }`,
sans `ownerID`, sans espèce, sans groupe sanguin) — vraie corruption de données. Ce n'est pas
théorique : la vérification d'identité de la fonction 2 n'existe que côté Owner, donc sur le
chemin CLINIQUE aucune fonction antérieure n'a prouvé que l'Animal existe encore.

## 3. Best-effort, pas critique (LE point à scruter en revue)

`response()` **avale toute erreur** de cette écriture et renvoie la Mission telle quelle. La
question n'est pas évidente et mérite d'être contestée ; le raisonnement :

- **Faire échouer la mutation** (`util.error`) rendrait l'échec visible à un appelant qui ne peut
  RIEN en faire : son vote est déjà écrit (write-once, fonction 5) et un second appel échouerait
  avec `ALREADY_VALIDATED`. Pire, `data` deviendrait `null` : côté client,
  `useOwnerMissions`/`useMissionClosure` verraient une exception et n'exécuteraient PAS l'upsert
  `ClinicOwnerRelation` — on casserait un correctif existant (`09b87c1`) pour signaler un échec
  non actionnable. Et l'utilisateur qui reçoit l'erreur (souvent l'Owner) n'est pas celui que
  l'information concerne (la clinique).
- **`util.appendError()`** (qui laisse `data` non nul) aboutit au **même résultat observable dans
  ce dépôt** : les deux composables passent leurs `errors` à `throwIfGraphqlError`
  (`src/services/graphql-error-service.js`), qui lève dès que le tableau est non vide.
- **Avaler** laisse le contrat de la mutation inchangé et n'est jamais pire que l'état d'avant ce
  correctif (où l'écriture n'avait *jamais* lieu sur ce chemin).

C'est la doctrine « écriture secondaire best-effort » de `CLAUDE.md`, déjà appliquée par la
fonction 7 (qui traite un `ConditionalCheckFailedException` comme non bloquant après une écriture
critique réussie) et par la Lambda planifiée (ses 3 écritures secondaires n'échouent jamais
l'invocation).

**Résidu assumé** : un échec DynamoDB dur ici est **silencieux**. Le runtime `APPSYNC_JS` n'expose
aucun `console` dans les types du paquet installé (aucun des 8 resolvers n'en utilise), et ce
dépôt n'a de toute façon aucun outil de suivi d'erreurs (trou d'observabilité connu, roadmap
Phase 5). Écart avec la Lambda, où la même écriture compte comme un échec dans son résumé de
log : la Lambda a un `console.error` et personne à qui remonter une erreur ; ici c'est l'inverse.

Asymétrie **délibérée**, au moment de la rédaction, avec `applyVeterinarianCompletionSideEffects`
(`mission-completion-side-effects.js`), où la même écriture était CRITIQUE (elle rethrow) : là-bas
l'appelant est le vétérinaire, il est devant son écran, il a le droit d'écrire ce champ et peut
agir. Ici l'écriture est un effet de bord serveur d'une mutation dont le contrat observable est
« ton vote est enregistré, voici le statut ».

> **Amendement du 2026-08-28** (voir §4) : cette asymétrie n'existe plus, l'écriture client ayant
> été **retirée**. Le raisonnement ci-dessus reste celui qui justifie le best-effort **ici** ; ce
> qui a changé, c'est qu'il n'y a plus d'écriture concurrente en face.

## 4. Ce que ce correctif ne fait PAS (résidus assumés, signalés)

- ~~**Double écriture acceptée** quand c'est le VÉTÉRINAIRE qui vote en second~~ — **CORRIGÉ le
  2026-08-28** (revue `lead-dev-reviewer`, finding MOYEN-ÉLEVÉ ; correctif livré avec ADR-0020).
  Le texte d'origine de ce point la disait « sans danger (même champ, même jour, idempotent) » et
  laissait le choix ouvert au Lead Dev. **C'était faux**, et voici pourquoi :
  `useMissionClosure.closeMission()` appelle `submitMissionValidation` **PUIS**
  `applyVeterinarianCompletionSideEffects` — l'écriture CLIENT part donc systématiquement APRÈS
  celle du serveur et l'**écrase**, toujours, pas seulement en cas de course. Or elle datait le
  don dans le fuseau du **navigateur** du vétérinaire (`todayAsAWSDate()`, accesseurs de date
  locaux) là où la fonction 8/8 le date en `Europe/Paris` explicite : sur un poste mal configuré
  ou un vétérinaire en déplacement, la date finale était fausse d'un jour — c'est-à-dire
  exactement le bug de fuseau que cette 8e fonction existe pour éviter, intégralement neutralisé
  sur le chemin où c'est le vétérinaire qui vote en second (le seul où les deux écritures
  coexistaient). Le « filet » invoqué n'en était pas un : il masquait le correctif.
  **Décision** : l'écriture client est **retirée** (`mission-completion-side-effects.js`), le
  serveur devient la source **unique** de `Animal.lastDonationDate` — il couvre déjà les deux
  chemins (Owner ou vétérinaire en second) et reste le seul endroit du système autorisé à écrire
  ce champ quel que soit l'appelant (ADR-0003). Conséquences assumées, toutes documentées dans le
  JSDoc de la fonction : `applyVeterinarianCompletionSideEffects` perd sa seule écriture
  **critique** et ne lève donc plus jamais (les deux restantes, `ClinicOwnerRelation` et compteurs
  `Clinic`, étaient déjà best-effort) ; le helper `todayAsAWSDate()`, devenu sans appelant, est
  supprimé ; le test `useMissionClosure.test.js` qui verrouillait le contrat « lève si
  `Animal.update` échoue » est remplacé par une non-régression qui vérifie qu'aucune écriture
  `Animal` n'est plus émise côté client. Contrepartie acceptée : un échec de l'écriture serveur
  est désormais **silencieux** sans rattrapage client (§3, résidu d'observabilité déjà connu) —
  préféré à une écriture bruyante mais **fausse**.
- **Compteurs `Clinic`** (`transfusionsDone`/`donorOwnersCount`) quand l'Owner vote en second :
  **non ajoutés**, résidu assumé (dérive déjà documentée pour ces compteurs). Coût réel :
  DEUX fonctions de pipeline supplémentaires (9/10 puis 10/10 — le `clinicID` n'est dans le stash
  que sur le chemin CLINIQUE, la fonction 4 étant un no-op côté Owner, il faudrait donc relire la
  `Request`), pour un compteur de tableau de bord — et `donorOwnersCount` resterait faux, sa
  valeur dépendant de la création ou non d'une `ClinicOwnerRelation`, décidée côté client.
- **`ClinicOwnerRelation`** : déjà porté côté client par les DEUX composables depuis `09b87c1`.
  Le dupliquer ici produirait une double écriture réelle (pas idempotente : une relation créée
  deux fois), pas juste redondante.
- **Plafond AppSync** : un resolver de pipeline accepte au plus 10 fonctions ; ce pipeline en
  consomme **8**. Il ne reste que 2 places. Pin-testé (`resource.transform.test.ts`).
- **`updatedAt` de `Mission`** n'est toujours écrit par aucune fonction de ce pipeline (écart
  préexistant aux fonctions 5 et 7). La fonction 8 écrit, elle, `Animal.updatedAt` — comme la
  Lambda le fait sur la même table et le même champ. Incohérence signalée, non corrigée ici
  (hors périmètre).
- **Le résidu de robustesse d'ADR-0018 §4 est inchangé** : si la fonction 6 ou 7 échoue durement,
  le vote reste écrit sans que le statut soit recalculé — et donc sans que la fonction 8 date le
  don.

## 5. Tests

`amplify/data/__tests__/submit-mission-validation.resolvers.test.js` (harnais existant **étendu**,
pas dupliqué : 8e étape dans `PIPELINE`, double de `util.time.nowFormatted` qui enregistre ses
arguments) : écriture déclenchée sur `COMPLETED` quel que soit le côté qui vote en second, jamais
sur `PENDING_VALIDATION`/`NO_SHOW`/`DISPUTED`/`COMPLETED_AUTO`, format + fuseau explicites pinnés,
garde anti-upsert (Animal supprimé entre les deux votes -> aucun Animal fantôme, appelant non
impacté), `response()` qui renvoie la Mission et jamais l'Animal, erreurs avalées, cohérence
`finalMissionStatus` <-> statut réellement écrit.

`amplify/data/__tests__/resource.transform.test.ts` : l'ordre exact des **8** fonctions et leurs
sources de données (`AnimalTable` en 8e), plus le plafond de 10.

`src/composables/__tests__/mission-dual-validation.integration.test.js` : touché au **minimum**
(harnais d'une autre sous-tâche) — `stash: {}` ajouté aux contextes qu'il fabrique (toujours
présent côté AppSync, désormais requis par la fonction 7), et le commentaire qui décrivait la
Frequency Rule comme un « résidu ouvert » mis à jour. Ses assertions sont inchangées : elles
comptent les écritures **du composable**, qui restent nulles côté Owner. Ce harnais ne rejoue que
les 3 fonctions d'écriture et ne modélise pas la table `Animal` — l'étendre à la 8e fonction est
un bon candidat pour la prochaine passe QA.
