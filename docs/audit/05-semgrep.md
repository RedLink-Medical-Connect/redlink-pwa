# Audit outillage — Semgrep (premier scan) — Redlink PWA

Audit réalisé selon la grille `docs/audit/00-referentiel.md`. Toute référence de
règle ci-dessous ("X.Y") pointe vers ce référentiel. Contrairement à
`01-frontend.md` à `04-crosscutting.md` (lecture manuelle de code), ce document
rapporte un **scan outillé** (Semgrep, CLI local) — premier passage, mode audit
uniquement, aucun fichier source modifié.

## Contexte : écart avec la demande initiale

La demande initiale visait le plugin officiel Claude Code "Semgrep Guardian"
(`semgrep/mcp-marketplace`), avec un mode local explicitement demandé ("rien
ne quitte ma machine sur ce repo client"). Après inspection du README et du
manifeste du plugin :

- Aucune commande `setup_semgrep_plugin` n'existe dans ce plugin — son
  installation officielle passe par `/plugin install semgrep@semgrep-marketplace`
  puis `/reload-plugins` puis **connexion obligatoire à un compte semgrep.dev**
  ("the agent asks Semgrep [cloud] and Semgrep answers", README). Aucun mode
  local n'est documenté pour le scan lui-même.
- Le plugin embarque en plus un skill sans rapport (`install-mfw`, un "Malware
  Firewall" — proxy système qui intercepte les installations npm/pip via
  semgrep.dev), avec modification du trust store OS et installation d'un
  daemon persistant.

Décision (validée avec l'utilisateur) : plugin Guardian et sa marketplace
**désinstallés**. À la place : **CLI Semgrep local** (`pipx`, aucune connexion
requise) + **hook `PostToolUse` maison** (`.claude/hooks/semgrep-scan.sh`,
déclenché sur `Edit|Write`) qui scanne uniquement le fichier venant d'être
modifié, avec `--metrics=off`. Seul trafic réseau : le téléchargement (et mise
en cache locale) des packs de règles publiques la première fois — aucun code
du repo n'est transmis.

## Méthode

- **Outil** : Semgrep CLI `1.173.0`, installé via `pipx` (`~/.local/`, hors
  environnement projet).
- **Périmètre** : `src/` (55 fichiers `.js`, 34 `.vue`) et
  `amplify/backend/function/` (3 fichiers `.js` — les deux Lambdas et leur
  test). `amplify/backend/api/redlinkpwa/schema.graphql` volontairement hors
  périmètre : ni ce schéma ni les résolveurs VTL générés ne sont un langage
  cible pour les rulesets utilisés ici (revue `@auth`/`@model` déjà couverte
  par l'agent `graphql-schema-reviewer`, pas par Semgrep).
- **Rulesets** : `p/javascript`, `p/security-audit`, `p/secrets`,
  `p/owasp-top-ten` — packs publics du registre Semgrep, résolus **sans
  connexion** (`semgrep login` non exécuté), `--metrics=off`. `p/vuejs` n'existe
  pas au registre (HTTP 404) — pas de pack dédié Vue.
- **Commande** : `semgrep scan --config p/javascript --config p/security-audit
  --config p/secrets --config p/owasp-top-ten --metrics=off src/
  amplify/backend/function/`.
- **MCP** : aucun (le plugin Guardian, qui aurait exposé un serveur MCP dédié,
  a été écarté — voir ci-dessus). Scan exécuté en CLI brut.

---

## Résultat du scan

```
Ran 149 rules on 111 files: 0 findings.
```

- 111 fichiers ciblés sur 114 trouvés dans le périmètre (3 fichiers hors
  formats couverts, ex. `.json`/`.yaml` de config).
- Détail par langage : `js` — 81 règles sur **58 fichiers** (55 `src/` + 3
  `amplify/backend/function/`) ; `<multilang>` (règles génériques,
  essentiellement `p/secrets`) — 41 règles sur **111 fichiers**, `.vue` inclus.
- **0 finding**, quelle que soit la sévérité.

## Limite d'outillage constatée (à lire avant de considérer ce "0 finding" comme un satisfecit)

Le tableau ci-dessus masque une limite réelle de cette configuration, vérifiée
par deux sondes synthétiques (fichiers hors dépôt git, supprimés après
vérification, aucune modification commise) :

1. **Les fichiers `.vue` ne reçoivent pas d'analyse JS/sécurité réelle.** Le
   décompte "js : 81 règles sur 58 fichiers" ne compte **aucun** des 34
   fichiers `.vue` du repo — Semgrep OSS n'a pas de parseur SFC Vue (confirmé
   par le 404 sur `p/vuejs`), les blocs `<script setup>` ne sont donc jamais
   passés aux règles `p/javascript`/`p/security-audit`. Seules les règles
   génériques `<multilang>` (recherche textuelle, essentiellement secrets)
   s'appliquent aux `.vue`. Sonde : un `<script setup>` de test contenant
   `eval(userInput)` (variable non contrôlée) et un `v-html` non sanitizé
   (règle 2.1 du référentiel) placé dans un fichier `.vue` du repo (non suivi
   par git, supprimé après test) → **0 finding**, alors que le même code dans
   un fichier `.js` frère aurait au moins été soumis aux règles JS (voir point
   suivant sur leur propre limite).
2. **Les rulesets publics anonymes ont une couverture réduite, y compris sur
   du `.js` pur.** Sonde : un fichier `.js` de test contenant la clé AWS
   d'exemple canonique `AKIAIOSFODNN7EXAMPLE` (le littéral standard utilisé
   pour valider un détecteur de secrets) → **0 finding** avec `p/secrets` en
   mode anonyme. Le CLI affiche lui-même, à chaque scan, `need more rules?
   semgrep login for additional free Semgrep Registry rules` : une partie non
   négligeable des règles (dont probablement la détection de secrets à haut
   rappel) n'est délivrée qu'aux comptes connectés — indépendamment du plugin
   Guardian écarté plus haut.

**Conséquence pour ce dépôt** : les vrais constats de sécurité déjà remontés
sur ce repo (clé secrète Stripe dans l'historique git — R-01 du backlog ; API
Gateway `apiStripe` ouverte — R-02 ; `Animal.bloodGroup` `@auth` — ADR-0006)
ont tous été trouvés par lecture manuelle de code (`02-backend.md`), pas par
un outil de ce type — un SAST générique ne peut de toute façon pas évaluer une
configuration d'infrastructure (permissions API Gateway) ni une règle `@auth`
GraphQL (langage non couvert). Ce "0 finding" ne doit donc **pas** être lu
comme "le scan confirme l'absence de dette" mais comme "avec cette
configuration 100% locale et anonyme, le scan n'a rien trouvé de plus que ce
que les audits `01`–`04` avaient déjà par ailleurs identifié" — le hook a une
vraie valeur de filet pour les patterns qu'il couvre effectivement (règles
`p/javascript`/`p/security-audit` sur du `.js` pur, `p/owasp-top-ten`), mais
n'est pas un substitut aux audits manuels sur ce repo, surtout pas sur ses 34
fichiers `.vue`.

