#!/usr/bin/env bash
# PostToolUse hook: scanne avec Semgrep (CLI local) le fichier que l'agent
# vient d'écrire/éditer. Alternative maison au plugin officiel "Semgrep
# Guardian" (semgrep/mcp-marketplace) : celui-ci exige un compte semgrep.dev
# connecté (pas de mode local documenté) et embarque un outil sans rapport
# (mfw, un proxy système qui intercepte les installs npm/pip) — écarté pour
# ce repo client, voir docs/audit/05-semgrep.md. Ici : aucune donnée ne quitte
# la machine hors le téléchargement initial (et mis en cache) des règles
# publiques depuis le registre Semgrep — pas d'envoi de code, --metrics=off.
set -euo pipefail

file_path=$(jq -r '.tool_input.file_path // empty')

[[ -z "$file_path" ]] && exit 0
[[ -f "$file_path" ]] || exit 0

case "$file_path" in
  *.js | *.vue) ;;
  *) exit 0 ;;
esac

case "$file_path" in
  */src/graphql/queries.js | */src/graphql/mutations.js | */src/graphql/subscriptions.js) exit 0 ;;
  *.env*) exit 0 ;;
esac

command -v semgrep >/dev/null 2>&1 || exit 0

output=$(semgrep scan \
  --config p/javascript \
  --config p/security-audit \
  --config p/secrets \
  --metrics=off \
  --quiet \
  --no-git-ignore \
  "$file_path" 2>/dev/null || true)

if [[ -n "$(echo "$output" | tr -d '[:space:]')" ]]; then
  echo "Semgrep a détecté des findings sur $file_path :" >&2
  echo "$output" >&2
  exit 2
fi

exit 0
