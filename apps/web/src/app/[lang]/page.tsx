import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isLang, getMessages, makeFmt, uiLangs } from '@/lib/i18n'
import { ContinueCard, EraCards } from '@/components/HomeParts'
import { LangMenu, ThemeToggle } from '@/components/Chrome'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  if (!isLang(lang)) return {}
  const f = makeFmt(lang, getMessages(lang))
  return { title: { absolute: `${f.t('app.name')} · ${f.t('app.nameAr')}` }, alternates: { canonical: `/${lang}`, languages: Object.fromEntries(uiLangs().map((l) => [l, `/${l}`])) } }
}

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  if (!isLang(lang)) notFound()
  const f = makeFmt(lang, getMessages(lang))
  return (
    <main className="page">
      <header className="apphead mob-only">
        <div className="t"><b>{f.t('app.name')}</b><span lang="ar" dir="rtl">{f.t('app.nameAr')}</span></div>
        <div className="tools"><LangMenu langs={uiLangs()} /><ThemeToggle /></div>
      </header>
      <section className="hero">
        <div className="pat" aria-hidden="true" />
        <p className="ar" lang="ar" dir="rtl">مُحَمَّدٌ رَسُولُ اللَّهِ</p>
        <span className="sub">{f.t('home.heroRef')}</span>
      </section>
      <section className="intro">
        <h1>{f.t('home.title')}</h1>
        <p>{f.t('home.lead')}</p>
      </section>
      <ContinueCard />
      <EraCards />
    </main>
  )
}
