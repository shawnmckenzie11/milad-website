#!/bin/bash
# Journal hook: record which file an agent just edited, in order.
#
# The checkpoint message uses this edit sequence to describe how a stage was reached
# when no explicit stage note was recorded. Runtime-only: the journal lives in the
# gitignored .cursor/commit-buddy/ directory.

set -uo pipefail

payload="$(cat 2>/dev/null || true)"

file_path=""
if command -v jq >/dev/null 2>&1; then
  file_path="$(printf '%s' "$payload" | jq -r '.file_path // .filePath // .path // empty' 2>/dev/null || true)"
fi
if [[ -z "$file_path" ]]; then
  file_path="$(printf '%s' "$payload" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
fi

if [[ -n "$file_path" ]]; then
  mkdir -p .cursor/commit-buddy 2>/dev/null || true
  printf '%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$file_path" >>.cursor/commit-buddy/journal.log 2>/dev/null || true
fi

echo '{}'
exit 0
