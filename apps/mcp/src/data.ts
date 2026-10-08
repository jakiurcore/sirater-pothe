import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@seerah/db'
import { schema as s } from '@seerah/db'
import { DEFAULT_LANG } from '@seerah/content'
import { ToolError, nowIso, uuid } from './util'
import type { Actor } from './env'

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect']
export type BatchStmt = Parameters<Db['batch']>[0][number]

export interface EventAggregate {
  event: Row<typeof s.events>
  translations: Row<typeof s.eventTranslations>[]
  sources: Row<typeof s.eventSources>[]
  ayat: Row<typeof s.eventAyat>[]
  hadith: Row<typeof s.eventHadith>[]
  people: Row<typeof s.eventPeople>[]
  recall: { question: Row<typeof s.recallQuestions>; translations: Row<typeof s.recallQuestionTranslations>[] }[]
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
  const [translations, sources, ayat, hadith, people, qs] = await Promise.all([
    db.select().from(s.eventTranslations).where(eq(s.eventTranslations.eventId, eventId)).orderBy(asc(s.eventTranslations.lang)),
    db.select().from(s.eventSources).where(eq(s.eventSources.eventId, eventId)).orderBy(asc(s.eventSources.id)),
    db.select().from(s.eventAyat).where(eq(s.eventAyat.eventId, eventId)).orderBy(asc(s.eventAyat.orderIndex)),
    db.select().from(s.eventHadith).where(eq(s.eventHadith.eventId, eventId)),
    db.select().from(s.eventPeople).where(eq(s.eventPeople.eventId, eventId)),
    db.select().from(s.recallQuestions).where(eq(s.recallQuestions.eventId, eventId)).orderBy(asc(s.recallQuestions.orderIndex)),
  ])
  const qt = qs.length
    ? await db.select().from(s.recallQuestionTranslations).where(inArray(s.recallQuestionTranslations.questionId, qs.map((q) => q.id)))
    : []
  return {
    event, translations, sources, ayat, hadith, people,
    recall: qs.map((question) => ({ question, translations: qt.filter((t) => t.questionId === question.id) })),
  }
}

/** Statements that make the DB match `snap` for this event (child rows replaced wholesale). */
export function restoreEventStatements(db: Db, snap: EventAggregate): BatchStmt[] {
  const id = snap.event.id
  const st: BatchStmt[] = [
    db.update(s.events).set({ ...snap.event, updatedAt: nowIso() }).where(eq(s.events.id, id)),
    db.delete(s.eventTranslations).where(eq(s.eventTranslations.eventId, id)),
    db.delete(s.eventSources).where(eq(s.eventSources.eventId, id)),
    db.delete(s.eventAyat).where(eq(s.eventAyat.eventId, id)),
    db.delete(s.eventHadith).where(eq(s.eventHadith.eventId, id)),
    db.delete(s.eventPeople).where(eq(s.eventPeople.eventId, id)),
    db.delete(s.recallQuestions).where(eq(s.recallQuestions.eventId, id)),
  ]
  if (snap.translations.length) st.push(db.insert(s.eventTranslations).values(snap.translations))
  if (snap.sources.length) st.push(db.insert(s.eventSources).values(snap.sources))
  if (snap.ayat.length) st.push(db.insert(s.eventAyat).values(snap.ayat))
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

export async function placeView(db: Db, placeId: string | null) {
  if (!placeId) return null
  const p = await db.query.places.findFirst({ where: eq(s.places.id, placeId) })
  if (!p) return null
  const names = await db.select().from(s.placeTranslations).where(eq(s.placeTranslations.placeId, placeId))
  return { slug: p.slug, type: p.type, lat: p.lat, lng: p.lng, verified: p.verified, names: Object.fromEntries(names.map((n) => [n.lang, n.name])) }
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
  const [srcRows, hadithRows, media] = await Promise.all([
    agg.sources.length ? db.select().from(s.sources).where(inArray(s.sources.id, agg.sources.map((x) => x.sourceId))) : [],
    agg.hadith.length ? db.select().from(s.hadithRefs).where(inArray(s.hadithRefs.id, agg.hadith.map((x) => x.hadithId))) : [],
    db.select().from(s.media).where(eq(s.media.eventId, eventId)),
  ])
  const ayah = await ayahViews(db, agg.ayat.map((a) => a.ayahId))
  const l = lang ?? DEFAULT_LANG
  const t = pickLang(agg.translations, l)
  return {
    slug: agg.event.slug, status: agg.event.status, era: era?.slug, order_index: agg.event.orderIndex,
    hijri_year: agg.event.hijriYear, gregorian_approx: agg.event.gregorianApprox, prophet_age: agg.event.prophetAge,
    certainty: agg.event.certainty, needs_verification: agg.event.needsVerification, published_at: agg.event.publishedAt,
    updated_at: agg.event.updatedAt,
    place: await placeView(db, agg.event.placeId), route: await routeView(db, agg.event.routeId),
    translation: t ? { lang: t.lang, title: t.title, summary: t.summary, key_details: t.keyDetails, lessons: t.lessons, dispute_note: t.disputeNote, my_reflection: t.myReflection, status: t.status } : null,
    translation_langs: agg.translations.map((x) => ({ lang: x.lang, status: x.status })),
    sources: agg.sources.map((c) => {
      const src = srcRows.find((x) => x.id === c.sourceId)
      return { citation_id: c.id, source: src?.slug, book: src?.book, author: src?.author, edition: src?.edition, volume: c.volume, page: c.page, note: c.note }
    }),
    ayat: agg.ayat.map((a) => ayah.get(a.ayahId)),
    hadith: agg.hadith.map((h) => hadithRows.find((x) => x.id === h.hadithId)).filter(Boolean).map((h) => ({ collection: h!.collection, number: h!.number, grading: h!.grading, grading_by: h!.gradingBy, note: h!.note })),
    recall_questions: agg.recall.map((q) => {
      const qt = pickLang(q.translations, l)
      return { id: q.question.id, lang: qt?.lang, question: qt?.question, answer: qt?.answer, distractors: qt?.distractors }
    }),
    media: media.map((m) => ({ id: m.id, kind: m.kind, r2_key: m.r2Key })),
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
