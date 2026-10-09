import { z } from 'zod'
import { eq, like, or, asc, sql } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/server'
import { schema as s } from '@seerah/db'
import { CreatePlaceSchema, CreateRouteSchema, GAZETTEER_SEED, PLACE_LEVEL, PlaceTypeSchema, SlugSchema, ZoomSchema, placeZoom, type PlaceType } from '@seerah/content'
import { assertCanEdit, defineTool, type ToolCtx } from './kit'
import { eventBySlug, linksOf, loadEventAggregate, placeBySlug, placeFields, placeLinkStatements, planAddPlace, planRemovePlace, planSetPrimary, withRevision } from '../data'
import { ToolError, uuid } from '../util'

const esc = (q: string) => q.replace(/[\\%_]/g, (c) => '\\' + c)

export function registerPlaceTools(server: McpServer, ctx: ToolCtx) {
  const { db, actor } = ctx

  defineTool(server, ctx, 'find_place', {
    title: 'Find place',
    description: 'Search places already in the database and the built-in Arabian Peninsula gazetteer (names in Bangla/English/Arabic). Each result has type (region | city | site), parent and the map zoom used for it. Gazetteer hits not yet in the database have in_database: false; pass them to create_place. Coordinates are approximate until verified.',
    access: 'read',
    input: z.object({ query: z.string().trim().min(1).max(80), limit: z.number().int().min(1).max(25).default(10) }),
  }, async ({ query, limit }) => {
    const q = `%${esc(query)}%`
    const rows = await db.select({ p: s.places, name: s.placeTranslations.name, lang: s.placeTranslations.lang }).from(s.places)
      .leftJoin(s.placeTranslations, eq(s.placeTranslations.placeId, s.places.id))
      .where(or(sql`${s.places.slug} like ${q} escape '\\'`, sql`${s.placeTranslations.name} like ${q} escape '\\'`))
      .orderBy(asc(s.places.slug))
    const dbHits = new Map<string, ReturnType<typeof placeFields> & { names: Record<string, string>; in_database: true }>()
    const parentSlug = new Map((await db.select({ id: s.places.id, slug: s.places.slug }).from(s.places)).map((x) => [x.id, x.slug]))
    for (const r of rows) {
      const h = dbHits.get(r.p.slug) ?? { ...placeFields(r.p, r.p.parentPlaceId ? parentSlug.get(r.p.parentPlaceId) ?? null : null), names: {}, in_database: true as const }
      if (r.name && r.lang) h.names[r.lang] = r.name
      dbHits.set(r.p.slug, h)
    }
    const ql = query.toLowerCase()
    const gaz = GAZETTEER_SEED
      .filter((g) => !dbHits.has(g.slug) && (g.slug.includes(ql) || Object.values(g.names).some((n) => n.toLowerCase().includes(ql))))
      .map((g) => ({ slug: g.slug, type: g.type, lat: g.lat, lng: g.lng, verified: false, parent: g.parent ?? null, zoom: placeZoom(g.type, g.zoom), names: g.names, in_database: false as const }))
    return { results: [...dbHits.values(), ...gaz].slice(0, limit) }
  })

  /** A place's parent must sit one level up (site → city, city → region) and exist. */
  async function resolveParent(type: PlaceType, parentSlug: string | undefined | null, selfId?: string) {
    if (!parentSlug) return null
    const parent = await placeBySlug(db, parentSlug)
    if (parent.id === selfId) throw new ToolError('A place cannot be its own parent.')
    if (PLACE_LEVEL[parent.type as PlaceType] >= PLACE_LEVEL[type])
      throw new ToolError(`"${parentSlug}" is a ${parent.type}; the parent of a ${type} must be ${type === 'site' ? 'a city (or region)' : type === 'city' ? 'a region' : 'nothing: a region has no parent'}.`)
    return parent
  }

  defineTool(server, ctx, 'create_place', {
    title: 'Create place',
    description: 'Add a place. type is region (map zoom ≈ 6), city (≈ 12) or site (≈ 17: the Kaaba, the Zamzam well, a cave, a battlefield). A site should have parent_place_slug (its city). Optional zoom overrides the default for this place. lat/lng are decimal degrees (latitude first). Rejected outside the Arabian Peninsula unless allow_outside_arabia is true (e.g. Aksum, Bayt al-Maqdis). New places are unverified until the owner calls verify_place.',
    access: 'write',
    input: CreatePlaceSchema,
  }, async (a) => {
    if (await db.query.places.findFirst({ where: eq(s.places.slug, a.slug) })) throw new ToolError(`Place "${a.slug}" already exists. Use find_place.`)
    const parent = await resolveParent(a.type, a.parent_place_slug)
    const id = uuid()
    const { revisionId } = await withRevision(db, actor, {
      entity: 'place', entityId: id, action: 'create',
      build: () => [
        db.insert(s.places).values({ id, slug: a.slug, type: a.type, lat: a.lat, lng: a.lng, verified: false, parentPlaceId: parent?.id ?? null, zoomOverride: a.zoom ?? null }),
        db.insert(s.placeTranslations).values(Object.entries(a.names).map(([lang, name]) => ({ placeId: id, lang, name: name! }))),
      ],
    })
    return { ok: true, slug: a.slug, type: a.type, parent: parent?.slug ?? null, zoom: placeZoom(a.type, a.zoom), verified: false, revision_id: revisionId }
  })

  defineTool(server, ctx, 'update_place', {
    title: 'Update place',
    description: 'Owner only. Change a place\'s type, parent (null clears it) or zoom override (null returns to the type\'s default). Use it to turn an old place into a proper site with a parent city. Coordinates are changed with verify_place.',
    access: 'owner',
    input: z.object({ slug: SlugSchema, type: PlaceTypeSchema.optional(), parent_place_slug: SlugSchema.nullable().optional(), zoom: ZoomSchema.nullable().optional() })
      .refine((v) => v.type !== undefined || v.parent_place_slug !== undefined || v.zoom !== undefined, 'provide type, parent_place_slug and/or zoom'),
  }, async ({ slug, type, parent_place_slug, zoom }) => {
    const p = await placeBySlug(db, slug)
    const newType = (type ?? p.type) as PlaceType
    let parentId = p.parentPlaceId
    if (parent_place_slug !== undefined) parentId = (await resolveParent(newType, parent_place_slug, p.id))?.id ?? null
    else if (type && parentId) { // type changed: the existing parent must still be one level up
      const cur = await db.query.places.findFirst({ where: eq(s.places.id, parentId) })
      if (cur && PLACE_LEVEL[cur.type as PlaceType] >= PLACE_LEVEL[newType]) throw new ToolError(`Changing "${slug}" to ${newType} conflicts with its parent "${cur.slug}" (a ${cur.type}). Pass parent_place_slug too.`)
    }
    const children = await db.select({ slug: s.places.slug, type: s.places.type }).from(s.places).where(eq(s.places.parentPlaceId, p.id))
    const bad = children.find((c) => PLACE_LEVEL[c.type as PlaceType] <= PLACE_LEVEL[newType])
    if (bad) throw new ToolError(`"${bad.slug}" (a ${bad.type}) is inside "${slug}", so it cannot become a ${newType}.`)
    const { revisionId } = await withRevision(db, actor, {
      entity: 'place', entityId: p.id, action: 'update',
      build: () => [db.update(s.places).set({ type: newType, parentPlaceId: parentId, ...(zoom !== undefined ? { zoomOverride: zoom } : {}) }).where(eq(s.places.id, p.id))],
    })
    return { ok: true, slug, type: newType, zoom: placeZoom(newType, zoom === undefined ? p.zoomOverride : zoom), revision_id: revisionId }
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

  // ───────────── places of an event ─────────────
  const eventForPlaces = async (slug: string) => {
    const ev = await eventBySlug(db, slug)
    assertCanEdit(ctx, ev.status)
    return { ev, agg: (await loadEventAggregate(db, ev.id))! }
  }
  const slugMap = async () => new Map((await db.select({ id: s.places.id, slug: s.places.slug }).from(s.places)).map((x) => [x.id, x.slug]))

  defineTool(server, ctx, 'set_primary_place', {
    title: 'Set primary place',
    description: 'Make this place THE primary place of the event (the map flies to it at the place\'s zoom; exactly one primary is required to publish). If the place is not linked yet it is added. The previous primary stays as a related place; remove it with remove_event_place if unwanted.',
    access: 'write',
    input: z.object({ event_slug: SlugSchema, place_slug: SlugSchema }),
  }, async ({ event_slug, place_slug }) => {
    const { ev, agg } = await eventForPlaces(event_slug)
    const place = await placeBySlug(db, place_slug)
    const next = planSetPrimary(linksOf(agg), place.id)
    const { revisionId } = await withRevision(db, actor, { entity: 'event', entityId: ev.id, action: 'set_primary_place', build: () => placeLinkStatements(db, ev.id, next) })
    const slugs = await slugMap()
    return { ok: true, event: event_slug, primary: place_slug, places: next.map((l) => ({ place: slugs.get(l.placeId), role: l.role, order: l.orderIndex })), revision_id: revisionId, live: ev.status === 'published' ? 'WARNING: this event is published, so the map change is already live.' : undefined }
  })

  defineTool(server, ctx, 'add_event_place', {
    title: 'Add event place',
    description: 'Link another place to the event as related (shown as a secondary marker), route_start or route_end (at most one each). The primary place is set only with set_primary_place. With several places the map fits them all in view.',
    access: 'write',
    input: z.object({ event_slug: SlugSchema, place_slug: SlugSchema, role: z.enum(['related', 'route_start', 'route_end']).default('related'), order: z.number().int().min(1).max(50).optional().describe('Position among the places (the primary is always first).') }),
  }, async ({ event_slug, place_slug, role, order }) => {
    const { ev, agg } = await eventForPlaces(event_slug)
    const place = await placeBySlug(db, place_slug)
    const next = planAddPlace(linksOf(agg), place.id, role, order)
    const { revisionId } = await withRevision(db, actor, { entity: 'event', entityId: ev.id, action: 'add_event_place', build: () => placeLinkStatements(db, ev.id, next) })
    const slugs = await slugMap()
    return { ok: true, event: event_slug, places: next.map((l) => ({ place: slugs.get(l.placeId), role: l.role, order: l.orderIndex })), revision_id: revisionId, note: next.some((l) => l.role === 'primary') ? undefined : 'This event still has no primary place: call set_primary_place before publishing.' }
  })

  defineTool(server, ctx, 'remove_event_place', {
    title: 'Remove event place',
    description: 'Unlink a place from the event (the place itself is kept). A published event must keep its primary place: replace it with set_primary_place instead.',
    access: 'write', destructive: true,
    input: z.object({ event_slug: SlugSchema, place_slug: SlugSchema }),
  }, async ({ event_slug, place_slug }) => {
    const { ev, agg } = await eventForPlaces(event_slug)
    const place = await placeBySlug(db, place_slug)
    const next = planRemovePlace(linksOf(agg), place.id, ev.status)
    const { revisionId } = await withRevision(db, actor, { entity: 'event', entityId: ev.id, action: 'remove_event_place', build: () => placeLinkStatements(db, ev.id, next) })
    const slugs = await slugMap()
    return { ok: true, event: event_slug, places: next.map((l) => ({ place: slugs.get(l.placeId), role: l.role, order: l.orderIndex })), revision_id: revisionId, note: next.some((l) => l.role === 'primary') ? undefined : 'This event now has no primary place: call set_primary_place before publishing.' }
  })
}
