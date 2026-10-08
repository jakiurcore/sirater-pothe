import { getEnv } from '@/lib/env'

/**
 * Serves PMTiles from R2 with HTTP Range support (the pmtiles client reads the archive in slices).
 * Only keys that look like "<name>.pmtiles" are served; the object is immutable per upload, so cache hard.
 */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  if (!/^[a-z0-9-]+\.pmtiles$/.test(file)) return new Response('Not found', { status: 404 })
  const env = await getEnv()
  const head = await env.TILES.head(file)
  if (!head) return new Response('Not found', { status: 404 })
  const base = {
    'Accept-Ranges': 'bytes',
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    ETag: head.httpEtag,
  }
  const range = req.headers.get('range')
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!m || (m[1] === '' && m[2] === '')) {
    const obj = await env.TILES.get(file)
    if (!obj) return new Response('Not found', { status: 404 })
    return new Response(obj.body, { headers: { ...base, 'Content-Length': String(head.size) } })
  }
  const size = head.size
  let start: number, end: number
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1 } else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1) }
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  const obj = await env.TILES.get(file, { range: { offset: start, length: end - start + 1 } })
  if (!obj) return new Response('Not found', { status: 404 })
  return new Response(obj.body, { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } })
}
