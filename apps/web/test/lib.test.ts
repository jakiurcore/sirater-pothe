import { describe, expect, it } from 'vitest'
import { makeFmt, getMessages, hijriLabel, gregLabel, ageLabel, isLang } from '@/lib/i18n'
import { smooth, boundsFor, PENINSULA } from '@/lib/map'
import { createStore, type Backend, type ReaderState } from '@/lib/store'
import type { MapData } from '@/lib/content'

const f = makeFmt('bn', getMessages('bn'))

describe('date and age labels (Bangla)', () => {
  it('uses Bengali digits and the before-Hijrah suffix for negative years', () => {
    expect(hijriLabel(f, -53)).toBe('৫৩ হি.পূ.')
    expect(hijriLabel(f, 1)).toBe('১ হি.')
    expect(hijriLabel(f, null)).toBe('—')
    expect(gregLabel(f, 622)).toBe('আনু. ৬২২ খ্রি.')
  })
  it('age: before birth / birth / years', () => {
    expect(ageLabel(f, null, -53)).toBe('জন্মের আগে')
    expect(ageLabel(f, null, 5)).toBe('—')
    expect(ageLabel(f, 0, -53)).toBe('জন্ম')
    expect(ageLabel(f, 40, -13)).toBe('৪০ বছর')
    expect(ageLabel(f, 40, -13, true)).toBe('বয়স ৪০')
  })
  it('validates languages', () => {
    expect(isLang('bn')).toBe(true)
    expect(isLang('xx')).toBe(false)
    expect(isLang('__proto__')).toBe(false)
    expect(isLang('constructor')).toBe(false)
  })
  it('interpolates and falls back to the key for unknown messages', () => {
    expect(f.t('era.readOf', { read: 1, total: 5 })).toBe('১/৫')
    expect(f.t('nope' as never)).toBe('nope')
  })
})

describe('map helpers', () => {
  it('smooth() passes through the original points and adds intermediate ones', () => {
    const pts: [number, number][] = [[39.8, 21.4], [39.5, 22.5], [39.6, 24.4]]
    const s = smooth(pts)
    expect(s.length).toBeGreaterThan(pts.length * 5)
    expect(s[0]).toEqual(pts[0])
    expect(s[s.length - 1]).toEqual(pts[2])
    expect(s.some((p) => Math.hypot(p[0] - pts[1]![0], p[1] - pts[1]![1]) < 0.02)).toBe(true)
    expect(smooth([pts[0]!, pts[1]!])).toEqual([pts[0], pts[1]])
  })
  const base: MapData = { eventId: 'e', markers: [], route: null, label: '' }
  it('boundsFor: peninsula when empty, never tighter than ~0.7° for one place, covers route + markers', () => {
    expect(boundsFor(base)).toEqual(PENINSULA)
    const [[w, s], [e, n]] = boundsFor({ ...base, markers: [{ slug: 'hira', name: 'h', lng: 39.86, lat: 21.46, highlight: true }] })
    expect(e - w).toBeGreaterThanOrEqual(0.7)
    expect(n - s).toBeGreaterThanOrEqual(0.7)
    const b = boundsFor({ ...base, markers: [{ slug: 'a', name: 'a', lng: 39.8, lat: 21.4, highlight: false }], route: { slug: 'r', name: 'r', coordinates: [[39.8, 21.4], [39.6, 24.5]] } })
    expect(b[0][0]).toBeLessThanOrEqual(39.6)
    expect(b[1][1]).toBeGreaterThanOrEqual(24.5)
  })
})

describe('reader store', () => {
  const memory = (opts: { failSave?: boolean; initial?: ReaderState } = {}): Backend & { saved: ReaderState[] } => {
    const saved: ReaderState[] = []
    return {
      saved,
      load: () => opts.initial ?? { read: {}, notes: {}, last: null },
      save: (s) => { if (opts.failSave) return false; saved.push(s); return true },
    }
  }
  it('marks read/unread and keeps notes, persisting every change', () => {
    const b = memory()
    const st = createStore(b)
    let calls = 0
    st.subscribe(() => calls++)
    st.setRead('e1', true)
    expect(Object.keys(st.getSnapshot().read)).toEqual(['e1'])
    st.setNote('e1', 'نوٹ')
    expect(st.getSnapshot().notes.e1?.text).toBe('نوٹ')
    st.setNote('e1', '   ') // blank removes the note
    expect(st.getSnapshot().notes.e1).toBeUndefined()
    st.setRead('e1', false)
    expect(st.getSnapshot().read).toEqual({})
    st.setLast('e2'); st.setLast('e2')
    expect(st.getSnapshot().last).toBe('e2')
    expect(calls).toBe(5) // the repeated setLast did not re-emit
    expect(b.saved.length).toBe(5)
  })
  it('snapshots are stable between changes (required by useSyncExternalStore) and never mutated', () => {
    const st = createStore(memory())
    const a = st.getSnapshot()
    expect(st.getSnapshot()).toBe(a)
    st.setRead('x', true)
    expect(st.getSnapshot()).not.toBe(a)
    expect(a.read).toEqual({})
  })
  it('reports when storage is unavailable but keeps working in memory', () => {
    const st = createStore(memory({ failSave: true }))
    st.setNote('e1', 'draft')
    expect(st.canPersist()).toBe(false)
    expect(st.getSnapshot().notes.e1?.text).toBe('draft')
  })
  it('the server snapshot is empty and constant', () => {
    const st = createStore(memory({ initial: { read: { a: 'x' }, notes: {}, last: 'a' } }))
    expect(st.getServerSnapshot()).toBe(st.getServerSnapshot())
    expect(st.getServerSnapshot().read).toEqual({})
  })
})
