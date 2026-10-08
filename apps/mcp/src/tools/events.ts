import { z } from 'zod'
import { asc, eq, sql, and } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/server'
import { schema as s } from '@seerah/db'
import {
  CertaintySchema, CreateEventDraftSchema, EventTranslationSchema, LangSchema, SlugSchema, UpdateEventSchema,
  UpdateEventTranslationSchema, DEFAULT_LANG, publishBlockers, addHonorific,
} from '@seerah/content'
import { assertCanEdit, defineTool, type ToolCtx } from './kit'
import { eraBySlug, eventBySlug, loadEventAggregate, maxOrder, placeBySlug, routeBySlug, touch, withRevision, titles } from '../data'
import { ToolError, nowIso, randomToken, sha256Hex, uuid } from '../util'

const GAP = 1024
const norm = (t: string) => t.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()

export function registerEventTools(server: McpServer, ctx: ToolCtx) {
  const { db, env, actor } = ctx

  defineTool(server, ctx, 'create_event_draft', {
    title: 'Create event draft',
    description: 'Create a new DRAFT event with its first translation. Search for duplicates first. It is appended at the end of the timeline; use set_event_order to place it. Attach sources, place, ayat and questions afterwards.',
    access: 'write',
    input: CreateEventDraftSchema,
  }, async (a) => {
    if (await db.query.events.findFirst({ where: eq(s.events.slug, a.slug) }))
      throw new ToolError(`An event with slug "${a.slug}" already exists. Use get_event/update_event, or choose a different slug.`)
    const era = await eraBySlug(db, a.era_slug)
    const place = a.place_slug ? await placeBySlug(db, a.place_slug) : null
    const route = a.route_slug ? await routeBySlug(db, a.route_slug) : null
    // Same title (in the same language) is almost certainly a duplicate.
    const same = await db.select({ id: s.eventTranslations.eventId, title: s.eventTranslations.title }).from(s.eventTranslations).where(eq(s.eventTranslations.lang, a.translation.lang))
    const dup = same.filter((x) => norm(x.title) === norm(a.translation.title))
    if (dup.length) {
      const evs = await Promise.all(dup.map((d) => db.query.events.findFirst({ where: eq(s.events.id, d.id) })))
      throw new ToolError(`An event titled "${a.translation.title}" already exists (${evs.map((e) => e?.slug).join(', ')}). Update it instead, or use a distinct title if this is a different event.`)
    }
    const id = uuid()
    const t = a.translation
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: id, action: 'create',
      build: () => [
        db.insert(s.events).values({
          id, slug: a.slug, eraId: era.id, orderIndex: 0, hijriYear: a.hijri_year ?? null, gregorianApprox: a.gregorian_approx ?? null,
          prophetAge: a.prophet_age ?? null, placeId: place?.id ?? null, routeId: route?.id ?? null, certainty: a.certainty, status: 'draft',
        }),
        db.update(s.events).set({ orderIndex: sql`(select coalesce(max(order_index), 0) + ${GAP} from events)` }).where(eq(s.events.id, id)),
        db.insert(s.eventTranslations).values({
          eventId: id, lang: t.lang, title: t.title, summary: t.summary, keyDetails: t.key_details ?? [], lessons: t.lessons ?? [],
          disputeNote: t.dispute_note ?? null, myReflection: t.my_reflection ?? null, status: 'draft',
        }),
      ],
    })
    const near = await db.select({ slug: s.events.slug, order: s.events.orderIndex }).from(s.events).orderBy(asc(s.events.orderIndex))
    return {
      ok: true, slug: a.slug, status: 'draft', revision_id: revisionId,
      position: `last of ${near.length} events`,
      next_steps: ['set_event_order (if not last)', 'create_source + add_source_citation (required to publish)', 'find_place / attach ayat / add_recall_questions', 'preview_event'],
    }
  })

  defineTool(server, ctx, 'update_event', {
    title: 'Update event',
    description: 'Change an event\'s era/dates/age/place/route (patch) and/or edit fields of an existing translation. Omitted fields are left untouched. Setting null clears a field.',
    access: 'write',
    input: z.object({
      slug: SlugSchema,
      patch: UpdateEventSchema.shape.patch.optional(),
      translation: UpdateEventTranslationSchema.optional().describe('Partial edit of an existing translation; use add_translation for a new language.'),
    }),
  }, async ({ slug, patch, translation }) => {
    if (!patch && !translation) throw new ToolError('Provide patch and/or translation.')
    const ev = await eventBySlug(db, slug)
    assertCanEdit(ctx, ev.status)
    const set: Partial<typeof s.events.$inferInsert> = {}
    if (patch) {
      if (patch.era_slug !== undefined) set.eraId = (await eraBySlug(db, patch.era_slug)).id
      if (patch.hijri_year !== undefined) set.hijriYear = patch.hijri_year
      if (patch.gregorian_approx !== undefined) set.gregorianApprox = patch.gregorian_approx
      if (patch.prophet_age !== undefined) set.prophetAge = patch.prophet_age
      if (patch.place_slug !== undefined) set.placeId = patch.place_slug ? (await placeBySlug(db, patch.place_slug)).id : null
      if (patch.route_slug !== undefined) set.routeId = patch.route_slug ? (await routeBySlug(db, patch.route_slug)).id : null
    }
    let tSet: Partial<typeof s.eventTranslations.$inferInsert> | null = null
    if (translation) {
      const cur = await db.query.eventTranslations.findFirst({ where: and(eq(s.eventTranslations.eventId, ev.id), eq(s.eventTranslations.lang, translation.lang)) })
      if (!cur) throw new ToolError(`No "${translation.lang}" translation on "${slug}". Use add_translation to create it.`)
      const { lang: _l, key_details, lessons, dispute_note, my_reflection, ...rest } = translation
      tSet = { ...rest, updatedAt: nowIso() }
      if (key_details !== undefined) tSet.keyDetails = key_details
      if (lessons !== undefined) tSet.lessons = lessons
      if (dispute_note !== undefined) tSet.disputeNote = dispute_note
      if (my_reflection !== undefined) tSet.myReflection = my_reflection
      if (ev.certainty === 'disputed' && dispute_note === null && !(await db.select().from(s.eventTranslations).where(and(eq(s.eventTranslations.eventId, ev.id), sql`${s.eventTranslations.lang} != ${translation.lang} and ${s.eventTranslations.disputeNote} is not null`))).length)
        throw new ToolError('This event is "disputed"; it needs a dispute_note. Use set_certainty to mark it agreed first.')
    }
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'update',
      build: () => [
        db.update(s.events).set({ ...set, updatedAt: nowIso() }).where(eq(s.events.id, ev.id)),
        ...(tSet ? [db.update(s.eventTranslations).set(tSet).where(and(eq(s.eventTranslations.eventId, ev.id), eq(s.eventTranslations.lang, translation!.lang)))] : []),
      ],
    })
    return { ok: true, slug, revision_id: revisionId, live: ev.status === 'published' ? 'WARNING: this event is published, so the change is already live. revert_revision undoes it.' : undefined }
  })

  defineTool(server, ctx, 'set_event_order', {
    title: 'Set event order',
    description: 'Move an event within the timeline: place it right after another event, or first. Orders are global across eras.',
    access: 'write',
    input: z.object({ slug: SlugSchema, after_slug: SlugSchema.nullable().describe('Slug of the event it should follow; null = move to the very beginning.') }),
  }, async ({ slug, after_slug }) => {
    const ev = await eventBySlug(db, slug)
    assertCanEdit(ctx, ev.status)
    if (after_slug === slug) throw new ToolError('An event cannot be placed after itself.')
    if (after_slug) await eventBySlug(db, after_slug)
    const all = (await db.select({ id: s.events.id, slug: s.events.slug, o: s.events.orderIndex }).from(s.events).orderBy(asc(s.events.orderIndex), asc(s.events.id))).filter((e) => e.id !== ev.id)
    const idx = after_slug ? all.findIndex((e) => e.slug === after_slug) : -1
    const prev = idx >= 0 ? all[idx]!.o : null
    const next = all[idx + 1]?.o ?? null
    let target: number | null
    if (prev === null) target = next === null ? GAP : next - GAP
    else if (next === null) target = prev + GAP
    else target = next - prev >= 2 ? Math.floor((prev + next) / 2) : null
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'reorder',
      build: () => {
        if (target !== null) return [db.update(s.events).set({ orderIndex: target, updatedAt: nowIso() }).where(eq(s.events.id, ev.id))]
        // No room between neighbours: respace everything, keeping relative order (and place this one).
        const seq = [...all.slice(0, idx + 1), { id: ev.id }, ...all.slice(idx + 1)]
        return seq.map((e, i) => db.update(s.events).set({ orderIndex: (i + 1) * GAP }).where(eq(s.events.id, e.id)))
      },
    })
    return { ok: true, slug, after: after_slug, revision_id: revisionId }
  })

  defineTool(server, ctx, 'set_certainty', {
    title: 'Set certainty',
    description: 'Mark an event "agreed" (scholars agree on the facts) or "disputed" (differing reports/opinions). Disputed requires a dispute_note explaining the positions.',
    access: 'write',
    input: z.object({ slug: SlugSchema, certainty: CertaintySchema, dispute_note: z.string().trim().min(10).max(1500).optional(), lang: LangSchema.optional().describe('Language of the dispute_note (default bn).') }),
  }, async ({ slug, certainty, dispute_note, lang }) => {
    const ev = await eventBySlug(db, slug)
    assertCanEdit(ctx, ev.status)
    const l = lang ?? DEFAULT_LANG
    const trs = await db.select().from(s.eventTranslations).where(eq(s.eventTranslations.eventId, ev.id))
    if (certainty === 'disputed' && !dispute_note && !trs.some((t) => t.disputeNote))
      throw new ToolError('To mark an event "disputed", pass dispute_note explaining the different positions (who says what, and on what evidence).')
    if (dispute_note && !trs.some((t) => t.lang === l)) throw new ToolError(`No "${l}" translation to attach the note to. Use add_translation first.`)
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'certainty',
      build: () => [
        db.update(s.events).set({ certainty, updatedAt: nowIso() }).where(eq(s.events.id, ev.id)),
        ...(dispute_note ? [db.update(s.eventTranslations).set({ disputeNote: addHonorific(dispute_note), updatedAt: nowIso() }).where(and(eq(s.eventTranslations.eventId, ev.id), eq(s.eventTranslations.lang, l)))] : []),
      ],
    })
    return { ok: true, slug, certainty, revision_id: revisionId }
  })

  defineTool(server, ctx, 'add_translation', {
    title: 'Add translation',
    description: 'Add an event translation in another language. It is saved as a DRAFT translation (not shown publicly until the owner publishes that language).',
    access: 'write',
    input: z.object({ slug: SlugSchema, translation: EventTranslationSchema }),
  }, async ({ slug, translation: t }) => {
    const ev = await eventBySlug(db, slug)
    assertCanEdit(ctx, ev.status)
    if (await db.query.eventTranslations.findFirst({ where: and(eq(s.eventTranslations.eventId, ev.id), eq(s.eventTranslations.lang, t.lang)) }))
      throw new ToolError(`"${slug}" already has a "${t.lang}" translation. Use update_event with translation to edit it.`)
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'add_translation',
      build: () => [
        db.insert(s.eventTranslations).values({ eventId: ev.id, lang: t.lang, title: t.title, summary: t.summary, keyDetails: t.key_details ?? [], lessons: t.lessons ?? [], disputeNote: t.dispute_note ?? null, myReflection: t.my_reflection ?? null, status: 'draft' }),
        touch(db, ev.id),
      ],
    })
    return { ok: true, slug, lang: t.lang, status: 'draft', revision_id: revisionId }
  })

  defineTool(server, ctx, 'preview_event', {
    title: 'Preview event',
    description: 'Create a signed, expiring preview link on the website so the owner can see a draft exactly as readers will. Give the link to the owner.',
    access: 'write',
    input: z.object({ slug: SlugSchema, ttl_minutes: z.number().int().min(5).max(1440).default(60), lang: LangSchema.optional() }),
  }, async ({ slug, ttl_minutes, lang }) => {
    const ev = await eventBySlug(db, slug)
    const token = randomToken(24)
    const expires = new Date(Date.now() + ttl_minutes * 60_000).toISOString()
    await db.delete(s.previewTokens).where(sql`${s.previewTokens.expiresAt} < ${nowIso()}`)
    await db.insert(s.previewTokens).values({ tokenHash: await sha256Hex(token), eventId: ev.id, expiresAt: expires, createdBy: actor.login })
    const base = env.WEB_ORIGIN.replace(/\/$/, '')
    return { url: `${base}/${lang ?? DEFAULT_LANG}/preview/${slug}?token=${token}`, expires_at: expires, note: 'Anyone with this link can view the draft until it expires.' }
  })

  defineTool(server, ctx, 'publish_event', {
    title: 'Publish event',
    description: 'Make an event (and its default-language translation) public. Blocked until it has a source citation, a certainty flag and a title+summary. Seed/sample events additionally require confirm_verified: true after the owner has checked the content.',
    access: 'owner',
    input: z.object({
      slug: SlugSchema,
      confirm_verified: z.boolean().optional().describe('Required for events flagged needs_verification: the owner confirms they have checked facts, sources and ayat.'),
      publish_langs: z.array(LangSchema).max(10).optional().describe('Also publish these other-language translations.'),
    }),
  }, async ({ slug, confirm_verified, publish_langs }) => {
    const ev = await eventBySlug(db, slug)
    if (ev.status === 'published') throw new ToolError(`"${slug}" is already published.`)
    const agg = (await loadEventAggregate(db, ev.id))!
    const blockers = publishBlockers({
      certainty: ev.certainty, sourceCount: agg.sources.length,
      translations: agg.translations.map((t) => ({ lang: t.lang, title: t.title, summary: t.summary, dispute_note: t.disputeNote })),
    })
    if (ev.needsVerification && !confirm_verified)
      blockers.push('This event is seed/sample content flagged "needs owner verification". After checking it, call publish_event again with confirm_verified: true.')
    for (const l of publish_langs ?? []) if (!agg.translations.some((t) => t.lang === l)) blockers.push(`No "${l}" translation to publish.`)
    if (blockers.length) throw new ToolError('Cannot publish yet:\n- ' + blockers.join('\n- '))
    const langs = [...new Set([DEFAULT_LANG, ...(publish_langs ?? [])])]
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'publish',
      build: () => [
        db.update(s.events).set({ status: 'published', publishedAt: nowIso(), needsVerification: false, updatedAt: nowIso() }).where(eq(s.events.id, ev.id)),
        ...langs.map((l) => db.update(s.eventTranslations).set({ status: 'published' }).where(and(eq(s.eventTranslations.eventId, ev.id), eq(s.eventTranslations.lang, l)))),
      ],
    })
    return { ok: true, slug, status: 'published', published_langs: langs, revision_id: revisionId, url: `${env.WEB_ORIGIN.replace(/\/$/, '')}/${DEFAULT_LANG}/events/${slug}` }
  })

  defineTool(server, ctx, 'unpublish_event', {
    title: 'Unpublish event', description: 'Take a published event offline (back to draft). Content is kept.', access: 'owner',
    input: z.object({ slug: SlugSchema }),
  }, async ({ slug }) => {
    const ev = await eventBySlug(db, slug)
    if (ev.status !== 'published') throw new ToolError(`"${slug}" is ${ev.status}, not published.`)
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'unpublish',
      build: () => [db.update(s.events).set({ status: 'draft', updatedAt: nowIso() }).where(eq(s.events.id, ev.id))],
    })
    return { ok: true, slug, status: 'draft', revision_id: revisionId }
  })
}
