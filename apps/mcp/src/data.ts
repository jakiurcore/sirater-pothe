import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@seerah/db'
import { schema as s } from '@seerah/db'
import { DEFAULT_LANG, locatorProblem, publishBlockers, publishWarnings, placeZoom, placementNeedsReview, slotCounts, type EventPlaceRole, type PlaceType, type SlotCounts } from '@seerah/content'
import { ToolError, nowIso, uuid } from './util'
import type { Actor } from './env'

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect']
export type BatchStmt = Parameters<Db['batch']>[0][number]

export interface EventAggregate {
  event: Row<typeof s.events>
  translations: Row<typeof s.eventTranslations>[]
  sources: Row<typeof s.eventSources>[]
  ayat: Row<typeof s.eventAyat>[]
  /** One short sentence per language above an ayah card. */
  ayatNotes: Row<typeof s.eventAyatNotes>[]
  hadith: Row<typeof s.eventHadith>[]
  /** The hadith references behind `hadith` (collection + number), used by the publish gate. */
  hadithRefs?: Row<typeof s.hadithRefs>[]
  people: Row<typeof s.eventPeople>[]
  recall: { question: Row<typeof s.recallQuestions>; translations: Row<typeof s.recallQuestionTranslations>[] }[]
  /** event_places rows: exactly one `primary` once publishable. */
  places: Row<typeof s.eventPlaces>[]
  /** Pictures attached to the event, with their alt text / captions. */
  media: { media: Row<typeof s.media>; alts: Row<typeof s.mediaAlt>[] }[]
}

export type Entity = 'event' | 'place' | 'route' | 'source'

// ───────────── lookups (all throw ToolError with fixable messages) ─────────────
export async function eventBySlug(db: Db, slug: string) {
  const e = await db.query.events.findFirst({ where: eq(s.events.slug, slug) })
  if (!e) {
    const near = await db.select({ slug: s.events.slug }).from(s.events).limit(15)
    throw new ToolError(`No event with slug "${slug}". Existing slugs: ${near.map((n) => n.slug).join(', ') || '(none yet)'}. Use search_events to find it.`)
  }
  return e
}

export async function eraBySlug(db: Db, slug: string) {
  const e = await db.query.eras.findFirst({ where: eq(s.eras.slug, slug) })
  if (!e) {
    const all = await db.select({ slug: s.eras.slug }).from(s.eras).orderBy(asc(s.eras.orderIndex))
    throw new ToolError(`No era with slug "${slug}". Available eras: ${all.map((x) => x.slug).join(', ') || '(none; the database has not been seeded)'}.`)
  }
  return e
}

export async function placeBySlug(db: Db, slug: string) {
  const p = await db.query.places.findFirst({ where: eq(s.places.slug, slug) })
  if (!p) throw new ToolError(`No place with slug "${slug}". Use find_place to search, or create_place to add it.`)
  return p
}

export async function routeBySlug(db: Db, slug: string) {
  const r = await db.query.routes.findFirst({ where: eq(s.routes.slug, slug) })
  if (!r) throw new ToolError(`No route with slug "${slug}". Use create_route first.`)
  return r
}

export async function sourceBySlug(db: Db, slug: string) {
  const r = await db.query.sources.findFirst({ where: eq(s.sources.slug, slug) })
  if (!r) throw new ToolError(`No source with slug "${slug}". Use create_source first.`)
  return r
}

