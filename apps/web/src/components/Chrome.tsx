'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useDue, useFmt } from './Providers'
import { Icon, GlobeIcon, SunIcon, PATHS } from './icons'
import { SUPPORTED_LANGS, type Lang } from '@/lib/i18n'
import { THEME_KEY } from '@/lib/theme'

type Tab = 'home' | 'timeline' | 'review' | 'progress'
const TABS: { id: Tab; path: string; key: 'nav.home' | 'nav.timeline' | 'nav.review' | 'nav.progress' }[] = [
  { id: 'home', path: '', key: 'nav.home' },
  { id: 'timeline', path: '/timeline', key: 'nav.timeline' },
  { id: 'review', path: '/review', key: 'nav.review' },
  { id: 'progress', path: '/progress', key: 'nav.progress' },
]

function useActiveTab(): Tab {
  const seg = (usePathname() ?? '').split('/')[2] ?? ''
  if (seg === 'timeline' || seg === 'events' || seg === 'preview') return 'timeline'
  if (seg === 'review') return 'review'
  if (seg === 'progress') return 'progress'
  return 'home'
}

export function TabBar() {
  const f = useFmt()
  const { due } = useDue()
  const active = useActiveTab()
  return (
    <nav className="tabbar mob-only" aria-label={f.t('nav.main')}>
      {TABS.map((t) => (
        <Link key={t.id} href={`/${f.lang}${t.path}`} aria-current={t.id === active ? 'page' : undefined}>
          <span className="pill">
            <Icon d={t.id} />
            {t.id === 'review' && due > 0 ? <span className="badge">{f.n(due)}</span> : null}
          </span>
          <span>{f.t(t.key)}</span>
        </Link>
      ))}
    </nav>
  )
}

export function DeskNav() {
  const f = useFmt()
  const { due } = useDue()
  const active = useActiveTab()
  return (
    <nav aria-label={f.t('nav.main')}>
      {TABS.map((t) => (
        <Link key={t.id} href={`/${f.lang}${t.path}`} aria-current={t.id === active ? 'page' : undefined}>
          {f.t(t.key)}
          {t.id === 'review' && due > 0 ? <span className="badge">{f.n(due)}</span> : null}
        </Link>
      ))}
    </nav>
  )
}

export function ThemeToggle() {
  const f = useFmt()
  const toggle = () => {
    const el = document.documentElement
    const next = el.dataset.theme === 'dark' ? 'light' : 'dark'
    el.dataset.theme = next
    try { localStorage.setItem(THEME_KEY, next) } catch { /* private mode: theme applies for this visit only */ }
    window.dispatchEvent(new Event('seerah:theme'))
  }
  return (
    <button type="button" className="iconbtn" aria-label={f.t('ui.theme')} onClick={toggle}>
      <span className="theme-moon"><Icon d="moon" size={20} /></span>
      <span className="theme-sun"><SunIcon /></span>
    </button>
  )
}

/** Remember the choice so "/" opens in this language next time. */
function remember(l: Lang) {
  try { document.cookie = `seerah-lang=${l}; path=/; max-age=31536000; samesite=lax` } catch { /* cookies blocked */ }
}

export function LangMenu({ langs }: { langs: Lang[] }) {
  const f = useFmt()
  const pathname = usePathname() ?? `/${f.lang}`
  const rest = pathname.split('/').slice(2).join('/')
  return (
    <details className="lang">
      <summary aria-label={f.t('ui.language')}>
        <GlobeIcon />
        {SUPPORTED_LANGS[f.lang].name}
        <Icon d="chevron" size={14} sw={2} />
      </summary>
      <ul>
        {langs.map((l) => (
          <li key={l}>
            <Link href={`/${l}${rest ? `/${rest}` : ''}`} hrefLang={l} lang={l} aria-current={l === f.lang ? 'true' : undefined} onClick={() => remember(l)}>{SUPPORTED_LANGS[l].name}</Link>
          </li>
        ))}
      </ul>
    </details>
  )
}

export { PATHS }
