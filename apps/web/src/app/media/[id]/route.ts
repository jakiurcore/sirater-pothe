import { eq } from 'drizzle-orm'
import { schema as s } from '@seerah/db'
import { getDatabase, getEnv } from '@/lib/env'
import { verifyPreviewToken } from '@/lib/content'

/**
 * Pictures of events, from the MEDIA bucket (uploaded through the MCP server).
 * - published event: public.
 * - draft: only with a valid, unexpired preview token issued for that very event (the preview page adds it to the URLs).
 * Everything else, including unattached uploads, is a plain 404, so ids cannot be probed.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  if (!/^[0-9a-f-]{36}$/.test(id)) return notFound()
  const db = await getDatabase()
  const row = await db.query.media.findFirst({ where: eq(s.media.id, id) })
  if (!row?.eventId) return notFound()
  const ev = await db.query.events.findFirst({ where: eq(s.events.id, row.eventId), columns: { slug: true, status: true } })
  if (!ev) return notFound()
  const published = ev.status === 'published'
  if (!published && !(await verifyPreviewToken(ev.slug, new URL(req.url).searchParams.get('token') ?? undefined)).ok) return notFound()
  const env = await getEnv()
  // ?w=480|960|1600 → the responsive webp copy when it exists (else the original, so a missing size never breaks a page)
  const w = new URL(req.url).searchParams.get('w')
  const variantKey = w && /^\d{3,4}$/.test(w) ? row.variants?.[w] : undefined
  const obj = (variantKey ? await env.MEDIA.get(variantKey) : null) ?? (await env.MEDIA.get(row.r2Key))
  if (!obj) return notFound()
  const isVariant = !!variantKey && obj.key === variantKey
  const headers = new Headers({
    'Content-Type': isVariant ? 'image/webp' : row.mime,
    'Content-Length': String(obj.size),
    'Cache-Control': published ? 'public, max-age=3600, stale-while-revalidate=86400' : 'private, no-store',
    'Content-Disposition': 'inline',
    ETag: obj.httpEtag,
    'Referrer-Policy': 'no-referrer',
  })
  if (published && req.headers.get('if-none-match') === obj.httpEtag) return new Response(null, { status: 304, headers })
  return new Response(obj.body, { headers })
}
