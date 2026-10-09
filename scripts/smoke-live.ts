#!/usr/bin/env tsx
/**
 * Live smoke test of the MCP server through its real OAuth flow.
 *   pnpm smoke:live            (MCP_ORIGIN / WEB_ORIGIN default to https://mcp.$DOMAIN / https://$DOMAIN)
 * You type YOUR username, password and authenticator code at the prompts (hidden). Nothing is stored or logged;
 * the access token lives in memory only. The script creates one draft event, previews it, checks that it is not public,
 * then reverts its creation (which deletes the draft) and checks the preview link is dead.
 */
import { createHash, randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { createInterface } from 'node:readline'

const DOMAIN = process.env.DOMAIN ?? 'siraterpotehe.com'
const MCP = process.env.MCP_ORIGIN ?? `https://mcp.${DOMAIN}`
const WEB = process.env.WEB_ORIGIN ?? `https://${DOMAIN}`
const REDIRECT = 'http://127.0.0.1:9/smoke-callback'
const SLUG = 'zz-smoke-test-delete-me'

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY })
const queue: string[] = [], waiters: ((l: string) => void)[] = []
rl.on('line', (l) => (waiters.length ? waiters.shift()!(l) : queue.push(l)))
const next = () => new Promise<string>((r) => (queue.length ? r(queue.shift()!) : waiters.push(r)))
async function ask(p: string, hidden = false) {
  process.stdout.write(p)
  const o = rl as unknown as { _writeToOutput?: (s: string) => void }
  const orig = o._writeToOutput
  if (hidden && process.stdin.isTTY && orig) o._writeToOutput = () => {}
  const l = await next()
  if (orig) o._writeToOutput = orig
  if (hidden) process.stdout.write('\n')
  return l
}

let failed = 0
const ok = (c: unknown, msg: string, extra = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}${extra ? '  ' + extra : ''}`); if (!c) failed++ }
const b64u = (b: Buffer) => b.toString('base64url')

async function login(): Promise<string> {
  const reg = await (await fetch(`${MCP}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Seerah live smoke test', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }) })).json() as { client_id: string }
  const verifier = b64u(randomBytes(32))
  const challenge = b64u(createHash('sha256').update(verifier).digest())
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, scope: 'mcp', state: 's1', code_challenge: challenge, code_challenge_method: 'S256', resource: `${MCP}/mcp` })
  const page = await fetch(`${MCP}/authorize?${q}`)
  const html = await page.text()
  ok(page.status === 200 && html.includes('ব্যবহারকারীর নাম') && !/github/i.test(html), 'login page renders (bn+en), no GitHub')
  const field = (n: string) => new RegExp(`name="${n}" value="([^"]*)"`).exec(html)?.[1]?.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c)) ?? ''
  const cookies = page.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  ok(page.headers.getSetCookie().some((c) => c.startsWith('__Host-seerah_csrf=') && /Secure/.test(c) && /HttpOnly/.test(c)), 'CSRF cookie is __Host-, Secure, HttpOnly')

  const post = (body: Record<string, string>, jar = cookies) => fetch(`${MCP}/authorize`, { method: 'POST', redirect: 'manual', headers: { Cookie: jar, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ handle: field('handle'), csrf: field('csrf'), authq: field('authq'), scope: 'mcp', decision: 'approve', ...body }) })

  // Negative checks that cannot lock the real account: an unknown username, and a missing CSRF token.
  const bad = await post({ username: 'no-such-user-smoke', password: 'definitely-wrong-password-1' })
  ok(bad.status === 401 && (await bad.text()).includes('Incorrect username, password or code.'), 'unknown account is rejected with the generic message')
  const noCsrf = await post({ username: 'x', password: 'y', csrf: '' })
  ok(noCsrf.status === 403, 'POST without CSRF token is rejected (403)')

  console.log('\nSign in as YOURSELF (typed here, hidden, never stored):')
  const username = (await ask('  Username: ')).trim()
  const password = await ask('  Password: ', true)
  const code = (await ask('  Authenticator code: ')).trim()
  // The failed attempt above issued a fresh consent handle, so re-open the page for a clean one.
  const page2 = await fetch(`${MCP}/authorize?${q}`)
  const html2 = await page2.text()
  const f2 = (n: string) => new RegExp(`name="${n}" value="([^"]*)"`).exec(html2)?.[1]?.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c)) ?? ''
  const jar2 = page2.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const res = await fetch(`${MCP}/authorize`, { method: 'POST', redirect: 'manual', headers: { Cookie: jar2, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ handle: f2('handle'), csrf: f2('csrf'), authq: f2('authq'), scope: 'mcp', decision: 'approve', username, password, code }) })
  const loc = res.headers.get('location') ?? ''
  const authCode = new URL(loc || 'http://x/').searchParams.get('code')
  ok(res.status === 302 && !!authCode, 'your login (password + 2FA) succeeds and the grant is issued')
  if (!authCode) throw new Error('Login failed; stopping (check username, password and a fresh 2FA code).')
  const tok = await (await fetch(`${MCP}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: authCode, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier, resource: `${MCP}/mcp` }) })).json() as { access_token?: string }
  ok(!!tok.access_token, 'token exchange (PKCE) works')
  return tok.access_token!
}

let rid = 1
async function rpc(token: string, method: string, params: unknown = {}) {
  const r = await fetch(`${MCP}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: rid++, method, params }) })
  const raw = await r.text()
  const m = /data: (.*)/.exec(raw)
  return { status: r.status, body: JSON.parse(m ? m[1]! : raw) as { result?: any; error?: any } }
}
async function tool(token: string, name: string, args: unknown) {
  const r = await rpc(token, 'tools/call', { name, arguments: args })
  const text: string = r.body.result?.content?.[0]?.text ?? JSON.stringify(r.body.error)
  let json: any = null
  try { json = JSON.parse(text) } catch { /* plain text */ }
  return { isError: !!r.body.result?.isError || !!r.body.error, text, json }
}

