#!/usr/bin/env node
/**
 * Design audit harness.
 *   node scripts/design-audit.mjs design            # screenshots of the /design artboards (needs: cd design && python3 -m http.server 8099)
 *   node scripts/design-audit.mjs live <label>      # screenshots + layout metrics of the running site (E2E_BASE_URL, default :3100)
 *   node scripts/design-audit.mjs compare <label>   # design | live side-by-side composites at 390 and 1280
 * Output: design-audit/{design,live/<label>,compare/<label>}/…  (+ metrics.json)
 */
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const OUT = new URL('../../../design-audit/', import.meta.url).pathname
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3100'
const DESIGN = process.env.DESIGN_URL ?? 'http://localhost:8099/Seerah%20Timeline.dc.html'
const [mode, label = 'before'] = process.argv.slice(2)
const launch = () => chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const dir = (...p) => { const d = join(OUT, ...p); mkdirSync(d, { recursive: true }); return d }

const WIDTHS = [360, 390, 768, 1024, 1280, 1440]
const today = new Date().toISOString().slice(0, 10)
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
const STATE = {
  read: { 'seed-event-year-of-the-elephant': new Date().toISOString(), 'seed-event-birth-of-the-prophet': new Date().toISOString() },
  notes: { 'seed-event-year-of-the-elephant': { text: 'আবরাহার হাতি এগোতে চায়নি, এটা মনে রাখতে হবে।', updatedAt: new Date().toISOString() } },
  last: 'seed-event-hijrah-to-madinah',
  srs: { 'seed-q-year-of-the-elephant-0': { due: today, interval: 1, ease: 2.5, reps: 1, lapses: 0 } },
  reviewDays: [day(2), day(1)],
}
/** page id → { path, theme?, state?, after? } */
const PAGES = {
  home: { path: '/bn' },
  'home-fresh': { path: '/bn', state: null },
  timeline: { path: '/bn/timeline' },
  event: { path: '/bn/events/hijrah-to-madinah' },
  'event-dark': { path: '/bn/events/hijrah-to-madinah', theme: 'dark' },
  review: { path: '/bn/review' },
  'review-answered': { path: '/bn/review', after: async (p) => { await p.locator('.opt').first().click().catch(() => {}) } },
  'review-empty': { path: '/bn/review', state: null },
  progress: { path: '/bn/progress' },
  'progress-empty': { path: '/bn/progress', state: null },
  'lang-menu': { path: '/bn', after: async (p) => { await p.locator('.lang button:visible').first().click().catch(() => {}); await p.waitForTimeout(300) } },
  'event-lang-menu': { path: '/bn/events/hijrah-to-madinah', after: async (p) => { await p.locator('.lang button:visible').first().click().catch(() => {}); await p.waitForTimeout(300) } },
  'event-ar': { path: '/ar/events/hijrah-to-madinah' },
  notfound: { path: '/bn/events/does-not-exist' },
}

/** In-page layout checks. */
const METRICS = () => {
  const vw = document.documentElement.clientWidth
  const out = { vw, scrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, offenders: [], smallTargets: [], clipped: [] }
  const sel = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const inScroller = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true } return false }
  for (const e of document.querySelectorAll('body *')) {
    if (!visible(e)) continue
    const r = e.getBoundingClientRect(); const s = getComputedStyle(e)
    if (s.position !== 'fixed' && !inScroller(e) && (r.right > vw + 1 || r.left < -1) && out.offenders.length < 12) out.offenders.push(`${sel(e)} ${Math.round(r.left)}→${Math.round(r.right)}`)
    if (e.matches('a[href],button,summary,input:not([type=hidden]),select,textarea,[role=button],[role=tab]')) {
      const inline = s.display === 'inline' && e.closest('p,li,span.t,.sub')
      if (!inline && (r.width < 43.5 || r.height < 43.5) && out.smallTargets.length < 25) out.smallTargets.push(`${sel(e)} ${Math.round(r.width)}x${Math.round(r.height)} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20)}"`)
    }
    if ((s.overflow === 'hidden' || s.overflowY === 'hidden' || s.overflowY === 'clip') && e.scrollHeight > e.clientHeight + 2 && e.clientHeight > 0 && (e.textContent || '').trim() && out.clipped.length < 12) out.clipped.push(`${sel(e)} ${e.clientHeight}<${e.scrollHeight}`)
  }
  return out
}

