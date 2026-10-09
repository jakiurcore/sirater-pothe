import { describe, expect, it } from 'vitest'
import { groupSlots, type Positioned } from '@/lib/slots'

type It = Positioned & { id: string }
const it_ = (id: string, kind: 'ayah' | 'media', placement: Positioned['placement'], afterIndex: number | null = null, order = 0): It => ({ id, kind, placement, afterIndex, order })
const ids = (a: It[] | undefined) => (a ?? []).map((x) => x.id)
const counts = { summary: 3, keyDetails: 3, lessons: 2 }

describe('groupSlots: ayat and pictures in the same slots', () => {
  it('puts every placement in its slot, mixed kinds sorted by order, pictures first at equal order', () => {
    const g = groupSlots([
      it_('a-hero', 'ayah', 'hero', null, 1000), it_('m-hero', 'media', 'hero', null, 0),
      it_('a-s1', 'ayah', 'in_summary', 1, 1), it_('m-s1', 'media', 'in_summary', 1, 0), it_('m-s1b', 'media', 'in_summary', 1, 1),
      it_('a-after', 'ayah', 'after_summary'), it_('m-k0', 'media', 'in_key_details', 0), it_('a-k0', 'ayah', 'in_key_details', 0),
      it_('a-bl', 'ayah', 'before_lessons'), it_('m-l1', 'media', 'in_lessons', 1), it_('a-end', 'ayah', 'end'), it_('m-gal', 'media', 'gallery'),
    ], counts)
    expect(ids(g.hero)).toEqual(['m-hero', 'a-hero'])
    expect(ids(g.inSummary.get(1))).toEqual(['m-s1', 'm-s1b', 'a-s1']) // order 0, then order 1 where the picture comes before the ayah
    expect(ids(g.afterSummary)).toEqual(['a-after'])
    expect(ids(g.inKeys.get(0))).toEqual(['m-k0', 'a-k0'])
    expect(ids(g.beforeLessons)).toEqual(['a-bl'])
    expect(ids(g.inLessons.get(1))).toEqual(['m-l1'])
    expect(ids(g.end)).toEqual(['a-end'])
    expect(ids(g.gallery)).toEqual(['m-gal'])
  })
  it('an index that no longer exists moves the item to the END of that section, after the items that belong there', () => {
    const g = groupSlots([it_('real-last', 'media', 'in_key_details', 2, 5), it_('orphan', 'ayah', 'in_key_details', 9, 0), it_('orphan-sum', 'ayah', 'in_summary', 3), it_('orphan-les', 'media', 'in_lessons', 2)], counts)
    expect(ids(g.inKeys.get(2))).toEqual(['real-last', 'orphan'])
    expect(ids(g.inSummary.get(2))).toEqual(['orphan-sum'])
    expect(ids(g.inLessons.get(1))).toEqual(['orphan-les'])
    expect(g.inKeys.has(9)).toBe(false)
  })
  it('an emptied section falls back to the neighbouring fixed slot, so nothing disappears', () => {
    const g = groupSlots([it_('s', 'ayah', 'in_summary', 0), it_('k', 'media', 'in_key_details', 1), it_('l', 'ayah', 'in_lessons', 0)], { summary: 0, keyDetails: 0, lessons: 0 })
    expect(ids(g.afterSummary)).toEqual(['s'])
    expect(ids(g.beforeLessons)).toEqual(['k'])
    expect(ids(g.end)).toEqual(['l'])
    const total = [g.hero, g.afterSummary, g.beforeLessons, g.end, g.gallery].flat().length
    expect(total).toBe(3)
  })
  it('an ayah can never end up in the gallery (it goes to the end slot)', () => {
    expect(ids(groupSlots([it_('x', 'ayah', 'gallery')], counts).end)).toEqual(['x'])
  })
  it('does not mutate its input and keeps every item exactly once', () => {
    const items = [it_('b', 'media', 'end', null, 2), it_('a', 'ayah', 'end', null, 1)]
    const copy = [...items]
    const g = groupSlots(items, counts)
    expect(items).toEqual(copy)
    expect(ids(g.end)).toEqual(['a', 'b'])
  })
})
