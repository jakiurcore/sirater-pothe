import { eq } from 'drizzle-orm'
import { schema as s } from '@seerah/db'
import type { Db } from '@seerah/db'
import { MAX_MEDIA_BYTES, placementProblem, type Placement } from '@seerah/content'
import type { Actor, Env } from '../env'
import { countsFor, loadEventAggregate, touch, withRevision, type EventAggregate } from '../data'
import { ToolError, uuid } from '../util'
import { stripMetadata, hasMetadata } from './strip'
import { VARIANT_WIDTHS, imagesProcessor, type ImageProcessor } from './process'

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** Content sniffing so the declared type (or file extension) can't disguise something else (e.g. SVG/HTML). PNG, JPEG, WebP only. */
export function sniffMime(b: Uint8Array): string | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x)
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

/** Pixel size from the file header (PNG, JPEG, WebP), so pages can reserve space before the image loads. null if not found. */
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
  }
  return null
}

/** Next free order inside a slot: pictures and ayat share slots, so look at both. */
export function nextSlotOrder(agg: Pick<EventAggregate, 'media' | 'ayat'>, placement: string, afterIndex: number | null, skip?: { kind: 'media' | 'ayah'; id: string }): number {
  const same = (p: string, i: number | null) => p === placement && (i ?? null) === (afterIndex ?? null)
  let next = 0
  for (const m of agg.media) if (same(m.media.placement, m.media.afterIndex) && !(skip?.kind === 'media' && skip.id === m.media.id)) next = Math.max(next, m.media.orderIndex + 1)
  for (const a of agg.ayat) if (same(a.placement, a.afterIndex) && !(skip?.kind === 'ayah' && skip.id === a.ayahId)) next = Math.max(next, a.orderIndex + 1)
  return next
}

/** Throws a ToolError with the valid range when the slot does not exist in the event's text. */
export function assertSlot(agg: EventAggregate, kind: 'media' | 'ayah', p: { placement: Placement; after_index?: number | null }) {
  const problem = placementProblem(p, kind, countsFor(agg))
  if (problem) throw new ToolError(problem)
}

export interface IngestMeta {
  kind: string
  alt: Record<string, string | undefined>
  caption?: Record<string, string | undefined>
  credit?: string
  license?: string
  author?: string
  sourceUrl?: string
  placement: Placement
  after_index?: number | null
  order?: number
}
export interface IngestInput {
  bytes: Uint8Array
  declaredMime?: string
  meta: IngestMeta
  eventId: string | null
  actor: Pick<Actor, 'login' | 'role'>
  via: string
}
export interface Ingested {
  media_id: string; r2_key: string; kind: string; bytes: number; width: number | null; height: number | null
  placement: string | null; after_index: number | null; event: string | null; revision_id?: string
  variants: number[]; metadata_removed: string[]; sha256: string; processing: string
}

/**
 * The one pipeline every upload path ends in (base64, URL, signed PUT, upload link, chunks):
 * size → sniff the real type → strip EXIF/XMP/IPTC → (bake rotation) → hash → responsive webp copies → R2 → database (+ revision).
 */
