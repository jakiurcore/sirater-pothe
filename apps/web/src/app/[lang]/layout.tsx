import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { Hind_Siliguri, Noto_Serif_Bengali, Amiri } from 'next/font/google'
import Link from 'next/link'
import '@/styles/tokens.css'
import '@/styles/app.css'
import { Providers } from '@/components/Providers'
import { DeskNav, LangMenu, TabBar, ThemeToggle } from '@/components/Chrome'
import { dirOf, getMessages, isLang, makeFmt, uiLangs } from '@/lib/i18n'
import { getTimeline } from '@/lib/content'
import { THEME_SCRIPT } from '@/lib/theme'

const hind = Hind_Siliguri({ subsets: ['bengali', 'latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-hind' })
const notoSerif = Noto_Serif_Bengali({ subsets: ['bengali', 'latin'], display: 'swap', variable: '--font-noto-serif' })
const amiri = Amiri({ subsets: ['arabic', 'latin'], weight: ['400', '700'], display: 'swap', variable: '--font-amiri' })

export const dynamic = 'force-dynamic'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#F3EBDD' }, { media: '(prefers-color-scheme: dark)', color: '#0D1524' }],
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  if (!isLang(lang)) return {}
  const f = makeFmt(lang, getMessages(lang))
  const origin = process.env.WEB_ORIGIN
  return {
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
  const timeline = await getTimeline(lang)
  const langs = uiLangs()
  return (
    <html lang={lang} dir={dirOf(lang)} className={`${hind.variable} ${notoSerif.variable} ${amiri.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {langs.map((l) => <link key={l} rel="alternate" hrefLang={l} href={`/${l}`} />)}
      </head>
      <body>
        <Providers lang={lang} messages={messages} timeline={timeline}>
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