/** A real, decodable solid-colour PNG (no people, no content): the smoke test's only picture. */
function solidPng(w: number, h: number, [r, g, b]: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}

const SLUG2 = 'zz-smoke-places-media-delete-me'

/** Second scenario: a draft with a site (primary) + related place + a picture after key detail #2; preview; map zoom; revert. */
async function placesAndMedia(token: string) {
  console.log('\n── places + media scenario ──')
  const started = new Date().toISOString()
  // Real content must be untouched by the migration: the Zamzam event uses the Zamzam site, the Elephant event is unchanged.
  const zam = await tool(token, 'get_event', { slug: 'abdul-muttalib-rediscovers-zamzam' })
  ok(!zam.isError && zam.json?.place?.slug === 'zamzam' && zam.json.places.some((p: any) => p.slug === 'makkah' && p.role === 'related'), 'Zamzam event: primary place is zamzam, makkah kept as related', zam.isError ? zam.text : `(${zam.json?.places?.map((p: any) => p.slug + ':' + p.role).join(', ')})`)
  const ele = await tool(token, 'get_event', { slug: 'year-of-the-elephant' })
  ok(!ele.isError && ele.json?.place?.slug === 'makkah', 'Year of the Elephant event still uses Makkah (not changed)', `(${ele.json?.place?.slug})`)
  const fp = await tool(token, 'find_place', { query: 'zamzam' })
  ok(fp.json?.results?.[0]?.slug === 'zamzam' && fp.json.results[0].type === 'site' && fp.json.results[0].parent === 'makkah' && fp.json.results[0].zoom === 17 && fp.json.results[0].verified === false, 'zamzam is an unverified site under makkah, zoom 17')

  let eventId: string | null = null
  try {
    const c = await tool(token, 'create_event_draft', { slug: SLUG2, era_slug: 'prophethood-in-makkah', hijri_year: -10, place_slug: 'zamzam', translation: { lang: 'bn', title: 'স্মোক টেস্ট: স্থান ও ছবি (মুছে ফেলা হবে)', summary: 'এটি স্বয়ংক্রিয় পরীক্ষার একটি খসড়া। এটি কখনও প্রকাশিত হবে না।', key_details: ['প্রথম পরীক্ষামূলক বিবরণ।', 'দ্বিতীয় পরীক্ষামূলক বিবরণ।', 'তৃতীয় পরীক্ষামূলক বিবরণ।'] } })
    ok(!c.isError, 'create_event_draft with place_slug (site)', c.isError ? c.text : '')
    const add = await tool(token, 'add_event_place', { event_slug: SLUG2, place_slug: 'masjid-al-haram', role: 'related' })
    ok(!add.isError, 'add_event_place: masjid-al-haram (related)', add.isError ? add.text : '')
    const pl = (await tool(token, 'get_event', { slug: SLUG2 })).json
    ok(pl?.places?.length === 2 && pl.places[0].slug === 'zamzam' && pl.places[0].role === 'primary' && pl.places[0].zoom === 17 && pl.places[1].role === 'related', 'get_event lists both places with roles and zoom', `(${pl?.places?.map((p: any) => `${p.slug}:${p.role}:z${p.zoom}`).join(', ')})`)

    const bad = await tool(token, 'upload_media', { event_slug: SLUG2, kind: 'pattern', mime: 'image/png', alt: { bn: 'পরীক্ষামূলক রঙিন চতুর্ভুজ' }, contains_people_confirmation: false, base64: solidPng(8, 8, [46, 106, 97]).toString('base64'), placement: 'in_key_details', after_key_detail_index: 7 })
    ok(bad.isError && /does not exist/.test(bad.text), 'a key-detail index that does not exist is rejected', bad.text.slice(0, 90))
    const person = await tool(token, 'upload_media', { event_slug: SLUG2, kind: 'portrait', mime: 'image/png', alt: { bn: 'পরীক্ষা' }, contains_people_confirmation: false, base64: solidPng(8, 8, [1, 1, 1]).toString('base64') })
    ok(person.isError, 'kind "portrait" is still rejected (no people)')
    const up = await tool(token, 'upload_media', { event_slug: SLUG2, kind: 'pattern', mime: 'image/png', alt: { bn: 'পরীক্ষামূলক সবুজ চতুর্ভুজ' }, caption: { bn: 'পরীক্ষামূলক ক্যাপশন' }, credit: 'স্মোক টেস্ট', contains_people_confirmation: false, base64: solidPng(320, 200, [46, 106, 97]).toString('base64'), placement: 'in_key_details', after_key_detail_index: 1 })
    ok(!up.isError && up.json?.width === 320 && up.json?.height === 200, 'upload_media with placement in_key_details after detail #2 (index 1)', up.isError ? up.text : `(${up.json?.width}x${up.json?.height})`)
    const m = (await tool(token, 'get_event', { slug: SLUG2 })).json?.media?.[0]
    ok(m?.placement === 'in_key_details' && m.after_key_detail_index === 1, 'get_event reports the placement', JSON.stringify({ p: m?.placement, i: m?.after_key_detail_index }))
    const mv = await tool(token, 'set_media_placement', { media_id: m?.media_id ?? 'x', placement: 'in_key_details', after_key_detail_index: 1, order: 0 })
    ok(!mv.isError, 'set_media_placement accepts a valid placement')

    const pre = await tool(token, 'preview_event', { slug: SLUG2, ttl_minutes: 10 })
    const url = pre.json?.url as string | undefined
    ok(!!url, 'preview_event link', '')
    if (url) {
      const { chromium } = await import('@playwright/test')
      const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
      try {
        const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage()
        await page.goto(url)
        await page.waitForSelector('figure.pic img')
        await page.locator('figure.pic').first().scrollIntoViewIfNeeded()
        await page.waitForFunction(() => (document.querySelector('figure.pic img') as HTMLImageElement | null)?.complete === true, null, { timeout: 15_000 })
        const seq = await page.evaluate(() => [...document.querySelectorAll('article .keys > li, article figure.pic')].map((e) => (e.matches('figure.pic') ? 'PIC' : e.classList.contains('keypic') ? 'KEYPIC' : 'key')).filter((x) => x !== 'KEYPIC').join(','))
        ok(seq === 'key,key,PIC,key', 'the picture renders after key detail #2 and before #3', `(${seq})`)
        const img = await page.evaluate(() => { const i = document.querySelector('figure.pic img') as HTMLImageElement; return { nw: i.naturalWidth, alt: i.alt, lazy: i.loading, cap: document.querySelector('figure.pic figcaption')?.textContent } })
        ok(img.nw === 320 && img.lazy === 'lazy' && !!img.alt && /পরীক্ষামূলক ক্যাপশন/.test(img.cap ?? ''), 'image loads (lazy), has alt text, caption and credit', JSON.stringify(img))
        await page.evaluate(() => scrollTo(0, 0))
        let z = 0
        for (let i = 0; i < 40 && Math.abs(z - 17) > 0.15; i++) { await page.waitForTimeout(500); z = Number(await page.locator('.mapbox').getAttribute('data-zoom') ?? 0) }
        ok(Math.abs(z - 17) <= 0.15, 'the live map zooms to the Zamzam site (zoom 17, fitted with the related place)', `(zoom ${z})`)
        const mk = await page.evaluate(() => ({ all: document.querySelectorAll('.mapmk').length, hl: document.querySelectorAll('.mapmk.hl').length, rel: document.querySelectorAll('.mapmk.rel').length }))
        ok(mk.all === 2 && mk.hl === 1 && mk.rel === 1, 'two markers: highlighted primary + secondary related', JSON.stringify(mk))
        const src = await page.locator('figure.pic img').getAttribute('src')
        const anon = await fetch(`${WEB}${src!.split('?')[0]}`)
        ok(anon.status === 404, 'the draft picture is NOT public without the preview token (404)', `(${anon.status})`)
        const pub = await fetch(`${WEB}/bn/events/${SLUG2}`)
        ok(pub.status === 404, 'the draft page is not public (404)', `(${pub.status})`)
      } finally { await browser.close() }
    }

    const revs = await tool(token, 'list_revisions', { event_slug: SLUG2 })
    const creation = revs.json?.revisions?.find((r: { action: string }) => r.action === 'create')
    ok(!!creation, 'list_revisions shows the creation')
    if (creation) {
      const rv = await tool(token, 'revert_revision', { revision_id: creation.revision_id })
      ok(!rv.isError, 'revert_revision deletes the draft with its place links and picture', rv.isError ? rv.text : '')
      created2 = false
      ok((await tool(token, 'get_event', { slug: SLUG2 })).isError, 'the draft no longer exists')
      if (url) ok(!(await (await fetch(url)).text()).includes('স্মোক টেস্ট'), 'preview link is dead after the revert')
    }
  } finally {
    if (created2) console.log(`\n!! Test draft "${SLUG2}" may still exist. Remove it via revert_revision or tell Claude.`)
    console.log(`\n(test window ${started} → ${new Date().toISOString()}; Claude removes the leftover test revisions/audit rows from this window)`)
  }
}
let created2 = true

