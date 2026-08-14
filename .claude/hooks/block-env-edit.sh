#!/usr/bin/env bash
# PreToolUse hook: bloque Edit/Write sur les fichiers .env locaux.
# Ce repo a un historique de secrets committés par erreur (voir commit
# d140fcf "remove .env file from git tracking security fix") — .env existe
# toujours en local (gitignored) et peut contenir des credentials Amplify/Stripe.
set -euo pipefail

file_path=$(jq -r '.tool_input.file_path // empty')

if [[ "$file_path" =~ (^|/)\.env(\.[A-Za-z0-9_.-]+)?$ ]]; then
  echo "Bloqué : $file_path est un fichier de secrets (.env*), jamais édité par l'agent." >&2
  echo "Demande à l'utilisateur de faire la modification lui-même si nécessaire." >&2
  exit 2
fi

exit 0