// ───────────── aggregates ─────────────
export async function loadEventAggregate(db: Db, eventId: string): Promise<EventAggregate | null> {
  const event = await db.query.events.findFirst({ where: eq(s.events.id, eventId) })
  if (!event) return null
  const [translations, sources, ayat, ayatNotes, hadith, people, qs, places, mediaRows] = await Promise.all([
    db.select().from(s.eventTranslations).where(eq(s.eventTranslations.eventId, eventId)).orderBy(asc(s.eventTranslations.lang)),
    db.select().from(s.eventSources).where(eq(s.eventSources.eventId, eventId)).orderBy(asc(s.eventSources.id)),
    db.select().from(s.eventAyat).where(eq(s.eventAyat.eventId, eventId)).orderBy(asc(s.eventAyat.orderIndex), asc(s.eventAyat.ayahId)),
    db.select().from(s.eventAyatNotes).where(eq(s.eventAyatNotes.eventId, eventId)),
    db.select().from(s.eventHadith).where(eq(s.eventHadith.eventId, eventId)),
    db.select().from(s.eventPeople).where(eq(s.eventPeople.eventId, eventId)),
    db.select().from(s.recallQuestions).where(eq(s.recallQuestions.eventId, eventId)).orderBy(asc(s.recallQuestions.orderIndex)),
    db.select().from(s.eventPlaces).where(eq(s.eventPlaces.eventId, eventId)).orderBy(asc(s.eventPlaces.orderIndex), asc(s.eventPlaces.placeId)),
    db.select().from(s.media).where(eq(s.media.eventId, eventId)).orderBy(asc(s.media.orderIndex), asc(s.media.createdAt), asc(s.media.id)),
  ])
  const hadithRefs = hadith.length ? await db.select().from(s.hadithRefs).where(inArray(s.hadithRefs.id, hadith.map((h) => h.hadithId))) : []
  const alts = mediaRows.length ? await db.select().from(s.mediaAlt).where(inArray(s.mediaAlt.mediaId, mediaRows.map((m) => m.id))) : []
  const qt = qs.length
    ? await db.select().from(s.recallQuestionTranslations).where(inArray(s.recallQuestionTranslations.questionId, qs.map((q) => q.id)))
    : []
  return {
    event, translations, sources, ayat, ayatNotes, hadith, hadithRefs, people, places,
    media: mediaRows.map((m) => ({ media: m, alts: alts.filter((a) => a.mediaId === m.id) })),
    recall: qs.map((question) => ({ question, translations: qt.filter((t) => t.questionId === question.id) })),
  }
}

/** Statements that make the DB match `snap` for this event (child rows replaced wholesale). */
export function restoreEventStatements(db: Db, snap: EventAggregate, recreate = false): BatchStmt[] {
  const id = snap.event.id
  const st: BatchStmt[] = [
    recreate
      ? db.insert(s.events).values({ ...snap.event, updatedAt: nowIso() }) // the event was deleted (delete_draft): bring the row back
      : db.update(s.events).set({ ...snap.event, updatedAt: nowIso() }).where(eq(s.events.id, id)),
    db.delete(s.eventTranslations).where(eq(s.eventTranslations.eventId, id)),
    db.delete(s.eventSources).where(eq(s.eventSources.eventId, id)),
    db.delete(s.eventAyatNotes).where(eq(s.eventAyatNotes.eventId, id)),
    db.delete(s.eventAyat).where(eq(s.eventAyat.eventId, id)),
    db.delete(s.eventHadith).where(eq(s.eventHadith.eventId, id)),
    db.delete(s.eventPeople).where(eq(s.eventPeople.eventId, id)),
    db.delete(s.recallQuestions).where(eq(s.recallQuestions.eventId, id)),
  ]
  // Snapshots taken before event_places / media placement existed have no `places` / `media`: leave those untouched.
  if (snap.places !== undefined) {
    st.push(db.delete(s.eventPlaces).where(eq(s.eventPlaces.eventId, id)))
    if (snap.places.length) st.push(db.insert(s.eventPlaces).values(snap.places))
  }
  if (snap.media !== undefined) {
    st.push(db.delete(s.media).where(eq(s.media.eventId, id))) // media_alt cascades
    for (const m of snap.media) {
      st.push(db.insert(s.media).values(m.media))
      if (m.alts.length) st.push(db.insert(s.mediaAlt).values(m.alts))
    }
  }
  if (snap.translations.length) st.push(db.insert(s.eventTranslations).values(snap.translations))
  if (snap.sources.length) st.push(db.insert(s.eventSources).values(snap.sources))
  if (snap.ayat.length) st.push(db.insert(s.eventAyat).values(snap.ayat))
  if (snap.ayatNotes?.length) st.push(db.insert(s.eventAyatNotes).values(snap.ayatNotes)) // snapshots from before placement notes have none
  if (snap.hadith.length) st.push(db.insert(s.eventHadith).values(snap.hadith))
  if (snap.people.length) st.push(db.insert(s.eventPeople).values(snap.people))
  for (const q of snap.recall) {
    st.push(db.insert(s.recallQuestions).values(q.question))
    if (q.translations.length) st.push(db.insert(s.recallQuestionTranslations).values(q.translations))
  }
  return st
}

