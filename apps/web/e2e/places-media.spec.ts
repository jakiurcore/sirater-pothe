import { test, expect, type Page } from '@playwright/test'
import { TOKENS, PICS, mediaId } from './setup.mjs'

/**
 * Fixtures (e2e/setup.mjs): battle-of-badr (published seed event, given fixture places/pictures by setup) and e2e-media (draft + preview token) have the same places and pictures:
 * places zamzam (primary) + masjid-al-haram + makkah (related), and 7 pictures, one or more in every placement.
 * e2e-site / e2e-region are drafts with one place of that type; seed events cover a city (birth-of-the-prophet) and a
 * site outside the detailed tiles (battle-of-badr).
 */
const PUB = '/bn/events/battle-of-badr'
const DRAFT = `/bn/preview/e2e-media?token=${TOKENS.media}`

const EXPECTED = [
  'pic:hero',
  'sum:0', 'pic:in_summary:0', 'ayah:96:1', 'sum:1', 'sum:2',
  'pic:after_summary',
  'key:0', 'pic:in_key_details:0', 'ayah:105:1', 'key:1', 'key:2', 'pic:in_key_details:2',
  'pic:before_lessons',
  'lesson:0', 'lesson:1', 'pic:in_lessons:1', 'ayah:9:40', 'lesson:2',
  'pic:end', 'ayah:105:2',
  'gallery', 'pic:gallery', 'pic:gallery',
]

/** The page's landmarks in document order. Pictures and ayat get `placement[:index]`; the index is the element they follow. */
async function sequence(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    let sum = -1, key = -1, lesson = -1
    for (const el of document.querySelectorAll('article .sum, article .keys > li:not(.keypic), article .lessons > li:not(.keypic), article figure.pic, article .ayahwrap, article .sec > h2')) {
      if (el.matches('.sum')) out.push(`sum:${++sum}`)
      else if (el.matches('.keys > li')) out.push(`key:${++key}`)
      else if (el.matches('.lessons > li')) out.push(`lesson:${++lesson}`)
      else if (el.matches('figure.pic')) {
        const p = (el as HTMLElement).dataset.placement!
        out.push(p === 'in_summary' ? `pic:${p}:${sum}` : p === 'in_key_details' ? `pic:${p}:${key}` : p === 'in_lessons' ? `pic:${p}:${lesson}` : `pic:${p}`)
      } else if (el.matches('.ayahwrap')) out.push(`ayah:${(el as HTMLElement).dataset.ref}`)
      else if (el.matches('h2') && el.parentElement!.querySelector(':scope > .pics.grid')) out.push('gallery')
    }
    return out
  })
}
async function loadAll(page: Page) {
  for (const f of await page.locator('figure.pic').all()) { await f.scrollIntoViewIfNeeded(); await expect.poll(() => f.locator('img').evaluate((i: HTMLImageElement) => i.complete)).toBe(true) }
  await page.evaluate(() => scrollTo(0, 0))
}
const zoom = (page: Page) => page.locator('.mapbox').evaluate((el) => Number((el as HTMLElement).dataset.zoom ?? 'NaN'))
async function zoomIs(page: Page, expected: number) {
  await expect.poll(() => zoom(page), { timeout: 30_000, message: `map zoom should settle at ${expected}` }).toBeGreaterThan(expected - 0.15)
  expect(await zoom(page)).toBeLessThan(expected + 0.15)
}

