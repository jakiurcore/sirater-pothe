import { describe, expect, it } from 'vitest'
import { missingHonorific } from '@seerah/content/honorific'
import { getMessages, makeFmt, negotiateLang, uiLangs, ageLabel } from '@/lib/i18n'
import bn from '@/messages/bn.json'
import en from '@/messages/en.json'
import ar from '@/messages/ar.json'

const cats = { bn, en, ar } as Record<string, Record<string, string>>

describe('catalogues', () => {
  it('every catalogue has exactly the keys of bn.json, no empty values, same placeholders', () => {
    const keys = Object.keys(bn).sort()
    const ph = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]))].sort().join(',')
    for (const [code, c] of Object.entries(cats)) {
      expect(Object.keys(c).sort(), code).toEqual(keys)
      for (const k of keys) {
        expect(c[k]!.trim(), `${code}:${k}`).not.toBe('')
        expect(ph(c[k]!), `${code}:${k} placeholders`).toBe(ph((bn as Record<string, string>)[k]!))
      }
    }
    expect(uiLangs().sort()).toEqual(Object.keys(cats).sort())
  })
  it('the Prophet is never named without ﷺ in any UI string', () => {
    for (const [code, c] of Object.entries(cats)) for (const [k, v] of Object.entries(c)) expect(missingHonorific(v), `${code}:${k}`).toBe(false)
  })
})

describe('negotiateLang', () => {
  it('cookie wins, then Accept-Language by quality, then default', () => {
    expect(negotiateLang('en-US,en;q=0.9', 'ar')).toBe('ar')
    expect(negotiateLang('en-US,en;q=0.9', 'xx')).toBe('en')
    expect(negotiateLang('fr;q=0.9,ar;q=0.8,bn;q=0.7')).toBe('ar') // fr has no catalogue
    expect(negotiateLang('bn-BD,bn;q=0.9,en;q=0.5')).toBe('bn')
    expect(negotiateLang('en;q=0.2,ar;q=0.9')).toBe('ar')
    expect(negotiateLang('ja,zh')).toBe('bn')
    expect(negotiateLang(null)).toBe('bn')
    expect(negotiateLang('en;q=0')).toBe('bn')
    expect(negotiateLang('__proto__,constructor')).toBe('bn')
  })
})

describe('formatter', () => {
  const fb = makeFmt('bn', getMessages('bn'))
  const fe = makeFmt('en', getMessages('en'))
  const fa = makeFmt('ar', getMessages('ar'))
  it('English plurals', () => {
    expect(fe.t('era.count', { n: 1 })).toBe('1 event')
    expect(fe.t('era.count', { n: 5 })).toBe('5 events')
    expect(fe.t('review.inDays', { n: 1 })).toBe('in 1 day')
  })
  it('Arabic plurals use all six categories and Arabic-Indic digits', () => {
    expect(fa.t('progress.days', { n: 1 })).toBe('يوم')
    expect(fa.t('progress.days', { n: 2 })).toBe('يومان')
    expect(fa.t('progress.days', { n: 5 })).toBe('٥ أيام')
    expect(fa.t('progress.days', { n: 12 })).toBe('١٢ يومًا')
    expect(fa.t('progress.days', { n: 100 })).toBe('١٠٠ يوم')
    expect(fa.t('era.count', { n: 0 })).toBe('لا أحداث')
  })
  it('Bangla keeps Bengali digits; English keeps Latin; age labels follow', () => {
    expect(fb.t('review.pos', { i: 2, total: 4 })).toBe('প্রশ্ন ২ / ৪')
    expect(fe.t('review.pos', { i: 2, total: 4 })).toBe('Question 2 / 4')
    expect(ageLabel(fe, 40, -13)).toBe('40 years')
    expect(ageLabel(fa, 3, 1)).toBe('٣ سنوات')
  })
  it('unknown key falls back (en, then bn, then the key itself)', () => {
    expect(fe.t('nope' as never)).toBe('nope')
  })
})

describe('percent', () => {
  it('is locale formatted', () => {
    expect(makeFmt('bn', getMessages('bn')).pct(40)).toBe('৪০%')
    expect(makeFmt('en', getMessages('en')).pct(40)).toBe('40%')
    expect(makeFmt('ar', getMessages('ar')).pct(40)).toMatch(/^٤٠.?٪/)
  })
})
