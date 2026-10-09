import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/server'
import { schema as s } from '@seerah/db'
import { MAX_MEDIA_BYTES, MediaMetaShape, PlacementFields, SlugSchema, ALLOWED_MEDIA_MIME, LangSchema } from '@seerah/content'
import { assertCanEdit, defineTool, type ToolCtx } from './kit'
import { eventBySlug, loadEventAggregate, touch, withRevision } from '../data'
import { ToolError, nowIso, sha256Hex, uuid } from '../util'
import { assertSlot, ingestImage, nextSlotOrder, sha256Bytes, type IngestMeta } from '../media/ingest'
import { importFromWikimedia } from '../media/wikimedia'
import { CHUNK_SIZE, SESSION_TTL_MS, chunkCount, chunkKey, createUploadToken, rateLimit } from '../media/uploads'

export { sniffMime, imageSize } from '../media/ingest'

const INDEXED = ['in_summary', 'in_key_details', 'in_lessons']
const metaOf = (a: z.infer<z.ZodObject<typeof MediaMetaShape>>): IngestMeta => ({
  kind: a.kind, alt: a.alt, caption: a.caption, credit: a.credit, placement: a.placement, after_index: a.after_index, order: a.order,
})

export function registerMediaTools(server: McpServer, ctx: ToolCtx) {
  const { db, env, actor } = ctx
  const actorShort = { login: actor.login, role: actor.role }

  /** Event for an upload tool: must exist, be editable by this user, and the slot must exist in its text right now. */
  const boundEvent = async (slug: string, meta: IngestMeta) => {
    const ev = await eventBySlug(db, slug)
    assertCanEdit(ctx, ev.status)
    assertSlot((await loadEventAggregate(db, ev.id))!, 'media', { placement: meta.placement, after_index: meta.after_index })
    return ev
  }
  const limitTokens = async () => {
    const rl = await rateLimit(env.DB, `upl-create:${actor.login}`, { max: 20, windowMs: 3600_000 })
    if (!rl.allowed) throw new ToolError(`Too many upload links created; wait about ${Math.ceil(rl.retryAfterSec / 60)} minutes.`)
  }

  // ───────────── 1. in the message (small pictures) or by URL ─────────────
  defineTool(server, ctx, 'upload_media', {
    title: 'Upload media (no people)',
    description: `Add a picture to the site. NEVER depicts people: the Prophet ﷺ, other prophets, companions, family members or angels must not appear in any form (no drawings, silhouettes or faces). kind must be map, landscape, architecture, object, pattern or calligraphy. Alt text is required; caption and credit are optional. PNG/JPEG/WebP only (the real content is checked), max 10 MB. EXIF/GPS and other metadata are always removed, and 480/960/1600 px webp copies are made.
TWO sources, give exactly one: base64 (only for SMALL images, roughly under 1 MB: bigger messages fail in many clients, use create_upload_link, create_upload_url or the chunked tools instead) or media_url: the server downloads it itself, ONLY from Wikimedia Commons (upload.wikimedia.org or commons.wikimedia.org file pages). For Commons files the licence, author and credit are fetched automatically and the file is REFUSED unless it is CC0, public domain, CC BY or CC BY-SA.
With event_slug the picture is placed in the event page at placement (see get_event_layout; gallery is the default). Never put markers in text; placement is the only way.`,
    access: 'write',
    input: z.object({
      event_slug: SlugSchema.optional(),
      ...MediaMetaShape,
      mime: z.enum(ALLOWED_MEDIA_MIME).optional().describe('Optional; the content is sniffed. If given it must match.'),
      base64: z.string().min(1).optional().describe('Raw file bytes as base64, no data: prefix. Small images only.'),
      media_url: z.string().url().optional().describe('A Wikimedia Commons file page or upload.wikimedia.org URL.'),
    }),
  }, async (a) => {
    if (!!a.base64 === !!a.media_url) throw new ToolError('Give exactly one of base64 or media_url.')
    const meta = metaOf(a)
    const ev = a.event_slug ? await eventBySlug(db, a.event_slug) : null
    if (ev) assertCanEdit(ctx, ev.status)
    let bytes: Uint8Array
    let extra: Partial<IngestMeta> = {}
    let source: Record<string, unknown> | undefined
    if (a.media_url) {
      const { file, bytes: got } = await importFromWikimedia(a.media_url)
      bytes = got
      extra = { license: file.license, author: file.author, sourceUrl: file.descriptionUrl, credit: a.credit ?? file.credit }
      source = { source: 'Wikimedia Commons', title: file.title, license: file.license, author: file.author, page: file.descriptionUrl, credit: extra.credit }
    } else {
      try {
        const bin = atob(a.base64!.replace(/^data:[^,]*,/, ''))
        bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
      } catch { throw new ToolError('base64 is not valid base64 (send the raw file bytes encoded as base64, without a data: prefix).') }
    }
    const out = await ingestImage(env, db, { bytes, declaredMime: a.mime, meta: { ...meta, ...extra }, eventId: ev?.id ?? null, actor: actorShort, via: a.media_url ? 'url' : 'base64' })
    return { ok: true, ...out, ...(source ? { wikimedia: source } : {}), reminder: 'The owner should still visually confirm the image contains no people.' }
  })

  // ───────────── 2. a signed PUT URL (clients with a shell) ─────────────
  defineTool(server, ctx, 'create_upload_url', {
    title: 'Create a signed upload URL (curl)',
    description: `For clients with a shell: returns a SINGLE-USE URL, valid 15 minutes, that accepts one image with HTTP PUT (body = the file bytes) and stores it exactly as upload_media would. Event, kind, placement, after_index and alt text are bound to the URL, so the upload cannot go anywhere else. PNG/JPEG/WebP, max 10 MB, metadata stripped. Example: curl -sS -X PUT --data-binary @photo.jpg "<upload_url>". The token is shown once. After the upload, call get_event to see the picture.`,
    access: 'write',
    input: z.object({ event_slug: SlugSchema, ...MediaMetaShape }),
  }, async (a) => {
    const meta = metaOf(a)
    const ev = await boundEvent(a.event_slug, meta)
    await limitTokens()
    const { token, expiresAt } = await createUploadToken(db, { mode: 'put', createdBy: actor.login, eventId: ev.id, meta })
    const url = `${env.MCP_ORIGIN.replace(/\/$/, '')}/upload/${token}`
    return { ok: true, upload_url: url, method: 'PUT', expires_at: expiresAt, single_use: true, limits: { max_bytes: MAX_MEDIA_BYTES, types: ['png', 'jpeg', 'webp'] }, curl: `curl -sS -X PUT --data-binary @FILE "${url}"`, bound_to: { event: a.event_slug, kind: a.kind, placement: a.placement, after_index: a.after_index ?? null } }
  })

  // ───────────── 3. a link to a minimal upload page (the owner picks the file) ─────────────
  defineTool(server, ctx, 'create_upload_link', {
    title: 'Create an upload link for the owner',
    description: `Returns a short-lived (30 minutes), SINGLE-USE link to a minimal upload page on the site, in Bangla. Give it to the owner: they open it, pick ONE file, see a preview, tick that the picture shows no people, and confirm. Kind, placement and alt text are already filled in from this call. This is not an admin panel: no login, no browsing, one file per link. Use it when the picture is on the owner's phone or computer and cannot be reached by URL.`,
    access: 'write',
    input: z.object({ event_slug: SlugSchema, ...MediaMetaShape, lang: LangSchema.default('bn').describe('Language of the upload page.') }),
  }, async ({ event_slug, lang, ...a }) => {
    const meta = metaOf(a as never)
    const ev = await boundEvent(event_slug, meta)
    await limitTokens()
    const { token, expiresAt } = await createUploadToken(db, { mode: 'link', createdBy: actor.login, eventId: ev.id, meta })
    return { ok: true, upload_link: `${env.WEB_ORIGIN.replace(/\/$/, '')}/${lang}/upload/${token}`, expires_at: expiresAt, single_use: true, give_this_to: 'the owner (open it in a browser)', limits: { max_bytes: MAX_MEDIA_BYTES, types: ['png', 'jpeg', 'webp'] }, bound_to: { event: event_slug, kind: a.kind, placement: a.placement, after_index: a.after_index ?? null } }
  })

  // ───────────── 4. chunked upload (fallback when nothing else works) ─────────────
  defineTool(server, ctx, 'upload_media_begin', {
    title: 'Start a chunked upload',
    description: `Fallback for clients that can only send small JSON messages and have no shell. Step 1 of 3: give the total size in bytes and the SHA-256 (hex) of the WHOLE file plus the same metadata as upload_media. Then split the file into ${CHUNK_SIZE}-byte chunks (the last one is smaller), send each with upload_media_chunk (index from 0, base64 and that chunk's SHA-256), then call upload_media_finish. A chunk whose hash does not match is refused and must be sent again. The session lasts 1 hour. Prefer create_upload_link or create_upload_url when possible.`,
    access: 'write',
    input: z.object({ event_slug: SlugSchema.optional(), ...MediaMetaShape, total_size: z.number().int().min(1).max(MAX_MEDIA_BYTES), sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, 'sha256 must be 64 hex characters') }),
  }, async (a) => {
    const meta = metaOf(a)
    if (a.event_slug) await boundEvent(a.event_slug, meta)
    await limitTokens()
    const id = uuid()
    await db.insert(s.uploadSessions).values({ id, createdBy: actor.login, totalSize: a.total_size, sha256: a.sha256.toLowerCase(), chunkSize: CHUNK_SIZE, meta: { ...meta, event_slug: a.event_slug ?? null }, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() })
    return { ok: true, upload_id: id, chunk_size: CHUNK_SIZE, chunk_count: chunkCount(a.total_size), expires_in_minutes: 60, next: 'upload_media_chunk for index 0 … chunk_count-1, then upload_media_finish' }
  })

  const session = async (id: string) => {
    const row = await db.query.uploadSessions.findFirst({ where: eq(s.uploadSessions.id, id) })
    if (!row || row.createdBy !== actor.login) throw new ToolError('No such upload session (it belongs to the user who started it). Start again with upload_media_begin.')
    if (Date.parse(row.expiresAt) <= Date.now()) { await db.delete(s.uploadSessions).where(eq(s.uploadSessions.id, id)); throw new ToolError('This upload session expired. Start again with upload_media_begin.') }
    return row
  }

  defineTool(server, ctx, 'upload_media_chunk', {
    title: 'Send one chunk',
    description: `Step 2 of 3. index starts at 0; every chunk is exactly ${CHUNK_SIZE} bytes except the last. chunk_sha256 is the SHA-256 (hex) of this chunk's bytes. On a hash mismatch nothing is stored and the error names the chunk to send again. Sending a chunk twice is fine (it replaces the earlier one).`,
    access: 'write',
    input: z.object({ upload_id: z.string().min(8).max(64), index: z.number().int().min(0).max(400), base64: z.string().min(1).max(CHUNK_SIZE * 2), chunk_sha256: z.string().regex(/^[0-9a-fA-F]{64}$/) }),
  }, async (a) => {
    const row = await session(a.upload_id)
    const n = chunkCount(row.totalSize)
    if (a.index >= n) throw new ToolError(`index ${a.index} is out of range: this upload has ${n} chunks (0–${n - 1}).`)
    let bytes: Uint8Array
    try { bytes = Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0)) } catch { throw new ToolError(`Chunk ${a.index} is not valid base64. Send chunk ${a.index} again.`) }
    const want = a.index === n - 1 ? row.totalSize - CHUNK_SIZE * (n - 1) : CHUNK_SIZE
    if (bytes.length !== want) throw new ToolError(`Chunk ${a.index} must be ${want} bytes but is ${bytes.length}. Send chunk ${a.index} again with the right slice.`)
    if ((await sha256Bytes(bytes)) !== a.chunk_sha256.toLowerCase()) throw new ToolError(`Chunk ${a.index} hash mismatch: the data arrived damaged or the hash is for a different slice. Send chunk ${a.index} again.`)
    await env.MEDIA.put(chunkKey(row.id, a.index), bytes)
    const have = (await env.MEDIA.list({ prefix: `tmp/${row.id}/` })).objects.length
    return { ok: true, index: a.index, received: have, of: n, remaining: n - have }
  })

  defineTool(server, ctx, 'upload_media_finish', {
    title: 'Finish a chunked upload',
    description: 'Step 3 of 3. Joins the chunks, checks the total size and the SHA-256 of the whole file, then stores the picture exactly as upload_media does. If chunks are missing the error lists their indexes. If the final hash does not match, start over.',
    access: 'write',
    input: z.object({ upload_id: z.string().min(8).max(64) }),
  }, async ({ upload_id }) => {
    const row = await session(upload_id)
    const n = chunkCount(row.totalSize)
    const listed = (await env.MEDIA.list({ prefix: `tmp/${row.id}/`, limit: 1000 })).objects.map((o) => o.key)
    const missing = Array.from({ length: n }, (_, i) => i).filter((i) => !listed.includes(chunkKey(row.id, i)))
    if (missing.length) throw new ToolError(`Missing chunk${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 40).join(', ')}. Send ${missing.length === 1 ? 'it' : 'them'} with upload_media_chunk, then call upload_media_finish again.`)
    const bytes = new Uint8Array(row.totalSize)
    for (let i = 0; i < n; i++) {
      const o = await env.MEDIA.get(chunkKey(row.id, i))
      const b = new Uint8Array(await o!.arrayBuffer())
      if (i * CHUNK_SIZE + b.length > bytes.length) throw new ToolError('The chunks add up to more than total_size. Start again.')
      bytes.set(b, i * CHUNK_SIZE)
    }
    if ((await sha256Bytes(bytes)) !== row.sha256) throw new ToolError('The joined file does not match the SHA-256 given at the start. Some chunk is wrong: start again with upload_media_begin.')
    const m = row.meta as unknown as IngestMeta & { event_slug: string | null }
    const ev = m.event_slug ? await eventBySlug(db, m.event_slug) : null
    if (ev) assertCanEdit(ctx, ev.status)
    const out = await ingestImage(env, db, { bytes, meta: m, eventId: ev?.id ?? null, actor: actorShort, via: 'chunks' })
    await env.MEDIA.delete(Array.from({ length: n }, (_, i) => chunkKey(row.id, i)))
    await db.delete(s.uploadSessions).where(eq(s.uploadSessions.id, row.id))
    return { ok: true, ...out }
  })

  // ───────────── attach / move ─────────────
  const mediaById = async (mediaId: string) => {
    const m = await db.query.media.findFirst({ where: eq(s.media.id, mediaId) })
    if (!m) throw new ToolError(`No picture "${mediaId}". media_id comes from an upload result or get_event → media.`)
    return m
  }

  defineTool(server, ctx, 'attach_media', {
    title: 'Attach uploaded picture to an event',
    description: 'Attach a picture that was uploaded without event_slug to an event, at a placement (hero | in_summary | after_summary | in_key_details | in_lessons | before_lessons | end | gallery; call get_event_layout first). Only for pictures not attached to any event; use set_media_placement to move one that is.',
    access: 'write',
    input: z.object({ media_id: z.string().min(8).max(64), event_slug: SlugSchema, ...PlacementFields }),
  }, async ({ media_id, event_slug, placement, after_index, order }) => {
    const m = await mediaById(media_id)
    if (m.eventId) throw new ToolError('That picture is already attached to an event. Use set_media_placement to change where it sits.')
    const ev = await eventBySlug(db, event_slug)
    assertCanEdit(ctx, ev.status)
    const agg = (await loadEventAggregate(db, ev.id))!
    assertSlot(agg, 'media', { placement, after_index })
    const idx = INDEXED.includes(placement) ? after_index! : null
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'attach_media',
      build: () => [db.update(s.media).set({ eventId: ev.id, placement, afterIndex: idx, orderIndex: order ?? nextSlotOrder(agg, placement, idx) }).where(eq(s.media.id, m.id)), touch(db, ev.id)],
    })
    return { ok: true, media_id, event: event_slug, placement, after_index: idx, revision_id: revisionId }
  })

  defineTool(server, ctx, 'set_media_placement', {
    title: 'Set picture placement',
    description: 'Move a picture inside its event page: hero (under the title) | in_summary (after summary paragraph N) | after_summary | in_key_details (after key detail N) | in_lessons (after lesson N) | before_lessons | end (after the lessons) | gallery. after_index is 0-based and required for the three "in_" placements; it must exist in the text (get_event_layout shows the valid slots). order sorts everything (ayat and pictures) that shares a slot. Published events change live; revert_revision undoes it.',
    access: 'write',
    input: z.object({ media_id: z.string().min(8).max(64), ...PlacementFields, placement: PlacementFields.placement.unwrap() }),
  }, async ({ media_id, placement, after_index, order }) => {
    const m = await mediaById(media_id)
    if (!m.eventId) throw new ToolError('That picture is not attached to an event yet. Use attach_media.')
    const ev = (await db.query.events.findFirst({ where: eq(s.events.id, m.eventId) }))!
    assertCanEdit(ctx, ev.status)
    const agg = (await loadEventAggregate(db, ev.id))!
    assertSlot(agg, 'media', { placement, after_index })
    const idx = INDEXED.includes(placement) ? after_index! : null
    const same = m.placement === placement && (m.afterIndex ?? null) === idx
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'set_media_placement',
      build: () => [db.update(s.media).set({ placement, afterIndex: idx, orderIndex: order ?? (same ? m.orderIndex : nextSlotOrder(agg, placement, idx, { kind: 'media', id: m.id })) }).where(eq(s.media.id, m.id)), touch(db, ev.id)],
    })
    return { ok: true, media_id, event: ev.slug, placement, after_index: idx, revision_id: revisionId, live: ev.status === 'published' ? 'WARNING: this event is published, so the change is already live.' : undefined }
  })
}
