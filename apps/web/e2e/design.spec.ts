import { test, expect, type Page } from '@playwright/test'
import { TOKENS } from './setup.mjs'

/**
 * Responsive + design regression tests. Projects run at 390 (mobile) and 1280 (desktop).
 * Snapshots are of the live pages with a frozen clock, fixed reader state and the map masked
 * (WebGL output is not stable across GPUs); update with `pnpm e2e -- design --update-snapshots`.
 */
const NOW = new Date('2026-10-09T10:00:00+06:00')
const iso = (n = 0) => new Date(NOW.getTime() - n * 864e5).toISOString()
const day = (n: number) => iso(n).slice(0, 10)
const STATE = {
  read: { 'seed-event-year-of-the-elephant': iso(), 'seed-event-birth-of-the-prophet': iso() },
  notes: { 'seed-event-year-of-the-elephant': { text: 'আবরাহার হাতি এগোতে চায়নি, এটা মনে রাখতে হবে।', updatedAt: iso() } },
  last: 'seed-event-hijrah-to-madinah',
  srs: { 'seed-q-year-of-the-elephant-0': { due: day(0), interval: 1, ease: 2.5, reps: 1, lapses: 0 } },
  reviewDays: [day(2), day(1)],
}

async function setup(page: Page, opts: { state?: object | null; theme?: 'dark' } = {}) {
  await page.clock.install({ time: NOW })
  await page.addInitScript(([st, theme]) => {
    try { if (st) localStorage.setItem('seerah:v1:reader', JSON.stringify(st)); if (theme) localStorage.setItem('seerah:theme', theme as string) } catch { /* private mode */ }
  }, [opts.state === undefined ? STATE : opts.state, opts.theme ?? null] as const)
}
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  // Lazy pictures only load near the viewport: walk down the page once so full-page captures and measurements see them.
  for (const f of await page.locator('figure.pic').all()) { await f.scrollIntoViewIfNeeded(); await f.locator('img').evaluate((i: HTMLImageElement) => i.decode().catch(() => {})) }
  await page.evaluate(() => scrollTo(0, 0))
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
  await page.waitForTimeout(400)
}
const PAGES: { id: string; path: string; opts?: { state?: null; theme?: 'dark' }; full?: boolean }[] = [
  { id: 'home', path: '/bn' },
  { id: 'home-fresh', path: '/bn', opts: { state: null } },
  { id: 'timeline', path: '/bn/timeline' },
  { id: 'event', path: '/bn/events/hijrah-to-madinah' },
  { id: 'event-dark', path: '/bn/events/hijrah-to-madinah', opts: { theme: 'dark' } },
  { id: 'review', path: '/bn/review' },
  { id: 'review-empty', path: '/bn/review', opts: { state: null } },
  { id: 'progress', path: '/bn/progress' },
  { id: 'progress-empty', path: '/bn/progress', opts: { state: null } },
  { id: 'event-rtl', path: '/ar/events/hijrah-to-madinah' },
  { id: 'event-media', path: '/bn/events/battle-of-badr' },
  { id: 'event-media-preview', path: `/bn/preview/e2e-media?token=${TOKENS.media}` },
  { id: 'long-title', path: `/bn/preview/e2e-long-title?token=${TOKENS.long}` },
]

test.describe('responsive: no overflow, 44px targets, Bangla never clipped', () => {
  for (const p of PAGES) {
    test(p.id, async ({ page }) => {
      await setup(page, p.opts)
      await page.goto(p.path)
      await page.waitForSelector('main, article, .revbody, .ev')
      await settle(page)
      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth
        const hidden = (e: Element) => { const s = getComputedStyle(e), b = e.getBoundingClientRect(); return s.visibility === 'hidden' || s.display === 'none' || b.width === 0 || b.height === 0 }
        const inScroller = (e: Element) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) return true; return false }
        const out: string[] = [], small: string[] = [], clipped: string[] = []
        for (const e of document.querySelectorAll('body *')) {
          if (hidden(e)) continue
          const b = e.getBoundingClientRect(), s = getComputedStyle(e)
          if (s.position !== 'fixed' && !inScroller(e) && (b.right > vw + 1 || b.left < -1)) out.push(e.tagName + '.' + e.className)
          if (e.matches('a[href],button,summary,input:not([type=hidden]),textarea,select') && !e.closest('.skip') && !(s.display === 'inline' && e.closest('p')) && (b.width < 43.5 || b.height < 43.5)) small.push(`${e.tagName}.${e.className} ${Math.round(b.width)}x${Math.round(b.height)}`)
          if ((s.overflowY === 'hidden' || s.overflowY === 'clip') && e.scrollHeight > e.clientHeight + 2 && e.clientHeight > 0 && e.textContent?.trim() && !e.matches('.mapbox,.stage,.maplibregl-map,.pat,.track,.bar,.b')) clipped.push(`${e.tagName}.${e.className}`)
        }
        return { scrollW: document.documentElement.scrollWidth, vw, out, small, clipped }
      })
      expect(r.scrollW, 'no horizontal page scroll').toBeLessThanOrEqual(r.vw)
      expect(r.out, 'nothing outside the viewport').toEqual([])
      expect(r.small, 'tap targets >= 44px').toEqual([])
      expect(r.clipped, 'no clipped text').toEqual([])
    })
  }
})

