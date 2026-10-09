import { cache } from 'react'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { schema as s, type Db } from '@seerah/db'
import { addHonorific } from '@seerah/content/honorific'
import { DEFAULT_LANG, type Lang } from '@seerah/content/langs'
import { effectiveZoom, type EventPlaceRole, type PlaceType } from '@seerah/content/geo'
import { slotCounts, summaryParagraphs, type Placement, type SlotCounts } from '@seerah/content/placement'
import { getDatabase } from './env'

/** "Always render ﷺ after the Prophet's name": enforced again at render time, whatever is stored. */
const hon = (t: string) => addHonorific(t)
const honN = (t: string | null | undefined) => (t ? addHonorific(t) : null)

// ───────── public shapes (serialisable; sent to client components) ─────────
export interface EventCard {
  id: string
  slug: string
  eraId: string
  title: string
  hijriYear: number | null
  gregorianApprox: number | null
  prophetAge: number | null
  place: string | null
  /** Sample content the owner has not verified yet. Only ever true for drafts / previews. */
  needsVerification: boolean
}
export interface EraGroup {
  id: string
  slug: string
  n: number
  title: string
  range: string | null
  events: EventCard[]
}
export interface Timeline {
  eras: EraGroup[]
  /** Flat, in reading order. */
  events: EventCard[]
}
export interface MapMarker { slug: string; name: string; lng: number; lat: number; highlight: boolean; role: EventPlaceRole | 'route' }
/** Fields every positioned item (ayah card or picture) has: see @seerah/content placement. */
export interface Slotted { placement: Placement; afterIndex: number | null; order: number }
export interface MediaItem extends Slotted {
  kind: 'media'
  id: string
  src: string
  /** Responsive copies (webp), smallest first; empty when only the original exists. */
  variants: { w: number; src: string }[]
  alt: string
  caption: string | null
  /** Credit line: the one given with the upload, else built from the Commons author + licence. */
  credit: string | null
  /** Where the picture comes from (Commons page), when known. */
  sourceUrl: string | null
  width: number | null
  height: number | null
}
export interface MapData {
  eventId: string
  markers: MapMarker[]
  route: { slug: string; name: string; coordinates: [number, number][] } | null
  label: string
  /** One place and nothing else to show: the camera flies straight to it at this zoom. */
  focus: { lng: number; lat: number; zoom: number } | null
  /** With several places or a route the camera fits them all, but never closer than this (the primary place's zoom). */
  maxZoom: number | null
}
export interface AyahView extends Slotted { kind: 'ayah'; /** one short sentence above the card (why it is here), in the page language */ note: string | null; ref: string; surah: number; ayah: number; arabic: string; translation: string | null; translationSource: string | null; translationLicense: string | null }
export interface EventPage {
  card: EventCard
  status: 'draft' | 'published' | 'archived'
  eraN: number
  eraTitle: string
  certainty: 'agreed' | 'disputed'
  disputeNote: string | null
  summary: string
  /** The summary split on blank lines (placements can point between paragraphs). */
  summaryParagraphs: string[]
  /** What exists to point at, per section: validates / clamps placements. */
  slotCounts: SlotCounts
  keyDetails: string[]
  lessons: string[]
  ayat: AyahView[]
  hadith: { collection: string; number: string; grading: string; gradingBy: string | null; note: string | null }[]
  sources: { book: string; author: string; edition: string | null; volume: string | null; page: string | null; section: string | null; note: string | null }[]
  map: MapData
  /** Primary first, then related / route places; what the "place" fact shows. */
  placeLabel: string | null
  media: MediaItem[]
  /** Language the text is actually in (differs from the requested one when falling back). */
  textLang: string
  /** Languages with a published translation of this event (for hreflang). */
  translatedLangs: string[]
  index: number
  total: number
  prev: EventCard | null
  next: EventCard | null
}

type TRow = typeof s.eventTranslations.$inferSelect
const pick = <T extends { lang: string; status?: string }>(rows: T[], lang: string, draftOk: boolean): T | undefined => {
  const ok = (r: T) => draftOk || r.status === undefined || r.status === 'published'
  return rows.find((r) => r.lang === lang && ok(r)) ?? rows.find((r) => r.lang === DEFAULT_LANG && ok(r))
}

