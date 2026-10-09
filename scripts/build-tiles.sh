#!/usr/bin/env bash
# Extracts map tiles from a Protomaps daily build into apps/web/tiles/:
#   arabia.pmtiles  the Arabian Peninsula, zoom 0-10 (~34 MB)
#   makkah.pmtiles  Makkah core, zoom 0-15 (~4 MB): streets and buildings so sites (Kaaba, Zamzam) have surroundings
# The detail areas must match TILE_DETAIL_AREAS in packages/content/src/geo.ts (bbox + maxzoom).
# Needs the `pmtiles` CLI: https://github.com/protomaps/go-pmtiles/releases
# Usage: scripts/build-tiles.sh [YYYYMMDD]   (default: 3 days ago, UTC; the newest builds can be missing)
# Upload:  cd apps/web && for f in arabia makkah; do pnpm exec wrangler r2 object put seerah-tiles/$f.pmtiles --file tiles/$f.pmtiles --remote; done
# Licence: OpenStreetMap data (ODbL). The map shows the attribution; keep it.
set -euo pipefail
DAY="${1:-$(date -u -d '3 days ago' +%Y%m%d)}"
DIR="$(dirname "$0")/../apps/web/tiles"
SRC="https://build.protomaps.com/${DAY}.pmtiles"
mkdir -p "$DIR"
pmtiles extract "$SRC" "$DIR/arabia.pmtiles" --bbox=34,12,60,33 --maxzoom=10
pmtiles extract "$SRC" "$DIR/makkah.pmtiles" --bbox=39.7,21.3,40.05,21.55 --maxzoom=15
ls -lh "$DIR"/*.pmtiles
