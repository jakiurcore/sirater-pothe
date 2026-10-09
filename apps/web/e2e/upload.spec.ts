import { test, expect, type Page } from '@playwright/test'
import { UPLOAD } from './setup.mjs'
import { pngBytes } from '../../mcp/test/fixtures'

/** The one-time upload page (/[lang]/upload/[token]): runs under both projects, 390 and 1280. The MCP Worker's PUT is intercepted. */
const PNG = Buffer.from(pngBytes(300, 200))
const URL_OF = (t: string, lang = 'bn') => `/${lang}/upload/${t}`
const ENDPOINT = (t: string) => new RegExp(`/upload/${t}$`)

/** Intercept only the PUT to the MCP Worker (the page itself lives at a URL ending the same way). */
const put = (page: Page, token: string, handler: Parameters<Page['route']>[1]) =>
  page.route(ENDPOINT(token), (route, req) => (req.method() === 'PUT' ? handler(route, req) : route.fallback()))

async function fileInput(page: Page, name = 'foto.png', mimeType = 'image/png', buffer: Buffer = PNG) {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType, buffer })
}

test.describe('upload page', () => {
  test('shows what the link is for, in Bangla: event, kind, where it goes, alt text, expiry; no admin chrome', async ({ page }) => {
    await page.goto(URL_OF(UPLOAD.valid))
    await expect(page.locator('h1')).toHaveText('ছবি আপলোড')
    const facts = page.locator('.uploadcard .facts')
    await expect(facts).toContainText('প্রাকৃতিক দৃশ্য') // kind: landscape
    await expect(facts).toContainText('সারসংক্ষেপের ২ নম্বর অনুচ্ছেদের পরে') // in_summary after index 1
    await expect(facts).toContainText('পরীক্ষামূলক ছবির বর্ণনা') // alt
    await expect(facts).toContainText('ছবি ও স্থানের পরীক্ষা') // the event title
    await expect(page.locator('.uploadcard .meta').first()).toContainText('লিংকের মেয়াদ')
    await expect(page.locator('input[type=file]')).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp')
    // not an admin panel: one card, no list, no password field, no links into the content
    await expect(page.locator('input[type=password], table, .uploadcard a')).toHaveCount(0)
  })

  test('is never indexed and does not leak the token as a referrer', async ({ page, request }) => {
    await page.goto(URL_OF(UPLOAD.valid))
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
    expect((await request.get(URL_OF(UPLOAD.valid))).headers()['x-robots-tag']).toContain('noindex')
  })

  test('picks one file, previews it, and only enables the button after the "no people" confirmation', async ({ page }) => {
    await page.goto(URL_OF(UPLOAD.valid))
    const confirm = page.getByRole('button', { name: 'আপলোড নিশ্চিত করুন' })
    await expect(confirm).toBeDisabled()
    await fileInput(page)
    const preview = page.locator('.uppreview img')
    await expect(preview).toBeVisible()
    await expect(preview).toHaveAttribute('src', /^blob:/)
    await expect(page.locator('.uppreview figcaption')).toContainText('foto.png')
    await expect(confirm).toBeDisabled() // a file alone is not enough
    await page.getByRole('checkbox').check()
    await expect(confirm).toBeEnabled()
    await page.getByRole('checkbox').uncheck()
    await expect(confirm).toBeDisabled()
  })

  test('confirming PUTs the file to the single-use URL with the people confirmation, then shows success', async ({ page }) => {
    let seen: { method: string; type: string | undefined; people: string | undefined; size: number } | null = null
    await put(page, UPLOAD.valid, async (route) => {
      const r = route.request()
      seen = { method: r.method(), type: r.headers()['content-type'], people: r.headers()['x-people-confirmed'], size: r.postDataBuffer()?.length ?? 0 }
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, media_id: 'x' }) })
    })
    await page.goto(URL_OF(UPLOAD.valid))
    await fileInput(page)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'আপলোড নিশ্চিত করুন' }).click()
    await expect(page.locator('.updone')).toContainText('ছবি যুক্ত হয়েছে')
    expect(seen).toEqual({ method: 'PUT', type: 'image/png', people: 'no-people', size: PNG.length })
    await expect(page.locator('form.upform')).toHaveCount(0) // one file per link: the form is gone
  })

  test('server errors are shown in the page; an expired answer says the link is dead; the network failing is explained', async ({ page }) => {
    await page.goto(URL_OF(UPLOAD.valid))
    await put(page, UPLOAD.valid, (route) => route.fulfill({ status: 422, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'File content is not a PNG, JPEG or WebP image.' }) }))
    await fileInput(page); await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'আপলোড নিশ্চিত করুন' }).click()
    await expect(page.locator('.uperr')).toContainText('File content is not a PNG')
    await page.unroute(ENDPOINT(UPLOAD.valid))
    await put(page, UPLOAD.valid, (route) => route.fulfill({ status: 410, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false }) }))
    await page.getByRole('button', { name: 'আপলোড নিশ্চিত করুন' }).click()
    await expect(page.locator('.uperr')).toContainText('সঠিক নয়, মেয়াদ শেষ')
    await page.unroute(ENDPOINT(UPLOAD.valid))
    await put(page, UPLOAD.valid, (route) => route.abort())
    await page.getByRole('button', { name: 'আপলোড নিশ্চিত করুন' }).click()
    await expect(page.locator('.uperr')).toContainText('সার্ভারের সাথে যোগাযোগ করা যায়নি')
    await expect(page.getByRole('button', { name: 'আপলোড নিশ্চিত করুন' })).toBeEnabled() // can try again
  })

  test('wrong types and files over 10 MB are refused before anything is sent', async ({ page }) => {
    let sent = 0
    await page.route(/\/upload\/up_/, async (route, req) => { if (req.method() === 'PUT') { sent++; await route.abort() } else await route.fallback() })
    await page.goto(URL_OF(UPLOAD.valid))
    await fileInput(page, 'x.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))
    await expect(page.locator('.uperr')).toContainText('শুধু PNG, JPEG বা WebP')
    await expect(page.locator('.uppreview')).toHaveCount(0)
    await fileInput(page, 'big.png', 'image/png', Buffer.alloc(10 * 1024 * 1024 + 1))
    await expect(page.locator('.uperr')).toContainText('১০ এমবির বেশি')
    expect(sent).toBe(0)
  })

  for (const [name, token] of [['unknown', 'up_e2e_does_not_exist_0123456789abcdefghijklm'], ['expired', UPLOAD.expired], ['already used', UPLOAD.used], ['locked after 5 attempts', UPLOAD.locked], ['malformed', 'garbage']] as const)
    test(`a ${name} link shows the same neutral message and no form`, async ({ page }) => {
      await page.goto(URL_OF(token))
      await expect(page.locator('.uploadcard [role=alert]')).toContainText('সঠিক নয়, মেয়াদ শেষ হয়ে গেছে, অথবা আগেই ব্যবহার করা হয়েছে')
      await expect(page.locator('input[type=file], .facts')).toHaveCount(0)
    })

  test('other languages and layout: English page, 44px targets, no horizontal scroll', async ({ page }) => {
    await page.goto(URL_OF(UPLOAD.valid, 'en'))
    await expect(page.locator('h1')).toHaveText('Upload a picture')
    await expect(page.locator('.facts')).toContainText('After summary paragraph 2')
    await fileInput(page)
    const sizes = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth,
      targets: [...document.querySelectorAll('.uploadcard button, .uploadcard label')].map((e) => { const r = e.getBoundingClientRect(); return [e.textContent!.trim().slice(0, 20), r.width, r.height] as const }),
    }))
    expect(sizes.sw).toBeLessThanOrEqual(sizes.vw)
    for (const [label, w, h] of sizes.targets) { expect(h, label).toBeGreaterThanOrEqual(43.5); expect(w, label).toBeGreaterThanOrEqual(43.5) }
  })

  test('dark mode keeps the card readable', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('seerah:theme', 'dark') } catch { /* private mode */ } })
    await page.goto(URL_OF(UPLOAD.valid))
    const c = await page.locator('.uploadcard').evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, color: getComputedStyle(e.querySelector('h1')!).color }))
    expect(c.bg).toBe('rgb(20, 32, 53)') // --surface in dark
    expect(c.color).not.toBe(c.bg)
  })
})
