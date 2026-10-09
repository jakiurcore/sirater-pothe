import { getPlacesIndex } from '@/lib/content'
import { isLang } from '@/lib/i18n'
import { DEFAULT_LANG } from '@seerah/content/langs'

/**
 * Public places index for the map's "other places" layer: every place plus the PUBLISHED events linked to it.
 * Drafts never appear (the index is built from the published timeline only).
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('lang') ?? DEFAULT_LANG
  const lang = isLang(q) ? q : DEFAULT_LANG
  const places = await getPlacesIndex(lang)
  return Response.json({ lang, places }, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } })
}