// ───────── timeline ─────────
export const getTimeline = cache(async (lang: Lang): Promise<Timeline> => {
  const db = await getDatabase()
  return loadTimeline(db, lang)
})

export async function loadTimeline(db: Db, lang: Lang): Promise<Timeline> {
  const [eraRows, eraTr, evRows, primaries] = await Promise.all([
    db.select().from(s.eras).orderBy(asc(s.eras.orderIndex)),
    db.select().from(s.eraTranslations),
    db.select().from(s.events).where(eq(s.events.status, 'published')).orderBy(asc(s.events.orderIndex)),
    db.select({ eventId: s.eventPlaces.eventId, placeId: s.eventPlaces.placeId }).from(s.eventPlaces).innerJoin(s.events, eq(s.events.id, s.eventPlaces.eventId)).where(and(eq(s.events.status, 'published'), eq(s.eventPlaces.role, 'primary'))),
  ])
  const ids = evRows.map((e) => e.id)
  // The primary place of each event; events.place_id is only a fallback for rows written before event_places existed.
  const primaryOf = new Map(primaries.map((p) => [p.eventId, p.placeId]))
  for (const e of evRows) if (!primaryOf.has(e.id) && e.placeId) primaryOf.set(e.id, e.placeId)
  const pids = [...new Set(primaryOf.values())]
  const [tr, pn] = await Promise.all([
    ids.length ? db.select().from(s.eventTranslations).where(inArray(s.eventTranslations.eventId, ids)) : [],
    pids.length ? db.select().from(s.placeTranslations).where(inArray(s.placeTranslations.placeId, pids)) : [],
  ])
  const trBy = groupBy(tr, (t) => t.eventId)
  const pnBy = groupBy(pn, (t) => t.placeId)

  const events: EventCard[] = []
  for (const e of evRows) {
    const t = pick(trBy.get(e.id) ?? [], lang, false)
    if (!t) continue // no published translation in any usable language → not listed
    const pid = primaryOf.get(e.id)
    events.push(card(e, t, pid ? pick(pnBy.get(pid) ?? [], lang, true)?.name ?? null : null))
  }
  const eras: EraGroup[] = eraRows.map((er, i) => {
    const t = pick(eraTr.filter((x) => x.eraId === er.id), lang, true)
    return { id: er.id, slug: er.slug, n: i + 1, title: t?.title ?? er.slug, range: t?.summary ?? null, events: events.filter((e) => e.eraId === er.id) }
  })
  return { eras, events }
}

function card(e: typeof s.events.$inferSelect, t: TRow, place: string | null): EventCard {
  return {
    id: e.id, slug: e.slug, eraId: e.eraId, title: hon(t.title), hijriYear: e.hijriYear, gregorianApprox: e.gregorianApprox,
    prophetAge: e.prophetAge, place: place, needsVerification: e.needsVerification,
  }
}

// ───────── single event ─────────
export interface EventLookup { slug: string; lang: Lang; /** Allow drafts. Only after a preview token has been verified. */ preview?: boolean; /** The verified preview token: picture URLs carry it so drafts' images can load. */ previewToken?: string }

