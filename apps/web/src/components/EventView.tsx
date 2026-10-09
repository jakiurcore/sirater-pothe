import Link from 'next/link'
import { makeFmt, getMessages, hijriLabel, gregLabel, ageLabel, type Lang } from '@/lib/i18n'
import type { EventPage, MediaItem } from '@/lib/content'
import { Icon } from './icons'
import { MapSync } from './MapStage'
import { EventEnter, NoteField, ReadButton } from './EventBits'

/** One picture: lazy, with reserved space (no layout shift), alt text, optional caption and credit. */
function Pic({ m }: { m: MediaItem }) {
  return (
    <figure className="pic" data-placement={m.placement}>
      <div className="frame" style={m.width && m.height ? { aspectRatio: `${m.width} / ${m.height}` } : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.src} alt={m.alt} width={m.width ?? undefined} height={m.height ?? undefined} loading="lazy" decoding="async" />
      </div>
      {m.caption || m.credit ? (
        <figcaption>
          {m.caption ? <span>{m.caption}</span> : null}
          {m.credit ? <small>{m.credit}</small> : null}
        </figcaption>
      ) : null}
    </figure>
  )
}
const Pics = ({ items, className = '' }: { items: MediaItem[]; className?: string }) =>
  items.length ? <div className={`pics ${className}`.trim()}>{items.map((m) => <Pic key={m.id} m={m} />)}</div> : null

