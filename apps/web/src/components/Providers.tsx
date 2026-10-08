'use client'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { makeFmt, type Fmt, type Lang, type Messages } from '@/lib/i18n'
import type { Timeline } from '@/lib/content'

const FmtCtx = createContext<Fmt | null>(null)
const TimelineCtx = createContext<Timeline | null>(null)

export function Providers({ lang, messages, timeline, children }: { lang: Lang; messages: Messages; timeline: Timeline; children: ReactNode }) {
  const fmt = useMemo(() => makeFmt(lang, messages), [lang, messages])
  return (
    <FmtCtx.Provider value={fmt}>
      <TimelineCtx.Provider value={timeline}>{children}</TimelineCtx.Provider>
    </FmtCtx.Provider>
  )
}

export function useFmt(): Fmt {
  const v = useContext(FmtCtx)
  if (!v) throw new Error('useFmt outside <Providers>')
  return v
}
export function useTimeline(): Timeline {
  const v = useContext(TimelineCtx)
  if (!v) throw new Error('useTimeline outside <Providers>')
  return v
}
