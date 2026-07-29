#!/bin/bash
# Session-start hook: push anything a previous session committed but never pushed,
# so a crashed or force-quit session cannot leave work stranded locally.

set -uo pipefail
cat >/dev/null 2>&1 || true

source "$(dirname "$0")/commit-buddy-lib.sh"

buddy_run sync

echo '{}'
exit 0
