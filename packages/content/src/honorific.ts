/**
 * "Always render ﷺ after the Prophet's name."
 * Applied on every write (stored text) and every render, so it holds even if an AI forgets.
 */
export const PBUH = 'ﷺ'

// Names / epithets that must be followed by ﷺ. Ordered longest-first within each language.
const NAME_PATTERNS: Record<string, string[]> = {
  bn: ['রাসূলুল্লাহ', 'রাসুলুল্লাহ', 'মুহাম্মাদ', 'মুহাম্মদ', 'মোহাম্মদ', 'নবীজি', 'আল্লাহর রাসূল', 'আল্লাহর রাসুল'],
  en: ['Rasulullah', 'Messenger of Allah', 'Prophet Muhammad', 'Muhammad', 'Muḥammad'],
  ar: ['رسول الله', 'محمد'],
  ur: ['رسول اللہ', 'محمد'],
}

const ALL = [...new Set(Object.values(NAME_PATTERNS).flat())].sort((a, b) => b.length - a.length)
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Matches a name not already followed (optionally after whitespace / bracket) by ﷺ or ﷺ-equivalents.
// Not matched when already followed by ﷺ (or a common abbreviation), nor when the name is part of another
// person's name ("Muhammad ibn Ishaq", "মুহাম্মদ ইবনে ইসহাক").
// Bangla inflects names with suffixes (নবীজির, নবীজিকে, মুহাম্মাদকে): the name is matched together with the rest of
// its Bengali-script word, and ﷺ goes after that whole word ("নবীজির ﷺ"). The `(?![\u0980-\u09FF])` after the
// suffix stops the regex backtracking to a shorter match inside the word, which would split it ("নবীজি ﷺর").
const BN_WORD = '[\\u0980-\\u09FF]'
const NAME_RE = new RegExp(
  `(?<!(?:ibn|bin|ইবনে|ইবন|বিন)\\s)(${ALL.map(escape).join('|')})(${BN_WORD}*)(?!${BN_WORD})(?!\\s*(?:[\\(\\[]?\\s*(?:${PBUH}|সা\\.|স\\.|সাঃ|সা:|সা\\))|ibn\\s|bin\\s|ইবনে|ইবন |বিন |বিন্))`,
  'g',
)

/** Inserts ﷺ after the Prophet's name wherever it is missing. Idempotent. */
export function addHonorific(text: string): string {
  return text.replace(NAME_RE, `$1$2 ${PBUH}`)
}

/** Returns true if the text mentions the Prophet by name without ﷺ. */
export function missingHonorific(text: string): boolean {
  NAME_RE.lastIndex = 0
  return NAME_RE.test(text)
}
