import { SUPPORTED_LANGS, DEFAULT_LANG, type Lang } from '@seerah/content/langs'
import bn from '../messages/bn.json'

export { SUPPORTED_LANGS, DEFAULT_LANG, type Lang }
export type Messages = typeof bn
export type MessageKey = keyof Messages

export const isLang = (s: string): s is Lang => Object.prototype.hasOwnProperty.call(SUPPORTED_LANGS, s)
export const dirOf = (lang: Lang) => SUPPORTED_LANGS[lang].dir

/** UI message catalogues that exist. Other languages fall back to the default until their file is added (phase 4). */
const CATALOGUES: Partial<Record<Lang, Messages>> = { bn }
export const uiLangs = (): Lang[] => Object.keys(CATALOGUES) as Lang[]
export const getMessages = (lang: Lang): Messages => CATALOGUES[lang] ?? bn

const NUM_LOCALE: Partial<Record<Lang, string>> = { bn: 'bn-BD', ar: 'ar-EG', fa: 'fa-IR', ur: 'ur-PK', hi: 'hi-IN' }

export interface Fmt {
  lang: Lang
  n(v: number): string
  t(key: MessageKey, params?: Record<string, string | number>): string
}

export function makeFmt(lang: Lang, messages: Messages): Fmt {
  const nf = new Intl.NumberFormat(NUM_LOCALE[lang] ?? lang, { useGrouping: false, maximumFractionDigits: 0 })
  return {
    lang,
    n: (v) => nf.format(v),
    t: (key, params) => {
      let s: string = messages[key] ?? bn[key] ?? key
      if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, typeof v === 'number' ? nf.format(v) : v)
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
