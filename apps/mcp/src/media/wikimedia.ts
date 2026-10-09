import { MAX_MEDIA_BYTES } from '@seerah/content'
import { ToolError } from '../util'

/** Hosts the server may download from. Everything else is refused (no open proxy, no SSRF). */
export const ALLOWED_HOSTS = ['upload.wikimedia.org', 'commons.wikimedia.org'] as const
const UA = 'SiraterPotheBot/1.0 (https://siraterpotehe.com; image import for a non-commercial Seerah timeline)'
const API = 'https://commons.wikimedia.org/w/api.php'
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp']

export interface CommonsFile {
  title: string
  descriptionUrl: string
  url: string
  thumbUrl: string | null
  mime: string
  size: number
  width: number
  height: number
  license: string
  author: string
  credit: string
}

/** File title ("File:Name.jpg") from a commons.wikimedia.org page URL or an upload.wikimedia.org file/thumbnail URL. */
export function wikimediaTitle(raw: string): string {
  let u: URL
  try { u = new URL(raw) } catch { throw new ToolError('media_url is not a valid URL.') }
  if (u.protocol !== 'https:') throw new ToolError('media_url must be https.')
  if (!(ALLOWED_HOSTS as readonly string[]).includes(u.hostname))
    throw new ToolError(`media_url host "${u.hostname}" is not allowed. The server only downloads from: ${ALLOWED_HOSTS.join(', ')} (Wikimedia Commons, so the licence can be checked). For other images use create_upload_link or create_upload_url.`)
  const dec = (s: string) => decodeURIComponent(s).replace(/_/g, ' ')
  if (u.hostname === 'commons.wikimedia.org') {
    const t = u.searchParams.get('title') ?? (u.pathname.startsWith('/wiki/') ? dec(u.pathname.slice(6)) : '')
    if (/^File:/i.test(t)) return 'File:' + t.slice(5).replace(/_/g, ' ')
    throw new ToolError('Give a Commons file page (https://commons.wikimedia.org/wiki/File:…) or an upload.wikimedia.org file URL.')
  }
  const m = /^\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/.exec(u.pathname)
  if (!m) throw new ToolError('Only Wikimedia COMMONS files are accepted (…/wikipedia/commons/…): files hosted on a single Wikipedia can have a different licence status.')
  return 'File:' + dec(m[1]!)
}

const decodeEntities = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' })[e as string]!)
export const plainText = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()

/**
 * The free-licence gate. Allowed: CC0, public domain, CC BY, CC BY-SA (any version).
 * Refused: NC / ND variants, GFDL alone, "fair use", unknown or missing licences.
 */
export function evaluateLicense(shortName: string | undefined, copyrighted?: string): { ok: true; license: string } | { ok: false; reason: string } {
  const name = (shortName ?? '').trim()
  const n = name.toLowerCase().replace(/[‐–—]/g, '-')
  if (!n) return copyrighted?.toLowerCase() === 'false' ? { ok: true, license: 'Public domain' } : { ok: false, reason: 'no licence is recorded on Commons for this file' }
  if (/(^|[ -])n[cd]([ -]|$)/.test(n)) return { ok: false, reason: `"${name}" restricts commercial use or derivatives (not a free licence for this site)` }
  if (/^cc0\b|^cc[ -]?zero/.test(n)) return { ok: true, license: name }
  if (/^(public domain|pd)(\b|$)/.test(n) || /^pd[ -]/.test(n)) return { ok: true, license: name }
  if (/^cc[ -]by(?:[ -]sa)?(?:[ -]\d(?:\.\d)?)?(?:[ -][a-z]{2,3}(?:-[a-z]+)?)?$/.test(n)) return { ok: true, license: name }
  return { ok: false, reason: `"${name}" is not one of the accepted free licences (CC0, public domain, CC BY, CC BY-SA)` }
}

