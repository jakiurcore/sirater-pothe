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

async function main() {
  const unauth = await fetch(`${MCP}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  ok(unauth.status === 401 && /bearer/i.test(unauth.headers.get('www-authenticate') ?? ''), 'unauthenticated /mcp → 401 with a bearer challenge')

  const token = await login()

  const list = await rpc(token, 'tools/list')
  const names: string[] = list.body.result?.tools?.map((t: { name: string }) => t.name) ?? []
  ok(names.length === 35, `tools/list returns all 35 tools`, `(${names.length})`)
  for (const t of ['set_primary_place', 'add_event_place', 'remove_event_place', 'set_media_placement', 'attach_media', 'update_place']) ok(names.includes(t), `tool ${t} is listed`)

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
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
}
main().catch((e) => { console.error('\nError:', e instanceof Error ? e.message : e); failed++ }).finally(() => { rl.close(); process.exit(failed ? 1 : 0) })
