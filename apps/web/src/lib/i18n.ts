import { SUPPORTED_LANGS, DEFAULT_LANG, type Lang } from '@seerah/content/langs'
import bn from '../messages/bn.json'
import en from '../messages/en.json'
import ar from '../messages/ar.json'

export { SUPPORTED_LANGS, DEFAULT_LANG, type Lang }
export type Messages = typeof bn
export type MessageKey = keyof Messages

export const isLang = (s: string): s is Lang => Object.prototype.hasOwnProperty.call(SUPPORTED_LANGS, s)
export const dirOf = (lang: Lang) => SUPPORTED_LANGS[lang].dir

/**
 * UI message catalogues that exist. A language without one falls back to English, then Bangla. To add a language:
 * create src/messages/<code>.json with the same keys as bn.json (a test enforces it) and list it here.
 */
const CATALOGUES: Partial<Record<Lang, Messages>> = { bn, en, ar }
export const uiLangs = (): Lang[] => Object.keys(CATALOGUES) as Lang[]
export const getMessages = (lang: Lang): Messages => CATALOGUES[lang] ?? en

/** Best UI language for an Accept-Language header among the available catalogues; default Bangla. */
export function negotiateLang(header: string | null | undefined, cookie?: string | null): Lang {
  if (cookie && isLang(cookie) && CATALOGUES[cookie]) return cookie
  const prefs = (header ?? '').split(',').map((p) => {
    const [tag, ...params] = p.trim().split(';')
    const q = Number(params.find((x) => x.trim().startsWith('q='))?.split('=')[1] ?? 1)
    return { base: (tag ?? '').toLowerCase().split('-')[0] ?? '', q: Number.isFinite(q) ? q : 0 }
  }).filter((p) => p.base && p.q > 0).sort((a, b) => b.q - a.q)
  for (const p of prefs) if (isLang(p.base) && CATALOGUES[p.base]) return p.base
  return DEFAULT_LANG
}

const NUM_LOCALE: Partial<Record<Lang, string>> = { bn: 'bn-BD', ar: 'ar-EG', fa: 'fa-IR', ur: 'ur-PK', hi: 'hi-IN' }
/** `{n, plural, one{# day} other{# days}}` — categories from Intl.PluralRules, `#` is the formatted number. */
const PLURAL_RE = /\{(\w+),\s*plural,((?:\s*\w+\{[^}]*\})+)\s*\}/g

export interface Fmt {
  lang: Lang
  n(v: number): string
  /** Percent from a 0–100 number, formatted for the locale (bn: ৪০%, ar: ٤٠٪). */
  pct(v: number): string
  t(key: MessageKey, params?: Record<string, string | number>): string
}

export function makeFmt(lang: Lang, messages: Messages): Fmt {
  const nf = new Intl.NumberFormat(NUM_LOCALE[lang] ?? lang, { useGrouping: false, maximumFractionDigits: 0 })
  const pf = new Intl.NumberFormat(NUM_LOCALE[lang] ?? lang, { style: 'percent', maximumFractionDigits: 0 })
  const plural = new Intl.PluralRules(lang)
  return {
    lang,
    n: (v) => nf.format(v),
    pct: (v) => pf.format(v / 100),
    t: (key, params) => {
      let s: string = messages[key] ?? en[key] ?? bn[key] ?? key
      if (params) {
        s = s.replace(PLURAL_RE, (_m, name: string, body: string) => {
          const v = params[name]
          const branches = new Map([...body.matchAll(/(\w+)\{([^}]*)\}/g)].map((m) => [m[1]!, m[2]!] as const))
          const cat = typeof v === 'number' ? plural.select(v) : 'other'
          return (branches.get(cat) ?? branches.get('other') ?? '').replaceAll('#', typeof v === 'number' ? nf.format(v) : String(v))
        })
        for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, typeof v === 'number' ? nf.format(v) : v)
      }
      return s
    },
  }
}

/** Display labels for event dates. Hijri years before the Hijrah are negative; there is no year 0. */
export const hijriLabel = (f: Fmt, y: number | null) => (y == null ? '—' : y < 0 ? f.t('date.hijriBefore', { n: -y }) : f.t('date.hijri', { n: y }))
export const gregLabel = (f: Fmt, y: number | null) => (y == null ? '—' : f.t('date.greg', { n: y }))
/** Birth year is -53 AH; events with no age before that are "before the birth". */
export function ageLabel(f: Fmt, age: number | null, hijri: number | null, short = false) {
  if (age == null) return hijri != null && hijri <= -53 ? f.t('age.before') : '—'
  if (age === 0) return f.t('age.birth')
  return short ? f.t('age.short', { n: age }) : f.t('age.long', { n: age })
}
