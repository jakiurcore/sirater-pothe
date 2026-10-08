import { cache } from 'react'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { schema as s, type Db } from '@seerah/db'
import { addHonorific } from '@seerah/content/honorific'
import { DEFAULT_LANG, type Lang } from '@seerah/content/langs'
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
export interface MapMarker { slug: string; name: string; lng: number; lat: number; highlight: boolean }
export interface MapData {
  eventId: string
  markers: MapMarker[]
  route: { slug: string; name: string; coordinates: [number, number][] } | null
  label: string
}
export interface AyahView { ref: string; surah: number; ayah: number; arabic: string; translation: string | null; translationSource: string | null; translationLicense: string | null }
export interface EventPage {
  card: EventCard
  status: 'draft' | 'published' | 'archived'
  eraN: number
  eraTitle: string
  certainty: 'agreed' | 'disputed'
  disputeNote: string | null
  summary: string
  keyDetails: string[]
  lessons: string[]
  ayat: AyahView[]
  hadith: { collection: string; number: string; grading: string; gradingBy: string | null; note: string | null }[]
  sources: { book: string; author: string; edition: string | null; volume: string | null; page: string; note: string | null }[]
  map: MapData
  /** Language the text is actually in (differs from the requested one when falling back). */
  textLang: string
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
  const [eraRows, eraTr, evRows, placeIds] = await Promise.all([
    db.select().from(s.eras).orderBy(asc(s.eras.orderIndex)),
    db.select().from(s.eraTranslations),
    db.select().from(s.events).where(eq(s.events.status, 'published')).orderBy(asc(s.events.orderIndex)),
    db.select({ id: s.events.placeId }).from(s.events).where(eq(s.events.status, 'published')),
  ])
  const ids = evRows.map((e) => e.id)
  const pids = [...new Set(placeIds.map((p) => p.id).filter((x): x is string => !!x))]
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
    events.push(card(e, t, e.placeId ? pick(pnBy.get(e.placeId) ?? [], lang, true)?.name ?? null : null))
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
export interface EventLookup { slug: string; lang: Lang; /** Allow drafts. Only after a preview token has been verified. */ preview?: boolean }

export async function getEventPage({ slug, lang, preview = false }: EventLookup): Promise<EventPage | null> {
  const db = await getDatabase()
  const e = await db.query.events.findFirst({ where: eq(s.events.slug, slug) })
  if (!e) return null
  if (!preview && e.status !== 'published') return null

  const [trAll, eraRow, eraTr, timeline, placeRow, routeRow] = await Promise.all([
    db.select().from(s.eventTranslations).where(eq(s.eventTranslations.eventId, e.id)),
    db.query.eras.findFirst({ where: eq(s.eras.id, e.eraId) }),
    db.select().from(s.eraTranslations).where(eq(s.eraTranslations.eraId, e.eraId)),
    getTimeline(lang),
    e.placeId ? db.query.places.findFirst({ where: eq(s.places.id, e.placeId) }) : undefined,
    e.routeId ? db.query.routes.findFirst({ where: eq(s.routes.id, e.routeId) }) : undefined,
  ])
  const t = pick(trAll, lang, preview)
  if (!t) return null

  const [placeNames, routeNames, cites, ayahLinks, hadithLinks, allPlaces] = await Promise.all([
    placeRow ? db.select().from(s.placeTranslations).where(eq(s.placeTranslations.placeId, placeRow.id)) : [],
    routeRow ? db.select().from(s.routeTranslations).where(eq(s.routeTranslations.routeId, routeRow.id)) : [],
    db.select().from(s.eventSources).where(eq(s.eventSources.eventId, e.id)),
    db.select().from(s.eventAyat).where(eq(s.eventAyat.eventId, e.id)).orderBy(asc(s.eventAyat.orderIndex)),
    db.select().from(s.eventHadith).where(eq(s.eventHadith.eventId, e.id)),
    routeRow ? db.select().from(s.places) : [],
  ])
  const placeName = placeRow ? pick(placeNames, lang, true)?.name ?? placeRow.slug : null

  const srcIds = [...new Set(cites.map((c) => c.sourceId))]
  const ayahIds = ayahLinks.map((a) => a.ayahId)
  const hadithIds = hadithLinks.map((h) => h.hadithId)
  const [srcRows, ayahRows, ayahTr, hadithRows, datasets] = await Promise.all([
    srcIds.length ? db.select().from(s.sources).where(inArray(s.sources.id, srcIds)) : [],
    ayahIds.length ? db.select().from(s.ayat).where(inArray(s.ayat.id, ayahIds)) : [],
    ayahIds.length ? db.select().from(s.ayahTranslations).where(and(inArray(s.ayahTranslations.ayahId, ayahIds), eq(s.ayahTranslations.lang, lang))) : [],
    hadithIds.length ? db.select().from(s.hadithRefs).where(inArray(s.hadithRefs.id, hadithIds)) : [],
    db.select().from(s.contentDatasets),
  ])
  const datasetName = new Map(datasets.map((d) => [d.id, d.name]))

  // Map: the event's place (highlighted), plus any gazetteer place that sits on the route (e.g. Thawr on the Hijrah path).
  const markers: MapMarker[] = []
  let route: MapData['route'] = null
  if (routeRow) {
    const coords = routeRow.geojson.coordinates
    route = { slug: routeRow.slug, name: pick(routeNames, lang, true)?.name ?? routeRow.slug, coordinates: coords }
    const near = allPlaces.filter((p) => coords.some(([lng, lat]) => Math.abs(lng - p.lng) < 0.03 && Math.abs(lat - p.lat) < 0.03))
    const names = near.length ? await db.select().from(s.placeTranslations).where(inArray(s.placeTranslations.placeId, near.map((p) => p.id))) : []
    for (const p of near) markers.push({ slug: p.slug, name: pick(names.filter((n) => n.placeId === p.id), lang, true)?.name ?? p.slug, lng: p.lng, lat: p.lat, highlight: p.id === placeRow?.id })
  }
  if (placeRow && !markers.some((m) => m.slug === placeRow.slug)) markers.push({ slug: placeRow.slug, name: placeName ?? placeRow.slug, lng: placeRow.lng, lat: placeRow.lat, highlight: true })

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
    keyDetails: t.keyDetails.map(hon),
    lessons: t.lessons.map(hon),
    ayat: ayahLinks.map((l) => {
      const a = ayahRows.find((x) => x.id === l.ayahId)
      const tr = ayahTr.find((x) => x.ayahId === l.ayahId)
      return a ? { ref: `${a.surah}:${a.ayah}`, surah: a.surah, ayah: a.ayah, arabic: a.arabicText, translation: tr?.text ?? null, translationSource: tr ? datasetName.get(tr.translationSource) ?? tr.translationSource : null, translationLicense: tr?.translationLicense ?? null } : null
    }).filter((x): x is AyahView => !!x),
    hadith: hadithLinks.map((l) => hadithRows.find((x) => x.id === l.hadithId)).filter((x): x is NonNullable<typeof x> => !!x)
      .map((h) => ({ collection: h.collection, number: h.number, grading: h.grading, gradingBy: h.gradingBy, note: h.note })),
    sources: cites.map((c) => {
      const src = srcRows.find((x) => x.id === c.sourceId)
      return { book: src?.book ?? '', author: src?.author ?? '', edition: src?.edition ?? null, volume: c.volume, page: c.page, note: c.note }
    }),
    map: { eventId: e.id, markers, route, label: markers.map((m) => m.name).join('، ') },
    textLang: t.lang,
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
  const db = await getDatabase()
  const rows = await db.select().from(s.events).where(eq(s.events.status, 'published')).orderBy(asc(s.events.orderIndex))
  const tr = rows.length ? await db.select({ id: s.eventTranslations.eventId, lang: s.eventTranslations.lang }).from(s.eventTranslations).where(and(inArray(s.eventTranslations.eventId, rows.map((r) => r.id)), eq(s.eventTranslations.status, 'published'))) : []
  return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt, langs: tr.filter((t) => t.id === r.id).map((t) => t.lang) }))
}