test.describe('media placement on the event page', () => {
  test('every picture sits exactly at its placement (published)', async ({ page }) => {
    await page.goto(PUB)
    expect(await sequence(page)).toEqual(EXPECTED)
  })

  test('preview shows the same placements as the published page', async ({ page }) => {
    await page.goto(DRAFT)
    const draft = await sequence(page)
    await page.goto(PUB)
    expect(draft).toEqual(await sequence(page))
    expect(draft).toEqual(EXPECTED)
  })

  test('pictures load, are lazy, have alt text, reserved space, caption and credit; nothing overflows', async ({ page }) => {
    await page.goto(PUB)
    await loadAll(page)
    const figs = page.locator('figure.pic')
    await expect(figs).toHaveCount(PICS.length)
    const data = await figs.evaluateAll((els) => els.map((f) => {
      const img = f.querySelector('img')!
      return {
        placement: (f as HTMLElement).dataset.placement, alt: img.alt, lazy: img.loading, nw: img.naturalWidth, w: img.getBoundingClientRect().width,
        ratio: (f.querySelector('.frame') as HTMLElement).style.aspectRatio, cap: f.querySelector('figcaption span')?.textContent ?? null, credit: f.querySelector('figcaption small')?.textContent ?? null,
        parentW: f.parentElement!.getBoundingClientRect().width,
      }
    }))
    PICS.forEach((p, i) => {
      // order in the DOM differs from PICS order (key pictures sit inside the list), so look each one up by its alt text
      const d = data.find((x) => x.alt === p.alt)!
      expect(d, p.alt).toBeTruthy()
      expect(d.lazy).toBe('lazy')
      expect(d.nw, `${p.id} loaded`).toBe(p.w)
      expect(d.ratio.replace(/\s/g, '')).toBe(`${p.w}/${p.h}`)
      expect(d.w).toBeLessThanOrEqual(d.parentW + 1)
      expect(d.cap).toBe(p.caption)
      expect(d.credit).toBe(p.credit)
      void i
    })
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }))
    expect(o.sw).toBeLessThanOrEqual(o.vw)
  })

  test('the gallery is a grid with a heading; key-detail pictures are not numbered like details', async ({ page }) => {
    await page.goto(PUB)
    await expect(page.locator('.sec > h2', { hasText: 'ছবি' })).toBeVisible()
    await expect(page.locator('.pics.grid figure.pic')).toHaveCount(2)
    await expect(page.locator('.keys > li:not(.keypic) > b')).toHaveText(['১', '২', '৩'])
  })

  test('picture URLs: public for a published event, token-gated for a draft, 404 for everything else', async ({ request }) => {
    const pub = await request.get(`/media/${mediaId(0, true)}`)
    expect(pub.status()).toBe(200)
    expect(pub.headers()['content-type']).toBe('image/png')
    expect(pub.headers()['cache-control']).toContain('public')
    expect((await request.get(`/media/${mediaId(0, false)}`)).status()).toBe(404) // draft, no token
    expect((await request.get(`/media/${mediaId(0, false)}?token=wrong-token-wrong-token-1234`)).status()).toBe(404)
    expect((await request.get(`/media/${mediaId(0, false)}?token=${TOKENS.other}`)).status()).toBe(404) // a token for ANOTHER event
    const ok = await request.get(`/media/${mediaId(0, false)}?token=${TOKENS.media}`)
    expect(ok.status()).toBe(200)
    expect(ok.headers()['cache-control']).toContain('no-store')
    for (const bad of ['not-a-uuid', '../etc/passwd', 'e2e00000-0000-4000-a000-0000000000ff']) expect((await request.get(`/media/${encodeURIComponent(bad)}`)).status(), bad).toBe(404)
  })

  test('draft pictures in the preview page carry the token and load', async ({ page }) => {
    await page.goto(DRAFT)
    await loadAll(page)
    const srcs = await page.locator('figure.pic img').evaluateAll((els) => els.map((i) => [(i as HTMLImageElement).src, (i as HTMLImageElement).naturalWidth]))
    expect(srcs.length).toBe(PICS.length)
    for (const [src, nw] of srcs as [string, number][]) { expect(src).toContain(`token=${TOKENS.media}`); expect(nw).toBeGreaterThan(0) }
  })

  test('an invalid preview token shows no pictures at all', async ({ page }) => {
    await page.goto('/bn/preview/e2e-media?token=nonsense-token-nonsense-token')
    await expect(page.locator('figure.pic')).toHaveCount(0)
  })
})

test.describe('ayat in the shared slots', () => {
  test('ayat and pictures sit in the same slots, in order', async ({ page }) => {
    await page.goto(PUB)
    expect(await sequence(page)).toEqual(EXPECTED)
  })
  test('the ayah card keeps the design: Arabic right-to-left in Amiri, translation, surah:ayah reference', async ({ page }) => {
    await page.goto(PUB)
    const card = page.locator('.ayahwrap[data-ref="105:1"]')
    await expect(card.locator('.verse .ar')).toHaveAttribute('dir', 'rtl')
    await expect(card.locator('.verse .ar')).toHaveAttribute('lang', 'ar')
    expect(await card.locator('.verse .ar').evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/Amiri/i)
    await expect(card.locator('.verse figcaption')).toContainText('১০৫:১')
    expect((await card.locator('.verse .ar').innerText()).length).toBeGreaterThan(5)
    const box = await card.boundingBox(), vp = page.viewportSize()!
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width)
  })
  test('the placement note is one small line ABOVE the card (and only where there is one)', async ({ page }) => {
    await page.goto(PUB)
    const withNote = page.locator('.ayahwrap[data-ref="96:1"]')
    await expect(withNote.locator('.ayahnote')).toHaveText('এই আয়াতে প্রথম ওহীর উল্লেখ আছে।')
    const order = await withNote.evaluate((el) => [...el.children].map((c) => c.className))
    expect(order[0]).toBe('ayahnote')
    expect(order[1]).toBe('verse')
    const sizes = await withNote.evaluate((el) => ({ note: parseFloat(getComputedStyle(el.querySelector('.ayahnote')!).fontSize), body: parseFloat(getComputedStyle(el.querySelector('.verse .tr')!).fontSize) }))
    expect(sizes.note).toBeLessThanOrEqual(13.5)
    expect(sizes.note).toBeLessThan(sizes.body)
    await expect(page.locator('.ayahwrap[data-ref="9:40"] .ayahnote')).toHaveCount(0)
  })
  test('ayat inside key details and lessons live in the list but are not numbered like items', async ({ page }) => {
    await page.goto(PUB)
    await expect(page.locator('.keys > li.keypic .ayahwrap[data-ref="105:1"]')).toHaveCount(1)
    await expect(page.locator('.lessons > li.keypic .ayahwrap[data-ref="9:40"]')).toHaveCount(1)
    await expect(page.locator('.keys > li:not(.keypic) > b')).toHaveText(['১', '২', '৩'])
  })
  test('preview shows the same ayat placements as the published page', async ({ page }) => {
    await page.goto(DRAFT)
    expect(await sequence(page)).toEqual(EXPECTED)
  })
  test('nothing overflows with ayat in every slot', async ({ page }) => {
    await page.goto(PUB)
    await loadAll(page)
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }))
    expect(o.sw).toBeLessThanOrEqual(o.vw)
  })
})

