import { uiLangs } from '@/lib/i18n'
import { getEnv } from '@/lib/env'

/** Sitemap index: one sitemap per language (see /[lang]/sitemap.xml). */
export async function GET() {
  const origin = (await getEnv()).WEB_ORIGIN.replace(/\/$/, '')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${uiLangs().map((l) => `  <sitemap><loc>${origin}/${l}/sitemap.xml</loc></sitemap>`).join('\n')}\n</sitemapindex>\n`
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' } })
}
