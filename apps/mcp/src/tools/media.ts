import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { schema as s } from '@seerah/db'
import { PlacementFields, SlugSchema, UploadMediaSchema, placementProblem, type MediaPlacement } from '@seerah/content'
import { assertCanEdit, defineTool, type ToolCtx } from './kit'
import { eq } from 'drizzle-orm'
import { eventBySlug, keyDetailCount, loadEventAggregate, touch, withRevision, type EventAggregate } from '../data'
import { ToolError, uuid } from '../util'

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif' }

/** Content sniffing so the declared mime can't disguise something else (e.g. SVG/HTML). */
export function sniffMime(b: Uint8Array): string | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x)
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  if (at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73))) return 'image/avif'
  return null
}

/** Pixel size from the file header (PNG, JPEG, WebP, AVIF), so pages can reserve space before the image loads. null if not found. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i]! << 8) | b[i + 1]!
  const u32be = (i: number) => ((b[i]! * 2 ** 24) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!)
  const ok = (w: number, h: number) => (w > 0 && h > 0 && w < 65536 && h < 65536 ? { width: w, height: h } : null)
  const ascii = (i: number, t: string) => [...t].every((c, k) => b[i + k] === c.charCodeAt(0))
  if (b.length > 24 && b[0] === 0x89 && ascii(1, 'PNG')) return ok(u32be(16), u32be(20))
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]!
      if (m === 0xff) { i++; continue }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(u16be(i + 7), u16be(i + 5))
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue }
      i += 2 + u16be(i + 2)
    }
    return null
  }
  if (b.length > 30 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    if (ascii(12, 'VP8X')) return ok(1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)))
    if (ascii(12, 'VP8L')) return ok(1 + (((b[22]! & 0x3f) << 8) | b[21]!), 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)))
    if (ascii(12, 'VP8 ')) return ok((b[26]! | (b[27]! << 8)) & 0x3fff, (b[28]! | (b[29]! << 8)) & 0x3fff)
    return null
  }
  if (b.length > 12 && ascii(4, 'ftyp')) {
    for (let i = 8; i + 20 < Math.min(b.length, 65536); i++) if (ascii(i, 'ispe')) return ok(u32be(i + 8), u32be(i + 12))
  }
  return null
}

/** Next free order number among an event's pictures with this placement. */
const nextOrder = (agg: EventAggregate, placement: MediaPlacement, skipId?: string) =>
  agg.media.filter((m) => m.media.placement === placement && m.media.id !== skipId).reduce((n, m) => Math.max(n, m.media.orderIndex + 1), 0)