async function live() {
  const b = await launch()
  const out = dir('live', label)
  const all = {}
  for (const w of WIDTHS) {
    const ctx = await b.newContext({ viewport: { width: w, height: w >= 900 ? 860 : 844 }, reducedMotion: 'reduce' })
    for (const [id, cfg] of Object.entries(PAGES)) {
      const page = await ctx.newPage()
      const state = 'state' in cfg ? cfg.state : STATE
      await page.addInitScript(([st, theme]) => {
        try { if (st) localStorage.setItem('seerah:v1:reader', JSON.stringify(st)); if (theme) localStorage.setItem('seerah-theme', theme) } catch {}
      }, [state, cfg.theme ?? null])
      await page.goto(BASE + cfg.path, { waitUntil: 'load' })
      await page.waitForTimeout(id.includes('event') || id === 'timeline' ? 2500 : 900)
      if (cfg.after) await cfg.after(page)
      const m = await page.evaluate(METRICS)
      all[`${id}@${w}`] = m
      await page.screenshot({ path: join(out, `${id}-${w}.png`), fullPage: !id.includes('menu') })
      if (id.includes('menu')) await page.screenshot({ path: join(out, `${id}-${w}.png`) })
      await page.close()
    }
    await ctx.close()
  }
  writeFileSync(join(out, 'metrics.json'), JSON.stringify(all, null, 1))
  const bad = Object.entries(all).filter(([, m]) => m.scrollW > m.vw + 1 || m.offenders.length || m.clipped.length)
  const tiny = Object.entries(all).reduce((n, [, m]) => n + m.smallTargets.length, 0)
  console.log(`${Object.keys(all).length} captures; ${bad.length} with overflow/clipping; ${tiny} small tap targets in total`)
  for (const [k, m] of bad.slice(0, 40)) console.log(k, `scrollW ${m.scrollW}/${m.vw}`, m.offenders.slice(0, 3).join(' | '), m.clipped.slice(0, 2).join(' | '))
  await b.close()
}

async function design() {
  const b = await launch()
  const out = dir('design')
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
  await p.goto(DESIGN)
  await p.waitForTimeout(9000)
  const ids = ['1a', '1b', '1c', '1d', '1e', '1f', '1g']
  const boxes = await p.evaluate(() => {
    const res = {}
    for (const e of document.querySelectorAll('*')) {
      const t = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('')
      if (/^\d[a-z]$/.test(t)) { const opt = e.parentElement.parentElement; const f = opt.children[1]; const r = f.getBoundingClientRect(); res[t] = { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height } }
    }
    return res
  })
  for (const id of ids) {
    const bx = boxes[id]; if (!bx) continue
    await p.setViewportSize({ width: 1600, height: Math.min(Math.ceil(bx.y + bx.h + 40), 6000) })
    await p.waitForTimeout(400)
    await p.screenshot({ path: join(out, `${id}.png`), clip: { x: bx.x, y: bx.y, width: bx.w, height: bx.h }, fullPage: true })
  }
  writeFileSync(join(out, 'boxes.json'), JSON.stringify(boxes, null, 1))
  console.log('design artboards:', JSON.stringify(boxes))
  await b.close()
}

async function compare() {
  const pairs = [['1a', 'home', 390], ['1b', 'timeline', 390], ['1c', 'event', 390], ['1d', 'event-dark', 390], ['1e', 'review', 390], ['1f', 'progress', 390], ['1g', 'event', 1280]]
  const out = dir('compare', label)
  for (const [d, l, w] of pairs) {
    const dp = join(OUT, 'design', `${d}.png`), lp = join(OUT, 'live', label, `${l}-${w}.png`)
    if (!existsSync(dp) || !existsSync(lp)) continue
    const A = sharp(dp), B = sharp(lp)
    const [ma, mb] = await Promise.all([A.metadata(), B.metadata()])
    const scale = w === 1280 ? 0.5 : 1
    const ra = await A.resize({ width: Math.round(ma.width * scale) }).png().toBuffer()
    const rb = await B.resize({ width: Math.round(mb.width * scale) }).png().toBuffer()
    const [ia, ib] = await Promise.all([sharp(ra).metadata(), sharp(rb).metadata()])
    const H = Math.max(ia.height, ib.height), gap = 20
    await sharp({ create: { width: ia.width + ib.width + gap, height: H, channels: 3, background: '#888' } })
      .composite([{ input: ra, left: 0, top: 0 }, { input: rb, left: ia.width + gap, top: 0 }]).png().toFile(join(out, `${d}-${l}-${w}.png`))
  }
  console.log('composites in', out)
}

/** crop <designId> <livePage> <width> <top> <height> [label]: design | live strip, for close inspection. */
async function crop() {
  const [, , , did, lp, w, top, h, lab = 'before'] = process.argv
  const dp = join(OUT, 'design', `${did}.png`), lv = join(OUT, 'live', lab, `${lp}-${w}.png`)
  const T = +top, H = +h
  const cut = async (f) => { const m = await sharp(f).metadata(); return sharp(f).extract({ left: 0, top: Math.min(T, m.height - 1), width: m.width, height: Math.min(H, m.height - T) }).png().toBuffer() }
  const [a, b] = await Promise.all([cut(dp), cut(lv)])
  const [ma, mb] = await Promise.all([sharp(a).metadata(), sharp(b).metadata()])
  const out = join(dir('compare', 'crops'), `${did}-${lp}-${w}-${T}.png`)
  await sharp({ create: { width: ma.width + mb.width + 16, height: Math.max(ma.height, mb.height), channels: 3, background: '#888' } }).composite([{ input: a, left: 0, top: 0 }, { input: b, left: ma.width + 16, top: 0 }]).png().toFile(out)
  console.log(out)
}

await ({ design, live, compare, crop }[mode] ?? (() => console.error('usage: design | live <label> | compare <label>')))()
