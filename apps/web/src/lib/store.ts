'use client'
/**
 * Reader state (progress, notes, last position). Today it lives in localStorage; the `Backend` interface is the
 * seam for accounts later: implement it against an API and pass it to createStore(). Nothing outside this file
 * touches localStorage for reader data.
 */
import { useSyncExternalStore } from 'react'

export interface ReaderState {
  /** event id → ISO time it was marked read */
  read: Record<string, string>
  /** event id → note */
  notes: Record<string, { text: string; updatedAt: string }>
  /** event id of the last event opened */
  last: string | null
}
export const EMPTY_STATE: ReaderState = Object.freeze({ read: {}, notes: {}, last: null }) as ReaderState

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
  return { read, notes, last: typeof o.last === 'string' ? o.last : null }
}

export function localStorageBackend(): Backend {
  let memory: ReaderState = { read: {}, notes: {}, last: null }
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
