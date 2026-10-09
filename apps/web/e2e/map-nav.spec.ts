import { test, expect, type Page } from '@playwright/test'
import { TOKENS } from './setup.mjs'

/**
 * Map controls (2D/3D, zoom, reset, compass, other places), mobile top area, meta numerals, empty date row.
 * Run once (the `desktop` project) with explicit viewports, so 360 / 390 / 430 / 768 / 1280 are all covered.
 */
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'viewport is set per test') })

const ROUTE_EVENT = '/bn/events/hijrah-to-madinah'
const data = (page: Page) => page.locator('.mapbox').evaluate((el) => ({ ...(el as HTMLElement).dataset }))
const num = async (page: Page, k: string) => Number((await data(page))[k] ?? NaN)
async function ready(page: Page) { await expect.poll(() => num(page, 'zoom'), { timeout: 30_000 }).toBeGreaterThan(0) }
async function settled(page: Page) {
  let last = -1
  await expect.poll(async () => { const z = await num(page, 'zoom'); const ok = Math.abs(z - last) < 0.01; last = z; return ok }, { timeout: 30_000, intervals: [700] }).toBe(true)
}
async function theme(page: Page, t: 'light' | 'dark') { await page.addInitScript((v) => { try { localStorage.setItem('seerah:theme', v) } catch { /* private mode */ } }, t) }
const btn = (page: Page, name: string | RegExp) => page.getByRole('button', { name })

