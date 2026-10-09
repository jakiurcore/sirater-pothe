import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { Hind_Siliguri, Noto_Serif_Bengali, Noto_Sans_Bengali, Amiri } from 'next/font/google'
import Link from 'next/link'
import Script from 'next/script'
import '@/styles/tokens.css'
import '@/styles/app.css'
import { Providers } from '@/components/Providers'
import { ThemeSync } from '@/components/ThemeSync'
import { DeskNav, LangMenu, TabBar, ThemeToggle } from '@/components/Chrome'
import { dirOf, getMessages, isLang, makeFmt, uiLangs } from '@/lib/i18n'
import { getRecallIndex, getTimeline } from '@/lib/content'
import { THEME_SCRIPT } from '@/lib/theme'

const hind = Hind_Siliguri({ subsets: ['bengali', 'latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-hind' })
const notoSerif = Noto_Serif_Bengali({ subsets: ['bengali', 'latin'], display: 'swap', variable: '--font-noto-serif' })
/** Meta/subtitle text and numerals only (see --f-meta in app.css): Hind Siliguri's "১" is half-height and reads as ৬/৭ at 12–14px; Noto Sans Bengali's digits are distinct. Bengali glyphs only; Latin falls back to the UI font. */
const notoSansBn = Noto_Sans_Bengali({ subsets: ['bengali'], weight: ['500', '600', '700'], display: 'swap', variable: '--font-noto-sans-bn' })
const amiri = Amiri({ subsets: ['arabic', 'latin'], weight: ['400', '700'], display: 'swap', variable: '--font-amiri' })

export const dynamic = 'force-dynamic'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // lets env(safe-area-inset-*) work (notch in landscape, home bar)
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#F3EBDD' }, { media: '(prefers-color-scheme: dark)', color: '#0D1524' }],
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  if (!isLang(lang)) return {}
  const f = makeFmt(lang, getMessages(lang))
  const origin = process.env.WEB_ORIGIN
  return {
    robots: process.env.INDEXING === 'on' ? undefined : { index: false, follow: false },
    metadataBase: origin ? new URL(origin) : undefined,
    title: { default: `${f.t('app.name')} · ${f.t('app.nameAr')}`, template: `%s · ${f.t('app.name')}` },
    description: f.t('app.description'),
    applicationName: f.t('app.name'),
    openGraph: { siteName: f.t('app.name'), locale: lang, type: 'website' },
  }
}

export default async function LangLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params
  if (!isLang(lang)) notFound()
  const messages = getMessages(lang)
  const f = makeFmt(lang, messages)
  const [timeline, recall] = await Promise.all([getTimeline(lang), getRecallIndex(lang)])
  const langs = uiLangs()
  return (
    <html lang={lang} dir={dirOf(lang)} className={`${hind.variable} ${notoSerif.variable} ${notoSansBn.variable} ${amiri.variable}`} suppressHydrationWarning>
      <head>
        {langs.map((l) => <link key={l} rel="alternate" hrefLang={l} href={`/${l}`} />)}
      </head>
      <body>
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <Providers lang={lang} messages={messages} timeline={timeline} recall={recall}>
          <ThemeSync />
          <div className="app">
            <a className="skip" href="#main">{f.t('nav.skip')}</a>
            <header className="deskbar desk-only">
              <div className="pat" aria-hidden="true" />
              <Link href={`/${lang}`} className="brand"><b>{f.t('app.name')}</b><span lang="ar" dir="rtl">{f.t('app.nameAr')}</span></Link>
              <DeskNav />
              <div className="tools"><LangMenu langs={langs} /><ThemeToggle /></div>
            </header>
            <div className="app-body" id="main">{children}</div>
            <TabBar />
          </div>
        </Providers>
      </body>
    </html>
  )
}
