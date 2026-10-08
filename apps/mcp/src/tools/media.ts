import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import { schema as s } from '@seerah/db'
import { SlugSchema, UploadMediaSchema } from '@seerah/content'
import { assertCanEdit, defineTool, type ToolCtx } from './kit'
import { eventBySlug } from '../data'
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

export function registerMediaTools(server: McpServer, ctx: ToolCtx) {
  const { db, env } = ctx

  defineTool(server, ctx, 'upload_media', {
    title: 'Upload media (no people)',
    description: 'Upload an image to R2. NEVER depicts people: the Prophet ﷺ, other prophets, companions, family members or angels must not appear in any form (no drawings, silhouettes or faces). kind must be one of map, landscape, architecture, object, pattern, calligraphy; anything else is rejected. Alt text is required. Max 5 MB; PNG/JPEG/WebP/AVIF only.',
    access: 'write',
    input: z.object({ event_slug: SlugSchema.optional() }).extend(UploadMediaSchema.shape),
  }, async (a) => {
    const ev = a.event_slug ? await eventBySlug(db, a.event_slug) : null
    if (ev) assertCanEdit(ctx, ev.status)
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
    try {
      await db.batch([
        db.insert(s.media).values({ id, r2Key: key, kind: a.kind, mime: a.mime, bytes: bytes.length, eventId: ev?.id ?? null }),
        db.insert(s.mediaAlt).values(Object.entries(a.alt).map(([lang, alt]) => ({ mediaId: id, lang, alt: alt! }))),
      ])
    } catch (e) {
      await env.MEDIA.delete(key)
      throw e
    }
    return { ok: true, media_id: id, r2_key: key, kind: a.kind, bytes: bytes.length, event: a.event_slug ?? null, reminder: 'The owner should still visually confirm the image contains no people.' }
  })

}
