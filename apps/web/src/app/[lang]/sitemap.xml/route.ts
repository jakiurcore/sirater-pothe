import { isLang, uiLangs } from '@/lib/i18n'
import { getEnv } from '@/lib/env'
import { listPublishedSlugs } from '@/lib/content'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export async function GET(_req: Request, { params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  if (!isLang(lang)) return new Response('Not found', { status: 404 })
  const origin = (await getEnv()).WEB_ORIGIN.replace(/\/$/, '')
  const slugs = await listPublishedSlugs()
  // An event is listed in a language only if it has a published translation there (or falls back to the default language).
  const urls = [
    { loc: `${origin}/${lang}`, mod: undefined as string | undefined, slug: '' },
    { loc: `${origin}/${lang}/timeline`, mod: undefined, slug: 'timeline' },
    ...slugs.map((s) => ({ loc: `${origin}/${lang}/events/${s.slug}`, mod: s.updatedAt, slug: s.slug })),
  ]
  const alt = (path: string) => uiLangs().map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${origin}/${l}${path}"/>`).join('')
  const body = urls.map((u) => {
    const path = u.loc.slice(`${origin}/${lang}`.length)
    return `  <url><loc>${esc(u.loc)}</loc>${u.mod ? `<lastmod>${u.mod}</lastmod>` : ''}${alt(path)}</url>`
  }).join('\n')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' } })
}