export async function getEventPage({ slug, lang, preview = false, previewToken }: EventLookup): Promise<EventPage | null> {
  const db = await getDatabase()
  const e = await db.query.events.findFirst({ where: eq(s.events.slug, slug) })
  if (!e) return null
  if (!preview && e.status !== 'published') return null

  const [trAll, eraRow, eraTr, timeline, links, routeRow, mediaRows] = await Promise.all([
    db.select().from(s.eventTranslations).where(eq(s.eventTranslations.eventId, e.id)),
    db.query.eras.findFirst({ where: eq(s.eras.id, e.eraId) }),
    db.select().from(s.eraTranslations).where(eq(s.eraTranslations.eraId, e.eraId)),
    getTimeline(lang),
    db.select().from(s.eventPlaces).where(eq(s.eventPlaces.eventId, e.id)).orderBy(asc(s.eventPlaces.orderIndex)),
    e.routeId ? db.query.routes.findFirst({ where: eq(s.routes.id, e.routeId) }) : undefined,
    db.select().from(s.media).where(eq(s.media.eventId, e.id)).orderBy(asc(s.media.orderIndex), asc(s.media.createdAt), asc(s.media.id)),
  ])
  const t = pick(trAll, lang, preview)
  if (!t) return null
  // Backward compatible read: a row written before event_places existed has only events.place_id.
  if (!links.some((l) => l.role === 'primary') && e.placeId) links.unshift({ eventId: e.id, placeId: e.placeId, role: 'primary', orderIndex: 0 })
  const linkedIds = links.map((l) => l.placeId)

  const [linkedPlaces, linkedNames, mediaAlts, routeNames, cites, ayahLinks, hadithLinks, allPlaces] = await Promise.all([
    linkedIds.length ? db.select().from(s.places).where(inArray(s.places.id, linkedIds)) : [],
    linkedIds.length ? db.select().from(s.placeTranslations).where(inArray(s.placeTranslations.placeId, linkedIds)) : [],
    mediaRows.length ? db.select().from(s.mediaAlt).where(inArray(s.mediaAlt.mediaId, mediaRows.map((m) => m.id))) : [],
    routeRow ? db.select().from(s.routeTranslations).where(eq(s.routeTranslations.routeId, routeRow.id)) : [],
    db.select().from(s.eventSources).where(eq(s.eventSources.eventId, e.id)),
    db.select().from(s.eventAyat).where(eq(s.eventAyat.eventId, e.id)).orderBy(asc(s.eventAyat.orderIndex)),
    db.select().from(s.eventHadith).where(eq(s.eventHadith.eventId, e.id)),
    routeRow ? db.select().from(s.places) : [],
  ])
  const evPlaces = links.map((l) => {
    const p = linkedPlaces.find((x) => x.id === l.placeId)
    return p ? { link: l, place: p, name: pick(linkedNames.filter((n) => n.placeId === p.id), lang, true)?.name ?? p.slug } : null
  }).filter((x): x is NonNullable<typeof x> => !!x)
  const primary = evPlaces.find((x) => x.link.role === 'primary') ?? null
  const placeName = primary?.name ?? null
  const byRole = (r: EventPlaceRole) => evPlaces.find((x) => x.link.role === r)
  const placeLabel = byRole('route_start') && byRole('route_end')
    ? `${byRole('route_start')!.name} → ${byRole('route_end')!.name}`
    : evPlaces.length ? evPlaces.map((x) => x.name).join(' · ') : null

  const srcIds = [...new Set(cites.map((c) => c.sourceId))]
  const ayahIds = ayahLinks.map((a) => a.ayahId)
  const hadithIds = hadithLinks.map((h) => h.hadithId)
  const [srcRows, ayahRows, ayahTr, hadithRows, datasets, ayahNotes] = await Promise.all([
    srcIds.length ? db.select().from(s.sources).where(inArray(s.sources.id, srcIds)) : [],
    ayahIds.length ? db.select().from(s.ayat).where(inArray(s.ayat.id, ayahIds)) : [],
    ayahIds.length ? db.select().from(s.ayahTranslations).where(and(inArray(s.ayahTranslations.ayahId, ayahIds), eq(s.ayahTranslations.lang, lang))) : [],
    hadithIds.length ? db.select().from(s.hadithRefs).where(inArray(s.hadithRefs.id, hadithIds)) : [],
    db.select().from(s.contentDatasets),
    db.select().from(s.eventAyatNotes).where(eq(s.eventAyatNotes.eventId, e.id)),
  ])
  const datasetName = new Map(datasets.map((d) => [d.id, d.name]))

  // Map: the primary place (highlighted), related / route places as secondary markers, plus any gazetteer place on the route.
  const markers: MapMarker[] = evPlaces.map((x) => ({ slug: x.place.slug, name: x.name, lng: x.place.lng, lat: x.place.lat, highlight: x.link.role === 'primary', role: x.link.role }))
  let route: MapData['route'] = null
  if (routeRow) {
    const coords = routeRow.geojson.coordinates
    route = { slug: routeRow.slug, name: pick(routeNames, lang, true)?.name ?? routeRow.slug, coordinates: coords }
    const near = allPlaces.filter((p) => coords.some(([lng, lat]) => Math.abs(lng - p.lng) < 0.03 && Math.abs(lat - p.lat) < 0.03) && !markers.some((m) => m.slug === p.slug))
    const names = near.length ? await db.select().from(s.placeTranslations).where(inArray(s.placeTranslations.placeId, near.map((p) => p.id))) : []
    for (const p of near) markers.push({ slug: p.slug, name: pick(names.filter((n) => n.placeId === p.id), lang, true)?.name ?? p.slug, lng: p.lng, lat: p.lat, highlight: false, role: 'route' })
  }
  // Camera: one place and no route → fly to it at its type's zoom (capped where only coarse tiles exist); otherwise fit everything.
  const zoom = primary ? effectiveZoom(primary.place.type as PlaceType, primary.place.zoomOverride, primary.place.lng, primary.place.lat) : null
  const focus = primary && markers.length === 1 && !route ? { lng: primary.place.lng, lat: primary.place.lat, zoom: zoom! } : null

  const withToken = (id: string, w?: number) => `/media/${id}${[previewToken ? `token=${encodeURIComponent(previewToken)}` : '', w ? `w=${w}` : ''].filter(Boolean).map((q, i) => (i ? '&' : '?') + q).join('')}`
  const media: MediaItem[] = mediaRows.map((m) => {
    const alts = mediaAlts.filter((a) => a.mediaId === m.id)
    const a = alts.find((x) => x.lang === lang) ?? alts.find((x) => x.lang === DEFAULT_LANG) ?? alts[0]
    const credit = m.credit ?? (m.author || m.license ? [m.author, m.license, m.sourceUrl?.includes('wikimedia') ? 'via Wikimedia Commons' : null].filter(Boolean).join(', ') : null)
    return {
      kind: 'media', id: m.id, src: withToken(m.id), placement: m.placement, afterIndex: m.afterIndex, order: m.orderIndex,
      variants: Object.keys(m.variants ?? {}).map(Number).sort((x, y) => x - y).map((w) => ({ w, src: withToken(m.id, w) })),
      alt: hon(a?.alt ?? ''), caption: honN(a?.caption), credit, sourceUrl: m.sourceUrl && /^https:\/\/commons\.wikimedia\.org\//.test(m.sourceUrl) ? m.sourceUrl : null, width: m.width, height: m.height,
    }
  })

  const eraT = pick(eraTr, lang, true)
  const eraIdx = timeline.eras.findIndex((x) => x.id === e.eraId)
  const flat = timeline.events
  let index = flat.findIndex((x) => x.id === e.id)
  const inList = index >= 0
  let prev: EventCard | null = null
  let next: EventCard | null = null
  if (inList) {
    prev = flat[index - 1] ?? null
    next = flat[index + 1] ?? null
  } else {
    // A draft in preview mode: find neighbours by order among published events.
    const order = new Map((await db.select({ id: s.events.id, o: s.events.orderIndex }).from(s.events).where(inArray(s.events.id, flat.map((x) => x.id)))).map((r) => [r.id, r.o]))
    const before = flat.filter((x) => (order.get(x.id) ?? 0) < e.orderIndex)
    prev = before[before.length - 1] ?? null
    next = flat.find((x) => (order.get(x.id) ?? 0) > e.orderIndex) ?? null
    index = before.length
  }

  return {
    card: card(e, t, placeName),
    status: e.status,
    eraN: eraIdx >= 0 ? eraIdx + 1 : (eraRow?.orderIndex ?? 0) / 1024,
    eraTitle: eraT?.title ?? eraRow?.slug ?? '',
    certainty: e.certainty,
    disputeNote: honN(t.disputeNote),
    summary: hon(t.summary),
    summaryParagraphs: summaryParagraphs(t.summary).map(hon),
    slotCounts: slotCounts({ summary: t.summary, keyDetails: t.keyDetails, lessons: t.lessons }),
    keyDetails: t.keyDetails.map(hon),
    lessons: t.lessons.map(hon),
    ayat: ayahLinks.map((l) => {
      const a = ayahRows.find((x) => x.id === l.ayahId)
      const tr = ayahTr.find((x) => x.ayahId === l.ayahId)
      const note = ayahNotes.filter((n) => n.ayahId === l.ayahId)
      const n = note.find((x) => x.lang === lang) ?? note.find((x) => x.lang === DEFAULT_LANG) ?? note[0]
      return a ? { kind: 'ayah' as const, placement: l.placement, afterIndex: l.afterIndex, order: l.orderIndex, note: honN(n?.note), ref: `${a.surah}:${a.ayah}`, surah: a.surah, ayah: a.ayah, arabic: a.arabicText, translation: tr?.text ?? null, translationSource: tr ? datasetName.get(tr.translationSource) ?? tr.translationSource : null, translationLicense: tr?.translationLicense ?? null } as AyahView : null
    }).filter((x): x is AyahView => !!x),
    hadith: hadithLinks.map((l) => hadithRows.find((x) => x.id === l.hadithId)).filter((x): x is NonNullable<typeof x> => !!x)
      .map((h) => ({ collection: h.collection, number: h.number, grading: h.grading, gradingBy: h.gradingBy, note: h.note })),
    sources: cites.map((c) => {
      const src = srcRows.find((x) => x.id === c.sourceId)
      return { book: src?.book ?? '', author: src?.author ?? '', edition: src?.edition ?? null, volume: c.volume, page: c.page, section: c.section, note: c.note }
    }),
    map: { eventId: e.id, markers, route, label: markers.map((m) => m.name).join('، '), focus, maxZoom: zoom },
    placeLabel,
    media,
    textLang: t.lang,
    translatedLangs: trAll.filter((x) => x.status === 'published').map((x) => x.lang),
    index: index + 1,
    total: flat.length + (inList ? 0 : 1),
    prev,
    next,
  }
}