// ───────────── other entity snapshots ─────────────
export async function loadSnapshot(db: Db, entity: Entity, id: string): Promise<unknown | null> {
  switch (entity) {
    case 'event': return loadEventAggregate(db, id)
    case 'place': {
      const place = await db.query.places.findFirst({ where: eq(s.places.id, id) })
      if (!place) return null
      return { place, translations: await db.select().from(s.placeTranslations).where(eq(s.placeTranslations.placeId, id)) }
    }
    case 'route': {
      const route = await db.query.routes.findFirst({ where: eq(s.routes.id, id) })
      if (!route) return null
      return { route, translations: await db.select().from(s.routeTranslations).where(eq(s.routeTranslations.routeId, id)) }
    }
    case 'source': return (await db.query.sources.findFirst({ where: eq(s.sources.id, id) })) ?? null
  }
}

export function restoreStatements(db: Db, entity: Entity, snap: any): BatchStmt[] {
  switch (entity) {
    case 'event': return restoreEventStatements(db, snap)
    case 'place': return [
      db.update(s.places).set(snap.place).where(eq(s.places.id, snap.place.id)),
      db.delete(s.placeTranslations).where(eq(s.placeTranslations.placeId, snap.place.id)),
      ...(snap.translations.length ? [db.insert(s.placeTranslations).values(snap.translations)] : []),
    ]
    case 'route': return [
      db.update(s.routes).set(snap.route).where(eq(s.routes.id, snap.route.id)),
      db.delete(s.routeTranslations).where(eq(s.routeTranslations.routeId, snap.route.id)),
      ...(snap.translations.length ? [db.insert(s.routeTranslations).values(snap.translations)] : []),
    ]
    case 'source': return [db.update(s.sources).set(snap).where(eq(s.sources.id, snap.id))]
  }
}

// ───────────── revisions ─────────────
/**
 * Runs `build` (the change statements) in one D1 batch together with a revision row whose `before`
 * is captured first. `after` is filled in straight afterwards (informational; revert only needs `before`).
 */
export async function withRevision(
  db: Db,
  actor: Actor,
  opts: { entity: Entity; entityId: string; action: string; build: () => BatchStmt[] },
): Promise<{ revisionId: string }> {
  const before = await loadSnapshot(db, opts.entity, opts.entityId)
  const revisionId = uuid()
  const changes = opts.build()
  await db.batch([
    ...changes,
    db.insert(s.revisions).values({
      id: revisionId, entity: opts.entity, entityId: opts.entityId, action: opts.action,
      beforeJson: before, afterJson: null, actor: actor.login,
    }),
  ] as unknown as [BatchStmt, ...BatchStmt[]])
  const after = await loadSnapshot(db, opts.entity, opts.entityId)
  await db.update(s.revisions).set({ afterJson: after }).where(eq(s.revisions.id, revisionId))
  return { revisionId }
}

export const touch = (db: Db, eventId: string): BatchStmt =>
  db.update(s.events).set({ updatedAt: nowIso() }).where(eq(s.events.id, eventId))

// ───────────── views ─────────────
const pickLang = <T extends { lang: string }>(rows: T[], lang: string): T | undefined =>
  rows.find((r) => r.lang === lang) ?? rows.find((r) => r.lang === DEFAULT_LANG) ?? rows[0]

export type PlaceLink = { placeId: string; role: EventPlaceRole; orderIndex: number }

/** Statements that make an event's places exactly `links` (and keep the deprecated events.place_id mirror in step). */
export function placeLinkStatements(db: Db, eventId: string, links: PlaceLink[]): BatchStmt[] {
  const primary = links.find((l) => l.role === 'primary')
  return [
    db.delete(s.eventPlaces).where(eq(s.eventPlaces.eventId, eventId)),
    ...(links.length ? [db.insert(s.eventPlaces).values(links.map((l) => ({ eventId, ...l })))] : []),
    db.update(s.events).set({ placeId: primary?.placeId ?? null, updatedAt: nowIso() }).where(eq(s.events.id, eventId)),
  ]
}

const renumber = (links: PlaceLink[]): PlaceLink[] => links.map((l, i) => ({ ...l, orderIndex: i }))

