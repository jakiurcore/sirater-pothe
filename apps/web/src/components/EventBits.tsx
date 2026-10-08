'use client'
import { useEffect, useRef, useState } from 'react'
import { useFmt } from './Providers'
import { Icon } from './icons'
import { getStore, useReader } from '@/lib/store'

/** Remembers the last event opened (for "continue") and resets scroll to the top of the reading pane. */
export function EventEnter({ id, track }: { id: string; track: boolean }) {
  useEffect(() => {
    if (track) getStore().setLast(id)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    let el: HTMLElement | null = document.getElementById('event-article')
    while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement
    if (el && el !== document.documentElement && el !== document.body) el.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
  }, [id, track])
  return null
}

export function ReadButton({ id }: { id: string }) {
  const f = useFmt()
  const isRead = !!useReader().read[id]
  const toggle = () => getStore().setRead(id, !isRead)
  return isRead ? (
    <button type="button" className="readbtn done" onClick={toggle}>
      <Icon d="check" size={18} sw={2.4} />{f.t('read.done')}<small>{f.t('read.undo')}</small>
    </button>
  ) : (
    <button type="button" className="readbtn" onClick={toggle}>
      <Icon d="check" size={18} sw={2.4} />{f.t('read.mark')}
    </button>
  )
}

export function NoteField({ id }: { id: string }) {
  const f = useFmt()
  const stored = useReader().notes[id]
  const [text, setText] = useState(stored?.text ?? '')
  const [dirty, setDirty] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef(text)
  latest.current = text

  // Pick up the stored note once it has loaded (the server render has no access to localStorage).
  useEffect(() => { if (!dirty) setText(stored?.text ?? '') }, [stored?.text, dirty])
  const flush = () => { clearTimeout(timer.current); if (dirty) { getStore().setNote(id, latest.current); setDirty(false) } }
  useEffect(() => () => { clearTimeout(timer.current); if (dirtyRef.current) getStore().setNote(id, latest.current) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  const onChange = (v: string) => {
    setText(v); setDirty(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { getStore().setNote(id, v); setDirty(false) }, 400)
  }
  const persisted = getStore().canPersist()
  const status = !persisted ? f.t('note.noStorage') : text.trim() ? f.t('note.saved') : f.t('note.hint')
  return (
    <section className="note">
      <div className="hd"><h2>{f.t('note.title')}</h2><span>{f.t('note.private')}</span></div>
      <label htmlFor={`note-${id}`}>{f.t('note.prompt')}</label>
      <textarea id={`note-${id}`} value={text} rows={5} placeholder={f.t('note.placeholder')} onChange={(e) => onChange(e.target.value)} onBlur={flush} />
      <span className="st" role="status"><Icon d="check" size={13} sw={2.2} />{status}</span>
    </section>
  )
}
