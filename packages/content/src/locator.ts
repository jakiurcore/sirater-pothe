/** Citation / hadith locator rules (pure; shared by the MCP tools, the publish gate and the public page). */
/** Values people (and AIs) type when they do not actually know the locator. Never accepted. */
const PLACEHOLDERS = new Set(['n/a', 'na', 'none', 'null', 'nil', 'tbd', 'tba', 'todo', 'unknown', 'unk', 'pending', 'later', 'xx', 'xxx', 'page', 'pages', 'p', 'pp', 'vol', 'volume', 'number', 'no', 'num', 'section', 'chapter', 'title', 'placeholder', 'example', 'test', 'asdf', 'foo', 'bar', 'অজানা', 'পরে', 'নেই', 'অজ্ঞাত', 'প্রযোজ্য নয়', 'غير معروف', 'لاحقا'])
export function isPlaceholder(v: string | null | undefined): boolean {
  const t = (v ?? '').trim().toLowerCase().replace(/[.\s]+$/g, '')
  if (!t) return true
  if (PLACEHOLDERS.has(t)) return true
  if (!/[\p{L}\p{N}]/u.test(t)) return true // only punctuation: "?", "-", "..."
  if (/^(.)\1{1,}$/u.test(t)) return true // "xxx", "???", "000"
  if (/^[0০٠]+$/u.test(t)) return true // page 0 does not exist
  if (/^(n\/?a|tbd|todo|\?+|-+|\.+)$/i.test(t)) return true
  return false
}
export const hasNumber = (v: string) => /\p{Nd}/u.test(v)
const ROMAN = /^[ivxlcdm]+$/i

/** A page locator is a number (Latin, Bangla or Arabic-Indic digits), a range / list of them, or a roman numeral (prefaces): "98", "১২৩–১২৫", "34, 36", "xii". */
export function pageProblem(page: string | null | undefined): string | null {
  const v = (page ?? '').trim()
  if (!v) return 'page is empty'
  if (isPlaceholder(v)) return `page "${v}" is a placeholder`
  const parts = v.split(/\s*[-–—,،;]\s*|\s+/).filter(Boolean)
  if (!parts.length || !parts.every((x) => /^\p{Nd}+[a-z]?$/iu.test(x) || ROMAN.test(x))) return `page "${v}" is not a page number or range (e.g. 98, 98-101, xii)`
  if (parts.every((x) => /^[0০٠]+$/u.test(x))) return `page "${v}" does not exist`
  return null
}
export function sectionProblem(section: string | null | undefined): string | null {
  const v = (section ?? '').trim()
  if (!v) return 'section/chapter title is empty'
  if (isPlaceholder(v)) return `section "${v}" is a placeholder`
  if (v.length < 4 || !/\p{L}/u.test(v)) return `section "${v}" is too short to be a real chapter or section title`
  return null
}
export interface CitationLocator { volume?: string | null; page?: string | null; section?: string | null }
/**
 * A citation needs ONE of: volume + page, page, or a chapter/section title. A volume alone is not a locator.
 * Returns the reason it is not a valid locator, or null.
 */
export function locatorProblem(c: CitationLocator): string | null {
  const hasPage = !!c.page?.trim(), hasSection = !!c.section?.trim()
  if (c.volume?.trim() && isPlaceholder(c.volume)) return `volume "${c.volume}" is a placeholder`
  if (hasPage) { const p = pageProblem(c.page); if (p) return p }
  if (hasSection) { const p = sectionProblem(c.section); if (p) return p }
  if (!hasPage && !hasSection) return 'no locator: give page (optionally with volume), or a chapter/section title. Ask the owner; never guess.'
  return null
}

