'use client'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/**
 * Language dropdown. The list is `position: fixed` and positioned from the button's rect, so no ancestor with
 * `overflow: hidden` (a modal, a scroll pane) can clip it. It never exceeds the visible viewport (internal scroll),
 * flips upward when there is more room above, and closes on Escape, outside press, route change and resize.
 */
export function LangMenu({ langs }: { langs: Lang[] }) {
  const f = useFmt()
  const pathname = usePathname() ?? `/${f.lang}`
  const rest = pathname.split('/').slice(2).join('/')
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' })
  const root = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const rtl = SUPPORTED_LANGS[f.lang].dir === 'rtl'

  const place = useCallback(() => {
    const b = btn.current, ul = list.current
    if (!b || !ul) return
    const r = b.getBoundingClientRect()
    const vv = window.visualViewport
    const vh = vv?.height ?? window.innerHeight, vw = vv?.width ?? window.innerWidth
    const gap = 6, edge = 8
    const below = vh - r.bottom - gap - edge, above = r.top - gap - edge
    const want = ul.scrollHeight + 2
    const flip = below < Math.min(want, 280) && above > below
    const room = Math.max(96, flip ? above : below)
    const width = Math.min(Math.max(180, r.width), vw - edge * 2)
    // Align the menu's inline-end edge with the button, then keep it fully on screen.
    let left = rtl ? r.left : r.right - width
    left = Math.min(Math.max(edge, left), vw - width - edge)
    setStyle({
      position: 'fixed', left, width, maxHeight: room, overflowY: 'auto', overscrollBehavior: 'contain',
      ...(flip ? { bottom: vh - r.top + gap } : { top: r.bottom + gap }), visibility: 'visible',
    })
  }, [rtl])

  useLayoutEffect(() => { if (open) place() }, [open, place])
  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    if (!open) return
    const close = (focus = false) => { setOpen(false); if (focus) btn.current?.focus() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true) }
    const press = (e: Event) => { if (!root.current?.contains(e.target as Node)) close() }
    const reflow = () => place()
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', press)
    window.addEventListener('resize', reflow)
    window.visualViewport?.addEventListener('resize', reflow)
    window.addEventListener('scroll', reflow, true)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('pointerdown', press)
      window.removeEventListener('resize', reflow)
      window.visualViewport?.removeEventListener('resize', reflow)
      window.removeEventListener('scroll', reflow, true)
    }
  }, [open, place])

  return (
    <div className="lang" ref={root}>
      <button type="button" ref={btn} className="langbtn" aria-label={f.t('ui.language')} aria-expanded={open} aria-controls="lang-list" onClick={() => { setStyle({ visibility: 'hidden' }); setOpen((o) => !o) }}>
        <GlobeIcon />
        {SUPPORTED_LANGS[f.lang].name}
        <Icon d="chevron" size={14} sw={2} />
      </button>
      {open && (
        <ul id="lang-list" ref={list} style={style}>
          {langs.map((l) => (
            <li key={l}>
              <Link href={`/${l}${rest ? `/${rest}` : ''}`} hrefLang={l} lang={l} aria-current={l === f.lang ? 'true' : undefined} onClick={() => remember(l)}>{SUPPORTED_LANGS[l].name}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export { PATHS }