function groupBy<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const r of rows) {
    const k = key(r)
    const a = m.get(k)
    if (a) a.push(r)
    else m.set(k, [r])
  }
  return m
}

// ───────── preview tokens ─────────
async function sha256Hex(v: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** True only for a stored, unexpired token issued for exactly this event. The token itself is never stored (SHA-256 only). */
export async function verifyPreviewToken(slug: string, token: string | undefined): Promise<{ ok: true; expiresAt: string } | { ok: false }> {
  if (!token || token.length < 16 || token.length > 200) return { ok: false }
  const db = await getDatabase()
  const row = await db.query.previewTokens.findFirst({ where: eq(s.previewTokens.tokenHash, await sha256Hex(token)) })
  if (!row || row.expiresAt <= new Date().toISOString()) return { ok: false }
  const ev = await db.query.events.findFirst({ where: eq(s.events.id, row.eventId), columns: { slug: true } })
  return ev?.slug === slug ? { ok: true, expiresAt: row.expiresAt } : { ok: false }
}

// ───────── sitemap ─────────
export async function listPublishedSlugs(): Promise<{ slug: string; updatedAt: string; langs: string[] }[]> {
  // `langs` = languages with a published translation of the event
  const db = await getDatabase()
  const rows = await db.select().from(s.events).where(eq(s.events.status, 'published')).orderBy(asc(s.events.orderIndex))
  const tr = rows.length ? await db.select({ id: s.eventTranslations.eventId, lang: s.eventTranslations.lang }).from(s.eventTranslations).where(and(inArray(s.eventTranslations.eventId, rows.map((r) => r.id)), eq(s.eventTranslations.status, 'published'))) : []
  return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt, langs: tr.filter((t) => t.id === r.id).map((t) => t.lang) }))
}

