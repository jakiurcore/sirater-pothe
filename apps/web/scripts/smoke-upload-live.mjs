#!/usr/bin/env node
/**
 * Live check of the upload machinery that needs no owner login: the signed PUT URL, the upload page, EXIF stripping and the
 * responsive copies made by the Images binding in PRODUCTION. Upload credentials are inserted straight into D1 for a TEMPORARY
 * draft event (zz-smoke-upl-delete-me), exactly as create_upload_url / create_upload_link would, and everything is deleted at the end
 * (rows, R2 originals and copies, audit rows of this run).   node scripts/smoke-upload-live.mjs
 */
import sharp from 'sharp'
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SITE = process.env.SITE ?? 'https://siraterpotehe.com'
const MCP = process.env.MCP ?? 'https://mcp.siraterpotehe.com'
const SLUG = 'zz-smoke-upl-delete-me'
const OUT = new URL('../../../design-audit/live/prod-upload/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const mcpDir = new URL('../../mcp/', import.meta.url).pathname
const started = new Date().toISOString()
const h = (t) => createHash('sha256').update(t).digest('hex')
const tok = () => 'up_' + randomBytes(32).toString('base64url')
const T = { put: tok(), put2: tok(), bad: tok(), rot: tok(), link: tok(), prev: randomBytes(24).toString('base64url') }
const exp = new Date(Date.now() + 3600e3).toISOString()
const wr = (args) => execFileSync('pnpm', ['exec', 'wrangler', ...args], { cwd: mcpDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const sql = (q) => { const f = join(tmpdir(), `sup-${process.pid}.sql`); writeFileSync(f, q, { mode: 0o600 }); try { return wr(['d1', 'execute', 'seerah', '--remote', '--yes', '--file', f]) } finally { rmSync(f, { force: true }) } }
const row = (mode, token, placement, idx, alt) => `INSERT INTO upload_tokens (token_hash, mode, created_by, event_id, kind, placement, after_index, alt, expires_at) VALUES ('${h(token)}', '${mode}', 'onset', 'zz-smoke-upl-event', 'pattern', '${placement}', ${idx ?? 'NULL'}, '{"bn":"${alt}"}', '${exp}');`

let failed = 0
const ok = (c, m, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); if (!c) failed++ }
const mediaIds = []
const keys = []

const real = (w, hgt, rgb) => sharp({ create: { width: w, height: hgt, channels: 3, background: rgb } }).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}"><g fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="6"><rect x="${w * 0.3}" y="${hgt * 0.2}" width="${w * 0.4}" height="${hgt * 0.6}"/><circle cx="${w / 2}" cy="${hgt / 2}" r="${hgt * 0.25}"/></g></svg>`) }])

try {
  sql(`DELETE FROM upload_tokens WHERE event_id = 'zz-smoke-upl-event'; DELETE FROM events WHERE id = 'zz-smoke-upl-event';`)
  sql(`
INSERT INTO events (id, slug, era_id, order_index, certainty, status, needs_verification) SELECT 'zz-smoke-upl-event', '${SLUG}', (SELECT id FROM eras WHERE slug = 'hijrah'), (SELECT coalesce(max(order_index), 0) + 1024 FROM events), 'agreed', 'draft', 1;
INSERT INTO event_translations (event_id, lang, title, summary, key_details, lessons, status) VALUES ('zz-smoke-upl-event', 'bn', 'স্মোক টেস্ট: আপলোড (মুছে ফেলা হবে)', 'প্রথম অনুচ্ছেদ।

দ্বিতীয় অনুচ্ছেদ।', '["প্রথম বিবরণ","দ্বিতীয় বিবরণ","তৃতীয় বিবরণ"]', '["প্রথম শিক্ষা","দ্বিতীয় শিক্ষা"]', 'draft');
INSERT INTO preview_tokens (token_hash, event_id, expires_at, created_by) VALUES ('${h(T.prev)}', 'zz-smoke-upl-event', '${exp}', 'smoke-upl');
${row('put', T.put, 'in_key_details', 1, 'পরীক্ষামূলক ছবি')}
${row('put', T.put2, 'end', null, 'দ্বিতীয় পরীক্ষা')}
${row('put', T.bad, 'hero', null, 'খারাপ ফাইল')}
${row('put', T.rot, 'before_lessons', null, 'ঘোরানো ছবি')}
${row('link', T.link, 'in_summary', 0, 'পরীক্ষামূলক ছবি (লিংক)')}`)

  // 1. a real 2400×1400 JPEG with camera/GPS-style EXIF: stored stripped, with responsive copies made by the Images binding
  const jpg = await real(2400, 1400, { r: 46, g: 106, b: 97 }).jpeg({ quality: 80 }).withExif({ IFD0: { Make: 'SmokeSecretCam', Copyright: 'SmokeSecretCopyright' } }).toBuffer()
  ok(jpg.includes('SmokeSecretCam'), 'test file really carries EXIF text', `(${jpg.length} bytes)`)
  const r1 = await fetch(`${MCP}/upload/${T.put}`, { method: 'PUT', body: new Uint8Array(jpg), headers: { 'Content-Type': 'application/octet-stream' } })
  const j1 = await r1.json()
  ok(r1.status === 200 && j1.ok, 'PUT to the signed URL stores the picture', `(${r1.status} ${j1.error ?? ''})`)
  if (j1.ok) {
    mediaIds.push(j1.media_id); keys.push(j1.r2_key)
    ok(j1.placement === 'in_key_details' && j1.after_index === 1, 'placement comes from the token (in_key_details after #2)')
    ok(j1.metadata_removed?.includes('EXIF'), 'EXIF removed', JSON.stringify(j1.metadata_removed))
    ok(JSON.stringify(j1.variants) === '[480,960,1600]', 'the Images binding made 480 / 960 / 1600 px copies in production', `(${j1.processing})`)
    for (const w of j1.variants ?? []) keys.push(`media/${j1.media_id}-${w}.webp`)
    const orig = await fetch(`${SITE}/media/${j1.media_id}?token=${T.prev}`)
    const ob = Buffer.from(await orig.arrayBuffer())
    ok(orig.status === 200 && !ob.includes('SmokeSecretCam') && !ob.includes('SmokeSecretCopyright') && !ob.includes('Exif'), 'the stored original has no EXIF text', `(${ob.length} bytes)`)
    const v = await fetch(`${SITE}/media/${j1.media_id}?w=480&token=${T.prev}`)
    const vb = Buffer.from(await v.arrayBuffer())
    const vm = await sharp(vb).metadata()
    ok(v.headers.get('content-type') === 'image/webp' && vm.width === 480 && vm.format === 'webp', '/media/<id>?w=480 serves a real 480 px webp', `(${vm.width}×${vm.height}, ${vb.length} bytes)`)
    const anon = await fetch(`${SITE}/media/${j1.media_id}`)
    ok(anon.status === 404, 'the draft picture is not public without the preview token')
  }
  const r1b = await fetch(`${MCP}/upload/${T.put}`, { method: 'PUT', body: new Uint8Array(jpg) })
  ok(r1b.status === 410, 'the same URL a second time → 410 (single use)')

  // 2. a wrong file does not burn the token; then a good one works
  const rb = await fetch(`${MCP}/upload/${T.bad}`, { method: 'PUT', body: '<svg onload=alert(1)></svg>', headers: { 'Content-Type': 'image/png' } })
  ok(rb.status === 422, 'SVG sent as image/png is refused (magic bytes decide)', `(${rb.status} ${(await rb.json()).error?.slice(0, 60)})`)
  const small = await real(500, 300, { r: 180, g: 138, b: 60 }).png().toBuffer()
  const r2 = await fetch(`${MCP}/upload/${T.bad}`, { method: 'PUT', body: new Uint8Array(small), headers: { 'Content-Type': 'image/png' } })
  const j2 = await r2.json()
  ok(r2.status === 200 && j2.ok && JSON.stringify(j2.variants) === '[480]', 'the same token then accepts a good 500 px PNG (one 480 px copy; no larger ones: it never enlarges)', `(${r2.status} ${JSON.stringify(j2.variants)})`)
  if (j2.ok) { mediaIds.push(j2.media_id); keys.push(j2.r2_key) }

  // 3. a rotated photo: the rotation is baked in (or refused cleanly), never published sideways
  const rotated = await real(600, 400, { r: 75, g: 58, b: 154 }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
  const rr = await fetch(`${MCP}/upload/${T.rot}`, { method: 'PUT', body: new Uint8Array(rotated), headers: { 'Content-Type': 'image/jpeg' } })
  const jr = await rr.json()
  if (jr.ok) { mediaIds.push(jr.media_id); keys.push(jr.r2_key); for (const w of jr.variants ?? []) keys.push(`media/${jr.media_id}-${w}.webp`) }
  ok(rr.status === 200 ? jr.width === 400 && jr.height === 600 : rr.status === 422 && /rotated/.test(jr.error), 'EXIF-rotated JPEG: rotation baked into the pixels (400×600) or refused with a clear message', rr.status === 200 ? `(baked: ${jr.width}×${jr.height})` : `(refused: ${jr.error?.slice(0, 70)})`)

  // 4. the upload page, as the owner would use it on a phone
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] })
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${SITE}/bn/upload/${T.link}`)
    ok((await page.locator('h1').innerText()) === 'ছবি আপলোড', 'upload page opens in Bangla')
    const facts = await page.locator('.facts').innerText()
    ok(/সারসংক্ষেপের ১ নম্বর অনুচ্ছেদের পরে/.test(facts) && /পরীক্ষামূলক ছবি \(লিংক\)/.test(facts), 'it shows where the picture goes and the alt text, pre-filled', facts.replace(/\n/g, ' | ').slice(0, 120))
    await page.screenshot({ path: `${OUT}upload-1-open.png` })
    await page.locator('input[type=file]').setInputFiles({ name: 'owner-photo.png', mimeType: 'image/png', buffer: await real(1200, 700, { r: 34, g: 81, b: 74 }).png().toBuffer() })
    await page.waitForSelector('.uppreview img')
    const btn = page.getByRole('button', { name: 'আপলোড নিশ্চিত করুন' })
    ok(await btn.isDisabled(), 'the confirm button waits for the "no people" tick')
    await page.getByRole('checkbox').check()
    await page.screenshot({ path: `${OUT}upload-2-preview.png` })
    await btn.click()
    await page.waitForSelector('.updone, .uperr', { timeout: 40_000 })
    ok((await page.locator('.updone').count()) === 1, 'confirming uploads through the MCP Worker (CORS from the site works)', (await page.locator('.uperr').count()) ? await page.locator('.uperr').innerText() : '')
    await page.screenshot({ path: `${OUT}upload-3-done.png` })
    await page.goto(`${SITE}/bn/upload/${T.link}`)
    ok(/সঠিক নয়, মেয়াদ শেষ/.test(await page.locator('.uploadcard').innerText()), 'the link is dead afterwards')
    ok(errors.length === 0, 'no page errors')

    // 5. the preview shows everything at its slot, responsive images load
    const found = sql(`SELECT id, r2_key, variants FROM media WHERE event_id = 'zz-smoke-upl-event'`)
    for (const m of found.matchAll(/"id": "([0-9a-f-]{36})",\s*"r2_key": "([^"]+)",\s*"variants": (null|"[^]*?")(?=\s*\})/g)) {
      if (!mediaIds.includes(m[1])) { mediaIds.push(m[1]); keys.push(m[2]) }
      for (const w of [480, 960, 1600]) if (m[3] !== 'null' && m[3].includes(`-${w}.webp`)) keys.push(`media/${m[1]}-${w}.webp`)
    }
    const pv = await ctx.newPage()
    await pv.goto(`${SITE}/bn/preview/${SLUG}?token=${T.prev}`)
    await pv.waitForSelector('article .keys')
    for (const f of await pv.locator('figure.pic').all()) { await f.scrollIntoViewIfNeeded(); await pv.waitForTimeout(250) }
    const seq = await pv.evaluate(() => {
      const out = []; let sum = -1, key = -1
      for (const el of document.querySelectorAll('article .sum, article .keys > li:not(.keypic), article figure.pic')) {
        if (el.matches('.sum')) out.push(`sum${++sum}`); else if (el.matches('.keys > li')) out.push(`key${++key}`); else out.push(`pic:${el.dataset.placement}`)
      }
      return out.join(' ')
    })
    ok(/^sum0 pic:in_summary sum1 key0 key1 pic:in_key_details key2 (pic:before_lessons )?pic:end$|^pic:hero /.test(seq) || seq.includes('sum0 pic:in_summary sum1 key0 key1 pic:in_key_details key2'), 'preview: pictures sit at their slots', `(${seq})`)
    const imgs = await pv.evaluate(() => [...document.querySelectorAll('figure.pic img')].map((i) => [i.naturalWidth, i.currentSrc.includes('w=') ? 'srcset' : 'orig']))
    ok(imgs.length >= 3 && imgs.every(([w]) => w > 0), 'all pictures load', JSON.stringify(imgs))
    ok(imgs.some(([, s]) => s === 'srcset'), 'the browser picked a responsive copy from the srcset')
    await pv.screenshot({ path: `${OUT}preview.png`, fullPage: true })
  } finally { await browser.close() }
} finally {
  // delete every temporary row, file and audit entry of this run
  try {
    const list = [...new Set(mediaIds)]
    sql(`DELETE FROM media WHERE event_id = 'zz-smoke-upl-event'${list.length ? ` OR id IN (${list.map((i) => `'${i}'`).join(',')})` : ''};