/** `placeId` becomes THE primary; the previous primary is kept as a related place. Pure (unit-tested). */
export function planSetPrimary(current: PlaceLink[], placeId: string): PlaceLink[] {
  const rest = current.filter((l) => l.placeId !== placeId).map((l) => (l.role === 'primary' ? { ...l, role: 'related' as const } : l))
  return renumber([{ placeId, role: 'primary', orderIndex: 0 }, ...rest.sort((x, y) => x.orderIndex - y.orderIndex)])
}

/** Adds a non-primary link. Throws ToolError with a fixable message. Pure. */
export function planAddPlace(current: PlaceLink[], placeId: string, role: Exclude<EventPlaceRole, 'primary'>, order?: number): PlaceLink[] {
  const have = current.find((l) => l.placeId === placeId)
  if (have) throw new ToolError(`That place is already linked as "${have.role}". ${have.role === 'primary' ? 'Use set_primary_place to change the primary.' : 'Use remove_event_place first if you want a different role.'}`)
  if (role !== 'related' && current.some((l) => l.role === role)) throw new ToolError(`The event already has a "${role}" place. An event can have only one; remove it first or use "related".`)
  const sorted = [...current].sort((x, y) => x.orderIndex - y.orderIndex)
  const at = order === undefined ? sorted.length : Math.max(1, Math.min(order, sorted.length)) // 0 is always the primary
  sorted.splice(at, 0, { placeId, role, orderIndex: at })
  return renumber(sorted)
}

/** Removes a link. A published event must keep its primary place. Pure. */
export function planRemovePlace(current: PlaceLink[], placeId: string, status: string): PlaceLink[] {
  const have = current.find((l) => l.placeId === placeId)
  if (!have) throw new ToolError('That place is not linked to this event (see get_event → places).')
  if (have.role === 'primary' && status === 'published')
    throw new ToolError('A published event must keep exactly one primary place. Choose a replacement with set_primary_place instead of removing it.')
  return renumber(current.filter((l) => l.placeId !== placeId).sort((x, y) => x.orderIndex - y.orderIndex))
}

export const linksOf = (agg: Pick<EventAggregate, 'places'>): PlaceLink[] => agg.places.map((p) => ({ placeId: p.placeId, role: p.role, orderIndex: p.orderIndex }))

export function placeFields(p: Row<typeof s.places>, parentSlug: string | null) {
  const type = p.type as PlaceType
  return {
    slug: p.slug, type, lat: p.lat, lng: p.lng, verified: p.verified,
    parent: parentSlug, zoom_override: p.zoomOverride, zoom: placeZoom(type, p.zoomOverride),
  }
}

/** Every place of an event with its role, in display order. */
export async function eventPlaceViews(db: Db, links: { placeId: string; role: string; orderIndex: number }[]) {
  if (!links.length) return []
  const ids = links.map((l) => l.placeId)
  const [rows, names] = await Promise.all([
    db.select().from(s.places).where(inArray(s.places.id, ids)),
    db.select().from(s.placeTranslations).where(inArray(s.placeTranslations.placeId, ids)),
  ])
  const parentIds = [...new Set(rows.map((r) => r.parentPlaceId).filter((x): x is string => !!x))]
  const parents = parentIds.length ? await db.select({ id: s.places.id, slug: s.places.slug }).from(s.places).where(inArray(s.places.id, parentIds)) : []
  return links.map((l) => {
    const p = rows.find((r) => r.id === l.placeId)!
    return {
      ...placeFields(p, parents.find((x) => x.id === p.parentPlaceId)?.slug ?? null),
      role: l.role, order: l.orderIndex,
      names: Object.fromEntries(names.filter((n) => n.placeId === p.id).map((n) => [n.lang, n.name])),
    }
  })
}

export async function placeView(db: Db, placeId: string | null) {
  if (!placeId) return null
  const [v] = await eventPlaceViews(db, [{ placeId, role: 'primary', orderIndex: 0 }])
  if (!v) return null
  const { role: _r, order: _o, ...rest } = v
  return rest
}

/** The translation placements are validated against (the default language, else whatever exists). */
const baseTranslation = (agg: Pick<EventAggregate, 'translations'>) => agg.translations.find((t) => t.lang === DEFAULT_LANG) ?? agg.translations[0]
export const countsFor = (agg: Pick<EventAggregate, 'translations'>, lang?: string): SlotCounts => {
  const t = (lang ? agg.translations.find((x) => x.lang === lang) : undefined) ?? baseTranslation(agg)
  return slotCounts({ summary: t?.summary, keyDetails: t?.keyDetails, lessons: t?.lessons })
}

