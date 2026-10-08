import Link from 'next/link'
import { makeFmt, getMessages, hijriLabel, gregLabel, ageLabel, type Lang } from '@/lib/i18n'
import type { EventPage } from '@/lib/content'
import { Icon } from './icons'
import { MapSync } from './MapStage'
import { EventEnter, NoteField, ReadButton } from './EventBits'

export function EventView({ page, lang, preview }: { page: EventPage; lang: Lang; preview?: { expiresAt: string } }) {
  const f = makeFmt(lang, getMessages(lang))
  const c = page.card
  const idx = f.t('event.idx', { i: page.index, total: page.total })
  const hasBody = page.keyDetails.length > 0 || page.lessons.length > 0 || page.sources.length > 0
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
            <div><dt>{f.t('event.place')}</dt><dd>{c.place ?? '—'}</dd></div>
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

        {page.keyDetails.length ? (
          <section className="sec">
            <h2>{f.t('event.key')}</h2>
            <ol className="keys">{page.keyDetails.map((k, i) => <li key={i}><b>{f.n(i + 1)}</b><span>{k}</span></li>)}</ol>
          </section>
        ) : null}

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
