import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, dayKey, dueQuestions, isDue, onCorrect, onWrong, previewIntervals, shuffled, streak, type Card } from '@/lib/srs'
import { parseReaderState, createStore, EMPTY_STATE } from '@/lib/store'

const T = '2026-10-08'

describe('day helpers', () => {
  it('addDays crosses month/year/leap boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('daysBetween ignores DST (uses calendar days)', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-10-24', '2026-11-02')).toBe(9)
    expect(daysBetween(T, T)).toBe(0)
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('scheduling', () => {
  it('new card: hard/good/easy = 2/5/12 days', () => {
    expect(previewIntervals(undefined, T)).toEqual({ hard: 2, good: 5, easy: 12 })
    expect(onCorrect(undefined, 'good', T)).toMatchObject({ due: '2026-10-13', interval: 5, reps: 1, lapses: 0 })
  })
  it('a wrong answer comes back tomorrow, resets reps, lowers ease (not below 1.3), counts a lapse', () => {
    const c: Card = { due: T, interval: 30, ease: 1.4, reps: 4, lapses: 1 }
    expect(onWrong(c, T)).toEqual({ due: '2026-10-09', interval: 1, ease: 1.3, reps: 0, lapses: 2 })
    expect(onWrong(undefined, T).due).toBe('2026-10-09')
  })
  it('intervals grow with repetition and are ordered hard < good < easy, always moving forward', () => {
    let c = onCorrect(undefined, 'good', T)
    for (let i = 0; i < 4; i++) {
      const p = previewIntervals(c, c.due)
      expect(p.hard).toBeGreaterThanOrEqual(c.interval + 1)
      expect(p.hard).toBeLessThanOrEqual(p.good)
      expect(p.good).toBeLessThan(p.easy)
      c = onCorrect(c, 'good', c.due)
    }
    expect(c.interval).toBeGreaterThan(30)
  })
  it('caps the interval at a year and keeps ease within bounds', () => {
    let c: Card = { due: T, interval: 300, ease: 3, reps: 9, lapses: 0 }
    c = onCorrect(c, 'easy', T)
    expect(c.interval).toBe(365)
    let h = onCorrect(onCorrect(undefined, 'hard', T), 'hard', T)
    for (let i = 0; i < 30; i++) h = onCorrect(h, 'hard', T)
    expect(h.ease).toBeGreaterThanOrEqual(1.3)
  })
})

describe('due list', () => {
  const index = [{ id: 'q1', eventId: 'e1' }, { id: 'q2', eventId: 'e1' }, { id: 'q3', eventId: 'e2' }]
  it('only questions of read events; new and overdue are due; future is not; most overdue first', () => {
    const read = { e1: 'x' }
    const srs: Record<string, Card> = { q1: { due: '2026-10-01', interval: 3, ease: 2.5, reps: 1, lapses: 0 }, q2: { due: '2026-10-20', interval: 3, ease: 2.5, reps: 1, lapses: 0 } }
    expect(dueQuestions(index, read, srs, T).map((q) => q.id)).toEqual(['q1'])
    expect(dueQuestions(index, { e1: 'x', e2: 'x' }, srs, T).map((q) => q.id)).toEqual(['q1', 'q3'])
    expect(dueQuestions(index, {}, srs, T)).toEqual([])
    expect(isDue(srs.q1, T)).toBe(true)
    expect(isDue(srs.q2, T)).toBe(false)
  })
})

describe('streak', () => {
  it('counts consecutive days; today not done yet does not break yesterday’s streak', () => {
    expect(streak([], T)).toBe(0)
    expect(streak(['2026-10-08', '2026-10-07', '2026-10-06'], T)).toBe(3)
    expect(streak(['2026-10-07', '2026-10-06'], T)).toBe(2)
    expect(streak(['2026-10-06'], T)).toBe(0)
    expect(streak(['2026-10-08', '2026-10-06'], T)).toBe(1)
  })
})

describe('shuffle', () => {
  it('is deterministic per seed, a permutation, and differs across seeds', () => {
    const a = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(shuffled(a, 'x')).toEqual(shuffled(a, 'x'))
    expect([...shuffled(a, 'x')].sort()).toEqual(a)
    expect(new Set(['1', '2', '3', '4', '5', '6'].map((s) => shuffled(a, s).join(''))).size).toBeGreaterThan(1)
    expect(a).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })
})

describe('stored state is validated', () => {
  it('drops malformed cards, days, notes and wrong types; keeps good ones', () => {
    const s = parseReaderState({
      read: { e1: '2026-10-01', e2: 5 },
      notes: { e1: { text: 'x', updatedAt: 't' }, e2: { text: 3 } },
      last: 7,
      srs: { q1: { due: '2026-10-09', interval: 2, ease: 2.5, reps: 1, lapses: 0 }, q2: { due: 'tomorrow', interval: 2, ease: 2.5 }, q3: null, q4: { due: '2026-10-09', interval: 'x', ease: 2 } },
      reviewDays: ['2026-10-08', 'bad', 3, '2026-10-08'],
    })
    expect(Object.keys(s.read)).toEqual(['e1'])
    expect(Object.keys(s.notes)).toEqual(['e1'])
    expect(s.last).toBeNull()
    expect(Object.keys(s.srs)).toEqual(['q1'])
    expect(s.reviewDays).toEqual(['2026-10-08'])
    expect(parseReaderState('garbage')).toEqual(EMPTY_STATE)
    expect(parseReaderState(null)).toEqual(EMPTY_STATE)
  })
  it('store keeps cards and review days and replaceAll validates', () => {
    const st = createStore({ load: () => EMPTY_STATE, save: () => true })
    st.setCard('q1', onCorrect(undefined, 'good', T))
    st.markReviewDay(T); st.markReviewDay(T)
    expect(st.getSnapshot().srs.q1?.interval).toBe(5)
    expect(st.getSnapshot().reviewDays).toEqual([T])
    st.replaceAll({ read: { z: 'x' }, srs: { q: { due: 'nope' } } })
    expect(Object.keys(st.getSnapshot().read)).toEqual(['z'])
    expect(st.getSnapshot().srs).toEqual({})
  })
})
