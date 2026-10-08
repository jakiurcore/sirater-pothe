'use client'
import Link from 'next/link'
import { useFmt, useTimeline } from './Providers'
import { useReader } from '@/lib/store'
import { hijriLabel, gregLabel } from '@/lib/i18n'

export function ContinueCard() {
  const f = useFmt()
  const { events, eras } = useTimeline()
  const reader = useReader()
  if (!events.length) return <section className="sect"><p className="stub">{f.t('home.empty')}</p></section>
  const last = reader.last ? events.find((e) => e.id === reader.last) : undefined
  const firstUnread = events.find((e) => !reader.read[e.id])
  const target = last ?? firstUnread ?? events[0]!
  const started = !!last || Object.keys(reader.read).length > 0
  const read = events.filter((e) => reader.read[e.id]).length
  const pct = Math.round((read / events.length) * 100)
  const era = eras.find((e) => e.id === target.eraId)
  return (
    <section className="cont">
      <div className="card">
        <span className="lbl">{started ? f.t('home.resume') : f.t('home.start')}</span>
        <div className="meta">
          {era ? <span className="era">{f.t('era.part', { n: era.n })} · {era.title}</span> : null}
          <h2>{target.title}</h2>
          <span className="sm">{[hijriLabel(f, target.hijriYear), gregLabel(f, target.gregorianApprox), target.place].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="prog">
          <div className="row"><span>{f.t('home.readCount', { n: `${f.n(read)} / ${f.n(events.length)}` })}</span><b>{f.n(pct)}%</b></div>
          <div className="bar"><i style={{ width: `${pct}%` }} /></div>
        </div>
        <Link href={`/${f.lang}/events/${target.slug}`} className="btn">{started ? f.t('home.continue') : f.t('home.startFrom')}<span aria-hidden="true">›</span></Link>
      </div>
    </section>
  )
}

export function EraCards() {
  const f = useFmt()
  const { eras, events } = useTimeline()
  const reader = useReader()
  const shown = eras.filter((e) => e.events.length)
  return (
    <section className="eras">
      <div className="hd"><h2>{f.t('home.eras')}</h2><span>{f.t('home.totalEvents', { n: events.length })}</span></div>
      <ol>
        {shown.map((era) => {
          const read = era.events.filter((e) => reader.read[e.id]).length
          const done = read === era.events.length
          const target = era.events.find((e) => !reader.read[e.id]) ?? era.events[0]!
          return (
            <li key={era.id}>
              <Link href={`/${f.lang}/events/${target.slug}`} className="eracard">
                <span className={`circ${done ? ' done' : ''}`}>{f.n(era.n)}</span>
                <span className="tx">
                  <b>{era.title}</b>
                  <span className="sm">{[era.range, f.t('era.count', { n: era.events.length })].filter(Boolean).join(' · ')}</span>
                  <span className="mini">
                    <span className="b"><i style={{ width: `${Math.round((read / era.events.length) * 100)}%` }} /></span>
                    <span className="r">{f.t('era.readOf', { read: f.n(read), total: f.n(era.events.length) })}</span>
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function AsideHead() {
  const f = useFmt()
  const { events } = useTimeline()
  const reader = useReader()
  const read = events.filter((e) => reader.read[e.id]).length
  const pct = events.length ? Math.round((read / events.length) * 100) : 0
  return (
    <div className="aside-head">
      <h2>{f.t('timeline.title')}</h2>
      <div className="pr"><div className="bar"><i style={{ width: `${pct}%` }} /></div><span>{f.n(pct)}%</span></div>
      <span>{f.t('home.readCount', { n: `${f.n(read)} / ${f.n(events.length)}` })}</span>
    </div>
  )
}

export function TimelineSub() {
  const f = useFmt()
  const { events } = useTimeline()
  const reader = useReader()
  const read = events.filter((e) => reader.read[e.id]).length
  return <span>{f.t('timeline.sub', { read: f.n(read), total: f.n(events.length) })}</span>
}

