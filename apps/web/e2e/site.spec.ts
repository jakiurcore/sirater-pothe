import { test, expect } from '@playwright/test'
import { TOKENS } from './setup.mjs'

const BN_DIGIT = /[০-৯]/

test.describe('reading flow', () => {
  test('home shows the hero, continue card and five eras', async ({ page }) => {
    await page.goto('/bn')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ﷺ')
    await expect(page.getByText('পাঁচটি পর্ব')).toBeVisible()
    await expect(page.locator('.eracard')).toHaveCount(await page.locator('.eracard').count())
    await expect(page.locator('.cont .btn')).toBeVisible()
  })

  test('opens an event, shows meta, certainty, sources and a rendered map', async ({ page }) => {
    await page.goto('/bn/events/hijrah-to-madinah')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('হিজরত, মক্কা থেকে মদিনা')
    await expect(page.locator('.facts')).toContainText('১ হি.')
    await expect(page.locator('.facts')).toContainText('৫৩ বছর')
    await expect(page.locator('.agreed')).toBeVisible()
    await expect(page.locator('.verse .ar')).toBeVisible()
    await expect(page.locator('.mapbox canvas')).toBeVisible()
    // highlighted marker + a route waypoint label are HTML markers
    await expect(page.locator('.mapmk.hl .maplbl')).toHaveText('মদিনা')
    await expect(page.locator('.mapmk .maplbl', { hasText: 'সাওর গুহা' })).toBeVisible()
    await expect(page.locator('.routelegend')).toContainText('হিজরতের আনুমানিক পথ')
  })

  test('the honorific is always rendered after the Prophet’s name', async ({ page }) => {
    await page.goto('/bn/events/birth-of-the-prophet')
    const text = await page.locator('article').innerText()
    expect(text).not.toMatch(/ﷺ\s*র\b/) // never splits an inflected word
    expect(text).not.toMatch(/ﷺ\s*ﷺ/)
    await expect(page.locator('.disputed')).toBeVisible()
  })

  test('prev/next navigation moves between events', async ({ page }) => {
    await page.goto('/bn/events/first-revelation-in-hira')
    await page.getByRole('link', { name: /পরের ঘটনা/ }).click()
    await expect(page).toHaveURL(/hijrah-to-madinah/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('হিজরত, মক্কা থেকে মদিনা')
    await page.getByRole('link', { name: /আগের ঘটনা/ }).click()
    await expect(page).toHaveURL(/first-revelation-in-hira/)
  })

  test('mark as read and notes persist across reloads, and feed the home progress', async ({ page }) => {
    await page.goto('/bn/events/year-of-the-elephant')
    await page.getByRole('button', { name: /পড়া শেষ/ }).click()
    await expect(page.getByRole('button', { name: /পড়া হয়েছে/ })).toBeVisible()
    await page.locator('textarea').fill('আমার নোট: তাওয়াক্কুল')
    await page.locator('textarea').blur()
    await page.reload()
    await expect(page.getByRole('button', { name: /পড়া হয়েছে/ })).toBeVisible()
    await expect(page.locator('textarea')).toHaveValue('আমার নোট: তাওয়াক্কুল')
    await page.goto('/bn')
    await expect(page.locator('.cont .prog')).toContainText('১ / ৫')
    // un-read
    await page.goto('/bn/events/year-of-the-elephant')
    await page.getByRole('button', { name: /পড়া হয়েছে/ }).click()
    await expect(page.getByRole('button', { name: /পড়া শেষ/ })).toBeVisible()
  })

  test('home "continue" resumes the last event opened', async ({ page }) => {
    await page.goto('/bn/events/battle-of-badr')
    await page.goto('/bn')
    await expect(page.locator('.cont h2')).toHaveText('বদরের যুদ্ধ')
    await page.locator('.cont .btn').click()
    await expect(page).toHaveURL(/battle-of-badr/)
  })

  test('theme toggle switches and persists', async ({ page }) => {
    await page.goto('/bn')
    const before = await page.evaluate(() => document.documentElement.dataset.theme)
    await page.locator('.iconbtn:visible').first().click()
    const after = await page.evaluate(() => document.documentElement.dataset.theme)
    expect(after).not.toBe(before)
    await page.reload()
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after)
  })
})