export function registerMediaTools(server: McpServer, ctx: ToolCtx) {
  const { db, env, actor } = ctx

  defineTool(server, ctx, 'upload_media', {
    title: 'Upload media (no people)',
    description: 'Upload an image to R2. NEVER depicts people: the Prophet ﷺ, other prophets, companions, family members or angels must not appear in any form (no drawings, silhouettes or faces). kind must be one of map, landscape, architecture, object, pattern, calligraphy; anything else is rejected. Alt text is required (caption and credit are optional). Max 5 MB; PNG/JPEG/WebP/AVIF only. With event_slug the picture is attached to that event at a structured placement: hero | after_summary | in_key_details (+ after_key_detail_index, 0-based) | before_lessons | gallery (default). Never put markers in text; placement is the only way.',
    access: 'write',
    input: z.object({ event_slug: SlugSchema.optional() }).extend(UploadMediaSchema.shape),
  }, async (a) => {
    const ev = a.event_slug ? await eventBySlug(db, a.event_slug) : null
    if (ev) assertCanEdit(ctx, ev.status)
    const agg = ev ? (await loadEventAggregate(db, ev.id))! : null
    const pp = placementProblem(a, agg ? keyDetailCount(agg) : undefined)
    if (pp) throw new ToolError(pp)
    if (!ev && (a.placement !== 'gallery' || a.order !== undefined)) throw new ToolError('placement only applies once the picture belongs to an event: pass event_slug (or upload first, then attach_media).')
    for (const l of Object.keys(a.caption ?? {})) if (!a.alt[l as keyof typeof a.alt]) throw new ToolError(`A "${l}" caption needs alt text in "${l}" too.`)
    let bytes: Uint8Array
    try {
      const bin = atob(a.base64.replace(/^data:[^,]*,/, ''))
      bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    } catch { throw new ToolError('base64 is not valid base64 (send the raw file bytes encoded as base64, without a data: prefix).') }
    if (bytes.length > 5 * 1024 * 1024) throw new ToolError(`Image is ${bytes.length} bytes; the limit is 5242880.`)
    const sniffed = sniffMime(bytes)
    if (!sniffed) throw new ToolError('File content is not a PNG, JPEG, WebP or AVIF image. SVG and other formats are not accepted.')
    if (sniffed !== a.mime) throw new ToolError(`Declared mime ${a.mime} does not match the file content (${sniffed}).`)
    const id = uuid()
    const key = `media/${id}.${EXT[a.mime]}`
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: a.mime, cacheControl: 'public, max-age=31536000, immutable' }, customMetadata: { kind: a.kind } })
    const size = imageSize(bytes)
    const row = {
      id, r2Key: key, kind: a.kind, mime: a.mime, bytes: bytes.length, eventId: ev?.id ?? null, placement: a.placement,
      afterKeyDetailIndex: a.placement === 'in_key_details' ? a.after_key_detail_index! : null,
      orderIndex: a.order ?? (agg ? nextOrder(agg, a.placement) : 0), credit: a.credit ?? null, width: size?.width ?? null, height: size?.height ?? null,
    }
    const alts = Object.entries(a.alt).map(([lang, alt]) => ({ mediaId: id, lang, alt: alt!, caption: a.caption?.[lang as keyof typeof a.alt] ?? null }))
    let revisionId: string | undefined
    try {
      if (ev) revisionId = (await withRevision(db, actor, { entity: 'event', entityId: ev.id, action: 'upload_media', build: () => [db.insert(s.media).values(row), db.insert(s.mediaAlt).values(alts), touch(db, ev.id)] })).revisionId
      else await db.batch([db.insert(s.media).values(row), db.insert(s.mediaAlt).values(alts)])
    } catch (e) {
      await env.MEDIA.delete(key)
      throw e
    }
    return { ok: true, media_id: id, r2_key: key, kind: a.kind, bytes: bytes.length, width: row.width, height: row.height, event: a.event_slug ?? null, placement: ev ? a.placement : null, after_key_detail_index: row.afterKeyDetailIndex, revision_id: revisionId, reminder: 'The owner should still visually confirm the image contains no people.' }
  })

  const mediaWithEvent = async (mediaId: string) => {
    const m = await db.query.media.findFirst({ where: eq(s.media.id, mediaId) })
    if (!m) throw new ToolError(`No picture "${mediaId}". media_id comes from upload_media or get_event → media.`)
    return m
  }

  defineTool(server, ctx, 'attach_media', {
    title: 'Attach uploaded picture to an event',
    description: 'Attach a picture that was uploaded without event_slug to an event, at a structured placement (hero | after_summary | in_key_details + after_key_detail_index | before_lessons | gallery). Only for pictures not attached to any event; use set_media_placement to move one that is.',
    access: 'write',
    input: z.object({ media_id: z.string().min(8).max(64), event_slug: SlugSchema, ...PlacementFields }),
  }, async ({ media_id, event_slug, placement, after_key_detail_index, order }) => {
    const m = await mediaWithEvent(media_id)
    if (m.eventId) throw new ToolError('That picture is already attached to an event. Use set_media_placement to change where it sits.')
    const ev = await eventBySlug(db, event_slug)
    assertCanEdit(ctx, ev.status)
    const agg = (await loadEventAggregate(db, ev.id))!
    const pp = placementProblem({ placement, after_key_detail_index }, keyDetailCount(agg))
    if (pp) throw new ToolError(pp)
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'attach_media',
      build: () => [db.update(s.media).set({ eventId: ev.id, placement, afterKeyDetailIndex: placement === 'in_key_details' ? after_key_detail_index! : null, orderIndex: order ?? nextOrder(agg, placement) }).where(eq(s.media.id, m.id)), touch(db, ev.id)],
    })
    return { ok: true, media_id, event: event_slug, placement, after_key_detail_index: placement === 'in_key_details' ? after_key_detail_index : null, revision_id: revisionId }
  })

  defineTool(server, ctx, 'set_media_placement', {
    title: 'Set picture placement',
    description: 'Move a picture inside its event page: hero (under the title) | after_summary | in_key_details (needs after_key_detail_index, 0-based: 0 = after the FIRST key detail; the index must exist in the default-language key_details) | before_lessons | gallery. order sorts pictures that share a placement. Structured placement only: never put markers in text. Published events change live; revert_revision undoes it.',
    access: 'write',
    input: z.object({ media_id: z.string().min(8).max(64), ...PlacementFields, placement: PlacementFields.placement.unwrap() }),
  }, async ({ media_id, placement, after_key_detail_index, order }) => {
    const m = await mediaWithEvent(media_id)
    if (!m.eventId) throw new ToolError('That picture is not attached to an event yet. Use attach_media.')
    const ev = (await db.query.events.findFirst({ where: eq(s.events.id, m.eventId) }))!
    assertCanEdit(ctx, ev.status)
    const agg = (await loadEventAggregate(db, ev.id))!
    const pp = placementProblem({ placement, after_key_detail_index }, keyDetailCount(agg))
    if (pp) throw new ToolError(pp)
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'set_media_placement',
      build: () => [db.update(s.media).set({ placement, afterKeyDetailIndex: placement === 'in_key_details' ? after_key_detail_index! : null, orderIndex: order ?? (m.placement === placement ? m.orderIndex : nextOrder(agg, placement, m.id)) }).where(eq(s.media.id, m.id)), touch(db, ev.id)],
    })
    return { ok: true, media_id, event: ev.slug, placement, after_key_detail_index: placement === 'in_key_details' ? after_key_detail_index : null, revision_id: revisionId, live: ev.status === 'published' ? 'WARNING: this event is published, so the change is already live.' : undefined }
  })
}
