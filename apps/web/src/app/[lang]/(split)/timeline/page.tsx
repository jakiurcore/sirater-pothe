import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isLang, getMessages, makeFmt, uiLangs } from '@/lib/i18n'
import { TimelineList } from '@/components/TimelineList'
import { TimelineSub } from '@/components/HomeParts'
import { DesktopResume } from '@/components/DesktopResume'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  if (!isLang(lang)) return {}
  const f = makeFmt(lang, getMessages(lang))
  return { title: f.t('timeline.title'), alternates: { canonical: `/${lang}/timeline`, languages: Object.fromEntries(uiLangs().map((l) => [l, `/${l}/timeline`])) } }
}

export default async function TimelinePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  if (!isLang(lang)) notFound()
  const f = makeFmt(lang, getMessages(lang))
  return (
    <>
      <div className="mob-only" style={{ flexDirection: 'column' }}>
        <header className="pagehead">
          <div className="pat" aria-hidden="true" />
          <h1>{f.t('timeline.title')}</h1>
          <TimelineSub />
        </header>
        <div className="tl-wrap"><TimelineList /></div>
      </div>
      <DesktopResume />
    </>
  )
}
