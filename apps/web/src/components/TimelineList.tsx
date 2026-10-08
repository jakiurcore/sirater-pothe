'use client'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useFmt, useTimeline } from './Providers'
import { Icon } from './icons'
import { useReader } from '@/lib/store'
import { hijriLabel, gregLabel, ageLabel } from '@/lib/i18n'

/** Slug of the event in the current URL (events/<slug> or preview/<slug>), if any. */
export function useCurrentSlug(): string | null {
  const parts = (usePathname() ?? '').split('/')
  return (parts[2] === 'events' || parts[2] === 'preview') && parts[3] ? decodeURIComponent(parts[3]) : null
}

export function TimelineList() {
  const f = useFmt()
  const { eras } = useTimeline()
  const reader = useReader()
  const slug = useCurrentSlug()
  const all = eras.flatMap((e) => e.events)
  const current = slug ? all.find((e) => e.slug === slug)?.id : reader.last
  const root = useRef<HTMLDivElement>(null)
  // Keep the event being read visible in the (desktop) side list when it changes.
  useEffect(() => {
    if (!slug) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    root.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [slug])
  return (
    <div className="tl" ref={root}>
      {eras.filter((e) => e.events.length).map((era) => {
        const read = era.events.filter((e) => reader.read[e.id]).length
        const done = read === era.events.length
        return (
          <section key={era.id}>
            <header>
              <div className="pat" aria-hidden="true" />
              <div className="top">
                <span className={`circ sm${done ? ' done' : ''}`}>{f.n(era.n)}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <h3>{era.title}</h3>
                  {era.range ? <span>{era.range}</span> : null}
                </div>
              </div>
              <div className="pr">
                <div className="b"><i style={{ width: `${Math.round((read / era.events.length) * 100)}%` }} /></div>
                <span>{f.t('era.readSuffix', { read: f.n(read), total: f.n(era.events.length) })}</span>
              </div>
            </header>
            <ol>
              {era.events.map((ev) => {
                const isCur = ev.id === current
                const isRead = !!reader.read[ev.id]
                return (
                  <li key={ev.id}>
                    <span className="rail" aria-hidden="true" />
                    <Link href={`/${f.lang}/events/${ev.slug}`} className={`node${isRead ? ' read' : ''}`} aria-current={isCur ? 'step' : undefined}>
                      <span className="dot">
                        {isRead && !isCur ? <Icon d="check" size={12} sw={3.4} /> : null}
                        {isCur ? <i /> : null}
                      </span>
                      <span className="tx">
                        {isCur ? <span className="now">{f.t('timeline.nowReading')}</span> : null}
                        <span className="ti">{ev.title}</span>
                        <span className="m">
                          <span>{hijriLabel(f, ev.hijriYear)}</span><span aria-hidden="true">·</span>
                          <span>{gregLabel(f, ev.gregorianApprox)}</span><span aria-hidden="true">·</span>
                          <span>{ageLabel(f, ev.prophetAge, ev.hijriYear, true)}</span>
                        </span>
                        {ev.place ? <span className="pl"><Icon d="pin" size={13} sw={2} />{ev.place}</span> : null}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ol>
          </section>
        )
      })}
    </div>
  )
}
