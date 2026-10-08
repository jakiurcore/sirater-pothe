// Converts the verbatim Tanzil downloads in data/source into compact JSON:
// an array of 114 surahs, each an array of ayah strings (index 0 = ayah 1).
// The source files are NOT modified (Tanzil terms: verbatim only); we only re-shape.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

// Tanzil's plain-text export prepends the Bismillah to ayah 1 of every surah except 1 and 9
// (95 and 97 even use a variant mark order). It is not part of those ayat, so we strip exactly the
// first four words, after checking they really are the Bismillah. Everything else is verbatim.
const marks = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g
const skeleton = (w) => w.replace(marks, '').replace(/\u0671/g, '\u0627')
const BISMILLAH = 'بسم الله الرحمن الرحيم'
function stripBismillah(surah, text) {
  if (surah === 1 || surah === 9) return text
  const words = text.split(' ')
  if (skeleton(words.slice(0, 4).join(' ')) !== BISMILLAH) throw new Error(`surah ${surah}: expected Bismillah prefix on ayah 1`)
  return words.slice(4).join(' ')
}

function convert(srcName, outName, strip) {
  const raw = readFileSync(join(dir, 'source', srcName), 'utf8')
  const surahs = []
  for (const line of raw.split(/\r?\n/)) {
    const m = /^(\d+)\|(\d+)\|(.*)$/.exec(line)
    if (!m) continue
    const s = Number(m[1]), a = Number(m[2])
    const arr = (surahs[s - 1] ??= [])
    if (arr.length !== a - 1) throw new Error(`${srcName}: out-of-order ${s}:${a}`)
    arr.push(strip && a === 1 ? stripBismillah(s, m[3]) : m[3])
  }
  const json = JSON.stringify(surahs)
  writeFileSync(join(dir, outName), json)
  return { sha256_source: createHash('sha256').update(raw).digest('hex'), ayat: surahs.flat().length }
}

const ar = convert('quran-uthmani.tanzil.txt', 'quran-uthmani.json', true)
const bn = convert('bn.bengali.tanzil.txt', 'translation-bn.json', false)
writeFileSync(join(dir, 'datasets.json'), JSON.stringify({
  arabic: { id: 'tanzil-uthmani-1.1', name: 'Tanzil Quran Text (Uthmani) v1.1', license: 'CC-BY-3.0 (verbatim copies only; attribute Tanzil Project, link to tanzil.net)', url: 'https://tanzil.net', notes: 'Bismillah prefix removed from ayah 1 of surahs 2-8 and 10-114 (Tanzil export prepends it); all other text is verbatim.', ...ar },
  bn: { id: 'tanzil-bn.bengali', name: 'Muhiuddin Khan (bn.bengali) via Tanzil', license: 'UNVERIFIED: translation copyright is held by the translator/publisher; Tanzil distributes it for display with attribution. Owner must verify before commercial/public use.', url: 'https://tanzil.net/trans/', ...bn }
}, null, 2))
console.log({ ar, bn })
