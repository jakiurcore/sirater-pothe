'use client'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { useFmt, useTimeline, useToday } from './Providers'
import { getStore, useReader } from '@/lib/store'
import { addDays, streak } from '@/lib/srs'

const NUM_LOCALE: Record<string, string> = { bn: 'bn-BD', ar: 'ar-EG' }

export function ProgressView() {
  const f = useFmt()
  const { eras, events } = useTimeline()
  const reader = useReader()
  const today = useToday()
  const loc = NUM_LOCALE[f.lang] ?? f.lang

  const read = events.filter((e) => reader.read[e.id]).length
  const pct = events.length ? Math.round((read / events.length) * 100) : 0
  const shown = eras.filter((e) => e.events.length)
  const erasDone = shown.filter((e) => e.events.every((x) => reader.read[x.id])).length
  const byId = new Map(events.map((e) => [e.id, e]))
  const notes = Object.entries(reader.notes)
    .filter(([id]) => byId.has(id))
    .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
  const days = today ? Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)) : []
  const wd = new Intl.DateTimeFormat(loc, { weekday: 'narrow' })
  const fmtDay = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long' })
  const parse = (d: string) => { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return new Date(y, m - 1, dd) }

  return (
    <div className="prog-page">
      <header className="pphead"><h1>{f.t('progress.title')}</h1></header>
      <section className="sect">
        <div className="ringcard">
          <div className="ring" style={{ background: `conic-gradient(var(--gold) ${pct * 3.6}deg, var(--line) 0)` }}>
            <div><b>{f.pct(pct)}</b><span>{f.t('progress.complete')}</span></div>
          </div>
          <div className="rtx">
            <b>{f.t('home.readCount', { n: `${f.n(read)} / ${f.n(events.length)}` })}</b>
            <span>{f.t('progress.erasDone', { done: erasDone, total: shown.length })}</span>
            <span>{f.t('progress.notesCount', { n: notes.length })}</span>
          </div>
        </div>
      </section>
      <section className="sect">
        <div className="card" style={{ gap: 14, padding: '16px 18px' }}>
          <div className="strk"><span>{f.t('progress.streak')}</span><b>{f.t('progress.days', { n: today ? streak(reader.reviewDays, today) : 0 })}</b></div>
          <div className="week">
            {days.map((d, i) => {
              const done = reader.reviewDays.includes(d)
              const isToday = i === 6
              return (
                <div key={d}>
                  <span className={`wd${done ? ' done' : ''}${isToday && !done ? ' today' : ''}`}>{done ? '✓' : ''}</span>
                  <span className="wl" style={{ color: isToday ? 'var(--ink)' : undefined }}>{wd.format(parse(d))}</span>
                </div>
              )
            })}
          </div>
        </div>
      </section>
      <section className="sect lst">
        <h2>{f.t('progress.byEra')}</h2>
        <div className="card" style={{ gap: 0, padding: '6px 18px' }}>
          {shown.map((era) => {
            const r = era.events.filter((e) => reader.read[e.id]).length
            return (
              <div key={era.id} className="erarow">
                <div><span>{f.n(era.n)}. {era.title}</span><span>{f.t('era.readOf', { read: f.n(r), total: f.n(era.events.length) })}</span></div>
                <div className="bar" style={{ height: 5 }}><i style={{ width: `${Math.round((r / era.events.length) * 100)}%` }} /></div>
              </div>
            )
          })}
        </div>
      </section>
      <section className="sect lst">
        <h2>{f.t('progress.notes')}</h2>
        {notes.length ? notes.map(([id, n]) => {
          const ev = byId.get(id)!
          return (
            <Link key={id} href={`/${f.lang}/events/${ev.slug}`} className="notecard">
              <span><b>{ev.title}</b><span>{n.updatedAt ? fmtDay.format(new Date(n.updatedAt)) : ''}</span></span>
              <span className="nt">{n.text}</span>
            </Link>
          )
        }) : <p className="stub">{f.t('progress.noNotes')}</p>}
      </section>
      <BackupSection />
    </div>
  )
}

function BackupSection() {
  const f = useFmt()
  const file = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const exportData = () => {
    const blob = new Blob([JSON.stringify({ app: 'seerah', version: 1, exportedAt: new Date().toISOString(), data: getStore().getSnapshot() }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `seerah-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const importData = async (fl: File | undefined) => {
    if (!fl) return
    try {
      if (fl.size > 5_000_000) throw new Error('too large')
      const j = JSON.parse(await fl.text())
      if (j?.app !== 'seerah' || typeof j.data !== 'object') throw new Error('not a backup')
      getStore().replaceAll(j.data)
      setMsg(f.t('progress.importOk'))
    } catch {
      setMsg(f.t('progress.importBad'))
    }
    if (file.current) file.current.value = ''
  }
  return (
    <section className="sect lst" style={{ paddingBottom: 28 }}>
      <h2>{f.t('progress.data')}</h2>
      <p className="stub">{f.t('progress.dataNote')}</p>
      <div className="backup">
        <button type="button" className="ghost" onClick={exportData}>{f.t('progress.export')}</button>
        <button type="button" className="ghost" onClick={() => file.current?.click()}>{f.t('progress.import')}</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void importData(e.target.files?.[0])} data-testid="import" />
      </div>
      {msg ? <p role="status" className="stub">{msg}</p> : null}
    </section>
  )
}
