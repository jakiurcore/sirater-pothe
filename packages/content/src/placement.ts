/**
 * ONE placement model for everything that is positioned inside an event page: pictures (media) and ayat.
 * Both render into the same slots, so an ayah and a picture can share a slot and are sorted by `order`.
 * Structured only: never put markers inside text fields.
 *
 *   hero            right under the title block, before the summary
 *   in_summary      between summary paragraphs: after paragraph `after_index` (0-based)
 *   after_summary   after the whole summary
 *   in_key_details  after key detail `after_index` (0-based)
 *   in_lessons      after lesson `after_index` (0-based)
 *   before_lessons  after the key details, before the lessons
 *   end             after the lessons, before hadith / sources
 *   gallery         a grid at the very end (pictures only)
 */
export const PLACEMENTS = ['hero', 'in_summary', 'after_summary', 'in_key_details', 'in_lessons', 'before_lessons', 'end', 'gallery'] as const
export type Placement = (typeof PLACEMENTS)[number]
/** The placements that need `after_index`. */
export const INDEXED_PLACEMENTS = ['in_summary', 'in_key_details', 'in_lessons'] as const satisfies readonly Placement[]
export type ItemKind = 'ayah' | 'media'

/** Backward compatible names (pictures used a subset of these before ayat shared the model). */
export const MEDIA_PLACEMENTS = PLACEMENTS
export type MediaPlacement = Placement

export const SECTION_OF: Record<(typeof INDEXED_PLACEMENTS)[number], 'summary' | 'keyDetails' | 'lessons'> = {
  in_summary: 'summary', in_key_details: 'keyDetails', in_lessons: 'lessons',
}
const SECTION_NOUN = { summary: 'summary paragraph', keyDetails: 'key detail', lessons: 'lesson' } as const
const SECTION_FIELD = { summary: 'summary', keyDetails: 'key_details', lessons: 'lessons' } as const

/** What exists in the event text of one language: the slots an index can point at. */
export interface SlotCounts { summary: number; keyDetails: number; lessons: number }

/** The summary is stored as one string; blank lines separate paragraphs. */
export const summaryParagraphs = (summary: string): string[] => summary.split(/\r?\n[ \t]*\r?\n/).map((p) => p.trim()).filter(Boolean)

export const slotCounts = (t: { summary?: string | null; keyDetails?: readonly string[] | null; lessons?: readonly string[] | null }): SlotCounts => ({
  summary: summaryParagraphs(t.summary ?? '').length, keyDetails: t.keyDetails?.length ?? 0, lessons: t.lessons?.length ?? 0,
})

export interface PlacementInput { placement: Placement; after_index?: number | null }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The rule every tool shares. Structure first (which placements take an index, which are for pictures only), then,
 * when `counts` is given, that the index exists in the text. The message always says what IS valid.
 */
export function placementProblem(p: PlacementInput, kind: ItemKind, counts?: SlotCounts): string | null {
  const idx = p.after_index
  if (p.placement === 'gallery' && kind === 'ayah') return 'placement "gallery" is for pictures only; place an ayah in hero, in_summary, after_summary, in_key_details, in_lessons, before_lessons or end.'
  if ((INDEXED_PLACEMENTS as readonly string[]).includes(p.placement)) {
    const section = SECTION_OF[p.placement as (typeof INDEXED_PLACEMENTS)[number]]
    if (idx === undefined || idx === null) return `placement "${p.placement}" needs after_index (0-based: 0 = after the first ${SECTION_NOUN[section]}).`
    if (!Number.isInteger(idx) || idx < 0) return 'after_index must be a whole number, 0 or more.'
    if (counts) {
      const n = counts[section]
      if (idx >= n)
        return n === 0
          ? `after_index ${idx} does not exist: the event has no ${SECTION_FIELD[section]} yet. Add them first (update_event), or choose another placement.`
          : `after_index ${idx} does not exist in ${SECTION_FIELD[section]}: the event has ${plural(n, SECTION_NOUN[section])} (valid after_index 0–${n - 1}).`
    }
    return null
  }
  if (idx !== undefined && idx !== null) return `after_index only applies to in_summary, in_key_details and in_lessons (this one is "${p.placement}"); omit it.`
  return null
}

/** For an item already stored: does its index still point at something? (Text may have been edited since.) */
export function placementNeedsReview(p: PlacementInput, counts: SlotCounts): { section: string; count: number; after_index: number } | null {
  if (!(INDEXED_PLACEMENTS as readonly string[]).includes(p.placement) || p.after_index === null || p.after_index === undefined) return null
  const section = SECTION_OF[p.placement as (typeof INDEXED_PLACEMENTS)[number]]
  return p.after_index >= counts[section] ? { section: SECTION_FIELD[section], count: counts[section], after_index: p.after_index } : null
}

/** Sort key inside one slot: lowest `order` first; at equal order pictures come before ayat (stable, matches the old page). */
export const slotSort = <T extends { order: number; kind: ItemKind }>(a: T, b: T) => a.order - b.order || (a.kind === b.kind ? 0 : a.kind === 'media' ? -1 : 1)
