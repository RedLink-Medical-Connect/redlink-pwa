---
status: accepted
supersedes: none (ferme une course ouverte par la coexistence d'ADR-0016 et d'ADR-0015/0019 —
  aucune des deux décisions n'est révisée)
---

# Vote tardif sur une Mission déjà finalisée : garde de statut dans `submitMissionValidation`

Correctif du 2026-08-28 (finding **ÉLEVÉ** d'une revue `lead-dev-reviewer` de la branche
`feat/mission-dual-validation-and-ratings`, après les étapes 1 à 5/5 et les correctifs
ADR-0018/0019). Comme ADR-0018, cet ADR documente un trou **fermé** — pas un résidu assumé.

## 1. La course : le write-once par côté ne dit RIEN du statut de la Mission

Deux décisions correctes prises séparément produisent, ensemble, une régression permanente :

- **ADR-0015 (étape 1/5)** : `submit-mission-validation-write-side.js` (fonction 5/8) est
  write-once **par côté** — condition DynamoDB `attributeExists: false` sur le champ d'outcome de
  l'appelant, et rien d'autre.
- **ADR-0016 §2 (étape 2/5)** : la Lambda planifiée `mission-validation-auto-finalizer` finalise
  une Mission restée en `PENDING_VALIDATION` (`COMPLETED_AUTO`, ou `DISPUTED` si le côté ayant
  répondu avait `DENIED`) en n'écrivant **que** `status`/`updatedAt` — *« le côté silencieux n'est
  jamais falsifié »*, pour ne pas détruire la valeur probante du couple outcome/timestamp.

Conséquence mécanique : après une finalisation automatique, le champ d'outcome du côté silencieux
est **toujours absent**, donc la condition write-once de la fonction 5/8 est **toujours
satisfaite**. Ce côté pouvait voter des semaines plus tard, et son vote était accepté.

Ce que produisait alors le reste du pipeline, en cascade :

1. **La trace `COMPLETED_AUTO`/`DISPUTED` est écrasée.** La condition optimiste de la fonction 7/8
   (`status: { eq: <valeur relue par la 6/8> }`) ne protège pas de ce cas : elle compare au statut
   **courant**, qui est justement le statut terminal — la condition est satisfaite et le statut
   recalculé écrase la finalisation automatique. Elle a été conçue contre une course entre les
   deux pipelines concurrents, pas contre un vote tardif.
2. **`Animal.lastDonationDate` est redaté** par la fonction 8/8 à la date du vote **tardif**
   (ADR-0019), décalant d'autant la Frequency Rule d'un animal prélevé bien avant. C'est
   exactement le type de conséquence médicale qu'ADR-0019 existe pour éviter.
3. **`Clinic.transfusionsDone` est double-compté** quand c'est le vétérinaire qui vote tard :
   `useMissionClosure.closeMission()` voit revenir `COMPLETED` et redéclenche
   `applyVeterinarianCompletionSideEffects`, alors que la Lambda a déjà fait ces écritures de son
   côté (ADR-0016 §4). Le garde-fou « `COMPLETED` STRICT, jamais `COMPLETED_AUTO` » des deux
   composables ne sert précisément à rien ici : le statut qui revient EST `COMPLETED`.
4. **Personne ne le voit.** Aucune notification, aucun outil de suivi d'erreurs (trou
   d'observabilité connu, roadmap Phase 5) : la Mission finit avec un statut plausible et une date
   de don fausse.

Rien de tout cela n'exige d'attaquant : c'est le comportement d'un utilisateur ordinaire qui
répond en retard, sur un écran qui affiche encore sa Mission (`awaitingValidationMissions` filtre
sur `PENDING_VALIDATION`, mais un onglet resté ouvert ou un cache local suffit).

## 2. La décision : garde en CODE dans la fonction 5/8, statut stashé par la 1/8

Aucune fonction n'est ajoutée au pipeline (il en compte toujours 8 — plafond AppSync à 10) :

- **Fonction 1/8** (`submit-mission-validation-resolve-parties.js`) : range `mission.status` dans
  `ctx.stash.missionStatus`, à côté d'`animalID`/`requestID`. Aucune lecture supplémentaire — elle
  lit déjà la Mission en `consistentRead`.
- **Fonction 5/8** (`submit-mission-validation-write-side.js`) : refuse le vote si ce statut est
  terminal, **avant** toute écriture, avec le code `MISSION_ALREADY_FINALIZED`.

```js
const TERMINAL_MISSION_STATUSES = ['COMPLETED', 'COMPLETED_AUTO', 'NO_SHOW', 'DISPUTED', 'CANCELLED']
```

Liste **noire** (les 5 statuts terminaux) plutôt que liste blanche des 5 statuts en cours
(`ACCEPTED`, `PENDING_ARRIVAL`, `EN_ROUTE`, `ARRIVED`, `PENDING_VALIDATION`) : un futur statut
**intermédiaire** ajouté au schéma sans être reporté ici continuerait d'accepter les votes
(comportement attendu), là où une liste blanche les refuserait tous en silence. La contrepartie
(un futur statut **terminal** oublié) est verrouillée par un test d'exhaustivité sur les 10
valeurs, et par un pointeur explicite sur le pin d'enum de `resource.transform.test.ts`.

### Pourquoi la garde vit en 5/8 et pas en 1/8, alors que c'est la 1/8 qui lit la Mission

C'était le point ouvert du brief. Réponse : **parce que la 1/8 s'exécute avant les vérifications
d'identité** (fonctions 2/8 à 4/8, ADR-0018). Rejeter là-bas ferait de `submitMissionValidation`
un **oracle d'état de Mission** pour n'importe quel authentifié : `MISSION_ALREADY_FINALIZED` vs
`Forbidden` révélerait, pour un `missionId` quelconque, si la Mission est close — exactement le
type de fuite qu'ADR-0018 §3 ferme pour l'*existence* (« Mission introuvable » et « pas votre
Mission » y renvoient délibérément le même code et le même message). La 5/8 est la première
fonction qui s'exécute **après** que l'appelant a été prouvé partie ; c'est donc le premier
endroit où l'on peut être précis sans rien divulguer.

### Fail-closed sur un statut absent du stash

La fonction 5/8 **refuse** le vote si `ctx.stash.missionStatus` est vide. Contrairement au rôle de
l'appelant — qu'elle redérive elle-même, restant correcte isolément (ADR-0018 §3) — le statut ne
peut pas être relu localement : une fonction de pipeline n'émet qu'un seul appel vers sa source de
données, et c'est ici l'écriture elle-même. La garde dépend donc de la 1/8. Un pipeline réordonné
(ou une Mission corrompue sans `status`, `required` au schéma) provoque un refus **bruyant et
immédiat** plutôt qu'une réouverture silencieuse du trou. Coût : cette fonction n'est plus
strictement autonome — écart assumé et signalé, dans le sens sûr.

## 3. Alternatives évaluées et écartées : les deux conditions DynamoDB « atomiques »

Une condition ANDée à celles de la fonction 5/8 serait **atomique**, là où une vérification en
code laisse une fenêtre TOCTOU. Les deux formulations possibles ont été écartées, chacune pour une
raison dirimante :

- **`status: { in: [...] }` (ou `not`/`ne` combinés via le tableau `and`).** Deux problèmes.
  (a) DynamoDB ne dit **jamais** laquelle des sous-conditions d'une `ConditionExpression` ANDée a
  échoué (résidu déjà documenté dans l'en-tête de la fonction 5/8) : le rejet retomberait donc sur
  `ALREADY_VALIDATED`, c'est-à-dire précisément le code que ce correctif doit **distinguer** — le
  besoin produit (« déjà clôturée automatiquement » ≠ « vous avez déjà voté ») serait perdu.
  (b) Ces opérateurs existent bien dans les types installés (`DynamoDBFilterObject`,
  `node_modules/@aws-appsync/utils/lib/transform-utils.d.ts` : `in`, `ne`, `and`, `not`), mais
  aucun n'est exercé aujourd'hui par ce dépôt et leur traduction réelle par
  `toDynamoDBConditionExpression` n'est pas vérifiable sans déploiement (`ampx sandbox`, hors
  périmètre d'un agent). ADR-0019 assume déjà **un** point de ce genre (le dialecte de
  `util.time.nowFormatted`) sur une écriture *best-effort* ; en ajouter un second sur le chemin
  d'écriture **critique** de la feature — où une erreur ferait échouer **tous** les votes — n'a
  pas le même profil de risque.
- **`status: { eq: <valeur lue par la 1/8> }`** (l'idiome optimiste déjà déployé en fonction 7/8,
  donc sans risque d'opérateur). Écartée parce qu'elle rejetterait des votes **légitimes** : quand
  les deux côtés votent quasi simultanément, le pipeline adverse fait passer la Mission de
  `ACCEPTED` à `PENDING_VALIDATION` entre la fonction 1/8 et la fonction 5/8 de celui-ci — la
  condition échouerait, et l'utilisateur verrait « vous avez déjà répondu » sur un vote jamais
  enregistré. Elle ne résout pas non plus le problème (a) du code d'erreur.

**Résidu assumé** : fenêtre TOCTOU de quelques millisecondes entre la lecture de la 1/8 et
l'écriture de la 5/8. Analysée plutôt que simplement concédée :

- Le pipeline **adverse** ne peut pas écrire un statut terminal dans cette fenêtre : sa fonction
  7/8 n'écrit un statut terminal que si les DEUX outcomes sont renseignés, ce qui suppose que
  l'écriture de la 5/8 de *ce* pipeline a déjà eu lieu. Il ne peut y écrire que
  `PENDING_VALIDATION`, non terminal.
- La **Lambda** planifiée le pourrait, mais seulement en tombant dans une fenêtre de quelques
  millisecondes sur une Mission en attente depuis des jours — et le résultat serait alors
  exactement l'état d'**avant** ce correctif, jamais pire.

## 4. Écarts de comportement observable, assumés

- **Un re-vote du même côté sur une Mission désormais terminale renvoie
  `MISSION_ALREADY_FINALIZED` et non plus `ALREADY_VALIDATED`** (la garde de statut précède la
  condition write-once). Les deux signifient « c'est fini, rien n'est modifiable » ; le nouveau
  est plus précis. Tant que la Mission n'est PAS terminale (cas courant du double-clic sur un
  premier vote), `ALREADY_VALIDATED` répond toujours — inchangé, pin-testé.
- **`InvalidOutcome` garde sa précédence** : une soumission malformée sur une Mission finalisée
  reste `InvalidOutcome` (la validation d'argument est la première garde de `request()`).
- **Aucun changement de schéma, aucun changement `@auth`, aucune fonction de pipeline ajoutée.**

## 5. Côté front

- `useOwnerMissions.js` **normalise** le nouveau code, comme il le fait déjà pour
  `ALREADY_VALIDATED` : `isMissionAlreadyFinalizedError()` + entrée dédiée dans
  `SUBMIT_DONATION_VALIDATION_ERROR_MESSAGES` (message **distinct**, pin-testé — c'est toute la
  raison d'être du code séparé : l'Owner concerné n'a jamais pu répondre, lui dire « vous avez
  déjà répondu » serait faux).
- `useMissionClosure.js` n'a **délibérément aucun** mapping de code d'erreur (contrat historique
  Phase 2.1 : `RequestsView.vue` affiche un message générique). Y introduire une table de messages
  pour ce seul code inventerait un vocabulaire d'erreur côté vétérinaire sans écran pour le
  consommer : laissé à la **PR d'UI** qui câblera l'affichage des deux côtés. Le code d'erreur
  serveur, lui, existe dès maintenant — c'est ce qui rend cette PR future possible sans retoucher
  le backend.

## 6. Tests

`amplify/data/__tests__/submit-mission-validation.resolvers.test.js` (harnais existant étendu) :
les 5 statuts terminaux rejetés / les 5 non terminaux acceptés (exhaustivité des 10 valeurs de
`MissionStatus`), code distinct d'`ALREADY_VALIDATED`, fail-closed sur stash vide ou absent,
précédence d'`InvalidOutcome` — puis, sur le **pipeline complet** rejoué contre le magasin en
mémoire : vote tardif de l'Owner et du vétérinaire après `COMPLETED_AUTO`/`DISPUTED` posé par la
Lambda (Mission intacte, `data` nul, `Animal.lastDonationDate` non redaté, fonction 8/8 jamais
atteinte), et non-régression du second vote légitime en `PENDING_VALIDATION`.

`src/composables/__tests__/useOwnerMissions.test.js` : normalisation du code et message utilisateur
distinct. `src/composables/__tests__/mission-dual-validation.integration.test.js` : le harnais
front alimente désormais `stash.missionStatus` depuis son magasin, comme le fait la fonction 1/8 en
production (sans quoi la garde fail-closed refuserait tous ses votes) — ses assertions sont
inchangées.

## Relation avec le reste des ADR

Ne révise **ni** ADR-0015 (le write-once par côté reste correct : il protège le champ d'outcome,
ce qui n'a jamais été la même question que le statut de la Mission), **ni** ADR-0016 (ne pas
falsifier le côté silencieux reste la bonne décision — c'est même elle qui rend cette garde
nécessaire, et la solution inverse, pré-remplir l'outcome manquant, détruirait la valeur probante
que la Lambda préserve). Prolonge ADR-0018 : même famille de correctif (rejet en tête de pipeline,
avant une écriture irréversible) et même souci de ne pas transformer un message d'erreur en oracle.
Protège ADR-0019 : sans cette garde, l'écriture serveur de `Animal.lastDonationDate` pouvait être
redatée par un vote tardif, c'est-à-dire retournée contre la Frequency Rule qu'elle réarme.