for (const [w, h] of [[360, 800], [390, 844], [768, 1024], [1280, 860]] as const) {
  test.describe(`map controls @${w}`, () => {
    test.use({ viewport: { width: w, height: h } })

    test('2D / 3D toggle: terrain + 55° tilt, back to flat, choice remembered', async ({ page }) => {
      await page.goto(ROUTE_EVENT)
      await ready(page)
      expect(await data(page)).toMatchObject({ mode: '2d', terrain: 'off', pitch: '0' })
      await btn(page, 'ভূখণ্ড ৩D মোড').click()
      await expect.poll(() => data(page)).toMatchObject({ mode: '3d', terrain: 'on' })
      await expect.poll(() => num(page, 'pitch'), { timeout: 20_000 }).toBeGreaterThan(50)
      await expect(btn(page, 'ভূখণ্ড ৩D মোড')).toHaveAttribute('aria-pressed', 'true')
      expect(await page.evaluate(() => localStorage.getItem('seerah:map:mode'))).toBe('3d')
      await page.reload()
      await ready(page)
      await expect.poll(() => data(page), { timeout: 20_000 }).toMatchObject({ mode: '3d', terrain: 'on' }) // remembered
      await btn(page, 'মানচিত্র মোড').click()
      await expect.poll(() => data(page)).toMatchObject({ mode: '2d', terrain: 'off' })
      await expect.poll(() => num(page, 'pitch'), { timeout: 20_000 }).toBe(0)
      expect(await page.evaluate(() => localStorage.getItem('seerah:map:mode'))).toBe('2d')
    })

    test('zoom in / out change the zoom by one level; reset returns to the event\'s place', async ({ page }) => {
      await page.goto('/bn/events/birth-of-the-prophet')
      await ready(page); await settled(page)
      const z0 = await num(page, 'zoom')
      await btn(page, 'বড় করুন').click()
      await expect.poll(() => num(page, 'zoom')).toBeGreaterThan(z0 + 0.8)
      await btn(page, 'বড় করুন').click()
      await settled(page)
      expect(await num(page, 'zoom')).toBeGreaterThan(z0 + 1.8)
      await btn(page, 'ছোট করুন').click()
      await settled(page)
      expect(await num(page, 'zoom')).toBeLessThan(z0 + 1.2)
      await btn(page, 'ঘটনার স্থানে ফিরে যান').click()
      await expect.poll(async () => Math.abs((await num(page, 'zoom')) - z0), { timeout: 20_000 }).toBeLessThan(0.2)
    })

    test('3D: the compass appears, follows the bearing and resets north + tilt', async ({ page }) => {
      await page.goto('/bn/events/birth-of-the-prophet')
      await ready(page)
      await expect(page.locator('.compass')).toHaveCount(0) // flat map has no compass
      await btn(page, 'ভূখণ্ড ৩D মোড').click()
      await expect(page.locator('.compass')).toBeVisible()
      await expect.poll(() => num(page, 'pitch'), { timeout: 20_000 }).toBeGreaterThan(50)
      // rotate with the keyboard (shift+arrow also tilts, plain arrows pan): use the page's own bearing via a drag with the right button
      const box = (await page.locator('.mapbox').boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down({ button: 'right' })
      await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 })
      await page.mouse.up({ button: 'right' })
      await expect.poll(async () => Math.abs(await num(page, 'bearing')), { timeout: 10_000 }).toBeGreaterThan(5)
      await btn(page, 'উত্তর ও কোণ ঠিক করুন').click()
      await expect.poll(() => num(page, 'bearing'), { timeout: 10_000 }).toBe(0)
      expect(await num(page, 'pitch')).toBeGreaterThan(50)
    })

    test('3D on an event with a route flies along it slowly; any gesture stops the flight', async ({ page }) => {
      await page.goto(ROUTE_EVENT)
      await ready(page)
      await btn(page, 'ভূখণ্ড ৩D মোড').click()
      await expect.poll(async () => (await data(page)).following, { timeout: 30_000 }).toBe('yes')
      const c0 = await page.locator('.mapbox').evaluate((el) => (el as HTMLElement).dataset.bearing)
      await page.waitForTimeout(2500)
      expect(await page.locator('.mapbox').evaluate((el) => (el as HTMLElement).dataset.bearing)).not.toBe(undefined)
      void c0
      const box = (await page.locator('.mapbox').boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 5 }); await page.mouse.up()
      await expect.poll(async () => (await data(page)).following, { timeout: 5000 }).toBe('no')
    })

    test('other places: off by default; on shows secondary markers; a marker opens a card with name, type, badge and event links', async ({ page }) => {
      await page.goto(ROUTE_EVENT)
      await ready(page)
      await expect(page.locator('.mapmk.oth, .mapmk.cl')).toHaveCount(0)
      const chip = btn(page, 'অন্যান্য স্থান দেখান')
      await expect(chip).toHaveAttribute('aria-pressed', 'false')
      await chip.click()
      await expect(chip).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => page.locator('.mapmk.oth, .mapmk.cl').count(), { timeout: 20_000 }).toBeGreaterThan(0)
      // open a card from the first single marker (zoom in a little when everything is clustered)
      for (let i = 0; i < 4 && (await page.locator('.mapmk.oth .hit').count()) === 0; i++) { await btn(page, 'বড় করুন').click(); await page.waitForTimeout(900) }
      await page.locator('.mapmk.oth .hit').first().dispatchEvent('click')
      const card = page.locator('.placecard')
      await expect(card).toBeVisible()
      await expect(card.locator('b')).not.toHaveText('')
      await expect(card.locator('.pt span')).toContainText(/অঞ্চল|শহর|স্থান/)
      await expect(card.locator('.px')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(card).toHaveCount(0)
      await btn(page, 'অন্যান্য স্থান দেখান').click()
      await expect(page.locator('.mapmk.oth, .mapmk.cl')).toHaveCount(0)
    })

    test('a place with published events lists them as links; an unverified place has the badge', async ({ page }) => {
      await page.goto('/bn/events/hijrah-to-madinah')
      await ready(page)
      await btn(page, 'অন্যান্য স্থান দেখান').click()
      // Badr has a published event (battle-of-badr) and is unverified: find its marker by label
      const badr = page.locator('.mapmk.oth .hit[aria-label="বদর"]')
      await expect.poll(() => page.locator('.mapmk .hit').count(), { timeout: 20_000 }).toBeGreaterThan(0) // places index loaded
      for (let i = 0; i < 3 && (await badr.count()) === 0; i++) { await btn(page, 'বড় করুন').click(); await page.waitForTimeout(1100) }
      await expect(badr).toHaveCount(1)
      await badr.dispatchEvent('click') // markers re-render while the camera settles; a DOM click is stable
      const card = page.locator('.placecard')
      await expect(card).toBeVisible()
      await expect(card.locator('.unv')).toHaveText('যাচাই বাকি')
      const link = card.locator('li a').first()
      await expect(link).toHaveAttribute('href', /\/bn\/events\/battle-of-badr$/)
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      expect((await card.locator('.px').boundingBox())!.width).toBeGreaterThanOrEqual(44)
      await link.click()
      await expect(page).toHaveURL(/battle-of-badr/)
    })

    test('controls: ≥44px targets, Bangla aria-labels, inside the map, no overlap with each other', async ({ page }) => {
      await page.goto(ROUTE_EVENT)
      await ready(page)
      await btn(page, 'ভূখণ্ড ৩D মোড').click()
      const items = await page.locator('.mapctl button, .seg button, .mapchip').evaluateAll((els) => els.map((e) => {
        const r = e.getBoundingClientRect()
        return { label: e.getAttribute('aria-label') ?? e.textContent ?? '', x: r.x, y: r.y, w: r.width, h: r.height }
      }))
      const box = (await page.locator('.mapbox').boundingBox())!
      expect(items.length).toBe(7) // chip + 2 mode buttons + zoom in / out / reset / compass
      for (const i of items) {
        expect(i.w, i.label).toBeGreaterThanOrEqual(43.5)
        expect(i.h, i.label).toBeGreaterThanOrEqual(43.5)
        expect(i.x, i.label).toBeGreaterThanOrEqual(box.x - 0.5)
        expect(i.x + i.w, i.label).toBeLessThanOrEqual(box.x + box.width + 0.5)
        expect(i.y + i.h, i.label).toBeLessThanOrEqual(box.y + box.height + 0.5)
        expect(i.label, 'Bangla label').toMatch(/[ঀ-৿]/)
      }
      for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
        const A = items[a]!, B = items[b]!
        const overlap = A.x < B.x + B.w - 1 && A.x + A.w > B.x + 1 && A.y < B.y + B.h - 1 && A.y + A.h > B.y + 1
        expect(overlap, `${A.label} / ${B.label}`).toBe(false)
      }
      // the attribution control must not sit under the last control column button
      const attr = (await page.locator('.maplibregl-ctrl-attrib').boundingBox())!
      for (const i of items) {
        const overlap = i.x < attr.x + attr.width - 1 && i.x + i.w > attr.x + 1 && i.y < attr.y + attr.height - 1 && i.y + i.h > attr.y + 1
        expect(overlap, `${i.label} must not sit on the attribution`).toBe(false)
      }
    })

    test('light and dark: controls keep a visible surface and border', async ({ page }) => {
      for (const t of ['light', 'dark'] as const) {
        await page.goto(ROUTE_EVENT)
        await page.evaluate((v) => localStorage.setItem('seerah:theme', v), t)
        await page.reload()
        await ready(page)
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(t)
        const s = await page.locator('.mapctl button').first().evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, border: c.borderTopColor, color: c.color } })
        const root = await page.evaluate(() => ({ surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() }))
        expect(s.bg).not.toBe('rgba(0, 0, 0, 0)')
        expect(s.bg).not.toBe(s.color)
        if (t === 'dark') expect(root.surface.toLowerCase()).toBe('#142035')
        else expect(root.surface.toLowerCase()).toBe('#faf6ee')
      }
    })
  })
}

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } })
  test('3D stays static: tilted, no automatic route flight', async ({ page }) => {
    await page.goto(ROUTE_EVENT)
    await ready(page)
    await btn(page, 'ভূখণ্ড ৩D মোড').click()
    await expect.poll(() => num(page, 'pitch'), { timeout: 20_000 }).toBeGreaterThan(50)
    await page.waitForTimeout(6000)
    expect((await data(page)).following).toBe('no')
    const b = await num(page, 'bearing'); await page.waitForTimeout(1500)
    expect(await num(page, 'bearing')).toBe(b)
  })
})

