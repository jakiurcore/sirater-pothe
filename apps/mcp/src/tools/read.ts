import { z } from 'zod'
import { and, eq, sql, asc } from 'drizzle-orm'
import { schema as s } from '@seerah/db'
import { LangSchema, SlugSchema, StatusSchema, DEFAULT_LANG } from '@seerah/content'
import { defineTool, type ToolCtx } from './kit'
import { blockersFor, eraBySlug, eventBySlug, eventView, loadEventAggregate, titles } from '../data'
import type { McpServer } from '@modelcontextprotocol/server'

const esc = (q: string) => q.replace(/[\\%_]/g, (c) => '\\' + c)

export async function timelineOutline(ctx: Pick<ToolCtx, 'db'>, lang: string, includeDrafts = true) {
  const { db } = ctx
  const eras = await db.select().from(s.eras).orderBy(asc(s.eras.orderIndex))
  const eraT = await db.select().from(s.eraTranslations)
  const evs = await db.select().from(s.events)
    .where(includeDrafts ? sql`${s.events.status} != 'archived'` : eq(s.events.status, 'published'))
    .orderBy(asc(s.events.orderIndex), asc(s.events.id))
  const tt = await titles(db, evs.map((e) => e.id), lang)
  return eras.map((era) => ({
    era: era.slug,
    title: (eraT.find((t) => t.eraId === era.id && t.lang === lang) ?? eraT.find((t) => t.eraId === era.id && t.lang === DEFAULT_LANG))?.title ?? era.slug,
    events: evs.filter((e) => e.eraId === era.id).map((e) => ({
      slug: e.slug, title: tt.get(e.id) ?? '(no title)', status: e.status, hijri_year: e.hijriYear, gregorian_approx: e.gregorianApprox,
      certainty: e.certainty, needs_verification: e.needsVerification,
    })),
  }))
}

export function outlineMarkdown(outline: Awaited<ReturnType<typeof timelineOutline>>): string {
  return outline.map((e) => `## ${e.title} (${e.era})\n` + (e.events.length
    ? e.events.map((v, i) => `${i + 1}. ${v.title} — \`${v.slug}\` [${v.status}${v.certainty === 'disputed' ? ', disputed' : ''}${v.needs_verification ? ', needs verification' : ''}]${v.hijri_year != null ? ` · ${v.hijri_year} হি.` : ''}`).join('\n')
    : '_no events yet_')).join('\n\n')
}

export function registerReadTools(server: McpServer, ctx: ToolCtx) {
  const { db } = ctx

  defineTool(server, ctx, 'search_events', {
    title: 'Search events',
    description: 'Find events by text in title/summary/slug (any language), optionally filtered by status or era. Always call this before creating an event to avoid duplicates.',
    access: 'read',
    input: z.object({
      query: z.string().trim().max(100).optional().describe('Text to look for; omit to list.'),
      status: StatusSchema.optional(),
      era_slug: SlugSchema.optional(),
      lang: LangSchema.optional().describe('Language for the returned titles (default bn).'),
      limit: z.number().int().min(1).max(50).default(20),
    }),
  }, async ({ query, status, era_slug, lang, limit }) => {
    const conds = []
    if (status) conds.push(eq(s.events.status, status))
    if (era_slug) conds.push(eq(s.events.eraId, (await eraBySlug(db, era_slug)).id))
    if (query) {
      const like = `%${esc(query)}%`
      conds.push(sql`(${s.events.slug} like ${like} escape '\\' or exists (select 1 from event_translations t where t.event_id = ${s.events.id} and (t.title like ${like} escape '\\' or t.summary like ${like} escape '\\')))`)
    }
    const rows = await db.select().from(s.events).where(conds.length ? and(...conds) : undefined).orderBy(asc(s.events.orderIndex)).limit(limit)
    const tt = await titles(db, rows.map((r) => r.id), lang ?? DEFAULT_LANG)
    return {
      count: rows.length,
      events: rows.map((r) => ({ slug: r.slug, title: tt.get(r.id) ?? null, status: r.status, hijri_year: r.hijriYear, certainty: r.certainty, needs_verification: r.needsVerification, order_index: r.orderIndex })),
    }
  })

  defineTool(server, ctx, 'get_event', {
    title: 'Get event',
    description: 'Full event: translation, ALL places with their roles (primary / related / route_start / route_end), route, sources, ayat (with server-fetched text), hadith refs, recall questions, readiness for publishing.',
    access: 'read',
    input: z.object({ slug: SlugSchema, lang: LangSchema.optional() }),
  }, async ({ slug, lang }) => {
    const e = await eventBySlug(db, slug)
    const view = await eventView(db, e.id, lang)
    const agg = (await loadEventAggregate(db, e.id))!
    return { ...view, publish_blockers: blockersFor(agg) }
  })

  defineTool(server, ctx, 'list_eras', {
    title: 'List eras', description: 'The eras of the timeline with titles and event counts.', access: 'read',
    input: z.object({ lang: LangSchema.optional() }),
  }, async ({ lang }) => {
    const l = lang ?? DEFAULT_LANG
    const eras = await db.select().from(s.eras).orderBy(asc(s.eras.orderIndex))
    const tr = await db.select().from(s.eraTranslations)
    const counts = await db.select({ eraId: s.events.eraId, n: sql<number>`count(*)` }).from(s.events).groupBy(s.events.eraId)
    return eras.map((e) => {
      const t = tr.find((x) => x.eraId === e.id && x.lang === l) ?? tr.find((x) => x.eraId === e.id && x.lang === DEFAULT_LANG)
      return { slug: e.slug, order: e.orderIndex, title: t?.title, summary: t?.summary, start_hijri: e.startHijri, end_hijri: e.endHijri, events: counts.find((c) => c.eraId === e.id)?.n ?? 0 }
    })
  })

  defineTool(server, ctx, 'list_drafts', {
    title: 'List drafts', description: 'All draft events, each with what still blocks publishing.', access: 'read',
    input: z.object({ lang: LangSchema.optional() }),
  }, async ({ lang }) => {
    const rows = await db.select().from(s.events).where(eq(s.events.status, 'draft')).orderBy(asc(s.events.orderIndex))
    const tt = await titles(db, rows.map((r) => r.id), lang ?? DEFAULT_LANG)
    const out = []
    for (const r of rows) {
      const agg = (await loadEventAggregate(db, r.id))!
      out.push({
        slug: r.slug, title: tt.get(r.id) ?? null, needs_verification: r.needsVerification, updated_at: r.updatedAt,
        blockers: blockersFor(agg),
      })
    }
    return { count: out.length, drafts: out }
  })

  defineTool(server, ctx, 'get_timeline_outline', {
    title: 'Timeline outline', description: 'Every event in timeline order, grouped by era. Use it to place a new event and to avoid duplicates.', access: 'read',
    input: z.object({ lang: LangSchema.optional() }),
  }, async ({ lang }) => timelineOutline(ctx, lang ?? DEFAULT_LANG))
}
