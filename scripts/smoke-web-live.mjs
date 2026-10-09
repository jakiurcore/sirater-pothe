#!/usr/bin/env node
/**
 * Live smoke test of the website's map and mobile header (no login needed).
 *   node scripts/smoke-web-live.mjs            (SITE defaults to https://siraterpotehe.com)
 * The production database has no published event with a route yet, so this creates ONE temporary DRAFT event with a route
 * (slug zz-smoke-web-delete-me) plus a preview token directly in D1, drives the preview page in a real browser, and deletes
 * every temporary row afterwards (also on failure). Nothing temporary is ever published or indexed.
 */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SITE = process.env.SITE ?? 'https://siraterpotehe.com'
const SLUG = 'zz-smoke-web-delete-me'
const OUT = new URL('../design-audit/live/prod-smoke/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const token = randomBytes(24).toString('base64url')
const hash = createHash('sha256').update(token).digest('hex')
const expires = new Date(Date.now() + 3600e3).toISOString()
const sh = (args) => execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'seerah', '--remote', '--yes', ...args], { cwd: new URL('../apps/mcp/', import.meta.url).pathname, encoding: 'utf8' })
const run = (sql) => { const f = join(tmpdir(), `smoke-web-${process.pid}.sql`); writeFileSync(f, sql, { mode: 0o600 }); try { return sh(['--file', f]) } finally { rmSync(f, { force: true }) } }

