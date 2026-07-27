#!/usr/bin/env bash
# Copy the local authored Ottawa scene into the public path expected by Phase 1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/Initial Scene.png}"
DEST="$ROOT/public/images/initial-scene.png"

if [[ ! -f "$SRC" ]]; then
	echo "Missing source image: $SRC" >&2
	echo "Usage: scripts/use-initial-scene.sh [path-to-Initial-Scene.png]" >&2
	exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp "$SRC" "$DEST"
echo "Copied -> $DEST"
