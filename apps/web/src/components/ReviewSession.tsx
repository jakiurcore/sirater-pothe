'use client'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useDue, useFmt, useRecallIndex } from './Providers'
import { Icon } from './icons'
import { getStore, useReader } from '@/lib/store'
import { dayKey, daysBetween, dueQuestions, onCorrect, onWrong, previewIntervals, shuffled, streak, type Rating } from '@/lib/srs'
import type { RecallQuestion } from '@/lib/content'

const RATINGS: Rating[] = ['hard', 'good', 'easy']

export function ReviewSession({ questions }: { questions: RecallQuestion[] }) {
  const f = useFmt()
  const index = useRecallIndex()
  const reader = useReader()
  const { today, eligible } = useDue()
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions])

  // The queue is fixed when the session starts, so answering does not reshuffle what is still to come.
  const [queue, setQueue] = useState<string[] | null>(null)
  const [pos, setPos] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [correct, setCorrect] = useState(0)
  const [answered, setAnswered] = useState(0)
  useEffect(() => {
    const st = getStore().getSnapshot()
    setQueue(dueQuestions(index, st.read, st.srs, dayKey()).map((q) => q.id).filter((id) => byId.has(id)))
  }, [index, byId])

  const header = (due: number) => (
    <header className="revhead">
      <div><h1>{f.t('review.title')}</h1><span>{f.t('review.sub')}</span></div>
      <span className="duepill">{f.t('review.dueLeft', { n: due })}</span>
    </header>
  )
  const note = (text: string, withLink = true) => (
    <div className="revbody">
      <p className="stub">{text}</p>
      {withLink ? <Link href={`/${f.lang}/timeline`} className="btn">{f.t('review.goRead')}</Link> : null}
    </div>
  )

  if (queue === null || !today) return <div className="rev">{header(0)}</div>

  const doneState = pos >= queue.length && queue.length > 0
  if (!queue.length && !doneState) {
    const hasQuestions = index.some((q) => reader.read[q.eventId])
    const next = nextDue(index, reader.read, reader.srs, today)
    return (
      <div className="rev">
        {header(0)}
        {eligible === 0 && !hasQuestions
          ? note(Object.keys(reader.read).length ? f.t('review.noQuestions') : f.t('review.noneYet'))
          : (
            <div className="revbody">
              <p className="stub">{f.t('review.nothingDue')}{next ? ` ${f.t('review.nextAt', { when: whenLabel(f, next.days) })}` : ''}</p>
              <StreakLine />
            </div>
          )}
      </div>
    )
  }

  if (doneState) return <Done total={queue.length} correct={correct} header={header(0)} today={today} />

  const q = byId.get(queue[pos]!)!
  const options = shuffled([q.answer, ...q.distractors], q.id + today)
  const letters = Array.from(f.t('review.letters'))
  const right = picked !== null && options[picked] === q.answer
  const card = reader.srs[q.id]
  const intervals = previewIntervals(card, today)

  const advance = () => {
    const last = pos + 1 >= queue.length
    if (last) getStore().markReviewDay(today)
    setPos(pos + 1)
    setPicked(null)
  }
  const pick = (i: number) => {
    if (picked !== null) return
    setPicked(i)
    setAnswered((n) => n + 1)
    if (options[i] === q.answer) setCorrect((n) => n + 1)
    else getStore().setCard(q.id, onWrong(card, today))
  }
  const rate = (r: Rating) => {
    getStore().setCard(q.id, onCorrect(card, r, today))
    advance()
  }

  return (
    <div className="rev">
      {header(queue.length - pos)}
      <div className="revbody">
        <div className="revtop">
          <div className="dots" aria-hidden="true">
            {queue.map((_, i) => <span key={i} style={{ width: i === pos ? 22 : 8, background: i < pos ? 'var(--primary)' : i === pos ? 'var(--gold)' : 'var(--line)' }} />)}
          </div>
          <span>{f.t('review.pos', { i: pos + 1, total: queue.length })}</span>
        </div>
        <div className="qcard" lang={q.lang}>
          <div className="qev"><Link href={`/${f.lang}/events/${q.eventSlug}`}>{q.eventTitle}</Link></div>
          <h2>{q.question}</h2>
          <div className="opts" role="group" aria-label={q.question}>
            {options.map((o, i) => {
              const state = picked === null ? '' : o === q.answer ? 'ok' : i === picked ? 'bad' : 'dim'
              return (
                <button key={i} type="button" className={`opt ${state}`} disabled={picked !== null} onClick={() => pick(i)} aria-pressed={picked === i}>
                  <span className="lt">{letters[i] ?? i + 1}</span>
                  <span>{o}</span>
                  <span className="mk" aria-hidden="true">{state === 'ok' ? '✓' : state === 'bad' ? '✕' : ''}</span>
                </button>
              )
            })}
          </div>
          {picked !== null ? (
            <div className="fb" role="status">
              <p className="fbt" style={{ color: right ? 'var(--primary-strong)' : 'var(--wrong)' }}>{right ? f.t('review.correct') : f.t('review.wrongAnswer', { a: q.answer })}</p>
              <span className="hint">{right ? f.t('review.rateHint') : f.t('review.wrongHint')}</span>
              <div className="rates">
                {right
                  ? RATINGS.map((r) => (
                    <button key={r} type="button" onClick={() => rate(r)}><b>{f.t(`review.${r}` as 'review.hard')}</b><span>{f.t('review.inDays', { n: intervals[r] })}</span></button>
                  ))
                  : <button type="button" onClick={advance}><b>{f.t('review.next')}</b><span>{f.t('review.tomorrow')}</span></button>}
              </div>
            </div>
          ) : null}
        </div>
        <p className="revfoot">{f.t('review.footer')}</p>
      </div>
    </div>
  )
}

function whenLabel(f: ReturnType<typeof useFmt>, days: number) {
  return days <= 1 ? f.t('review.tomorrowWhen') : f.t('review.inDays', { n: days })
}

/** Soonest scheduled review among questions of events that have been read. */
function nextDue(index: { id: string; eventId: string }[], read: Record<string, unknown>, srs: Record<string, { due: string }>, today: string) {
  let best: number | null = null
  for (const q of index) {
    const c = srs[q.id]
    if (!read[q.eventId] || !c) continue
    const d = daysBetween(today, c.due)
    if (d > 0 && (best === null || d < best)) best = d
  }
  return best === null ? null : { days: best }
}

function StreakLine() {
  const f = useFmt()
  const r = useReader()
  const today = dayKey()
  const n = streak(r.reviewDays, today)
  return n > 0 ? <span className="streak">{f.t('review.streak', { n })}</span> : null
}

function Done({ total, correct, header, today }: { total: number; correct: number; header: React.ReactNode; today: string }) {
  const f = useFmt()
  const index = useRecallIndex()
  const r = useReader()
  const next = nextDue(index, r.read, r.srs, today)
  return (
    <div className="rev">
      {header}
      <div className="revbody">
        <div className="donecard">
          <div className="pat" aria-hidden="true" />
          <span className="tick"><Icon d="check" size={26} sw={2.2} /></span>
          <h2>{f.t('review.doneTitle')}</h2>
          <p>{f.t('review.result', { n: correct, total })}{next ? ` ${f.t('review.nextAt', { when: whenLabel(f, next.days) })}` : ''}</p>
          <span className="streak">{f.t('review.streak', { n: streak(r.reviewDays, today) })}</span>
        </div>
        <Link href={`/${f.lang}/timeline`} className="ghost">{f.t('review.goRead')}</Link>
      </div>
    </div>
  )
}