const SETUP = `
INSERT INTO routes (id, slug, geojson) VALUES ('zz-smoke-route', 'zz-smoke-route', '{"type":"LineString","coordinates":[[39.826,21.4225],[39.85,21.37],[39.5,22.2],[39.2,23.2],[39.4,24.0],[39.61,24.47]]}');
INSERT INTO route_translations (route_id, lang, name) VALUES ('zz-smoke-route', 'bn', 'পরীক্ষামূলক পথ');
INSERT INTO events (id, slug, era_id, order_index, hijri_year, gregorian_approx, prophet_age, route_id, certainty, status, needs_verification)
  SELECT 'zz-smoke-event', '${SLUG}', (SELECT id FROM eras WHERE slug = 'hijrah'), (SELECT coalesce(max(order_index), 0) + 1024 FROM events), 1, 622, 53, 'zz-smoke-route', 'agreed', 'draft', 1;
INSERT INTO event_translations (event_id, lang, title, summary, key_details, lessons, status) VALUES ('zz-smoke-event', 'bn', 'স্মোক টেস্ট: পথসহ ঘটনা (মুছে ফেলা হবে)', 'এটি স্বয়ংক্রিয় পরীক্ষার একটি খসড়া।', '[]', '[]', 'draft');
INSERT INTO event_places (event_id, place_id, role, order_index) SELECT 'zz-smoke-event', id, 'primary', 0 FROM places WHERE slug = 'madinah';
INSERT INTO event_places (event_id, place_id, role, order_index) SELECT 'zz-smoke-event', id, 'route_start', 1 FROM places WHERE slug = 'makkah';
INSERT INTO preview_tokens (token_hash, event_id, expires_at, created_by) VALUES ('${hash}', 'zz-smoke-event', '${expires}', 'smoke-web');
`
const CLEANUP = `
DELETE FROM preview_tokens WHERE event_id = 'zz-smoke-event';
DELETE FROM events WHERE id = 'zz-smoke-event';
DELETE FROM routes WHERE id = 'zz-smoke-route';
DELETE FROM revisions WHERE entity_id = 'zz-smoke-event';
`
let failed = 0
const ok = (c, msg, extra = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}${extra ? '  ' + extra : ''}`); if (!c) failed++ }
const num = async (page, k) => Number(await page.locator('.mapbox').getAttribute(`data-${k}`))
const data = (page, k) => page.locator('.mapbox').getAttribute(`data-${k}`)
const btn = (page, name) => page.getByRole('button', { name })

try {
  run(CLEANUP) // in case a previous run died
  run(SETUP)
  const url = `${SITE}/bn/preview/${SLUG}?token=${token}`
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  try {
    for (const [name, vp, mobile] of [['mobile-390', { width: 390, height: 844 }, true], ['desktop-1280', { width: 1280, height: 860 }, false]]) {
      console.log(`\n── ${name} ──`)
      const ctx = await browser.newContext({ viewport: vp, hasTouch: mobile, deviceScaleFactor: 2 })
      const page = await ctx.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)))
      await page.goto(url)
      await page.waitForFunction(() => Number(document.querySelector('.mapbox')?.dataset.zoom) > 0, null, { timeout: 40_000 })
      ok((await data(page, 'mode')) === '2d' && (await data(page, 'terrain')) === 'off', 'opens in 2D (flat) by default')
      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
      ok(sw[0] <= sw[1], 'no horizontal scroll', `(${sw[0]}/${sw[1]})`)
      await page.screenshot({ path: `${OUT}${name}-2d.png` })

      const z0 = await num(page, 'zoom')
      await btn(page, 'বড় করুন').click(); await page.waitForTimeout(900)
      ok((await num(page, 'zoom')) > z0 + 0.8, 'zoom + button zooms in', `(${z0.toFixed(1)} → ${(await num(page, 'zoom')).toFixed(1)})`)
      await btn(page, 'ছোট করুন').click(); await page.waitForTimeout(900)
      await btn(page, 'ঘটনার স্থানে ফিরে যান').click(); await page.waitForTimeout(2500)
      ok(Math.abs((await num(page, 'zoom')) - z0) < 0.3, 'reset returns to the event view')

      await btn(page, 'ভূখণ্ড ৩D মোড').click()
      await page.waitForFunction(() => document.querySelector('.mapbox')?.dataset.terrain === 'on', null, { timeout: 40_000 })
      await page.waitForFunction(() => Number(document.querySelector('.mapbox')?.dataset.pitch) > 50, null, { timeout: 20_000 })
      ok(true, '3D terrain on, tilted', `(pitch ${await data(page, 'pitch')}°)`)
      await page.waitForFunction(() => document.querySelector('.mapbox')?.dataset.following === 'yes', null, { timeout: 30_000 }).then(() => ok(true, 'camera flies along the route'), () => ok(false, 'camera flies along the route'))
      await page.waitForTimeout(4000)
      await page.screenshot({ path: `${OUT}${name}-3d.png` })
      const dem = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.includes('/tiles/terrain.pmtiles')).length)
      ok(dem > 0, 'terrain.pmtiles is read from R2 (range requests)', `(${dem} requests)`)
      await btn(page, 'উত্তর ও কোণ ঠিক করুন').click(); await page.waitForTimeout(1200)
      ok((await num(page, 'bearing')) === 0, 'compass resets north', `(bearing ${await data(page, 'bearing')})`)
      await btn(page, 'মানচিত্র মোড').click(); await page.waitForTimeout(2500)
      ok((await data(page, 'terrain')) === 'off' && (await num(page, 'pitch')) === 0, 'back to flat 2D')

      await btn(page, 'অন্যান্য স্থান দেখান').click()
      await page.waitForFunction(() => document.querySelectorAll('.mapmk .hit').length > 0, null, { timeout: 20_000 })
      ok(true, 'other places toggle shows markers', `(${await page.locator('.mapmk .hit').count()})`)
      for (let i = 0; i < 4 && (await page.locator('.mapmk.oth .hit').count()) === 0; i++) { await btn(page, 'বড় করুন').click(); await page.waitForTimeout(1000) }
      await page.locator('.mapmk.oth .hit').first().dispatchEvent('click')
      await page.waitForSelector('.placecard', { timeout: 5000 }).then(async () => {
        const txt = (await page.locator('.placecard').innerText()).replace(/\n+/g, ' | ')
        ok(true, 'tapping a marker opens its card', `(${txt.slice(0, 80)})`)
        ok(/যাচাই বাকি/.test(txt), 'unverified place shows the "যাচাই বাকি" badge')
        await page.screenshot({ path: `${OUT}${name}-card.png` })
        await page.keyboard.press('Escape')
      }, () => ok(false, 'tapping a marker opens its card'))
      ok(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '))

      if (mobile) {
        // header + language menu on the real site
        await page.goto(`${SITE}/bn`)
        await page.waitForSelector('.apphead')
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, tools: [...document.querySelectorAll('.apphead .tools button')].map((b) => [Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)]), meta: document.querySelector('meta[name=viewport]')?.content }))
        ok(m.sw <= m.vw && m.tools.every(([w, h]) => w >= 44 && h >= 44), 'mobile header: no overflow, 44px targets', JSON.stringify(m.tools))
        ok(/viewport-fit=cover/.test(m.meta ?? ''), 'viewport-fit=cover is live')
        await page.locator('.apphead .lang button').click()
        const l = await page.locator('.lang ul').boundingBox()
        ok(l && l.x >= 0 && l.x + l.width <= vp.width && l.y + l.height <= vp.height, 'language menu fits the screen')
        await page.screenshot({ path: `${OUT}${name}-header-menu.png`, clip: { x: 0, y: 0, width: vp.width, height: 360 } })
      }
      await ctx.close()
    }
  } finally { await browser.close() }
} finally {
  try { run(CLEANUP); const left = run(`SELECT (SELECT count(*) FROM events WHERE slug = '${SLUG}') e, (SELECT count(*) FROM routes WHERE slug = 'zz-smoke-route') r, (SELECT count(*) FROM preview_tokens WHERE created_by = 'smoke-web') t;`); console.log('\ncleanup:', /"e": 0,\s*"r": 0,\s*"t": 0/.test(left) ? 'all temporary rows deleted' : 'CHECK LEFTOVERS\n' + left) } catch (e) { console.error('CLEANUP FAILED, remove zz-smoke-* rows manually', e.message) }
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
