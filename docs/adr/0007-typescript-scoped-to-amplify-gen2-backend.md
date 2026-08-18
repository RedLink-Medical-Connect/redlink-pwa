---
status: accepted
---

# TypeScript scopé au dossier `amplify/` pour la migration Gen2

Ce repo est intégralement en JavaScript pur (`CLAUDE.md`, `.cursorrules` : "Pas de
TypeScript — JS pur"). Amplify Gen2 (`@aws-amplify/backend`) est en revanche conçu et
documenté "entirely in TypeScript" — pas de mode JS-only documenté ni supporté de
façon éprouvée. `defineAuth`/`defineData`/`defineBackend` reposent sur l'inférence de
types TypeScript pour générer le client typé côté frontend (`ClientSchema`,
`Schema['ModelName']['type']`, etc.) : écrire ces fichiers en JS reviendrait à perdre
l'essentiel du bénéfice du framework, tout en s'éloignant du chemin le plus documenté
et le plus éprouvé par la communauté Amplify (donc le plus facile à déboguer en cas de
problème pendant une migration déjà risquée).

## Décision

TypeScript est introduit, mais **strictement scopé au dossier `amplify/`** :
`amplify/backend.ts`, `amplify/auth/resource.ts`, `amplify/functions/**` (et
`amplify/data/**` à la sous-tâche 4). Rien dans `src/` ne change : pas de fichier
`.ts`/`.tsx`, pas de changement de `vite.config.js` (pas de plugin `@vitejs/plugin-vue`
en mode TS, pas de `vue-tsc`), pas de changement d'`eslint.config.js` pour le
frontend. Le tsconfig racine ajouté (`include: ["amplify/**/*.ts"]`) ne s'applique
qu'aux fichiers `amplify/`, sans effet sur le glob de lint frontend (`app/files-to-lint`
cible `**/*.{js,mjs,jsx,vue}`, pas `.ts`).

Conséquence assumée : ESLint (config plate actuelle, pas de parseur TypeScript
installé) ne couvre pas les fichiers `amplify/**/*.ts` — ni erreurs ni warnings dessus
tant qu'un parseur TS n'est pas ajouté explicitement (hors périmètre de cette
sous-tâche ; à envisager en Phase 9 si la dette TypeScript du dossier `amplify/`
grossit). La vérification de ces fichiers passe par `tsc --noEmit` (type-checking pur,
aucun appel réseau/AWS) plutôt que par le lint habituel du repo.

## Alternative rejetée

Écrire le backend Gen2 en JS pur avec JSDoc (pattern déjà toléré ailleurs dans ce repo
pour le typage ponctuel de fonctions) a été envisagée puis écartée : aucun exemple
Amplify Gen2 officiel ne documente ce mode, et `defineData`/`ClientSchema` (sous-tâche 4) dépendent structurellement de l'inférence TypeScript pour produire un type de
retour utile côté client — sans elle, `generateClient<Schema>()` perdrait tout intérêt
par rapport au Gen1 actuel. Le coût (une deuxième "zone de langage" dans un repo par
ailleurs 100% JS) est jugé inférieur au risque de contourner un framework hors de son
mode d'usage documenté pendant une migration déjà risquée par nature.

## Portée

Cette décision ne rouvre pas le choix "pas de TypeScript" pour `src/` — elle
documente une contrainte du framework Gen2, pas une préférence d'ingénierie qui
s'étendrait au reste du repo.
