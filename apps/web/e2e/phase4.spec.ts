import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const ANSWER = 'পাখির নিক্ষিপ্ত কঙ্করে ধ্বংস হয়'

async function readElephant(page: Page) {
  await page.goto('/bn/events/year-of-the-elephant')
  await page.getByRole('button', { name: /পড়া শেষ/ }).click()
  await expect(page.getByRole('button', { name: /পড়া হয়েছে/ })).toBeVisible()
}
const option = (page: Page, text: string | RegExp) => page.locator('.opt', { hasText: text })

test.describe('review (spaced repetition)', () => {
  test('nothing to review before reading anything', async ({ page }) => {
    await page.goto('/bn/review')
    await expect(page.locator('.revbody .stub')).toContainText('পড়া শেষ করলে')
    await expect(page.locator('.tabbar .badge, .deskbar .badge')).toHaveCount(0)
  })

  test('reading an event makes its question due: badge, home banner, review', async ({ page, isMobile, viewport }) => {
    await readElephant(page)
    await page.goto('/bn')
    await expect(page.locator('.dueline')).toContainText('১টি প্রশ্ন')
    await expect(page.locator('.badge:visible').first()).toHaveText('১')
    await page.locator('.dueline').click()
    await expect(page).toHaveURL(/\/bn\/review/)
    await expect(page.locator('.duepill')).toHaveText('আজ বাকি ১টি')
    await expect(page.locator('.qcard h2')).toHaveText('হস্তীবাহিনীর শেষ পরিণতি কী হয়েছিল?')
    await expect(page.locator('.opt')).toHaveCount(4)
  })

  test('a wrong answer shows the right one and brings the question back tomorrow', async ({ page }) => {
    await readElephant(page)
    await page.goto('/bn/review')
    await page.locator('.opt').filter({ hasNotText: ANSWER }).first().click()
    await expect(page.locator('.fbt')).toHaveText(`সঠিক উত্তর: ${ANSWER}`)
    await expect(page.locator('.opt.bad')).toHaveCount(1)
    await expect(page.locator('.opt.ok')).toHaveText(new RegExp(ANSWER))
    await expect(page.locator('.rates button')).toHaveCount(1)
    await expect(page.locator('.rates button')).toContainText('আগামীকাল')
    await page.locator('.rates button').click()
    await expect(page.locator('.donecard h2')).toHaveText('আজকের পুনরালোচনা শেষ')
    await expect(page.locator('.donecard p')).toContainText('১টির মধ্যে ০টি সঠিক')
    await page.reload()
    await expect(page.locator('.revbody .stub')).toContainText('আজ পুনরালোচনার কিছু বাকি নেই')
    await expect(page.locator('.revbody .stub')).toContainText('আগামীকাল')
    await expect(page.locator('.badge:visible')).toHaveCount(0)
  })

  test('a right answer asks how easy it was; the rating sets the next date and the streak starts', async ({ page }) => {
    await readElephant(page)
    await page.goto('/bn/review')
    await option(page, ANSWER).click()
    await expect(page.locator('.fbt')).toHaveText('ঠিক উত্তর')
    const rates = page.locator('.rates button')
    await expect(rates).toHaveCount(3)
    await expect(rates.nth(0)).toContainText('২ দিন পর')
    await expect(rates.nth(1)).toContainText('৫ দিন পর')
    await expect(rates.nth(2)).toContainText('১২ দিন পর')
    await rates.nth(1).click()
    await expect(page.locator('.donecard p')).toContainText('১টির মধ্যে ১টি সঠিক')
    await expect(page.locator('.donecard p')).toContainText('৫ দিন পর')
    await expect(page.locator('.donecard .streak')).toContainText('১ দিন')
    await page.reload()
    await expect(page.locator('.revbody .stub')).toContainText('৫ দিন পর')
    await page.goto('/bn/progress')
    await expect(page.locator('.strk b')).toHaveText('১ দিন')
    await expect(page.locator('.wd.done')).toHaveCount(1)
  })

  test('a session with several due questions walks through all of them', async ({ page }) => {
    await page.goto('/bn/events/first-revelation-in-hira')
    await page.getByRole('button', { name: /পড়া শেষ/ }).click()
    await expect(page.getByRole('button', { name: /পড়া হয়েছে/ })).toBeVisible()
    await page.goto('/bn/review')
    await expect(page.locator('.duepill')).toHaveText('আজ বাকি ২টি')
    for (let i = 0; i < 2; i++) {
      await expect(page.locator('.revtop')).toContainText(`প্রশ্ন ${'১২'[i]} / ২`)
      await page.locator('.opt').first().click()
      await page.locator('.rates button').last().click()
    }
    await expect(page.locator('.donecard')).toBeVisible()
  })
})

