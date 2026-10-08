import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isLang, getMessages, makeFmt } from '@/lib/i18n'
import { getEventPage, verifyPreviewToken } from '@/lib/content'
import { EventView } from '@/components/EventView'

export const dynamic = 'force-dynamic'
type P = { params: Promise<{ lang: string; slug: string }>; searchParams: Promise<{ token?: string | string[] }> }

export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' }

export default async function PreviewRoute({ params, searchParams }: P) {
  const { lang, slug } = await params
  if (!isLang(lang)) notFound()
  const sp = await searchParams
  const token = Array.isArray(sp.token) ? sp.token[0] : sp.token
  const ok = await verifyPreviewToken(slug, token)
  // Drafts are only ever loaded after the token check; every failure looks the same.
  const page = ok.ok ? await getEventPage({ slug, lang, preview: true }) : null
  if (!ok.ok || !page) {
    const f = makeFmt(lang, getMessages(lang))
    return <div className="ev"><p className="stub">{f.t('preview.invalid')}</p></div>
  }
  return <EventView page={page} lang={lang} preview={{ expiresAt: ok.expiresAt }} />
}
