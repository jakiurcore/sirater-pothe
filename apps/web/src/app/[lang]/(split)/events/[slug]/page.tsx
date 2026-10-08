import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isLang, getMessages, makeFmt, uiLangs, hijriLabel, gregLabel } from '@/lib/i18n'
import { getEventPage } from '@/lib/content'
import { EventView } from '@/components/EventView'

export const dynamic = 'force-dynamic'
type P = { params: Promise<{ lang: string; slug: string }> }

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { lang, slug } = await params
  if (!isLang(lang)) return {}
  const page = await getEventPage({ slug, lang })
  if (!page) return { title: makeFmt(lang, getMessages(lang)).t('notfound.title'), robots: { index: false } }
  const f = makeFmt(lang, getMessages(lang))
  const desc = page.summary.length > 180 ? `${page.summary.slice(0, 177).trimEnd()}…` : page.summary
  const url = `/${lang}/events/${slug}`
  return {
    title: page.card.title,
    description: `${hijriLabel(f, page.card.hijriYear)} · ${gregLabel(f, page.card.gregorianApprox)} — ${desc}`,
    // Pages that fall back to another language's text are not indexed; hreflang lists only real translations.
    robots: page.textLang === lang ? undefined : { index: false, follow: true },
    alternates: { canonical: url, languages: Object.fromEntries(page.translatedLangs.filter((l) => uiLangs().includes(l as never)).map((l) => [l, `/${l}/events/${slug}`])) },
    openGraph: { type: 'article', title: page.card.title, description: desc, url, locale: lang },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function EventRoute({ params }: P) {
  const { lang, slug } = await params
  if (!isLang(lang)) notFound()
  const page = await getEventPage({ slug, lang })
  if (!page) notFound()
  return <EventView page={page} lang={lang} />
}