/** What the publish gate needs to know about an event's sources. */
const sourceCandidate = (agg: EventAggregate) => ({
  citations: agg.sources.map((c) => ({ id: c.id, volume: c.volume, page: c.page, section: c.section })),
  hadith: (agg.hadithRefs ?? []).map((h) => ({ id: h.id, collection: h.collection, number: h.number })),
  ayahCount: agg.ayat.length,
})
const candidateOf = (agg: EventAggregate) => ({
  certainty: agg.event.certainty,
  ...sourceCandidate(agg),
  translations: agg.translations.map((t) => ({ lang: t.lang, title: t.title, summary: t.summary, dispute_note: t.disputeNote })),
  primaryPlaceCount: agg.places.filter((p) => p.role === 'primary').length,
})
/** Invalid stored citations / hadith refs that do NOT block publishing (the event has another valid source). */
export const warningsFor = (agg: EventAggregate): string[] => publishWarnings(candidateOf(agg))

/** The single source of truth for "what blocks publishing this event". */
export function blockersFor(agg: EventAggregate): string[] {
  return publishBlockers(candidateOf(agg))
}

export interface ReviewItem { kind: 'ayah' | 'media'; id: string; placement: string; after_index: number; section: string; langs: { lang: string; count: number }[]; fix: string }
/**
 * Items whose after_index no longer exists in the text of some language (a paragraph / key detail / lesson was removed).
 * The page does not break: such an item is shown at the END of that section. This lists them so an AI or the owner can re-place them.
 */
export function placementReview(agg: EventAggregate): ReviewItem[] {
  const out: ReviewItem[] = []
  const check = (kind: 'ayah' | 'media', id: string, placement: string, afterIndex: number | null) => {
    const langs: ReviewItem['langs'] = []
    let section = ''
    for (const t of agg.translations) {
      const r = placementNeedsReview({ placement: placement as never, after_index: afterIndex }, slotCounts({ summary: t.summary, keyDetails: t.keyDetails, lessons: t.lessons }))
      if (r) { section = r.section; langs.push({ lang: t.lang, count: r.count }) }
    }
    if (langs.length) out.push({ kind, id, placement, after_index: afterIndex!, section, langs, fix: `Shown at the end of ${section} for now. Use ${kind === 'ayah' ? 'set_ayah_placement' : 'set_media_placement'} to choose a slot that exists (see get_event_layout).` })
  }
  for (const a of agg.ayat) check('ayah', a.ayahId, a.placement, a.afterIndex)
  for (const m of agg.media) check('media', m.media.id, m.media.placement, m.media.afterIndex)
  return out
}

export function mediaView(m: EventAggregate['media'][number], lang: string) {
  const alt = pickLang(m.alts, lang)
  return {
    media_id: m.media.id, kind: m.media.kind, placement: m.media.placement, after_index: m.media.afterIndex,
    order: m.media.orderIndex, credit: m.media.credit, license: m.media.license, author: m.media.author, source_url: m.media.sourceUrl,
    width: m.media.width, height: m.media.height, variants: m.media.variants ? Object.keys(m.media.variants).map(Number) : [], r2_key: m.media.r2Key,
    alt: alt?.alt ?? null, caption: alt?.caption ?? null,
    languages: m.alts.map((a) => a.lang),
  }
}

export async function routeView(db: Db, routeId: string | null) {
  if (!routeId) return null
  const r = await db.query.routes.findFirst({ where: eq(s.routes.id, routeId) })
  if (!r) return null
  const names = await db.select().from(s.routeTranslations).where(eq(s.routeTranslations.routeId, routeId))
  return { slug: r.slug, points: r.geojson.coordinates.length, names: Object.fromEntries(names.map((n) => [n.lang, n.name])) }
}