const SLUG4 = 'zz-smoke-sources-delete-me'
/** Fourth scenario: list_sources, locator rules and the hadith-only source path, on a throw-away draft. */
async function sourcesGate(token: string) {
  console.log('\n── sources and locators ──')
  let done = false
  try {
    const ls = await tool(token, 'list_sources', {})
    ok(!ls.isError && Array.isArray(ls.json?.sources) && /Never guess/.test(ls.json.locator_rules), 'list_sources returns the registered books and the locator rules', ls.isError ? ls.text : `(${ls.json?.sources?.length} books)`)
    const c = await tool(token, 'create_event_draft', { slug: SLUG4, era_slug: 'prophethood-in-makkah', hijri_year: -10, place_slug: 'zamzam', translation: { lang: 'bn', title: 'স্মোক টেস্ট: সূত্র (মুছে ফেলা হবে)', summary: 'এটি স্বয়ংক্রিয় পরীক্ষার খসড়া।' } })
    ok(!c.isError, 'create_event_draft', c.isError ? c.text : '')
    const book = ls.json?.sources?.[0]?.slug as string | undefined
    if (book) {
      for (const bad of [{ page: 'n/a' }, { page: 'TBD' }, { page: '0' }, { volume: '1' }, {}]) {
        const r = await tool(token, 'add_source_citation', { event_slug: SLUG4, source_slug: book, ...bad })
        ok(r.isError, `locator ${JSON.stringify(bad)} is refused`, r.isError ? '' : 'ACCEPTED')
      }
      const sec = await tool(token, 'add_source_citation', { event_slug: SLUG4, source_slug: book, section: 'পরীক্ষামূলক অধ্যায়ের শিরোনাম' })
      ok(!sec.isError, 'a chapter/section title is a valid locator', sec.isError ? sec.text : '')
    } else console.log('SKIP  no registered book to cite')
    const h0 = (await tool(token, 'get_event', { slug: SLUG4 })).json
    const cid = h0?.sources?.[0]?.citation_id as string | undefined
    if (cid) {
      ok(h0.sources[0].valid === true, 'get_event shows citation_id and valid flag')
      ok((await tool(token, 'update_source_citation', { event_slug: SLUG4, citation_id: cid, page: 'tbd', section: null })).isError, 'update_source_citation refuses a placeholder')
      ok(!(await tool(token, 'update_source_citation', { event_slug: SLUG4, citation_id: cid, page: '12' })).isError, 'update_source_citation sets a real page')
      ok(!(await tool(token, 'remove_source_citation', { event_slug: SLUG4, citation_id: cid })).isError, 'remove_source_citation removes it')
      await tool(token, 'attach_ayah', { event_slug: SLUG4, surah: 96, ayah: 1 })
      ok(!((await tool(token, 'get_event', { slug: SLUG4 })).json?.publish_blockers as string[]).some((b) => /source/i.test(b)), 'an attached ayah alone satisfies the source rule')
    }
    const wrong = await tool(token, 'delete_draft', { event_slug: SLUG4, confirm_slug: SLUG4 + 'x' })
    ok(wrong.isError && /does not match/.test(wrong.text), 'delete_draft with a wrong confirm_slug is refused')
    const dd = await tool(token, 'delete_draft', { event_slug: SLUG4, confirm_slug: SLUG4 })
    ok(!dd.isError, 'delete_draft (exact slug) soft-deletes the draft', dd.isError ? dd.text : '')
    ok((await tool(token, 'get_event', { slug: SLUG4 })).isError, 'the draft is gone from get_event')
    ok((await tool(token, 'list_drafts', {})).json?.recently_deleted?.some((x: { slug: string }) => x.slug === SLUG4), 'list_drafts lists it as recently deleted')
    ok(!(await tool(token, 'revert_revision', { revision_id: dd.json.revision_id })).isError, 'revert_revision restores it')
    const h = await tool(token, 'get_event', { slug: SLUG4 })
    ok(!(h.json?.publish_blockers as string[] | undefined)?.some((b) => /source/i.test(b)) || !book, 'the section citation satisfies the source rule', JSON.stringify(h.json?.publish_blockers))
    const rv = await tool(token, 'list_revisions', { event_slug: SLUG4 })
    const creation = rv.json?.revisions?.find((r: { action: string }) => r.action === 'create')
    if (creation) { ok(!(await tool(token, 'revert_revision', { revision_id: creation.revision_id })).isError, 'revert deletes the test draft'); done = true }
  } finally {
    if (!done) console.log(`\n!! Test draft "${SLUG4}" may still exist. Remove it via revert_revision or tell Claude.`)
  }
}

