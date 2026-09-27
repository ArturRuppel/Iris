#!/bin/bash
# Rasterise public/iris-favicon.svg into the PNGs the manifest and iOS reference.
#
# The SVG is the source of truth and the PNGs are committed anyway: a home screen
# icon that regenerates differently on a machine with a different rasteriser is a
# worse deal than a few KB in git. (Lifted from switchboard/tools/make-icons.sh,
# which is the same job on the same phone.)
#
# iOS wants apple-touch-icon at 180 and does NOT read the manifest's icons for the
# home screen; Chrome wants 192 and 512 in the manifest. Hence three files.

set -euo pipefail
cd "$(dirname "$0")/.."
SRC=public/iris-favicon.svg
# iOS rounds the home-screen icon itself and paints transparent corners black, so
# the 180 px apple-touch-icon is rendered from a square (rx=0) copy of the SVG.
SQUARE=$(mktemp --suffix=.svg)
trap 'rm -f "$SQUARE"' EXIT
sed 's/ rx="22"//' "$SRC" > "$SQUARE"

for spec in "180:public/apple-touch-icon.png:$SQUARE" \
            "192:public/icon-192.png:$SRC" \
            "512:public/icon-512.png:$SRC"; do
    size=${spec%%:*}
    rest=${spec#*:}
    out=${rest%%:*}
    src=${rest#*:}
    inkscape "$src" --export-type=png --export-filename="$out" \
        --export-width="$size" --export-height="$size" >/dev/null 2>&1
    echo "$out  ${size}x${size}"
done
