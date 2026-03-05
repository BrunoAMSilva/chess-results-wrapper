#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_JSON="$ROOT_DIR/data/por2026-tournaments.json"
JSON_PATH="${TOURNAMENT_JSON_PATH:-$DEFAULT_JSON}"
DEFAULT_SEARCH_HTML="$HOME/Downloads/Chess-Results.com - Turniersuche.html"
SEARCH_HTML_PATH="${SEARCH_HTML_PATH:-$DEFAULT_SEARCH_HTML}"

cd "$ROOT_DIR"

if [[ -f "$JSON_PATH" ]]; then
  echo "[server-import] Using JSON seed file: $JSON_PATH"
  npm run seed:por2026 -- --import-json "$JSON_PATH" "$@"
elif [[ -f "$SEARCH_HTML_PATH" ]]; then
  echo "[server-import] Using search export: $SEARCH_HTML_PATH"
  npm run seed:por2026 -- --search-html "$SEARCH_HTML_PATH" "$@"
else
  echo "[server-import] No JSON/search export found; using live discovery fallback"
  npm run seed:por2026 -- "$@"
fi
