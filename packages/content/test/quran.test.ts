import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import datasets from '../data/datasets.json'
import { describe, it, expect } from 'vitest'
import arabic from '../data/quran-uthmani.json'
import bn from '../data/translation-bn.json'
import { AYAH_COUNTS, TOTAL_AYAT, checkRef, getAyat, parseRef, formatRef, MAX_RANGE_LENGTH } from '../src'

const dir = join(import.meta.dirname, '..', 'data')

describe('bundled datasets', () => {
  it('ayah count table sums to 6236 across 114 surahs', () => {
    expect(AYAH_COUNTS).toHaveLength(114)
    expect(AYAH_COUNTS.reduce((a, b) => a + b, 0)).toBe(TOTAL_AYAT)
  })
  it.each([['arabic', arabic], ['bengali', bn]] as const)('%s dataset matches the ayah-count table exactly', (_n, data) => {
    expect(data).toHaveLength(114)
    data.forEach((s, i) => {
      expect(s.length, `surah ${i + 1}`).toBe(AYAH_COUNTS[i])
      s.forEach((t, j) => expect(t.trim().length, `${i + 1}:${j + 1} empty`).toBeGreaterThan(0))
    })
  })
  it('is an exact re-shaping of the verbatim Tanzil sources (checksums recorded, nothing edited)', () => {
    const rd = (f: string) => readFileSync(join(dir, f), 'utf8')
    expect(createHash('sha256').update(rd('source/quran-uthmani.tanzil.txt')).digest('hex')).toBe(datasets.arabic.sha256_source)
    expect(createHash('sha256').update(rd('source/bn.bengali.tanzil.txt')).digest('hex')).toBe(datasets.bn.sha256_source)
    const lines = rd('source/quran-uthmani.tanzil.txt').split('\n').filter((l: string) => /^\d+\|\d+\|/.test(l))
    expect(lines).toHaveLength(TOTAL_AYAT)
    for (const l of lines) {
      const [s, a, ...t] = l.split('|')
      const src = t.join('|')
      const got = arabic[+s! - 1]![+a! - 1]!
      // Only the Bismillah prefix on ayah 1 may differ (see scripts/build-quran.mjs).
      if (a === '1' && s !== '1' && s !== '9') expect(src.endsWith(' ' + got)).toBe(true)
      else expect(got).toBe(src)
    }
  })
  it('has no Bismillah prefix on ayah 1 of surahs 2-114 (Tanzil export quirk)', () => {
    const skeleton = (w: string) => w.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '').replace(/\u0671/g, '\u0627')
    const bis = skeleton(arabic[0]![0]!)
    arabic.forEach((s, i) => {
      if (i === 0 || i === 8) return
      expect(skeleton(s[0]!.split(' ').slice(0, 4).join(' ')), `surah ${i + 1}`).not.toBe(bis)
    })
    expect(skeleton(arabic[95]![0]!)).toBe('اقرأ باسم ربك الذى خلق')
    expect(skeleton(arabic[94]![0]!).startsWith('والتين')).toBe(true)
    expect(skeleton(arabic[96]![0]!).startsWith('إنا')).toBe(true)
  })
  it('spot-checks', () => {
    expect(arabic[0]![0]!.startsWith('بِسْمِ')).toBe(true)
  })
})

describe('checkRef', () => {
  it('accepts valid refs and ranges', () => {
    expect(checkRef({ surah: 96, ayah: 1 })).toEqual({ ok: true, ref: { surah: 96, ayah: 1, ayahTo: 1 } })
    expect(checkRef({ surah: 2, ayah: 255, ayahTo: 257 }).ok).toBe(true)
    expect(checkRef({ surah: 114, ayah: 6 }).ok).toBe(true)
  })
  it.each([
    [{ surah: 0, ayah: 1 }, /does not exist/],
    [{ surah: 115, ayah: 1 }, /does not exist/],
    [{ surah: 1, ayah: 8 }, /has 7 ayat/],
    [{ surah: 1, ayah: 0 }, /out of range/],
    [{ surah: 112, ayah: 2, ayahTo: 1 }, />= ayah/],
    [{ surah: 112, ayah: 1, ayahTo: 5 }, /out of range/],
    [{ surah: 2, ayah: 1, ayahTo: 1 + MAX_RANGE_LENGTH }, /maximum/],
    [{ surah: 1.5, ayah: 1 }, /does not exist/],
  ])('rejects %j with a fixable message', (ref, msg) => {
    const r = checkRef(ref)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(msg)
  })
})

describe('getAyat', () => {
  it('returns Arabic + Bangla with source ids', () => {
    const [a] = getAyat({ surah: 96, ayah: 1 }, 'bn')
    expect(a!.arabic).toBe(arabic[95]![0])
    expect(a!.translation).toBe(bn[95]![0])
    expect(a!.translationSource).toBe('tanzil-bn.bengali')
  })
  it('returns Arabic only for langs without a bundled translation', () => {
    expect(getAyat({ surah: 1, ayah: 1 }, 'ur')[0]!.translation).toBeUndefined()
  })
  it('returns every ayah in a range', () => {
    expect(getAyat({ surah: 2, ayah: 255, ayahTo: 257 })).toHaveLength(3)
  })
  it('throws on invalid refs', () => expect(() => getAyat({ surah: 1, ayah: 99 })).toThrow(RangeError))
})

describe('ref parsing', () => {
  it('round-trips', () => {
    expect(parseRef('2:255-257')).toEqual({ surah: 2, ayah: 255, ayahTo: 257 })
    expect(formatRef({ surah: 2, ayah: 255, ayahTo: 257 })).toBe('2:255-257')
    expect(formatRef({ surah: 2, ayah: 255 })).toBe('2:255')
    expect(parseRef('abc')).toBeNull()
  })
})
