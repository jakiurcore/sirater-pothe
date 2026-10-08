#!/usr/bin/env bash
# Extracts the Arabian Peninsula (zoom 0-10, ~34 MB) from a Protomaps daily build into apps/web/tiles/arabia.pmtiles.
# Needs the `pmtiles` CLI: https://github.com/protomaps/go-pmtiles/releases
# Usage: scripts/build-tiles.sh [YYYYMMDD]   (default: yesterday, UTC)
# Upload:  pnpm --filter @seerah/web exec wrangler r2 object put seerah-tiles/arabia.pmtiles --file tiles/arabia.pmtiles --remote
# Licence: OpenStreetMap data (ODbL). The map shows the attribution; keep it.
set -euo pipefail
DAY="${1:-$(date -u -d yesterday +%Y%m%d)}"
OUT="$(dirname "$0")/../apps/web/tiles/arabia.pmtiles"
mkdir -p "$(dirname "$OUT")"
pmtiles extract "https://build.protomaps.com/${DAY}.pmtiles" "$OUT" --bbox=34,12,60,33 --maxzoom=10
ls -lh "$OUT"
