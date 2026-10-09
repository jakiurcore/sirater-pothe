import { DEFAULT_LANG, summaryParagraphs, slotSort, type Placement } from '@seerah/content'
import { placementReview, type EventAggregate } from './data'

const pick = <T extends { lang: string }>(rows: T[], lang: string): T | undefined => rows.find((r) => r.lang === lang) ?? rows.find((r) => r.lang === DEFAULT_LANG) ?? rows[0]
const head = (t: string, n = 80) => { const x = t.replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n).trimEnd() + '…' : x }

export interface LayoutItem { kind: 'ayah' | 'media'; order: number; needs_review?: true; [k: string]: unknown }

/**
 * The event page as numbered slots, with what is already in each of them. This is what an AI reads BEFORE placing an
 * ayah or a picture: choose the paragraph / key detail / lesson the item directly supports.
 */
export function buildLayout(agg: EventAggregate, lang: string) {
  const t = pick(agg.translations, lang)
  const paras = summaryParagraphs(t?.summary ?? '')
  const keys = t?.keyDetails ?? []
  const lessons = t?.lessons ?? []
  const counts = { in_summary: paras.length, in_key_details: keys.length, in_lessons: lessons.length } as Record<string, number>

  const items: (LayoutItem & { placement: Placement; after: number | null })[] = [
    ...agg.ayat.map((a) => {
      const note = pick(agg.ayatNotes.filter((n) => n.ayahId === a.ayahId), lang)
      return { kind: 'ayah' as const, ref: a.ayahId, order: a.orderIndex, ...(note ? { placement_note: note.note } : {}), placement: a.placement as Placement, after: a.afterIndex }
    }),
    ...agg.media.map((m) => {
      const alt = pick(m.alts, lang)
      return { kind: 'media' as const, media_id: m.media.id, image_kind: m.media.kind, alt: alt?.alt ?? null, order: m.media.orderIndex, placement: m.media.placement as Placement, after: m.media.afterIndex }
    }),
  ].sort((a, b) => slotSort({ order: a.order, kind: a.kind }, { order: b.order, kind: b.kind }))

  const strip = ({ placement: _p, after: _a, ...rest }: (typeof items)[number], review = false): LayoutItem => ({ ...rest, ...(review ? { needs_review: true as const } : {}) })
  const slot = (p: Placement) => items.filter((i) => i.placement === p).map((i) => strip(i))
  const FALLBACK: Record<string, Placement> = { in_summary: 'after_summary', in_key_details: 'before_lessons', in_lessons: 'end' }
  const fallbackExtras: Record<string, LayoutItem[]> = { after_summary: [], before_lessons: [], end: [] }

  const indexed = (p: 'in_summary' | 'in_key_details' | 'in_lessons', texts: string[], len: number) =>
    texts.map((text, i) => ({
      after_index: i, text: head(text, len),
      placed_after: items.filter((x) => x.placement === p && (x.after === i || (x.after !== null && x.after >= texts.length && i === texts.length - 1))).map((x) => strip(x, x.after !== i)),
    }))
  for (const p of ['in_summary', 'in_key_details', 'in_lessons'] as const)
    if (counts[p] === 0) for (const x of items.filter((i) => i.placement === p)) fallbackExtras[FALLBACK[p]!]!.push(strip(x, true))

  return {
    event: agg.event.slug, lang: t?.lang ?? lang, text_language: t?.lang ?? null,
    how_to_use: 'Read this before attaching an ayah or a picture. Pick the slot of the paragraph, key detail or lesson the item directly supports: after_index N means "right after element N". Explain the choice to the owner before saving. Do not put everything in one place.',
    page_order: ['hero', 'summary paragraphs (in_summary after N)', 'after_summary', 'key details (in_key_details after N)', 'before_lessons', 'lessons (in_lessons after N)', 'end', 'hadith and sources', 'gallery'],
    slots: {
      hero: slot('hero'),
      summary: indexed('in_summary', paras, 80),
      after_summary: [...slot('after_summary'), ...fallbackExtras.after_summary!],
      key_details: indexed('in_key_details', keys, 80),
      before_lessons: [...slot('before_lessons'), ...fallbackExtras.before_lessons!],
      lessons: indexed('in_lessons', lessons, 80),
      end: [...slot('end'), ...fallbackExtras.end!],
      gallery: slot('gallery'),
    },
    counts: { summary_paragraphs: paras.length, key_details: keys.length, lessons: lessons.length },
    needs_placement_review: placementReview(agg),
  }
}