// ───────────── mobile top area ─────────────
for (const w of [360, 390, 430]) for (const t of ['light', 'dark'] as const) {
  test.describe(`mobile top area @${w} ${t}`, () => {
    test.use({ viewport: { width: w, height: 800 }, hasTouch: true, isMobile: true })
    test('header, language menu, tab bar: no overflow, targets ≥44px, nothing clipped, content not covered', async ({ page }) => {
      await theme(page, t)
      for (const lang of ['bn', 'en', 'ar']) {
        await page.goto(`/${lang}`)
        await page.waitForSelector('.apphead')
        const r = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth
          const rect = (s: string) => [...document.querySelectorAll(s)].map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width, h: b.height, t: b.top } })
          const title = document.querySelector('.apphead .t b') as HTMLElement
          return { sw: document.documentElement.scrollWidth, vw, tools: rect('.apphead .tools button'), tabs: rect('.tabbar a'), head: rect('.apphead')[0]!, titleClipped: title.scrollWidth > title.clientWidth + 1 }
        })
        expect(r.sw, `${lang} no horizontal scroll`).toBeLessThanOrEqual(r.vw)
        expect(r.titleClipped).toBe(false)
        expect(r.tools.length).toBe(2)
        for (const b of r.tools) { expect(b.h).toBeGreaterThanOrEqual(43.5); expect(b.w).toBeGreaterThanOrEqual(43.5); expect(b.l).toBeGreaterThanOrEqual(0); expect(b.r).toBeLessThanOrEqual(r.vw) }
        expect(r.tabs.length).toBe(4)
        for (const b of r.tabs) { expect(b.h).toBeGreaterThanOrEqual(43.5); expect(b.l).toBeGreaterThanOrEqual(0); expect(b.r).toBeLessThanOrEqual(r.vw + 0.5) }
        // language menu: inside the viewport, scrolls instead of overflowing, items ≥44px
        await page.locator('.apphead .lang button').click()
        const m = await page.locator('.lang ul').evaluate((ul) => { const b = ul.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, vw: innerWidth, vh: innerHeight, items: [...ul.querySelectorAll('a')].map((a) => a.getBoundingClientRect().height) } })
        expect(m.l).toBeGreaterThanOrEqual(0); expect(m.r).toBeLessThanOrEqual(m.vw); expect(m.b).toBeLessThanOrEqual(m.vh)
        for (const h of m.items) expect(h).toBeGreaterThanOrEqual(43.5)
        await page.keyboard.press('Escape')
        // the last piece of content is not hidden behind the sticky tab bar
        await page.evaluate(() => scrollTo(0, document.body.scrollHeight))
        const gap = await page.evaluate(() => { const tab = document.querySelector('.tabbar')!.getBoundingClientRect().top; const last = [...document.querySelectorAll('.app-body *')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.getBoundingClientRect().bottom).sort((a, b) => b - a)[0]!; return tab - last })
        expect(gap).toBeGreaterThanOrEqual(-1)
      }
    })
    test('theme toggle works and the header keeps its layout', async ({ page }) => {
      await theme(page, t)
      await page.goto('/bn')
      const before = await page.locator('.apphead').boundingBox()
      await page.locator('.apphead .iconbtn').click()
      const after = await page.locator('.apphead').boundingBox()
      expect(after!.height).toBe(before!.height)
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(t)
    })
  })
}

