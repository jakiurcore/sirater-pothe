#!/usr/bin/env node
/** Mobile top-area audit: node scripts/nav-audit.mjs <label>  → design-audit/nav/<label>/{page}-{w}-{theme}.png + metrics.json */
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
const label = process.argv[2] ?? 'before'
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3100'
const OUT = new URL(`../../../design-audit/nav/${label}/`, import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const PAGES = { home: '/bn', timeline: '/bn/timeline', event: '/bn/events/hijrah-to-madinah', review: '/bn/review', progress: '/bn/progress', 'home-en': '/en', 'home-ar': '/ar' }
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const all = {}
for (const w of [360, 390, 430]) for (const theme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
  for (const [id, path] of Object.entries(PAGES)) {
    const page = await ctx.newPage()
    await page.addInitScript((t) => { try { localStorage.setItem('seerah:theme', t) } catch {} }, theme)
    await page.goto(BASE + path, { waitUntil: 'load' }); await page.waitForTimeout(id === 'event' ? 3000 : 900)
    const m = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth
      const head = document.querySelector('.apphead, .backbar, .pagehead, .pphead, .revhead') // the first thing at the top
      const hr = head?.getBoundingClientRect()
      const tools = [...document.querySelectorAll('.apphead .tools button, .apphead .tools a')].map((e) => { const r = e.getBoundingClientRect(); return `${e.className || e.tagName} ${Math.round(r.left)}→${Math.round(r.right)} x ${Math.round(r.width)}×${Math.round(r.height)}` })
      const clipped = [...document.querySelectorAll('.apphead *, .backbar *, .pagehead *, .tabbar *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map((e) => e.className || e.tagName)
      const over = [...document.querySelectorAll('.apphead, .apphead *, .backbar, .backbar *, .tabbar, .tabbar *')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > vw + 0.5 || r.left < -0.5 }).map((e) => e.className || e.tagName)
      const tab = document.querySelector('.tabbar')?.getBoundingClientRect()
      return { vw, sw: document.documentElement.scrollWidth, headTop: hr ? Math.round(hr.top) : null, headH: hr ? Math.round(hr.height) : null, tools, clipped, over, tabH: tab ? Math.round(tab.height) : null, lineHeights: [...document.querySelectorAll('.apphead .t b, .apphead .t span')].map((e) => `${e.textContent?.trim().slice(0, 12)} ${e.getBoundingClientRect().height.toFixed(0)}/${getComputedStyle(e).fontSize}`) }
    })
    all[`${id}@${w}-${theme}`] = m
    await page.screenshot({ path: `${OUT}${id}-${w}-${theme}.png`, clip: { x: 0, y: 0, width: w, height: id === 'event' ? 520 : 360 } })
    if (id === 'home' || id === 'event') {
      const btn = page.locator('.lang button:visible').first()
      if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}${id}-${w}-${theme}-menu.png`, clip: { x: 0, y: 0, width: w, height: 520 } }); const u = await page.evaluate(() => { const l = document.querySelector('.lang ul')?.getBoundingClientRect(); return l ? `${Math.round(l.left)}→${Math.round(l.right)} y${Math.round(l.top)}-${Math.round(l.bottom)}` : null }); all[`${id}@${w}-${theme}`].menu = u }
    }
    await page.close()
  }
  await ctx.close()
}
writeFileSync(OUT + 'metrics.json', JSON.stringify(all, null, 1))
for (const [k, m] of Object.entries(all)) if (m.sw > m.vw || m.over.length || m.clipped.length) console.log('ISSUE', k, 'sw', m.sw, 'over', m.over.slice(0, 4), 'clipped', m.clipped.slice(0, 4))
console.log(Object.keys(all).length, 'captures ->', OUT)
await b.close()
