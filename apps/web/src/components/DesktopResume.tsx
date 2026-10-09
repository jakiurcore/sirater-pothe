'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useFmt, useTimeline } from './Providers'
import { useReader } from '@/lib/store'

/** On wide screens the timeline is the left column, so /timeline opens the event you were reading. */
export function DesktopResume() {
  const f = useFmt()
  const { events } = useTimeline()
  const reader = useReader()
  const router = useRouter()
  const target = (reader.last && events.find((e) => e.id === reader.last)) || events.find((e) => !reader.read[e.id]) || events[0]
  useEffect(() => {
    if (target && matchMedia('(min-width: 900px) and (min-height: 520px)').matches) router.replace(`/${f.lang}/events/${target.slug}`)
  }, [target?.slug]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="split-empty desk-only" style={{ justifyContent: 'center' }}>{f.t('timeline.pick')}</div>
}