export function EventView({ page, lang, preview }: { page: EventPage; lang: Lang; preview?: { expiresAt: string } }) {
  const f = makeFmt(lang, getMessages(lang))
  const c = page.card
  const idx = f.t('event.idx', { i: page.index, total: page.total })
  const hasBody = page.keyDetails.length > 0 || page.lessons.length > 0 || page.sources.length > 0 || page.media.length > 0
  // Pictures sit exactly where their structured placement says (the same in preview and when published).
  const at = (p: MediaItem['placement']) => page.media.filter((m) => m.placement === p)
  const nKeys = page.keyDetails.length
  // A key-detail index that no longer exists (details were edited) clamps to the last one; with no details at all the picture goes before the lessons.
  const inKeys = (i: number) => at('in_key_details').filter((m) => nKeys > 0 && Math.min(m.afterKeyDetailIndex ?? 0, nKeys - 1) === i)
  const beforeLessons = [...(nKeys === 0 ? at('in_key_details') : []), ...at('before_lessons')]
  return (
    <div className="contents">
      <MapSync data={page.map} />
      <EventEnter id={c.id} track={!preview} />
      <div className="backbar mob-only" style={{ order: 0 }}>
        <Link href={`/${lang}/timeline`}><span aria-hidden="true">‹</span>{f.t('ui.back')}</Link>
        <span>{idx}</span>
      </div>
      <article id="event-article" className="ev" style={{ order: 2 }} lang={page.textLang}>
        <header>
          {preview ? (
            <div className="draftbanner" role="note">
              <b>{f.t('preview.banner')}</b>
              <span>{f.t('preview.text')}</span>
              <span>{f.t('preview.expires', { t: new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : lang, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(preview.expiresAt)) })}</span>
              {c.needsVerification ? <span>{f.t('preview.flagged')}</span> : null}
            </div>
          ) : null}
          {page.textLang !== lang ? <p className="stub">{f.t('event.fallbackLang')}</p> : null}
          <span className="kicker">{f.t('event.kicker', { n: page.eraN, era: page.eraTitle, idx })}</span>
          <h1>{c.title}</h1>
          <dl className="facts">
            <div><dt>{f.t('event.hijri')}</dt><dd>{hijriLabel(f, c.hijriYear)}</dd></div>
            <div><dt>{f.t('event.greg')}</dt><dd>{gregLabel(f, c.gregorianApprox)}</dd></div>
            <div><dt>{f.t('event.age')}</dt><dd>{ageLabel(f, c.prophetAge, c.hijriYear)}</dd></div>
            <div><dt>{f.t('event.place')}</dt><dd>{page.placeLabel ?? '—'}</dd></div>
          </dl>
          {page.certainty === 'agreed' ? (
            <span className="agreed"><Icon d="check" size={14} sw={2.6} />{f.t('event.agreed')}</span>
          ) : (
            <div className="disputed">
              <span className="h">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></svg>
                {f.t('event.disputed')}
              </span>
              {page.disputeNote ? <p>{page.disputeNote}</p> : null}
            </div>
          )}
        </header>

        <Pics items={at('hero')} className="top" />

        {page.ayat.map((a) => (
          <figure key={a.ref} className="verse">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ stroke: 'var(--gold)', strokeWidth: 1.4 }}><rect x="6" y="6" width="12" height="12" /><rect x="6" y="6" width="12" height="12" transform="rotate(45 12 12)" /></svg>
            <p className="ar" lang="ar" dir="rtl">{a.arabic}</p>
            {a.translation ? <p className="tr" lang={lang}>{a.translation}</p> : null}
            <figcaption>
              {f.t('ayah.ref', { s: f.n(a.surah), a: f.n(a.ayah) })}
              {a.translationSource ? <small>{a.translationSource}</small> : null}
            </figcaption>
          </figure>
        ))}

        <section className="sec">
          <h2>{f.t('event.summary')}</h2>
          <p className="sum">{page.summary}</p>
        </section>

        <Pics items={at('after_summary')} />

        {page.keyDetails.length ? (
          <section className="sec">
            <h2>{f.t('event.key')}</h2>
            <ol className="keys">
              {page.keyDetails.flatMap((k, i) => [
                <li key={`k${i}`}><b>{f.n(i + 1)}</b><span>{k}</span></li>,
                ...inKeys(i).map((m) => <li key={m.id} className="keypic"><Pic m={m} /></li>),
              ])}
            </ol>
          </section>
        ) : null}

        <Pics items={beforeLessons} />

        {page.lessons.length ? (
          <section className="sec">
            <h2>{f.t('event.lessons')}</h2>
            <ul className="lessons">{page.lessons.map((l, i) => <li key={i}><i aria-hidden="true" /><span>{l}</span></li>)}</ul>
          </section>
        ) : null}

        {page.hadith.length ? (
          <section className="sec">
            <h2>{f.t('event.hadith')}</h2>
            <ul className="srcs">
              {page.hadith.map((h, i) => (
                <li key={i}><Icon d="book" size={16} /><span>{h.collection} {h.number}<small>{f.t('hadith.grading', { g: h.grading })}{h.gradingBy ? ` ${f.t('hadith.gradingBy', { by: h.gradingBy })}` : ''}</small></span></li>
              ))}
            </ul>
          </section>
        ) : null}

        {page.sources.length ? (
          <section className="sec">
            <h2>{f.t('event.sources')}</h2>
            <ul className="srcs">
              {page.sources.map((s, i) => (
                <li key={i}>
                  <Icon d="book" size={16} />
                  <span>
                    {s.book}{s.author ? ` — ${s.author}` : ''}
                    <small>{[s.volume ? f.t('source.vol', { v: s.volume }) : '', f.t('source.page', { p: s.page }), s.note ?? ''].filter(Boolean).join(' · ')}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {at('gallery').length ? (
          <section className="sec">
            <h2>{f.t('event.gallery')}</h2>
            <Pics items={at('gallery')} className="grid" />
          </section>
        ) : null}

        {!hasBody ? <p className="stub">{f.t('event.stub')}</p> : null}

        <div className="divider" aria-hidden="true" />

        <NoteField id={c.id} />

        <div className="actions">
          <ReadButton id={c.id} />
          <nav className="prevnext" aria-label={f.t('event.nav')}>
            {page.prev ? <Link className="p" href={`/${lang}/events/${page.prev.slug}`}><span>{f.t('event.prev')}</span><b>{page.prev.title}</b></Link> : <span />}
            {page.next ? <Link className="n" href={`/${lang}/events/${page.next.slug}`}><span>{f.t('event.next')}</span><b>{page.next.title}</b></Link> : null}
          </nav>
        </div>
      </article>
    </div>
  )
}
