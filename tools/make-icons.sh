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

for spec in "180:public/apple-touch-icon.png" \
            "192:public/icon-192.png" \
            "512:public/icon-512.png"; do
    size=${spec%%:*}
    out=${spec#*:}
    inkscape "$SRC" --export-type=png --export-filename="$out" \
        --export-width="$size" --export-height="$size" >/dev/null 2>&1
    echo "$out  ${size}x${size}"
done