test.describe('progress', () => {
  test('ring, eras, notes list and backup round-trip', async ({ page }) => {
    await readElephant(page)
    await page.locator('textarea').fill('আমার প্রথম নোট')
    await page.locator('textarea').blur()
    await page.waitForTimeout(300)
    await page.goto('/bn/progress')
    await expect(page.locator('.ring b')).toHaveText('২০%')
    await expect(page.locator('.rtx')).toContainText('১ / ৫ ঘটনা পড়া হয়েছে')
    await expect(page.locator('.erarow').first()).toContainText('১/১')
    await expect(page.locator('.notecard')).toHaveCount(1)
    await expect(page.locator('.notecard .nt')).toHaveText('আমার প্রথম নোট')
    await page.locator('.notecard').click()
    await expect(page).toHaveURL(/year-of-the-elephant/)
    await page.goto('/bn/progress')

    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ব্যাকআপ নামান' }).click()])
    const path = await dl.path()
    const backup = JSON.parse(readFileSync(path!, 'utf8'))
    expect(backup.app).toBe('seerah')
    expect(Object.keys(backup.data.read)).toHaveLength(1)

    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await expect(page.locator('.ring b')).toHaveText('০%')
    await page.getByTestId('import').setInputFiles(path!)
    await expect(page.getByRole('status').filter({ hasText: 'ফেরানো হয়েছে' })).toBeVisible()
    await expect(page.locator('.ring b')).toHaveText('২০%')
    await expect(page.locator('.notecard')).toHaveCount(1)
  })

  test('rejects a bad backup file without touching data', async ({ page }) => {
    await readElephant(page)
    await page.goto('/bn/progress')
    await page.getByTestId('import').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') })
    await expect(page.getByRole('status').filter({ hasText: 'সঠিক নয়' })).toBeVisible()
    await expect(page.locator('.ring b')).toHaveText('২০%')
    await page.getByTestId('import').setInputFiles({ name: 'y.json', mimeType: 'application/json', buffer: Buffer.from('not json') })
    await expect(page.getByRole('status').filter({ hasText: 'সঠিক নয়' })).toBeVisible()
  })
})

test.describe('i18n and RTL', () => {
  test('English UI: lang/dir, translated chrome, Latin digits, plural, bn content fallback with notice and noindex', async ({ page }) => {
    await page.goto('/en')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('The life of the Prophet ﷺ, event by event')
    await expect(page.locator('.eras .hd span')).toHaveText('5 events in total')
    await page.goto('/en/events/hijrah-to-madinah')
    await expect(page.locator('.facts')).toContainText('1 AH')
    await expect(page.locator('.facts')).toContainText('53 years')
    await expect(page.locator('.ev .stub').first()).toContainText('not been translated')
    await expect(page.locator('article')).toHaveAttribute('lang', 'bn') // the text really is Bangla
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    await expect(page.getByRole('button', { name: 'Mark as read' })).toBeVisible()
  })

  test('Arabic UI is right-to-left and the layout mirrors', async ({ page, viewport }) => {
    await page.goto('/ar')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await expect(page.locator('.eras .hd span')).toHaveText('المجموع ٥ أحداث')
    if ((viewport?.width ?? 0) >= 900) {
      const first = await page.locator('.deskbar nav a').first().boundingBox()
      const last = await page.locator('.deskbar nav a').last().boundingBox()
      expect(first!.x).toBeGreaterThan(last!.x) // first tab is on the right
    } else {
      const first = await page.locator('.tabbar a').first().boundingBox()
      const last = await page.locator('.tabbar a').last().boundingBox()
      expect(first!.x).toBeGreaterThan(last!.x)
    }
    await page.goto('/ar/review')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('المراجعة')
    // no horizontal overflow in RTL
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('"/" negotiates the language: Accept-Language, then the remembered choice', async ({ request, playwright, baseURL }) => {
    const get = (headers: Record<string, string>) => request.get('/', { headers, maxRedirects: 0 })
    expect((await get({ 'Accept-Language': 'ar,en;q=0.5' })).headers().location).toMatch(/\/ar$/)
    expect((await get({ 'Accept-Language': 'en-GB,en;q=0.8' })).headers().location).toMatch(/\/en$/)
    expect((await get({ 'Accept-Language': 'ja' })).headers().location).toMatch(/\/bn$/)
    expect((await get({ 'Accept-Language': 'ar', Cookie: 'seerah-lang=en' })).headers().location).toMatch(/\/en$/)
    expect((await get({ Cookie: 'seerah-lang=zz' })).headers().location).toMatch(/\/bn$/)
  })

  test('the language menu switches language, keeps the theme, and is remembered', async ({ page }) => {
    await page.goto('/bn')
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; localStorage.setItem('seerah:theme', 'dark') })
    await page.locator('.lang button:visible').first().click()
    await page.locator('.lang a[hreflang="en"]:visible').click()
    await expect(page).toHaveURL(/\/en$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('The life of the Prophet')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    const res = await page.request.get('/', { maxRedirects: 0 })
    expect(res.headers().location).toMatch(/\/en$/)
    await page.getByRole('link', { name: 'Progress' }).filter({ visible: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My progress')
  })

  test('sitemaps list only real translations per language', async ({ request }) => {
    const bn = await (await request.get('/bn/sitemap.xml')).text()
    const en = await (await request.get('/en/sitemap.xml')).text()
    expect(bn).toContain('/bn/events/hijrah-to-madinah')
    expect(en).not.toContain('/en/events/')
    expect(en).toContain('<loc>')
    expect((await request.get('/sitemap.xml')).status()).toBe(200)
  })
})