// ───────── recall questions ─────────
export interface RecallIndexItem { id: string; eventId: string }
export interface RecallQuestion extends RecallIndexItem {
  eventSlug: string
  eventTitle: string
  question: string
  answer: string
  distractors: string[]
  lang: string
}

async function publishedQuestions(lang: Lang) {
  const db = await getDatabase()
  const timeline = await getTimeline(lang)
  const ids = timeline.events.map((e) => e.id)
  if (!ids.length) return { timeline, qs: [] as (typeof s.recallQuestions.$inferSelect)[], tr: [] as (typeof s.recallQuestionTranslations.$inferSelect)[] }
  const qs = await db.select().from(s.recallQuestions).where(inArray(s.recallQuestions.eventId, ids)).orderBy(asc(s.recallQuestions.orderIndex))
  const tr = qs.length ? await db.select().from(s.recallQuestionTranslations).where(inArray(s.recallQuestionTranslations.questionId, qs.map((q) => q.id))) : []
  return { timeline, qs, tr }
}

/** Ids only: small enough to ship on every page so the "due" badge can be computed in the browser. */
export const getRecallIndex = cache(async (lang: Lang): Promise<RecallIndexItem[]> => {
  const { qs, tr } = await publishedQuestions(lang)
  return qs.filter((q) => tr.some((t) => t.questionId === q.id && (t.lang === lang || t.lang === DEFAULT_LANG))).map((q) => ({ id: q.id, eventId: q.eventId }))
})