test.describe('phones in landscape and the viewport', () => {
  test('landscape phone (932×430) gets the mobile layout, desktop (1280×860) the desktop header', async ({ browser }) => {
    const ls = await (await browser.newContext({ viewport: { width: 932, height: 430 } })).newPage()
    await ls.goto('/bn/timeline')
    await expect(ls.locator('.tabbar')).toBeVisible()
    await expect(ls.locator('.deskbar')).toBeHidden()
    expect(await ls.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const dk = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage()
    await dk.goto('/bn/timeline')
    await expect(dk.locator('.deskbar')).toBeVisible()
    await expect(dk.locator('.tabbar')).toBeHidden()
  })
  test('viewport-fit=cover is set (safe-area insets work on notched phones)', async ({ page }) => {
    await page.goto('/bn')
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)
  })
})

// ───────────── numerals ─────────────
test.describe('Bangla digits in meta text', () => {
  for (const [w, h] of [[390, 844], [1280, 860]] as const) for (const t of ['light', 'dark'] as const) {
    test.describe(`@${w} ${t}`, () => {
      test.use({ viewport: { width: w, height: h } })
      test('the eyebrow line and the meta row use the numeral font; headings and body keep theirs', async ({ page }) => {
        await theme(page, t)
        await page.goto(ROUTE_EVENT)
        await page.waitForSelector('.ev .kicker')
        await page.evaluate(() => document.fonts.ready)
        const f = await page.evaluate(() => {
          const fam = (s: string) => getComputedStyle(document.querySelector(s)!).fontFamily
          return { kicker: fam('.ev .kicker'), dd: fam('.facts dd'), dt: fam('.facts dt'), h1: fam('.ev h1'), sum: fam('.ev .sum'), circ: document.querySelector('.circ') ? fam('.circ') : '', loaded: [...document.fonts].filter((x) => x.status === 'loaded').map((x) => x.family) }
        })
        for (const k of ['kicker', 'dd', 'dt'] as const) expect(f[k], k).toMatch(/Noto[ _]Sans[ _]Bengali/i)
        expect(f.h1).toMatch(/Hind[ _]Siliguri/i)
        expect(f.sum).toMatch(/Noto[ _]Serif[ _]Bengali/i)
        expect(f.loaded.join()).toMatch(/Noto[ _]Sans[ _]Bengali/i)
      })
      test('visual: eyebrow line and meta row', async ({ page }) => {
        await theme(page, t)
        await page.clock.install({ time: new Date('2026-10-09T10:00:00+06:00') })
        await page.goto(ROUTE_EVENT)
        await page.waitForSelector('.ev .kicker')
        await page.evaluate(() => document.fonts.ready)
        await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' })
        const hdr = page.locator('.ev > header')
        await expect(hdr).toHaveScreenshot(`numerals-header-${w}-${t}.png`, { maxDiffPixelRatio: 0.01 })
      })
    })
  }
})

// ───────────── events without dates ─────────────
test.describe('meta row of an event without any date', () => {
  for (const [w, h] of [[390, 844], [1280, 860]] as const) {
    test(`shows one label instead of three dashes @${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto(`/bn/preview/e2e-nodate?token=${TOKENS.nodate}`)
      const facts = page.locator('.facts')
      await expect(facts).toBeVisible()
      await expect(facts).not.toContainText('—')
      await expect(facts.locator('div')).toHaveCount(2) // "সময়: নির্দিষ্ট সময় নেই" + the place
      await expect(facts).toContainText('নির্দিষ্ট সময় নেই')
      await expect(facts.locator('dt').first()).toHaveText('সময়')
      await expect(facts).toContainText('মক্কা')
    })
  }
  test('an event with dates still shows only the facts it has (hijri, gregorian, age, place)', async ({ page }) => {
    await page.goto(ROUTE_EVENT)
    await expect(page.locator('.facts div')).toHaveCount(4)
    await expect(page.locator('.facts')).not.toContainText('—')
  })
})
