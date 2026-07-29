#!/bin/bash
# Checkpoint hook: at the end of an agent turn (or a subagent's run), let the commit
# buddy decide whether the working tree has reached a stage worth committing.
#
# Usage: commit-buddy-checkpoint.sh <trigger-label>
# The buddy applies its own gates, so this hook fires far more often than it commits.

set -uo pipefail
cat >/dev/null 2>&1 || true

source "$(dirname "$0")/commit-buddy-lib.sh"

buddy_run auto --trigger "${1:-agent-turn-end}"

echo '{}'
exit 0