**OK d'ignorer si** (à la manière des clauses du référentiel) : ce "0 finding"
n'a pas besoin d'être re-questionné à chaque scan futur sur du code déjà
audité manuellement en `01`–`04` — seulement sur du code neuf, en gardant à
l'esprit la limite `.vue` ci-dessus.

---

## Ce qui a été installé/configuré dans cette étape

- **Semgrep CLI** `1.173.0` (`pipx install semgrep`) — hors dépendances npm du
  projet, à réinstaller manuellement sur toute nouvelle machine
  (`pipx install semgrep`, pas de fichier de lock versionné pour cet outil).
- **Hook `PostToolUse` local** : `.claude/hooks/semgrep-scan.sh`, déclaré dans
  `.claude/settings.json` sur `Edit|Write`. Scanne uniquement le fichier
  `.js`/`.vue` venant d'être modifié (exclut `src/graphql/{queries,mutations,
  subscriptions}.js` et `.env*`, comme les hooks `PreToolUse` existants), avec
  les 4 rulesets ci-dessus et `--metrics=off`. Sortie non bloquante en soi
  (exit 2 renvoie les findings à l'agent à titre indicatif, ne bloque pas
  l'édition déjà faite).
- **jscpd** `^5.0.15`, ajouté en devDependency (`npm install --save-dev
  jscpd`). Script `npm run check:duplication` → `jscpd src/`. Config
  `.jscpd.json` à la racine : seuil **5%** (règle 3.1 du référentiel, "Bloc de
  15 lignes ou plus" — `minLines: 15`), formats `javascript`+`vue` (Vue est
  supporté nativement par jscpd, contrairement à Semgrep), exclusion des
  fichiers de test et de `src/graphql/` (auto-généré). Premier run :
  **1.05% de duplication globale** (8 clones, tous sous le seuil), exit code
  0 — cohérent avec l'absence de tout constat de duplication au sens strict
  de la règle 3.1 dans les audits `01`–`04` (`04-crosscutting.md`, "Notes de
  méthode").

---

## Notes de méthode

- Aucun fichier `src/`/`amplify/` n'a été modifié à cette étape — scan en
  mode audit uniquement, conformément à la demande.
- Les deux fichiers de sonde synthétique (`eval()`, clé AWS d'exemple) ont été
  créés hors suivi git, dans le repo (pour que Semgrep les prenne en compte —
  il ignore par défaut tout ce qui n'est pas trackable par `git ls-files`) et
  supprimés immédiatement après vérification (`git status` confirmé propre
  avant/après).
- Le plugin Claude Code Guardian et sa marketplace (`semgrep/mcp-marketplace`)
  ont été désinstallés (`claude plugin uninstall semgrep@semgrep-marketplace`,
  `claude plugin marketplace remove semgrep-marketplace`) — aucune trace ne
  doit rester dans la config `user` de Claude Code après cette étape.
