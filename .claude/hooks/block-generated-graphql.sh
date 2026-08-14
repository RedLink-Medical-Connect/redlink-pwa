#!/usr/bin/env bash
# PreToolUse hook: bloque Edit/Write sur les fichiers GraphQL auto-générés.
# Un vrai bug de ce repo vient d'une édition manuelle de ces fichiers,
# écrasée au amplify codegen/push suivant. Voir CLAUDE.md, section GraphQL.
set -euo pipefail

file_path=$(jq -r '.tool_input.file_path // empty')

if [[ "$file_path" =~ src/graphql/(queries|mutations|subscriptions)\.js$ ]]; then
  echo "Bloqué : $file_path est auto-généré par 'amplify codegen' et sera écrasé." >&2
  echo "Ajoute le champ/la query manquante dans custom-queries.js ou custom-mutations.js à la place." >&2
  exit 2
fi

exit 0
