'use client'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { makeFmt, type Fmt, type Lang, type Messages } from '@/lib/i18n'
import type { RecallIndexItem, Timeline } from '@/lib/content'
import { useReader } from '@/lib/store'
import { dayKey, dueQuestions, isDue } from '@/lib/srs'
import { useEffect, useState } from 'react'

const FmtCtx = createContext<Fmt | null>(null)
const TimelineCtx = createContext<Timeline | null>(null)
const RecallCtx = createContext<RecallIndexItem[]>([])

export function Providers({ lang, messages, timeline, recall, children }: { lang: Lang; messages: Messages; timeline: Timeline; recall: RecallIndexItem[]; children: ReactNode }) {
  const fmt = useMemo(() => makeFmt(lang, messages), [lang, messages])
  return (
    <FmtCtx.Provider value={fmt}>
      <TimelineCtx.Provider value={timeline}><RecallCtx.Provider value={recall}>{children}</RecallCtx.Provider></TimelineCtx.Provider>
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

export function useRecallIndex(): RecallIndexItem[] {
  return useContext(RecallCtx)
}

/** Local calendar day; null on the server and until mounted (avoids a hydration mismatch around midnight). */
export function useToday(): string | null {
  const [d, setD] = useState<string | null>(null)
  useEffect(() => {
    setD(dayKey())
    const t = setInterval(() => setD(dayKey()), 60_000)
    return () => clearInterval(t)
  }, [])
  return d
}

/** Review status for the badge, the home banner and the review screen. */
export function useDue() {
  const index = useRecallIndex()
  const reader = useReader()
  const today = useToday()
  if (!today) return { today, due: 0, eligible: 0, doneToday: false }
  const eligible = index.filter((q) => reader.read[q.eventId])
  return { today, due: dueQuestions(index, reader.read, reader.srs, today).length, eligible: eligible.length, doneToday: reader.reviewDays.includes(today) && !eligible.some((q) => isDue(reader.srs[q.id], today)) }
}