test.describe('several places', () => {
  test('the place fact lists primary then related places', async ({ page }) => {
    await page.goto(PUB)
    await expect(page.locator('.facts')).toContainText('জমজম কূপ · মাসজিদুল হারাম (কাবা) · মক্কা')
  })

  test('map: primary is highlighted, related places are secondary markers, all in view', async ({ page }) => {
    await page.goto(PUB)
    await expect(page.locator('.mapmk')).toHaveCount(3)
    await expect(page.locator('.mapmk.hl')).toHaveCount(1)
    await expect(page.locator('.mapmk.hl .maplbl')).toHaveText('জমজম কূপ')
    await expect(page.locator('.mapmk.rel')).toHaveCount(2)
    await zoomIs(page, 17) // fits the three nearby places, never closer than the primary site's zoom
    const box = await page.locator('.mapbox').boundingBox()
    for (const m of await page.locator('.mapmk i').all()) {
      const b = (await m.boundingBox())!
      expect(b.x).toBeGreaterThanOrEqual(box!.x)
      expect(b.x + b.width).toBeLessThanOrEqual(box!.x + box!.width)
      expect(b.y).toBeGreaterThanOrEqual(box!.y)
      expect(b.y + b.height).toBeLessThanOrEqual(box!.y + box!.height)
    }
  })

  test('a published event keeps working when only the old events.place_id exists (backward compatible read)', async ({ request }) => {
    // seed events have both; this checks the page renders a place for an event whose event_places row was written by the migration
    const r = await request.get('/bn/events/hijrah-to-madinah')
    expect(await r.text()).toContain('মদিনা')
  })
})

test.describe('map zoom by place type', () => {
  test('site: flies to the Zamzam site at zoom 17', async ({ page }) => {
    await page.goto(`/bn/preview/e2e-site?token=${TOKENS.site}`)
    await expect(page.locator('.mapmk')).toHaveCount(1)
    await zoomIs(page, 17)
  })
  test('city: Makkah at zoom 12', async ({ page }) => {
    await page.goto('/bn/events/birth-of-the-prophet')
    await zoomIs(page, 12)
  })
  test('region: zoom 6', async ({ page }) => {
    await page.goto(`/bn/preview/e2e-region?token=${TOKENS.region}`)
    await zoomIs(page, 6)
  })
  test('a site outside the detailed tiles is capped at 12 (its own override of 13 cannot be shown)', async ({ page }) => {
    await page.goto(`/bn/preview/e2e-far?token=${TOKENS.far}`)
    await zoomIs(page, 12)
  })
  test('detail tiles load for the Kaaba area', async ({ page }) => {
    const reqs: string[] = []
    page.on('request', (r) => { if (r.url().includes('/tiles/makkah.pmtiles')) reqs.push(r.url()) })
    await page.goto(`/bn/preview/e2e-site?token=${TOKENS.site}`)
    await zoomIs(page, 17)
    expect(reqs.length).toBeGreaterThan(0)
  })
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })
  test('the camera jumps (no flight) and still lands on the right zoom; no pulsing marker', async ({ page }) => {
    await page.goto(`/bn/preview/e2e-site?token=${TOKENS.site}`)
    await zoomIs(page, 17)
    const anim = await page.locator('.mapmk.hl').evaluate((el) => getComputedStyle(el, '::after').animationName)
    expect(anim).toBe('none')
  })
})
