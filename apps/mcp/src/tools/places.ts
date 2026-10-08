import { z } from 'zod'
import { eq, like, or, asc, sql } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/server'
import { schema as s } from '@seerah/db'
import { CreatePlaceSchema, CreateRouteSchema, GAZETTEER_SEED, SlugSchema } from '@seerah/content'
import { defineTool, type ToolCtx } from './kit'
import { placeBySlug, withRevision } from '../data'
import { ToolError, uuid } from '../util'

const esc = (q: string) => q.replace(/[\\%_]/g, (c) => '\\' + c)

export function registerPlaceTools(server: McpServer, ctx: ToolCtx) {
  const { db, actor } = ctx

  defineTool(server, ctx, 'find_place', {
    title: 'Find place',
    description: 'Search places already in the database and the built-in Arabian Peninsula gazetteer (names in Bangla/English/Arabic). Gazetteer hits not yet in the database have in_database: false; pass them to create_place. Coordinates are approximate until verified.',
    access: 'read',
    input: z.object({ query: z.string().trim().min(1).max(80), limit: z.number().int().min(1).max(25).default(10) }),
  }, async ({ query, limit }) => {
    const q = `%${esc(query)}%`
    const rows = await db.select({ p: s.places, name: s.placeTranslations.name, lang: s.placeTranslations.lang }).from(s.places)
      .leftJoin(s.placeTranslations, eq(s.placeTranslations.placeId, s.places.id))
      .where(or(sql`${s.places.slug} like ${q} escape '\\'`, sql`${s.placeTranslations.name} like ${q} escape '\\'`))
      .orderBy(asc(s.places.slug))
    const dbHits = new Map<string, { slug: string; type: string; lat: number; lng: number; verified: boolean; names: Record<string, string>; in_database: true }>()
    for (const r of rows) {
      const h = dbHits.get(r.p.slug) ?? { slug: r.p.slug, type: r.p.type, lat: r.p.lat, lng: r.p.lng, verified: r.p.verified, names: {}, in_database: true as const }
      if (r.name && r.lang) h.names[r.lang] = r.name
      dbHits.set(r.p.slug, h)
    }
    const ql = query.toLowerCase()
    const gaz = GAZETTEER_SEED
      .filter((g) => !dbHits.has(g.slug) && (g.slug.includes(ql) || Object.values(g.names).some((n) => n.toLowerCase().includes(ql))))
      .map((g) => ({ slug: g.slug, type: g.type, lat: g.lat, lng: g.lng, verified: false, names: g.names, in_database: false as const }))
    return { results: [...dbHits.values(), ...gaz].slice(0, limit) }
  })

  defineTool(server, ctx, 'create_place', {
    title: 'Create place',
    description: 'Add a place. lat/lng are decimal degrees (latitude first). Rejected outside the Arabian Peninsula unless allow_outside_arabia is true (e.g. Aksum, Bayt al-Maqdis). New places are unverified until the owner calls verify_place.',
    access: 'write',
    input: CreatePlaceSchema,
  }, async (a) => {
    if (await db.query.places.findFirst({ where: eq(s.places.slug, a.slug) })) throw new ToolError(`Place "${a.slug}" already exists. Use find_place.`)
    const id = uuid()
    const { revisionId } = await withRevision(db, actor, {
      entity: 'place', entityId: id, action: 'create',
      build: () => [
        db.insert(s.places).values({ id, slug: a.slug, type: a.type, lat: a.lat, lng: a.lng, verified: false }),
        db.insert(s.placeTranslations).values(Object.entries(a.names).map(([lang, name]) => ({ placeId: id, lang, name: name! }))),
      ],
    })
    return { ok: true, slug: a.slug, verified: false, revision_id: revisionId }
  })

  defineTool(server, ctx, 'verify_place', {
    title: 'Verify place', description: 'Owner confirms a place\'s coordinates are correct (or un-verifies it).', access: 'owner',
    input: z.object({ slug: SlugSchema, verified: z.boolean().default(true), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() }),
  }, async ({ slug, verified, lat, lng }) => {
    const p = await placeBySlug(db, slug)
    const { revisionId } = await withRevision(db, actor, {
      entity: 'place', entityId: p.id, action: verified ? 'verify' : 'unverify',
      build: () => [db.update(s.places).set({ verified, ...(lat !== undefined ? { lat } : {}), ...(lng !== undefined ? { lng } : {}) }).where(eq(s.places.id, p.id))],
    })
    return { ok: true, slug, verified, revision_id: revisionId }
  })

  defineTool(server, ctx, 'create_route', {
    title: 'Create route',
    description: 'Add a journey route as a GeoJSON LineString with coordinates in [lng, lat] order (note: longitude first). All points must lie inside the Arabian Peninsula bounding box unless allow_outside_arabia is true. Attach it to an event with update_event {patch:{route_slug}}.',
    access: 'write',
    input: CreateRouteSchema,
  }, async (a) => {
    if (await db.query.routes.findFirst({ where: eq(s.routes.slug, a.slug) })) throw new ToolError(`Route "${a.slug}" already exists.`)
    const id = uuid()
    const { revisionId } = await withRevision(db, actor, {
      entity: 'route', entityId: id, action: 'create',
      build: () => [
        db.insert(s.routes).values({ id, slug: a.slug, geojson: a.geojson }),
        db.insert(s.routeTranslations).values(Object.entries(a.names).map(([lang, name]) => ({ routeId: id, lang, name: name! }))),
      ],
    })
    return { ok: true, slug: a.slug, points: a.geojson.coordinates.length, revision_id: revisionId }
  })
}
