'use client'
/**
 * Reader state (progress, notes, last position). Today it lives in localStorage; the `Backend` interface is the
 * seam for accounts later: implement it against an API and pass it to createStore(). Nothing outside this file
 * touches localStorage for reader data.
 */
import { useSyncExternalStore } from 'react'
import type { Card } from './srs'

export interface ReaderState {
  /** event id → ISO time it was marked read */
  read: Record<string, string>
  /** event id → note */
  notes: Record<string, { text: string; updatedAt: string }>
  /** event id of the last event opened */
  last: string | null
  /** recall question id → spaced-repetition card */
  srs: Record<string, Card>
  /** local days ("YYYY-MM-DD") on which a review session was completed */
  reviewDays: string[]
}
export const EMPTY_STATE: ReaderState = Object.freeze({ read: {}, notes: {}, last: null, srs: {}, reviewDays: [] }) as ReaderState

export interface Backend {
  load(): ReaderState
  save(state: ReaderState): boolean
  /** Subscribe to changes made elsewhere (other tabs). */
  watch?(cb: () => void): () => void
}

const KEY = 'seerah:v1:reader'

function sanitize(raw: unknown): ReaderState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReaderState>
  const read: ReaderState['read'] = {}
  for (const [k, v] of Object.entries(o.read ?? {})) if (typeof v === 'string') read[k] = v
  const notes: ReaderState['notes'] = {}
  for (const [k, v] of Object.entries(o.notes ?? {})) if (v && typeof v.text === 'string') notes[k] = { text: v.text, updatedAt: String(v.updatedAt ?? '') }
  const srs: ReaderState['srs'] = {}
  for (const [k, v] of Object.entries(o.srs ?? {})) {
    const c = v as Partial<Card> | null
    if (c && typeof c.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.due) && Number.isFinite(c.interval) && Number.isFinite(c.ease))
      srs[k] = { due: c.due, interval: c.interval!, ease: c.ease!, reps: Number(c.reps) || 0, lapses: Number(c.lapses) || 0 }
  }
  const reviewDays = Array.isArray(o.reviewDays) ? [...new Set(o.reviewDays.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().slice(-400) : []
  return { read, notes, last: typeof o.last === 'string' ? o.last : null, srs, reviewDays }
}

export const parseReaderState = (raw: unknown): ReaderState => sanitize(raw)

export function localStorageBackend(): Backend {
  let memory: ReaderState = EMPTY_STATE
  return {
    load() {
      try {
        const v = window.localStorage.getItem(KEY)
        if (v) memory = sanitize(JSON.parse(v))
      } catch { /* blocked storage or corrupt JSON: keep what we have in memory */ }
      return memory
    },
    save(state) {
      memory = state
      try {
        window.localStorage.setItem(KEY, JSON.stringify(state))
        return true
      } catch {
        return false
      }
    },
    watch(cb) {
      const h = (e: StorageEvent) => { if (e.key === KEY || e.key === null) cb() }
      window.addEventListener('storage', h)
      return () => window.removeEventListener('storage', h)
    },
  }
}

export function createStore(backend: Backend) {
  let state: ReaderState = EMPTY_STATE
  let loaded = false
  let persisted = true
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  const ensure = () => { if (!loaded) { loaded = true; state = backend.load() } }
  const commit = (next: ReaderState) => { state = next; persisted = backend.save(next); emit() }
  let unwatch: (() => void) | undefined

  return {
    subscribe(cb: () => void) {
      listeners.add(cb)
      if (listeners.size === 1) unwatch = backend.watch?.(() => { state = backend.load(); loaded = true; emit() })
      return () => { listeners.delete(cb); if (!listeners.size) { unwatch?.(); unwatch = undefined } }
    },
    getSnapshot(): ReaderState { ensure(); return state },
    getServerSnapshot(): ReaderState { return EMPTY_STATE },
    canPersist: () => persisted,
    setRead(id: string, read: boolean) {
      ensure()
      const r = { ...state.read }
      if (read) r[id] = new Date().toISOString()
      else delete r[id]
      commit({ ...state, read: r })
    },
    setNote(id: string, text: string) {
      ensure()
      const notes = { ...state.notes }
      if (text.trim()) notes[id] = { text, updatedAt: new Date().toISOString() }
      else delete notes[id]
      commit({ ...state, notes })
    },
    setCard(questionId: string, card: Card) {
      ensure()
      commit({ ...state, srs: { ...state.srs, [questionId]: card } })
    },
    markReviewDay(day: string) {
      ensure()
      if (!state.reviewDays.includes(day)) commit({ ...state, reviewDays: [...state.reviewDays, day].sort().slice(-400) })
    },
    /** Replace everything (import of a backup). Input is validated like stored data. */
    replaceAll(raw: unknown) {
      ensure()
      commit(sanitize(raw))
    },
    setLast(id: string) {
      ensure()
      if (state.last !== id) commit({ ...state, last: id })
    },
  }
}

export type Store = ReturnType<typeof createStore>
let singleton: Store | undefined
export const getStore = (): Store => (singleton ??= createStore(typeof window === 'undefined' ? { load: () => EMPTY_STATE, save: () => false } : localStorageBackend()))

export function useReader(): ReaderState {
  const st = getStore()
  return useSyncExternalStore(st.subscribe, st.getSnapshot, st.getServerSnapshot)
}
