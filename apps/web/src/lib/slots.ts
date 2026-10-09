import { slotSort, type ItemKind, type Placement, type SlotCounts } from '@seerah/content/placement'

/** Anything that sits in a slot of the event page: an ayah card or a picture. */
export interface Positioned { kind: ItemKind; placement: Placement; afterIndex: number | null; order: number }

export interface Slots<T> {
  hero: T[]
  afterSummary: T[]
  beforeLessons: T[]
  end: T[]
  gallery: T[]
  /** items to show after summary paragraph / key detail / lesson N */
  inSummary: Map<number, T[]>
  inKeys: Map<number, T[]>
  inLessons: Map<number, T[]>
}

const add = <T>(m: Map<number, T[]>, i: number, x: T) => { const a = m.get(i); if (a) a.push(x); else m.set(i, [x]) }

/**
 * Sorts the page's ayat and pictures into the slots the shared placement model defines (one order, both kinds together).
 * An index that no longer exists (text was edited) does not break the page: the item goes to the END of that section; when the
 * whole section is empty it falls back to the neighbouring fixed slot (in_summary → after_summary, in_key_details → before_lessons,
 * in_lessons → end). Items that really belong to the last element come first, orphans after them.
 */
export function groupSlots<T extends Positioned>(items: T[], counts: SlotCounts): Slots<T> {
  const out: Slots<T> = { hero: [], afterSummary: [], beforeLessons: [], end: [], gallery: [], inSummary: new Map(), inKeys: new Map(), inLessons: new Map() }
  const sorted = [...items].sort(slotSort)
  const orphans: { map: Map<number, T[]>; last: number; x: T }[] = []
  const indexed = (map: Map<number, T[]>, n: number, fallback: T[], x: T) => {
    const i = x.afterIndex ?? 0
    if (n === 0) fallback.push(x)
    else if (i >= n) orphans.push({ map, last: n - 1, x })
    else add(map, i, x)
  }
  for (const x of sorted) {
    switch (x.placement) {
      case 'hero': out.hero.push(x); break
      case 'after_summary': out.afterSummary.push(x); break
      case 'before_lessons': out.beforeLessons.push(x); break
      case 'end': out.end.push(x); break
      case 'gallery': (x.kind === 'media' ? out.gallery : out.end).push(x); break
      case 'in_summary': indexed(out.inSummary, counts.summary, out.afterSummary, x); break
      case 'in_key_details': indexed(out.inKeys, counts.keyDetails, out.beforeLessons, x); break
      case 'in_lessons': indexed(out.inLessons, counts.lessons, out.end, x); break
    }
  }
  for (const o of orphans) add(o.map, o.last, o.x)
  return out
}