/** Full questions for the review screen (requested language, else the default one). Events must be published. */
export async function getRecallQuestions(lang: Lang): Promise<RecallQuestion[]> {
  const { timeline, qs, tr } = await publishedQuestions(lang)
  const byId = new Map(timeline.events.map((e) => [e.id, e]))
  const out: RecallQuestion[] = []
  for (const q of qs) {
    const t = pick(tr.filter((x) => x.questionId === q.id), lang, true)
    const ev = byId.get(q.eventId)
    if (t && ev) out.push({ id: q.id, eventId: q.eventId, eventSlug: ev.slug, eventTitle: ev.title, question: hon(t.question), answer: hon(t.answer), distractors: t.distractors.map(hon), lang: t.lang })
  }
  return out
}

// ───────── places index (map "other places" layer) ─────────
export interface PlaceIndexItem {
  slug: string
  name: string
  type: PlaceType
  lat: number
  lng: number
  verified: boolean
  /** Published events linked to this place (any role), in timeline order. */
  events: { slug: string; title: string }[]
}

/** Every place with the published events that use it. Names and titles in `lang`, falling back to the default language. */
export async function getPlacesIndex(lang: Lang): Promise<PlaceIndexItem[]> {
  const db = await getDatabase()
  const [places, names, tl, links] = await Promise.all([
    db.select().from(s.places).orderBy(asc(s.places.slug)),
    db.select().from(s.placeTranslations),
    loadTimeline(db, lang),
    db.select({ eventId: s.eventPlaces.eventId, placeId: s.eventPlaces.placeId }).from(s.eventPlaces),
  ])
  const nameBy = groupBy(names, (n) => n.placeId)
  const byEvent = new Map(tl.events.map((e) => [e.id, e]))
  const legacy = await db.select({ id: s.events.id, placeId: s.events.placeId }).from(s.events).where(eq(s.events.status, 'published'))
  const pairs = [...links, ...legacy.filter((e) => e.placeId).map((e) => ({ eventId: e.id, placeId: e.placeId! }))]
  const eventsBy = new Map<string, Map<string, { slug: string; title: string }>>()
  for (const { eventId, placeId } of pairs) {
    const ev = byEvent.get(eventId)
    if (!ev) continue // not published (or no usable translation)
    const m = eventsBy.get(placeId) ?? new Map()
    m.set(ev.slug, { slug: ev.slug, title: ev.title })
    eventsBy.set(placeId, m)
  }
  const order = new Map(tl.events.map((e, i) => [e.slug, i]))
  return places.map((p) => ({
    slug: p.slug,
    name: pick(nameBy.get(p.id) ?? [], lang, true)?.name ?? p.slug,
    type: p.type as PlaceType, lat: p.lat, lng: p.lng, verified: p.verified,
    events: [...(eventsBy.get(p.id)?.values() ?? [])].sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0)),
  }))
}

// ───────── one-time upload page ─────────
export interface UploadInfo {
  ok: true
  eventTitle: string | null
  kind: string
  placement: Placement
  afterIndex: number | null
  alt: string
  expiresAt: string
}

/** What the upload page may show about a token. Every problem (unknown, used, expired, locked) looks the same: `{ ok: false }`. */
export async function getUploadInfo(token: string, lang: Lang, now = Date.now()): Promise<UploadInfo | { ok: false }> {
  if (!/^up_[A-Za-z0-9_-]{20,80}$/.test(token)) return { ok: false }
  const db = await getDatabase()
  const row = await db.query.uploadTokens.findFirst({ where: eq(s.uploadTokens.tokenHash, await sha256Hex(token)) })
  if (!row || row.mode !== 'link' || row.usedAt || Date.parse(row.expiresAt) <= now || row.attempts >= 5) return { ok: false }
  const tr = row.eventId ? await db.select().from(s.eventTranslations).where(eq(s.eventTranslations.eventId, row.eventId)) : []
  const t = tr.find((x) => x.lang === lang) ?? tr.find((x) => x.lang === DEFAULT_LANG) ?? tr[0]
  const alt = row.alt[lang] ?? row.alt[DEFAULT_LANG] ?? Object.values(row.alt)[0] ?? ''
  return { ok: true, eventTitle: t ? hon(t.title) : null, kind: row.kind, placement: row.placement as Placement, afterIndex: row.afterIndex, alt: hon(alt), expiresAt: row.expiresAt }
}