type Json = Record<string, any>
/** Looks a file up on Commons and decides whether it may be used. `fetchImpl` is injectable for tests. */
export async function commonsFile(title: string, fetchImpl: typeof fetch = fetch): Promise<CommonsFile> {
  const url = `${API}?${new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', titles: title, prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '1600',
    iiextmetadatafilter: 'LicenseShortName|Artist|Credit|Copyrighted|ObjectName|UsageTerms',
  })}`
  let res: Response
  try { res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }) } catch { throw new ToolError('Wikimedia Commons could not be reached; try again in a minute.') }
  if (!res.ok) throw new ToolError(`Wikimedia Commons answered ${res.status}; try again later.`)
  const j = (await res.json()) as Json
  const page = j.query?.pages?.[0]
  const info = page?.imageinfo?.[0]
  if (!page || page.missing || !info) throw new ToolError(`"${title}" does not exist on Wikimedia Commons.`)
  const meta = (k: string): string | undefined => info.extmetadata?.[k]?.value
  const lic = evaluateLicense(meta('LicenseShortName'), meta('Copyrighted'))
  if (!lic.ok) throw new ToolError(`Refused: ${lic.reason}. Only free licences are accepted. Pick another file or upload your own with create_upload_link.`)
  if (!IMAGE_MIME.includes(info.mime)) throw new ToolError(`That file is ${info.mime}; only PNG, JPEG and WebP are accepted (not SVG, TIFF, GIF…).`)
  const author = plainText(meta('Artist') ?? meta('Credit') ?? '') || 'Unknown author'
  const shortAuthor = author.length > 90 ? author.slice(0, 87) + '…' : author
  return {
    title, descriptionUrl: info.descriptionurl as string, url: info.url as string, thumbUrl: (info.thumburl as string | undefined) ?? null,
    mime: info.mime as string, size: Number(info.size) || 0, width: Number(info.width) || 0, height: Number(info.height) || 0,
    license: lic.license, author: shortAuthor, credit: `${shortAuthor}, ${lic.license}, via Wikimedia Commons`,
  }
}

/** Downloads at most MAX_MEDIA_BYTES from an allow-listed host, following redirects only to allow-listed hosts. */
export async function safeDownload(url: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  let cur = url
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(cur)
    if (u.protocol !== 'https:' || !(ALLOWED_HOSTS as readonly string[]).includes(u.hostname)) throw new ToolError(`Refusing to download from ${u.hostname}.`)
    const res = await fetchImpl(cur, { redirect: 'manual', headers: { 'User-Agent': UA } })
    if (res.status >= 300 && res.status < 400) { const loc = res.headers.get('location'); if (!loc) throw new ToolError('Redirect without a location.'); cur = new URL(loc, cur).toString(); continue }
    if (!res.ok) throw new ToolError(`Download failed with status ${res.status}.`)
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_MEDIA_BYTES) throw new ToolError(`The file is ${len} bytes; the limit is ${MAX_MEDIA_BYTES}.`)
    const reader = res.body?.getReader()
    if (!reader) throw new ToolError('Empty download.')
    const chunks: Uint8Array[] = []
    let got = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      got += value.length
      if (got > MAX_MEDIA_BYTES) { await reader.cancel(); throw new ToolError(`The file is larger than the ${MAX_MEDIA_BYTES}-byte limit.`) }
      chunks.push(value)
    }
    const out = new Uint8Array(got)
    let o = 0
    for (const c of chunks) { out.set(c, o); o += c.length }
    return out
  }
  throw new ToolError('Too many redirects.')
}

/** One call: URL → checked Commons metadata + the bytes (the 1600 px copy when the original is over the size limit). */
export async function importFromWikimedia(rawUrl: string, fetchImpl: typeof fetch = fetch): Promise<{ file: CommonsFile; bytes: Uint8Array }> {
  const file = await commonsFile(wikimediaTitle(rawUrl), fetchImpl)
  const useThumb = file.size > MAX_MEDIA_BYTES && file.thumbUrl
  if (file.size > MAX_MEDIA_BYTES && !file.thumbUrl) throw new ToolError(`The original is ${file.size} bytes (limit ${MAX_MEDIA_BYTES}) and Commons offers no smaller copy.`)
  const bytes = await safeDownload(useThumb ? file.thumbUrl! : file.url, fetchImpl)
  return { file, bytes }
}
