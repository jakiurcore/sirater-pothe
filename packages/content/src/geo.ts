/** Rough bounding box of the Arabian Peninsula (+ Red Sea coasts, Levant edge for Isra, Yemen). [minLng, minLat, maxLng, maxLat] */
export const ARABIA_BBOX = [34.0, 12.0, 60.0, 33.0] as const

export const inArabiaBBox = (lng: number, lat: number): boolean =>
  lng >= ARABIA_BBOX[0] && lat >= ARABIA_BBOX[1] && lng <= ARABIA_BBOX[2] && lat <= ARABIA_BBOX[3]

// ───────────── place types and map zoom ─────────────
export const PLACE_TYPES = ['region', 'city', 'site'] as const
export type PlaceType = (typeof PLACE_TYPES)[number]
/** Hierarchy for parent_place: a site sits in a city, a city in a region. */
export const PLACE_LEVEL: Record<PlaceType, number> = { region: 0, city: 1, site: 2 }
/** Default camera zoom when the map shows a single place of this type. */
export const DEFAULT_ZOOM: Record<PlaceType, number> = { region: 6, city: 12, site: 17 }
export const MIN_ZOOM_OVERRIDE = 3
export const MAX_ZOOM_OVERRIDE = 19

/** The zoom an owner asked for: the place's own override, else its type's default. */
export const placeZoom = (type: PlaceType, override?: number | null): number => override ?? DEFAULT_ZOOM[type]

export const EVENT_PLACE_ROLES = ['primary', 'related', 'route_start', 'route_end'] as const
export type EventPlaceRole = (typeof EVENT_PLACE_ROLES)[number]

/**
 * Where we ship detailed vector tiles (roads, buildings): extra PMTiles archives next to the peninsula-wide one
 * (which stops at zoom 10). Keep in sync with scripts/build-tiles.sh. [minLng, minLat, maxLng, maxLat]
 */
export const TILE_DETAIL_AREAS = [
  { id: 'makkah', file: 'makkah.pmtiles', bbox: [39.7, 21.3, 40.05, 21.55] as const, maxzoom: 15 },
] as const
export const BASE_TILE_MAXZOOM = 10
/** Vector tiles can be over-zoomed a little before they look broken; this is how far we let the camera go past the data. */
export const OVERZOOM = 2

/** Highest camera zoom that still shows real map data at this point. */
export function maxZoomAt(lng: number, lat: number): number {
  for (const a of TILE_DETAIL_AREAS) if (lng >= a.bbox[0] && lat >= a.bbox[1] && lng <= a.bbox[2] && lat <= a.bbox[3]) return a.maxzoom + OVERZOOM
  return BASE_TILE_MAXZOOM + OVERZOOM
}

/** Requested zoom, lowered to what the tiles can show at that spot. */
export const effectiveZoom = (type: PlaceType, override: number | null | undefined, lng: number, lat: number): number =>
  Math.min(placeZoom(type, override), maxZoomAt(lng, lat))
