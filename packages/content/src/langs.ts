export const SUPPORTED_LANGS = {
  bn: { name: 'বাংলা', dir: 'ltr' },
  en: { name: 'English', dir: 'ltr' },
  ar: { name: 'العربية', dir: 'rtl' },
  ur: { name: 'اردو', dir: 'rtl' },
  tr: { name: 'Türkçe', dir: 'ltr' },
  id: { name: 'Bahasa Indonesia', dir: 'ltr' },
  ms: { name: 'Bahasa Melayu', dir: 'ltr' },
  fr: { name: 'Français', dir: 'ltr' },
  hi: { name: 'हिन्दी', dir: 'ltr' },
  fa: { name: 'فارسی', dir: 'rtl' },
} as const
export type Lang = keyof typeof SUPPORTED_LANGS
export const DEFAULT_LANG: Lang = 'bn'