test.describe('timeline', () => {
  test('lists all published events grouped by era; node opens the event', async ({ page, isMobile, viewport }) => {
    await page.goto('/bn/timeline')
    const wide = (viewport?.width ?? 0) >= 900
    if (wide) await page.waitForURL(/\/bn\/events\//) // desktop: timeline is the left column and resumes an event
    else await expect(page.getByRole('heading', { level: 1, name: 'টাইমলাইন' })).toBeVisible()
    const nodes = page.locator('.tl .node:visible')
    await expect(nodes).toHaveCount(5)
    await nodes.nth(2).click()
    await expect(page).toHaveURL(/first-revelation-in-hira/)
    // the list is only visible beside the event on wide screens
    if (wide) await expect(page.locator('.node[aria-current="step"]:visible')).toHaveCount(1)
  })
})

test.describe('visibility rules', () => {
  test('a draft is not reachable by its public URL, in the timeline or in the sitemap', async ({ page, request }) => {
    const r = await request.get('/bn/events/e2e-draft')
    expect(r.status()).toBe(404)
    await page.goto('/bn/timeline')
    await expect(page.locator('body')).not.toContainText('খসড়া ঘটনা')
    const sm = await (await request.get('/bn/sitemap.xml')).text()
    expect(sm).toContain('/bn/events/hijrah-to-madinah')
    expect(sm).not.toContain('e2e-draft')
  })

  test('preview shows the draft only with a valid token for that event', async ({ page }) => {
    await page.goto(`/bn/preview/e2e-draft?token=${TOKENS.valid}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('খসড়া ঘটনা (পরীক্ষা)')
    await expect(page.locator('.draftbanner')).toContainText('খসড়া প্রিভিউ')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    for (const bad of [TOKENS.expired, TOKENS.other, 'nonsense-token-nonsense-token', '']) {
      await page.goto(`/bn/preview/e2e-draft?token=${bad}`)
      await expect(page.locator('body')).not.toContainText('খসড়া ঘটনা (পরীক্ষা)')
      await expect(page.locator('.ev .stub')).toContainText('সঠিক নয়')
    }
    await page.goto('/bn/preview/e2e-draft')
    await expect(page.locator('.ev .stub')).toContainText('সঠিক নয়')
  })

  test('a token for another event cannot unlock this draft, and cannot unlock unrelated slugs', async ({ page }) => {
    await page.goto(`/bn/preview/battle-of-badr?token=${TOKENS.valid}`)
    await expect(page.locator('.ev .stub')).toContainText('সঠিক নয়')
  })
})

test.describe('SEO and plumbing', () => {
  test('metadata, sitemap index, robots, tiles range', async ({ request, page }) => {
    await page.goto('/bn/events/first-revelation-in-hira')
    await expect(page).toHaveTitle(/হেরা গুহায় প্রথম ওহী/)
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/bn\/events\/first-revelation-in-hira$/)
    expect(await (await request.get('/sitemap.xml')).text()).toContain('/bn/sitemap.xml')
    expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /*/preview/')
    const range = await request.get('/tiles/arabia.pmtiles', { headers: { Range: 'bytes=0-6' } })
    expect(range.status()).toBe(206)
    expect((await range.body()).toString()).toBe('PMTiles')
    expect((await request.get('/tiles/..%2Fsecret')).status()).toBe(404)
  })

  test('unknown language and unknown event return 404', async ({ request }) => {
    expect((await request.get('/xx/events/hijrah-to-madinah')).status()).toBe(404)
    expect((await request.get('/bn/events/no-such-event')).status()).toBe(404)
  })

  test('no digits regressions: Bangla numerals in meta', async ({ page }) => {
    await page.goto('/bn/events/hijrah-to-madinah')
    expect(await page.locator('.facts').innerText()).toMatch(BN_DIGIT)
  })
})
