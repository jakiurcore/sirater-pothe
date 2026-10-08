/** Rough bounding box of the Arabian Peninsula (+ Red Sea coasts, Levant edge for Isra, Yemen). [minLng, minLat, maxLng, maxLat] */
export const ARABIA_BBOX = [34.0, 12.0, 60.0, 33.0] as const

export const inArabiaBBox = (lng: number, lat: number): boolean =>
  lng >= ARABIA_BBOX[0] && lat >= ARABIA_BBOX[1] && lng <= ARABIA_BBOX[2] && lat <= ARABIA_BBOX[3]