export async function ingestImage(env: Env, db: Db, input: IngestInput, processor: ImageProcessor | null = imagesProcessor(env.IMAGES as never)): Promise<Ingested> {
  const { bytes, meta } = input
  if (bytes.length === 0) throw new ToolError('The file is empty.')
  if (bytes.length > MAX_MEDIA_BYTES) throw new ToolError(`Image is ${bytes.length} bytes; the limit is ${MAX_MEDIA_BYTES} (10 MB).`)
  const sniffed = sniffMime(bytes)
  if (!sniffed) throw new ToolError('File content is not a PNG, JPEG or WebP image (the extension is not trusted). SVG, GIF, AVIF and others are not accepted.')
  if (input.declaredMime && input.declaredMime !== sniffed) throw new ToolError(`Declared type ${input.declaredMime} does not match the file content (${sniffed}).`)
  if (!imageSize(bytes)) throw new ToolError('The image header is unreadable or the file is corrupt.')

  // Where it goes, validated against the text as it is now.
  let agg: EventAggregate | null = null
  let ev: typeof s.events.$inferSelect | null = null
  if (input.eventId) {
    ev = (await db.query.events.findFirst({ where: eq(s.events.id, input.eventId) })) ?? null
    if (!ev) throw new ToolError('The event this upload was meant for no longer exists.')
    if (input.actor.role === 'editor' && ev.status !== 'draft') throw new ToolError(`This event is ${ev.status}; editors can only add pictures to drafts.`)
    agg = (await loadEventAggregate(db, ev.id))!
    assertSlot(agg, 'media', { placement: meta.placement, after_index: meta.after_index })
  } else {
    const p = placementProblem({ placement: meta.placement, after_index: meta.after_index }, 'media')
    if (p) throw new ToolError(p)
    if (meta.placement !== 'gallery' || meta.order !== undefined) throw new ToolError('A placement only applies once the picture belongs to an event: pass event_slug (or upload first, then attach_media).')
  }
  for (const l of Object.keys(meta.caption ?? {})) if (!meta.alt[l]) throw new ToolError(`A "${l}" caption needs alt text in "${l}" too.`)

  // Metadata: strip it (EXIF/GPS, XMP, IPTC, comments). A rotated file needs its rotation baked in first.
  let mime = sniffed
  let work: Uint8Array
  let removed: string[]
  let stripped
  try { stripped = stripMetadata(bytes, sniffed) } catch (e) { throw new ToolError(`The image is corrupt: ${(e as Error).message}.`) }
  removed = stripped.removed
  work = stripped.bytes
  if (stripped.orientation !== 1) {
    const baked = processor ? await processor.bakeOrientation(bytes, sniffed) : null
    if (!baked) throw new ToolError(`The photo is stored rotated (EXIF orientation ${stripped.orientation}); removing the metadata would show it sideways and this server cannot rotate it right now. Rotate it upright and upload again.`)
    mime = sniffMime(baked) ?? sniffed
    try { const again = stripMetadata(baked, mime); work = again.bytes; removed = [...removed, ...again.removed] } catch { work = baked }
  }
  if (hasMetadata(work, mime)) throw new ToolError('Metadata could not be removed from this file; it was not stored.')
  const dims = imageSize(work)!

  const id = uuid()
  const key = `media/${id}.${EXT[mime]}`
  const hash = await sha256Bytes(work)
  const variants: Record<string, string> = {}
  let processing = 'original only (no resizing available)'
  if (processor) {
    for (const w of VARIANT_WIDTHS) {
      if (w >= dims.width) continue
      const v = await processor.resize(work, w)
      if (!v) { processing = 'resizing failed; original only'; break }
      variants[String(w)] = `media/${id}-${w}.webp`
      await env.MEDIA.put(variants[String(w)]!, v, { httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' } })
      processing = `resized to ${Object.keys(variants).join('/')} px`
    }
    if (!Object.keys(variants).length && processing.startsWith('original')) processing = 'original is already small; no larger copies needed'
  }
  await env.MEDIA.put(key, work, { httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' }, customMetadata: { kind: meta.kind } })

  const order = meta.order ?? (agg ? nextSlotOrder(agg, meta.placement, meta.after_index ?? null) : 0)
  const row = {
    id, r2Key: key, kind: meta.kind as typeof s.media.$inferInsert['kind'], mime, bytes: work.length, eventId: ev?.id ?? null, placement: meta.placement,
    afterIndex: (['in_summary', 'in_key_details', 'in_lessons'] as string[]).includes(meta.placement) ? meta.after_index ?? null : null,
    orderIndex: order, credit: meta.credit ?? null, license: meta.license ?? null, author: meta.author ?? null, sourceUrl: meta.sourceUrl ?? null,
    width: dims.width, height: dims.height, variants: Object.keys(variants).length ? variants : null, sha256: hash,
  }
  const alts = Object.entries(meta.alt).filter(([, a]) => !!a).map(([lang, alt]) => ({ mediaId: id, lang, alt: alt!, caption: meta.caption?.[lang] ?? null }))
  let revisionId: string | undefined
  try {
    if (ev) revisionId = (await withRevision(db, input.actor as Actor, { entity: 'event', entityId: ev.id, action: 'upload_media', build: () => [db.insert(s.media).values(row), db.insert(s.mediaAlt).values(alts), touch(db, ev!.id)] })).revisionId
    else await db.batch([db.insert(s.media).values(row), db.insert(s.mediaAlt).values(alts)])
  } catch (e) {
    await env.MEDIA.delete([key, ...Object.values(variants)])
    throw e
  }
  return {
    media_id: id, r2_key: key, kind: meta.kind, bytes: work.length, width: dims.width, height: dims.height, placement: ev ? meta.placement : null,
    after_index: row.afterIndex, event: ev?.slug ?? null, revision_id: revisionId, variants: Object.keys(variants).map(Number), metadata_removed: removed, sha256: hash, processing,
  }
}

export async function sha256Bytes(b: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource))].map((x) => x.toString(16).padStart(2, '0')).join('')
}
