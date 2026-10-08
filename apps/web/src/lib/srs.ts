/**
 * Spaced repetition for recall questions. Pure functions, local calendar days ("YYYY-MM-DD") so a schedule never
 * drifts with time zones. Wrong answer → back tomorrow. Right answer → the reader rates how easy it was and the
 * interval grows (SM-2 flavoured). The labels shown on the rating buttons come from the same function that
 * schedules, so they are always truthful.
 */
export interface Card {
  /** next review day */
  due: string
  /** current interval in days */
  interval: number
  ease: number
  reps: number
  lapses: number
}
export type Rating = 'hard' | 'good' | 'easy'

export const MIN_EASE = 1.3
export const MAX_INTERVAL = 365

export const dayKey = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return dayKey(new Date(y, m - 1, d + n))
}
export function daysBetween(a: string, b: string): number {
  const p = (s: string) => { const [y, m, d] = s.split('-').map(Number) as [number, number, number]; return Date.UTC(y, m - 1, d) }
  return Math.round((p(b) - p(a)) / 86400000)
}

export const NEW_INTERVALS: Record<Rating, number> = { hard: 2, good: 5, easy: 12 }

/** Card after a correct answer rated `rating`. */
export function onCorrect(card: Card | undefined, rating: Rating, today: string): Card {
  const c = card ?? { due: today, interval: 0, ease: 2.5, reps: 0, lapses: 0 }
  let interval: number
  if (c.reps === 0) interval = NEW_INTERVALS[rating]
  else if (rating === 'hard') interval = Math.max(c.interval + 1, Math.round(c.interval * 1.2))
  else if (rating === 'good') interval = Math.max(c.interval + 1, Math.round(c.interval * c.ease))
  else interval = Math.max(c.interval + 2, Math.round(c.interval * c.ease * 1.5))
  interval = Math.min(MAX_INTERVAL, interval)
  const ease = Math.max(MIN_EASE, c.ease + (rating === 'hard' ? -0.15 : rating === 'easy' ? 0.15 : 0))
  return { due: addDays(today, interval), interval, ease, reps: c.reps + 1, lapses: c.lapses }
}

/** Card after a wrong answer: it comes back tomorrow and the interval restarts. */
export function onWrong(card: Card | undefined, today: string): Card {
  const c = card ?? { due: today, interval: 0, ease: 2.5, reps: 0, lapses: 0 }
  return { due: addDays(today, 1), interval: 1, ease: Math.max(MIN_EASE, c.ease - 0.2), reps: 0, lapses: c.lapses + 1 }
}

/** Days until the next review for each rating (for the button labels). */
export function previewIntervals(card: Card | undefined, today: string): Record<Rating, number> {
  return {
    hard: daysBetween(today, onCorrect(card, 'hard', today).due),
    good: daysBetween(today, onCorrect(card, 'good', today).due),
    easy: daysBetween(today, onCorrect(card, 'easy', today).due),
  }
}

export const isDue = (card: Card | undefined, today: string): boolean => !card || card.due <= today

export interface QRef { id: string; eventId: string }

/** Questions to review today: only for events the reader has finished; overdue first (most overdue first), then new. */
export function dueQuestions(index: QRef[], read: Record<string, unknown>, srs: Record<string, Card>, today: string): QRef[] {
  const due = index.filter((q) => read[q.eventId] && isDue(srs[q.id], today))
  const overdue = (q: QRef) => (srs[q.id] ? daysBetween(srs[q.id]!.due, today) : -1)
  return due.sort((a, b) => overdue(b) - overdue(a))
}

/** Consecutive days (ending today, or yesterday if today is not done yet) on which a review session was completed. */
export function streak(days: string[], today: string): number {
  const set = new Set(days)
  let day = set.has(today) ? today : addDays(today, -1)
  let n = 0
  while (set.has(day)) { n++; day = addDays(day, -1) }
  return n
}

/** Seeded shuffle so the option order is stable while a question is on screen. */
export function shuffled<T>(items: T[], seed: string): T[] {
  let h = 2166136261
  for (const ch of seed) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619) }
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296 }
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!] }
  return a
}
