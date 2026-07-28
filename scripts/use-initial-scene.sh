#!/usr/bin/env bash
# Copy the local authored Ottawa scene into the public path expected by Phase 1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/public/images/initial-scene.png"

if [[ $# -ge 1 ]]; then
	SRC="$1"
elif [[ -f "$ROOT/public/images/Initial Scene.png" ]]; then
	SRC="$ROOT/public/images/Initial Scene.png"
elif [[ -f "$ROOT/Initial Scene.png" ]]; then
	SRC="$ROOT/Initial Scene.png"
else
	echo "Missing source image. Expected one of:" >&2
	echo "  public/images/Initial Scene.png" >&2
	echo "  ./Initial Scene.png" >&2
	echo "Usage: scripts/use-initial-scene.sh [path-to-Initial-Scene.png]" >&2
	exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp "$SRC" "$DEST"
echo "Copied $SRC -> $DEST"
