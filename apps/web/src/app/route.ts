import { cookies, headers } from 'next/headers'
import { negotiateLang } from '@/lib/i18n'

/** "/" → the reader's language: remembered choice (cookie), else Accept-Language, else Bangla. */
export async function GET(req: Request) {
  const lang = negotiateLang((await headers()).get('accept-language'), (await cookies()).get('seerah-lang')?.value)
  return new Response(null, { status: 307, headers: { Location: new URL(`/${lang}`, req.url).toString(), Vary: 'Accept-Language, Cookie' } })
}