export async function ayahViews(db: Db, ayahIds: string[]) {
  if (!ayahIds.length) return new Map<string, unknown>()
  const rows = await db.select().from(s.ayat).where(inArray(s.ayat.id, ayahIds))
  const tr = await db.select().from(s.ayahTranslations).where(inArray(s.ayahTranslations.ayahId, ayahIds))
  return new Map(rows.map((a) => [a.id, {
    ref: `${a.surah}:${a.ayah}`, surah: a.surah, ayah: a.ayah, arabic: a.arabicText,
    translations: tr.filter((t) => t.ayahId === a.id).map((t) => ({ lang: t.lang, text: t.text, source: t.translationSource, license: t.translationLicense })),
  }]))
}

/** Full, human-readable event for get_event / preview. */
export async function eventView(db: Db, eventId: string, lang?: string) {
  const agg = await loadEventAggregate(db, eventId)
  if (!agg) throw new ToolError('Event not found.')
  const era = await db.query.eras.findFirst({ where: eq(s.eras.id, agg.event.eraId) })
  const [srcRows, hadithRows, places] = await Promise.all([
    agg.sources.length ? db.select().from(s.sources).where(inArray(s.sources.id, agg.sources.map((x) => x.sourceId))) : [],
    agg.hadith.length ? db.select().from(s.hadithRefs).where(inArray(s.hadithRefs.id, agg.hadith.map((x) => x.hadithId))) : [],
    eventPlaceViews(db, linksOf(agg)),
  ])
  const ayah = await ayahViews(db, agg.ayat.map((a) => a.ayahId))
  const l = lang ?? DEFAULT_LANG
  const t = pickLang(agg.translations, l)
  return {
    slug: agg.event.slug, status: agg.event.status, era: era?.slug, order_index: agg.event.orderIndex,
    hijri_year: agg.event.hijriYear, gregorian_approx: agg.event.gregorianApprox, prophet_age: agg.event.prophetAge,
    certainty: agg.event.certainty, needs_verification: agg.event.needsVerification, published_at: agg.event.publishedAt,
    updated_at: agg.event.updatedAt,
    // `place` = the primary place (kept for older clients); `places` lists every place with its role.
    place: places.find((p) => p.role === 'primary') ?? null, places, route: await routeView(db, agg.event.routeId),
    translation: t ? { lang: t.lang, title: t.title, summary: t.summary, key_details: t.keyDetails, lessons: t.lessons, dispute_note: t.disputeNote, my_reflection: t.myReflection, status: t.status } : null,
    translation_langs: agg.translations.map((x) => ({ lang: x.lang, status: x.status })),
    sources: agg.sources.map((c) => {
      const src = srcRows.find((x) => x.id === c.sourceId)
      const problem = locatorProblem(c)
      return { citation_id: c.id, valid: !problem, problem: problem ?? undefined, source: src?.slug, book: src?.book, author: src?.author, edition: src?.edition, volume: c.volume, page: c.page, section: c.section, note: c.note }
    }),
    ayat: agg.ayat.map((a) => ({
      ...(ayah.get(a.ayahId) as object),
      placement: a.placement, after_index: a.afterIndex, order: a.orderIndex,
      placement_note: Object.fromEntries(agg.ayatNotes.filter((n) => n.ayahId === a.ayahId).map((n) => [n.lang, n.note])),
    })),
    needs_placement_review: placementReview(agg),
    hadith: agg.hadith.map((h) => hadithRows.find((x) => x.id === h.hadithId)).filter(Boolean).map((h) => ({ hadith_ref_id: h!.id, collection: h!.collection, number: h!.number, grading: h!.grading, grading_by: h!.gradingBy, note: h!.note })),
    recall_questions: agg.recall.map((q) => {
      const qt = pickLang(q.translations, l)
      return { id: q.question.id, lang: qt?.lang, question: qt?.question, answer: qt?.answer, distractors: qt?.distractors }
    }),
    media: agg.media.map((m) => mediaView(m, l)),
  }
}

export async function titles(db: Db, ids: string[], lang: string): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const rows = await db.select().from(s.eventTranslations).where(inArray(s.eventTranslations.eventId, ids))
  const out = new Map<string, string>()
  for (const id of ids) {
    const t = pickLang(rows.filter((r) => r.eventId === id), lang)
    if (t) out.set(id, t.title)
  }
  return out
}

export async function maxOrder(db: Db): Promise<number> {
  const [r] = await db.select({ m: sql<number>`coalesce(max(${s.events.orderIndex}), 0)` }).from(s.events)
  return r?.m ?? 0
}

export { and, asc, desc, eq, inArray, sql }