test.describe('visual regression', () => {
  for (const p of PAGES) {
    test(p.id, async ({ page }) => {
      await setup(page, p.opts)
      await page.goto(p.path)
      await page.waitForSelector('main, article, .revbody, .ev')
      await settle(page)
      await expect(page).toHaveScreenshot(`${p.id}.png`, {
        fullPage: true,
        mask: [page.locator('.mapbox'), page.locator('.maplibregl-ctrl-attrib')],
        maxDiffPixelRatio: 0.02,
      })
    })
  }
})

test.describe('language dropdown', () => {
  const open = async (page: Page) => {
    await setup(page)
    await page.goto('/bn')
    const btn = page.locator('.lang button:visible').first()
    await btn.click()
    return { btn, list: page.locator('.lang ul') }
  }

  test('opens inside the viewport, closes on Escape and on outside press', async ({ page }) => {
    const { btn, list } = await open(page)
    await expect(list).toBeVisible()
    const b = await list.boundingBox(), vp = page.viewportSize()!
    expect(b!.x).toBeGreaterThanOrEqual(0)
    expect(b!.x + b!.width).toBeLessThanOrEqual(vp.width)
    expect(b!.y + b!.height).toBeLessThanOrEqual(vp.height)
    await page.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
    await expect(btn).toBeFocused()
    await btn.click()
    await expect(list).toBeVisible()
    await page.mouse.click(5, vp.height - 5)
    await expect(list).toHaveCount(0)
  })

  test('scrolls inside itself when the viewport is too short, never off-screen', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 190 })
    const { list } = await open(page)
    const m = await list.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, bottom: el.getBoundingClientRect().bottom, vh: window.innerHeight, oy: getComputedStyle(el).overflowY }))
    expect(m.oy).toBe('auto')
    expect(m.sh).toBeGreaterThan(m.ch) // content is taller than the room, so it scrolls
    expect(m.bottom).toBeLessThanOrEqual(m.vh)
    await list.evaluate((el) => (el.scrollTop = el.scrollHeight))
    await expect(list.locator('a').last()).toBeInViewport()
  })

  test('flips upward when there is no room below', async ({ page }) => {
    await setup(page)
    await page.goto('/bn')
    const tools = page.locator('.tools:visible').first()
    await tools.evaluate((el) => { Object.assign(el.style, { position: 'fixed', bottom: '8px', insetInlineEnd: '8px', zIndex: '50' }) })
    const btn = page.locator('.lang button:visible').first()
    await btn.click()
    const list = page.locator('.lang ul')
    const [bb, lb] = [await btn.boundingBox(), await list.boundingBox()]
    expect(lb!.y + lb!.height).toBeLessThanOrEqual(bb!.y) // sits above the button
    expect(lb!.y).toBeGreaterThanOrEqual(0)
  })

  test('is not clipped by an overflow:hidden ancestor (modal-like container)', async ({ page }) => {
    await setup(page)
    await page.goto('/bn')
    await page.locator('.tools:visible').first().evaluate((el) => {
      const box = document.createElement('div')
      Object.assign(box.style, { position: 'fixed', inset: '40% 10% 10%', overflow: 'hidden', background: '#fff', zIndex: '40', display: 'flex' })
      el.parentElement!.appendChild(box); box.appendChild(el)
    })
    await page.locator('.lang button:visible').first().click()
    const list = page.locator('.lang ul')
    await expect(list).toBeVisible()
    await expect(list.locator('a').last()).toBeInViewport() // visible even though the container is smaller than the list
  })
})
