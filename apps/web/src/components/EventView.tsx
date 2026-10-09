import Link from 'next/link'
import { makeFmt, getMessages, hijriLabel, gregLabel, ageLabel, type Lang } from '@/lib/i18n'
import { Fragment } from 'react'
import type { AyahView, EventPage, MediaItem } from '@/lib/content'
import { groupSlots } from '@/lib/slots'
import { Icon } from './icons'
import { MapSync } from './MapStage'
import { EventEnter, NoteField, ReadButton } from './EventBits'

/** One picture: lazy, responsive (srcset), with reserved space (no layout shift), alt text, optional caption, credit and source link. */
function Pic({ m }: { m: MediaItem }) {
  const srcSet = m.variants.length ? [...m.variants.map((v) => `${v.src} ${v.w}w`), ...(m.width && m.width > m.variants.at(-1)!.w ? [`${m.src} ${m.width}w`] : [])].join(', ') : undefined
  return (
    <figure className="pic" data-placement={m.placement}>
      <div className="frame" style={m.width && m.height ? { aspectRatio: `${m.width} / ${m.height}` } : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.variants.length ? m.variants.find((v) => v.w >= 960)?.src ?? m.src : m.src} srcSet={srcSet} sizes={srcSet ? '(max-width: 720px) calc(100vw - 40px), 680px' : undefined} alt={m.alt} width={m.width ?? undefined} height={m.height ?? undefined} loading="lazy" decoding="async" />
      </div>
      {m.caption || m.credit ? (
        <figcaption>
          {m.caption ? <span>{m.caption}</span> : null}
          {m.credit ? <small>{m.sourceUrl ? <a href={m.sourceUrl} target="_blank" rel="noopener noreferrer">{m.credit}</a> : m.credit}</small> : null}
        </figcaption>
      ) : null}
    </figure>
  )
}

/** An ayah card in the design's style: Arabic (RTL, Amiri), translation, surah:ayah reference, and optionally one small context line above it. */
function AyahCard({ a, lang, f }: { a: AyahView; lang: Lang; f: ReturnType<typeof makeFmt> }) {
  return (
    <div className="ayahwrap" data-placement={a.placement} data-ref={a.ref}>
      {a.note ? <p className="ayahnote" lang={lang}>{a.note}</p> : null}
      <figure className="verse">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ stroke: 'var(--gold)', strokeWidth: 1.4 }}><rect x="6" y="6" width="12" height="12" /><rect x="6" y="6" width="12" height="12" transform="rotate(45 12 12)" /></svg>
        <p className="ar" lang="ar" dir="rtl">{a.arabic}</p>
        {a.translation ? <p className="tr" lang={lang}>{a.translation}</p> : null}
        <figcaption>
          {f.t('ayah.ref', { s: f.n(a.surah), a: f.n(a.ayah) })}
          {a.translationSource ? <small>{a.translationSource}</small> : null}
        </figcaption>
      </figure>
    </div>
  )
}

type Item = AyahView | MediaItem
const Items = ({ items, lang, f, className = '' }: { items: Item[] | undefined; lang: Lang; f: ReturnType<typeof makeFmt>; className?: string }) =>
  items?.length ? <div className={`pics ${className}`.trim()}>{items.map((x) => (x.kind === 'ayah' ? <AyahCard key={`a${x.ref}`} a={x} lang={lang} f={f} /> : <Pic key={x.id} m={x} />))}</div> : null

export function EventView({ page, lang, preview }: { page: EventPage; lang: Lang; preview?: { expiresAt: string } }) {
  const f = makeFmt(lang, getMessages(lang))
  const c = page.card
  const idx = f.t('event.idx', { i: page.index, total: page.total })
  // Only the facts the event has. With no date at all (e.g. a lineage event) one "no specific date" cell replaces three dashes.
  const dates: [string, string, string | null][] = [
    ['hijri', f.t('event.hijri'), hijriLabel(f, c.hijriYear)],
    ['greg', f.t('event.greg'), gregLabel(f, c.gregorianApprox)],
    ['age', f.t('event.age'), ageLabel(f, c.prophetAge, c.hijriYear)],
  ]
  const have = dates.filter((d): d is [string, string, string] => d[2] !== null)
  const facts: [string, string, string][] = [
    ...(have.length ? have : [['when', f.t('event.when'), f.t('event.noDate')] as [string, string, string]]),
    ...(page.placeLabel ? [['place', f.t('event.place'), page.placeLabel] as [string, string, string]] : []),
  ]
  const hasBody = page.keyDetails.length > 0 || page.lessons.length > 0 || page.sources.length > 0 || page.media.length > 0 || page.ayat.length > 0
  // Ayat and pictures share ONE placement model: sort them into the page's slots together (see lib/slots).
  const slots = groupSlots<Item>([...page.ayat, ...page.media], page.slotCounts)
  const paras = page.summaryParagraphs.length ? page.summaryParagraphs : [page.summary]
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
          {facts.length ? (
            <dl className="facts">
              {facts.map(([k, label, value]) => <div key={k}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          ) : null}
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

        <Items items={slots.hero} lang={lang} f={f} className="top" />

        <section className="sec">
          <h2>{f.t('event.summary')}</h2>
          {paras.map((p, i) => (
            <Fragment key={i}>
              <p className="sum">{p}</p>
              <Items items={slots.inSummary.get(i)} lang={lang} f={f} />
            </Fragment>
          ))}
        </section>

        <Items items={slots.afterSummary} lang={lang} f={f} />

        {page.keyDetails.length ? (
          <section className="sec">
            <h2>{f.t('event.key')}</h2>
            <ol className="keys">
              {page.keyDetails.flatMap((k, i) => [
                <li key={`k${i}`}><b>{f.n(i + 1)}</b><span>{k}</span></li>,
                ...(slots.inKeys.get(i)?.length ? [<li key={`kp${i}`} className="keypic"><Items items={slots.inKeys.get(i)} lang={lang} f={f} /></li>] : []),
              ])}
            </ol>
          </section>
        ) : null}

        <Items items={slots.beforeLessons} lang={lang} f={f} />

        {page.lessons.length ? (
          <section className="sec">
            <h2>{f.t('event.lessons')}</h2>
            <ul className="lessons">
              {page.lessons.flatMap((l, i) => [
                <li key={`l${i}`}><i aria-hidden="true" /><span>{l}</span></li>,
                ...(slots.inLessons.get(i)?.length ? [<li key={`lp${i}`} className="keypic lessonpic"><Items items={slots.inLessons.get(i)} lang={lang} f={f} /></li>] : []),
              ])}
            </ul>
          </section>
        ) : null}

        <Items items={slots.end} lang={lang} f={f} />

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

        {slots.gallery.length ? (
          <section className="sec">
            <h2>{f.t('event.gallery')}</h2>
            <Items items={slots.gallery} lang={lang} f={f} className="grid" />
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
