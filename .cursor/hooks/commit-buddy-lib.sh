#!/bin/bash
# Shared helpers for commit-buddy hooks.
#
# Hooks run from the project root with a minimal environment, so `node` may not be
# on PATH even when it is available in an interactive shell.

# Resolve a usable node binary.
# Prints the path on success; returns 1 when no node is available.
buddy_find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  local candidate
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

# Run the commit-buddy CLI with the given arguments, discarding stdout/stderr.
# Always returns 0 so a buddy failure can never block the agent.
buddy_run() {
  local node_bin
  node_bin="$(buddy_find_node)" || return 0
  "$node_bin" scripts/commit-buddy.mjs "$@" >/dev/null 2>&1 || true
  return 0
}
