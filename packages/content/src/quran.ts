import arabic from '../data/quran-uthmani.json'
import bengali from '../data/translation-bn.json'
import datasets from '../data/datasets.json'
import { AYAH_COUNTS, SURAH_COUNT } from './surahs'

/** Max ayat a single reference may span; stops the AI dumping whole surahs into an event. */
export const MAX_RANGE_LENGTH = 20

export interface AyahRef {
  surah: number
  ayah: number
  /** Inclusive end of a range within the same surah. */
  ayahTo?: number
}

export interface TranslationDataset {
  /** Stored in ayat.translation_source. */
  id: string
  name: string
  license: string
}

const ARABIC = arabic as string[][]
const TRANSLATIONS: Record<string, { meta: TranslationDataset; text: string[][] }> = {
  bn: { meta: datasets.bn, text: bengali as string[][] },
}

export const ARABIC_DATASET: TranslationDataset = datasets.arabic
export const availableTranslationLangs = (): string[] => Object.keys(TRANSLATIONS)

export type RefCheck = { ok: true; ref: Required<AyahRef> } | { ok: false; error: string }

/** Validates a surah:ayah[-ayahTo] reference against the 114-surah ayah-count table. */
export function checkRef(ref: AyahRef): RefCheck {
  const { surah, ayah } = ref
  const to = ref.ayahTo ?? ayah
  if (!Number.isInteger(surah) || surah < 1 || surah > SURAH_COUNT)
    return { ok: false, error: `Surah ${surah} does not exist; surah must be an integer 1-${SURAH_COUNT}.` }
  const max = AYAH_COUNTS[surah - 1]!
  if (!Number.isInteger(ayah) || ayah < 1 || ayah > max)
    return { ok: false, error: `Surah ${surah} has ${max} ayat; ayah ${ayah} is out of range (1-${max}).` }
  if (!Number.isInteger(to) || to < ayah)
    return { ok: false, error: `ayahTo (${to}) must be an integer >= ayah (${ayah}).` }
  if (to > max)
    return { ok: false, error: `Surah ${surah} has ${max} ayat; ayahTo ${to} is out of range (${ayah}-${max}).` }
  if (to - ayah + 1 > MAX_RANGE_LENGTH)
    return { ok: false, error: `Range ${surah}:${ayah}-${to} spans ${to - ayah + 1} ayat; the maximum is ${MAX_RANGE_LENGTH}. Split it or choose the key ayat.` }
  return { ok: true, ref: { surah, ayah, ayahTo: to } }
}

export const formatRef = (r: AyahRef): string =>
  r.ayahTo && r.ayahTo !== r.ayah ? `${r.surah}:${r.ayah}-${r.ayahTo}` : `${r.surah}:${r.ayah}`

/** Parses "2:255" or "2:255-257". */
export function parseRef(s: string): AyahRef | null {
  const m = /^\s*(\d{1,3}):(\d{1,3})(?:\s*-\s*(\d{1,3}))?\s*$/.exec(s)
  if (!m) return null
  return { surah: +m[1]!, ayah: +m[2]!, ...(m[3] ? { ayahTo: +m[3] } : {}) }
}

export interface AyahText {
  surah: number
  ayah: number
  arabic: string
  /** Present only when a bundled translation exists for the requested lang. */
  translation?: string
  translationSource?: string
}

/** Server-side source of all Qur'an text. Throws on invalid refs; callers validate first with checkRef. */
export function getAyat(ref: AyahRef, lang?: string): AyahText[] {
  const c = checkRef(ref)
  if (!c.ok) throw new RangeError(c.error)
  const tr = lang ? TRANSLATIONS[lang] : undefined
  const out: AyahText[] = []
  for (let a = c.ref.ayah; a <= c.ref.ayahTo; a++) {
    out.push({
      surah: c.ref.surah,
      ayah: a,
      arabic: ARABIC[c.ref.surah - 1]![a - 1]!,
      ...(tr ? { translation: tr.text[c.ref.surah - 1]![a - 1]!, translationSource: tr.meta.id } : {}),
    })
  }
  return out
}

export const getTranslationMeta = (lang: string): TranslationDataset | undefined => TRANSLATIONS[lang]?.meta
