import { DEFAULT_LANG } from '@/lib/i18n'

/** "/" → the default-language home. (Language negotiation arrives with the i18n plumbing in phase 4.) */
export function GET(req: Request) {
  return Response.redirect(new URL(`/${DEFAULT_LANG}`, req.url), 307)
}