DELETE FROM upload_tokens WHERE event_id = 'zz-smoke-upl-event';
DELETE FROM preview_tokens WHERE event_id = 'zz-smoke-upl-event';
DELETE FROM events WHERE id = 'zz-smoke-upl-event';
DELETE FROM revisions WHERE entity_id = 'zz-smoke-upl-event';
DELETE FROM audit_log WHERE created_at >= '${started}' AND ((actor = 'onset' AND tool LIKE 'upload.%') OR tool = 'upload.rejected');`)
    for (const k of [...new Set(keys)]) { try { wr(['r2', 'object', 'delete', `seerah-media/${k}`, '--remote']) } catch { /* already gone */ } }
    const left = wr(['d1', 'execute', 'seerah', '--remote', '--command', `SELECT (SELECT count(*) FROM events WHERE slug LIKE 'zz-%') e, (SELECT count(*) FROM media) m, (SELECT count(*) FROM upload_tokens) t, (SELECT count(*) FROM preview_tokens WHERE created_by = 'smoke-upl') p;`])
    const rowsGone = ['e', 'm', 't', 'p'].every((k) => new RegExp(`"${k}":\\s*0\\b`).test(left))
    let objectsLeft = 0
    for (const k of [...new Set(keys)]) { try { wr(['r2', 'object', 'get', `seerah-media/${k}`, '--remote', '--file', join(tmpdir(), 'sup-probe')]); objectsLeft++ } catch { /* 404: deleted */ } }
    rmSync(join(tmpdir(), 'sup-probe'), { force: true })
    console.log('\ncleanup:', rowsGone && objectsLeft === 0 ? `all temporary rows deleted, ${new Set(keys).size} R2 objects removed (verified gone)` : `CHECK LEFTOVERS rows:${rowsGone ? 'ok' : left} r2 objects still present: ${objectsLeft}`)
  } catch (e) { console.error('CLEANUP FAILED: remove zz-smoke-upl-* rows and media/ objects manually', e.message) }
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