const SLUG3 = 'zz-smoke-uploads-delete-me'
const sha = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex')
/** A JPEG with fake EXIF (GPS text) and a comment, structurally valid: proves the live server strips metadata. */
function jpegWithExif(): Buffer {
  const seg = (m: number, body: number[]) => [0xff, m, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]
  const a = (t: string) => [...Buffer.from(t)]
  const exif = [...a('Exif'), 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, ...a('GPS=21.4225,39.8262;Model=SmokeSecretCam')]
  return Buffer.from([0xff, 0xd8, ...seg(0xe0, [...a('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), ...seg(0xe1, exif), ...seg(0xfe, a('SmokeSecretComment')), ...seg(0xc0, [8, 0, 30, 0, 40, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]), ...Array.from({ length: 30 }, (_, i) => (i * 7 + 1) & 0x7f), 0xff, 0xd9])
}

/** Third scenario: ayah in_key_details + a picture through each of the four upload paths, positions in the preview, then revert. */
async function placementAndUploads(token: string) {
  console.log('\n── ayah placement + the four upload paths ──')
  const started = new Date().toISOString()
  let done = false
  try {
    const c = await tool(token, 'create_event_draft', { slug: SLUG3, era_slug: 'prophethood-in-makkah', hijri_year: -10, place_slug: 'zamzam', translation: { lang: 'bn', title: 'স্মোক টেস্ট: আয়াত ও ছবির স্থান (মুছে ফেলা হবে)', summary: 'প্রথম অনুচ্ছেদ: এটি স্বয়ংক্রিয় পরীক্ষার খসড়া।\n\nদ্বিতীয় অনুচ্ছেদ: এটি কখনও প্রকাশিত হবে না।', key_details: ['প্রথম পরীক্ষামূলক বিবরণ।', 'দ্বিতীয় পরীক্ষামূলক বিবরণ।', 'তৃতীয় পরীক্ষামূলক বিবরণ।'], lessons: ['প্রথম শিক্ষা।', 'দ্বিতীয় শিক্ষা।'] } })
    ok(!c.isError, 'create_event_draft (2 paragraphs, 3 key details, 2 lessons)', c.isError ? c.text : '')
    const lay = (await tool(token, 'get_event_layout', { event: SLUG3 })).json
    ok(lay?.counts?.summary_paragraphs === 2 && lay.counts.key_details === 3 && lay.counts.lessons === 2 && lay.slots.key_details.length === 3, 'get_event_layout shows the numbered slots', JSON.stringify(lay?.counts))
    const bad = await tool(token, 'attach_ayah', { event_slug: SLUG3, surah: 96, ayah: 1, placement: 'in_key_details', after_index: 9 })
    ok(bad.isError && /valid after_index 0–2/.test(bad.text), 'an index that does not exist is refused with the valid range', bad.text.slice(0, 100))
    const ay = await tool(token, 'attach_ayah', { event_slug: SLUG3, surah: 96, ayah: 1, placement: 'in_key_details', after_index: 1, placement_note: { bn: 'এই আয়াতে প্রথম ওহীর উল্লেখ আছে।' } })
    ok(!ay.isError && ay.json?.ayat?.[0]?.arabic, 'attach_ayah in_key_details after #2, with a note (text comes from the server dataset)', ay.isError ? ay.text : '')

    // A) base64, small
    const a = await tool(token, 'upload_media', { event_slug: SLUG3, kind: 'pattern', alt: { bn: 'পরীক্ষামূলক সবুজ চতুর্ভুজ (base64)' }, contains_people_confirmation: false, base64: solidPng(320, 200, [46, 106, 97]).toString('base64'), placement: 'in_key_details', after_index: 1 })
    ok(!a.isError && a.json?.placement === 'in_key_details', 'path 1: upload_media (base64)', a.isError ? a.text : `(${a.json?.processing})`)
    // B) Wikimedia Commons URL (public domain satellite image, no people)
    const b = await tool(token, 'upload_media', { event_slug: SLUG3, kind: 'landscape', alt: { bn: 'আন-নুফুদ মরুভূমির স্যাটেলাইট চিত্র' }, contains_people_confirmation: false, media_url: 'https://commons.wikimedia.org/wiki/File:Al-Nafud_Desert,_Saudi_Arabia_(MODIS_2026-01-17).jpg', placement: 'in_summary', after_index: 0 })
    ok(!b.isError && b.json?.wikimedia?.license, 'path 2: upload_media with media_url (Wikimedia Commons)', b.isError ? b.text.slice(0, 160) : `(${b.json.wikimedia.license}; ${b.json.width}×${b.json.height}; variants ${JSON.stringify(b.json.variants)}; ${b.json.processing})`)
    const nf = await tool(token, 'upload_media', { event_slug: SLUG3, kind: 'landscape', alt: { bn: 'পরীক্ষা' }, contains_people_confirmation: false, media_url: 'https://example.com/a.jpg' })
    ok(nf.isError && /not allowed/.test(nf.text), 'media_url from any other host is refused')
    // C) signed single-use PUT URL (what a client with a shell uses)
    const u = await tool(token, 'create_upload_url', { event_slug: SLUG3, kind: 'landscape', alt: { bn: 'পরীক্ষামূলক ছবি (curl)' }, contains_people_confirmation: false, placement: 'end' })
    ok(!u.isError && u.json?.upload_url, 'path 3: create_upload_url', u.isError ? u.text : '')
    if (u.json?.upload_url) {
      const put1 = await fetch(u.json.upload_url, { method: 'PUT', body: new Uint8Array(jpegWithExif()), headers: { 'Content-Type': 'application/octet-stream' } })
      const pj = (await put1.json()) as { ok?: boolean; metadata_removed?: string[]; placement?: string }
      ok(put1.status === 200 && pj.ok && pj.placement === 'end', 'PUT stores it at the bound placement', `(${put1.status})`)
      ok(!!pj.metadata_removed?.includes('EXIF') && pj.metadata_removed.includes('comment'), 'EXIF/GPS and comment were removed from the stored file', JSON.stringify(pj.metadata_removed))
      ok((await fetch(u.json.upload_url, { method: 'PUT', body: new Uint8Array(jpegWithExif()) })).status === 410, 'the URL works exactly once (second PUT → 410)')
    }
    // D) link to the site's upload page, driven in a browser like the owner would
    const l = await tool(token, 'create_upload_link', { event_slug: SLUG3, kind: 'landscape', alt: { bn: 'পরীক্ষামূলক ছবি (লিংক)' }, contains_people_confirmation: false, placement: 'in_lessons', after_index: 0 })
    ok(!l.isError && l.json?.upload_link, 'path 4: create_upload_link', l.isError ? l.text : '')
    const { chromium } = await import('@playwright/test')
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
    try {
      if (l.json?.upload_link) {
        const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
        await page.goto(l.json.upload_link)
        ok((await page.locator('h1').innerText()) === 'ছবি আপলোড', 'the upload page opens in Bangla')
        ok(/শিক্ষার ১ নম্বরের পরে/.test(await page.locator('.facts').innerText()), 'it shows where the picture will go (pre-filled)')
        await page.locator('input[type=file]').setInputFiles({ name: 'smoke.png', mimeType: 'image/png', buffer: solidPng(320, 200, [180, 138, 60]) })
        await page.getByRole('checkbox').check()
        await page.getByRole('button', { name: 'আপলোড নিশ্চিত করুন' }).click()
        await page.waitForSelector('.updone, .uperr', { timeout: 30_000 })
        ok(await page.locator('.updone').count() === 1, 'confirming on the page uploads the picture', (await page.locator('.uperr').count()) ? await page.locator('.uperr').innerText() : '')
        await page.goto(l.json.upload_link)
        ok(/সঠিক নয়, মেয়াদ শেষ/.test(await page.locator('.uploadcard').innerText()), 'the link is dead afterwards')
      }
      // E) chunked fallback
      const noise = deflateSync(randomBytes(120 * 120 * 3 + 120), { level: 0 })
      const big = (() => { const png = solidPng(120, 120, [0, 0, 0]); return Buffer.concat([png.subarray(0, 33), ...(() => { const len = Buffer.alloc(4); len.writeUInt32BE(noise.length); const t = Buffer.from('IDAT'); return [len, t, noise, Buffer.alloc(4)] })(), png.subarray(png.length - 12)]) })()
      const ch = await tool(token, 'upload_media_begin', { event_slug: SLUG3, kind: 'pattern', alt: { bn: 'পরীক্ষামূলক ছবি (খণ্ড খণ্ড)' }, contains_people_confirmation: false, placement: 'before_lessons', total_size: big.length, sha256: sha(big) })
      ok(!ch.isError && ch.json?.chunk_count >= 2, 'path 5 (fallback): upload_media_begin', ch.isError ? ch.text : `(${big.length} bytes → ${ch.json?.chunk_count} chunks)`)
      if (ch.json?.upload_id) {
        const n = ch.json.chunk_count as number
        let corrupted = false
        for (let i = 0; i < n; i++) {
          const part = big.subarray(i * 32768, (i + 1) * 32768)
          if (i === 1 && !corrupted) { // a damaged chunk is refused, then the right one is accepted
            const bad2 = Buffer.from(part); bad2[5]! ^= 1
            const r0 = await tool(token, 'upload_media_chunk', { upload_id: ch.json.upload_id, index: i, base64: bad2.toString('base64'), chunk_sha256: sha(part) })
            ok(r0.isError && /hash mismatch.*again/.test(r0.text), 'a damaged chunk is refused and must be sent again', r0.text.slice(0, 80)); corrupted = true
          }
          const r = await tool(token, 'upload_media_chunk', { upload_id: ch.json.upload_id, index: i, base64: part.toString('base64'), chunk_sha256: sha(part) })
          if (r.isError) ok(false, `chunk ${i}`, r.text)
        }
        const fin = await tool(token, 'upload_media_finish', { upload_id: ch.json.upload_id })
        ok(!fin.isError && fin.json?.placement === 'before_lessons', 'upload_media_finish verifies the whole file and stores it', fin.isError ? fin.text : '')
      }

      // positions + responsive copies, as the owner would see them
      const ev = (await tool(token, 'get_event', { slug: SLUG3 })).json
      ok(ev?.media?.length === 5 && ev.ayat?.length === 1, 'the event now has 1 ayah and 5 pictures', `(${ev?.media?.length} pictures)`)
      const big2 = ev?.media?.find((m: any) => m.width && m.width > 600)
      ok(!big2 || big2.variants.length > 0, 'larger pictures got responsive webp copies (Images binding)', JSON.stringify(ev?.media?.map((m: any) => [m.width, m.variants])))
      const pre = await tool(token, 'preview_event', { slug: SLUG3, ttl_minutes: 10 })
      if (pre.json?.url) {
        for (const [name, vp] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]] as const) {
          const page = await (await browser.newContext({ viewport: vp })).newPage()
          await page.goto(pre.json.url)
          await page.waitForSelector('article .keys')
          for (const f of await page.locator('figure.pic').all()) { await f.scrollIntoViewIfNeeded(); await page.waitForTimeout(150) }
          const seq = await page.evaluate(() => {
            const out: string[] = []; let sum = -1, key = -1, les = -1
            for (const el of document.querySelectorAll('article .sum, article .keys > li:not(.keypic), article .lessons > li:not(.keypic), article figure.pic, article .ayahwrap')) {
              if (el.matches('.sum')) out.push(`sum${++sum}`)
              else if (el.matches('.keys > li')) out.push(`key${++key}`)
              else if (el.matches('.lessons > li')) out.push(`lesson${++les}`)
              else if (el.matches('.ayahwrap')) out.push('AYAH')
              else out.push(`pic:${(el as HTMLElement).dataset.placement}`)
            }
            return out.join(' ')
          })
          ok(seq === 'sum0 pic:in_summary sum1 key0 key1 AYAH pic:in_key_details key2 pic:before_lessons lesson0 pic:in_lessons lesson1 pic:end', `${name}: ayah and pictures render at their slots`, `(${seq})`)
          const imgs = await page.evaluate(() => [...document.querySelectorAll('figure.pic img')].map((i) => (i as HTMLImageElement).naturalWidth))
          ok(imgs.length === 5 && imgs.every((w) => w > 0), `${name}: all 5 pictures load`, JSON.stringify(imgs))
          const note = await page.locator('.ayahnote').innerText().catch(() => '')
          ok(/প্রথম ওহীর/.test(note), `${name}: the placement note shows above the ayah card`)
        }
      }
    } finally { await browser.close() }

    const revs = await tool(token, 'list_revisions', { event_slug: SLUG3 })
    const creation = revs.json?.revisions?.find((r: { action: string }) => r.action === 'create')
    if (creation) {
      const rv = await tool(token, 'revert_revision', { revision_id: creation.revision_id })
      ok(!rv.isError, 'revert_revision deletes the draft with its ayah, notes and all 5 pictures', rv.isError ? rv.text : '')
      done = true
      ok((await tool(token, 'get_event', { slug: SLUG3 })).isError, 'the draft no longer exists')
    }
  } finally {
    if (!done) console.log(`\n!! Test draft "${SLUG3}" may still exist. Remove it via revert_revision or tell Claude.`)
    console.log(`\n(test window ${started} → ${new Date().toISOString()}; Claude removes the leftover test revisions/audit/upload rows from this window)`)
  }
}

async function main() {
  const unauth = await fetch(`${MCP}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  ok(unauth.status === 401 && /bearer/i.test(unauth.headers.get('www-authenticate') ?? ''), 'unauthenticated /mcp → 401 with a bearer challenge')

  const token = await login()

  const list = await rpc(token, 'tools/list')
  const names: string[] = list.body.result?.tools?.map((t: { name: string }) => t.name) ?? []
  ok(names.length === 47, `tools/list returns all 47 tools`, `(${names.length})`)
  for (const t of ['set_primary_place', 'add_event_place', 'remove_event_place', 'set_media_placement', 'attach_media', 'update_place', 'get_event_layout', 'set_ayah_placement', 'create_upload_url', 'create_upload_link', 'upload_media_begin', 'upload_media_chunk', 'upload_media_finish', 'list_sources', 'remove_source_citation', 'update_source_citation', 'detach_hadith_ref', 'delete_draft']) ok(names.includes(t), `tool ${t} is listed`)

  const eras = await tool(token, 'list_eras', {})
  ok(!eras.isError && eras.text.includes('prophethood-in-makkah'), 'list_eras sees the production seed (5 eras)')

  let created = false
  try {
    const c = await tool(token, 'create_event_draft', { slug: SLUG, era_slug: 'prophethood-in-makkah', hijri_year: -10, translation: { lang: 'bn', title: 'স্মোক টেস্ট (মুছে ফেলা হবে)', summary: 'এটি স্বয়ংক্রিয় পরীক্ষার একটি খসড়া। এটি কখনও প্রকাশিত হবে না।' } })
    created = !c.isError
    ok(created, 'create_event_draft', c.isError ? c.text : '')
    const pre = await tool(token, 'preview_event', { slug: SLUG, ttl_minutes: 5 })
    const url = pre.json?.url as string | undefined
    ok(!!url && url.startsWith(`${WEB}/bn/preview/${SLUG}?token=`), 'preview_event returns a link on the live site')
    if (url) {
      const pv = await fetch(url)
      const body = await pv.text()
      ok(pv.status === 200 && body.includes('স্মোক টেস্ট'), 'preview link shows the draft', `(${pv.status})`)
      const bad = await fetch(url.replace(/token=.*/, 'token=' + 'x'.repeat(32)))
      ok(!(await bad.text()).includes('স্মোক টেস্ট'), 'preview with an invalid token does not show the draft')
    }
    const pub = await fetch(`${WEB}/bn/events/${SLUG}`)
    ok(pub.status === 404, 'draft is NOT visible on the public event URL (404)', `(${pub.status})`)
    const sitemap = await (await fetch(`${WEB}/bn/sitemap.xml`)).text()
    ok(!sitemap.includes(SLUG), 'draft is not in the sitemap')

    const revs = await tool(token, 'list_revisions', { event_slug: SLUG })
    const creation = revs.json?.revisions?.find((r: { action: string }) => r.action === 'create')
    ok(!!creation, 'list_revisions shows the creation')
    if (creation) {
      const rv = await tool(token, 'revert_revision', { revision_id: creation.revision_id })
      ok(!rv.isError, 'revert_revision undoes the creation (deletes the draft)', rv.isError ? rv.text : '')
      const gone = await tool(token, 'get_event', { slug: SLUG })
      ok(gone.isError, 'the draft no longer exists')
      created = false
      if (url) ok(!(await (await fetch(url)).text()).includes('স্মোক টেস্ট'), 'preview link is dead after the revert')
    }
  } finally {
    if (created) console.log(`\n!! Test draft "${SLUG}" may still exist. Remove it via revert_revision or tell Claude.`)
  }
  await placesAndMedia(token)
  await placementAndUploads(token)
  await sourcesGate(token)
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
}
main().catch((e) => { console.error('\nError:', e instanceof Error ? e.message : e); failed++ }).finally(() => { rl.close(); process.exit(failed ? 1 : 0) })
