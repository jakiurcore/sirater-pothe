/** Where a picture sits inside the event page. Structured only: never put markers inside text fields. */
export const MEDIA_PLACEMENTS = ['hero', 'after_summary', 'in_key_details', 'before_lessons', 'gallery'] as const
export type MediaPlacement = (typeof MEDIA_PLACEMENTS)[number]

/** Structural rule shared by every tool that sets a placement. Existence of the index is checked against the event's key_details. */
export function placementProblem(p: { placement: MediaPlacement; after_key_detail_index?: number | null }, keyDetailCount?: number): string | null {
  const idx = p.after_key_detail_index
  if (p.placement === 'in_key_details') {
    if (idx === undefined || idx === null) return 'placement "in_key_details" needs after_key_detail_index (0-based: 0 = after the first key detail).'
    if (keyDetailCount !== undefined && idx >= keyDetailCount)
      return keyDetailCount === 0
        ? `after_key_detail_index ${idx} does not exist: the event has no key_details yet. Add key_details first (update_event), or use another placement.`
        : `after_key_detail_index ${idx} does not exist: the event has ${keyDetailCount} key detail${keyDetailCount === 1 ? '' : 's'} (valid indexes 0–${keyDetailCount - 1}).`
    return null
  }
  if (idx !== undefined && idx !== null) return `after_key_detail_index only applies to placement "in_key_details" (this one is "${p.placement}"); omit it.`
  return null
}
