#!/usr/bin/env tsx
/**
 * Live smoke test of the MCP server through its real OAuth flow.
 *   pnpm smoke:live            (MCP_ORIGIN / WEB_ORIGIN default to https://mcp.$DOMAIN / https://$DOMAIN)
 * You type YOUR username, password and authenticator code at the prompts (hidden). Nothing is stored or logged;
 * the access token lives in memory only. The script creates one draft event, previews it, checks that it is not public,
 * then reverts its creation (which deletes the draft) and checks the preview link is dead.
 */
import { createHash, randomBytes } from 'node:crypto'
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

async function main() {
  const unauth = await fetch(`${MCP}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  ok(unauth.status === 401 && /bearer/i.test(unauth.headers.get('www-authenticate') ?? ''), 'unauthenticated /mcp → 401 with a bearer challenge')

  const token = await login()

  const list = await rpc(token, 'tools/list')
  const names: string[] = list.body.result?.tools?.map((t: { name: string }) => t.name) ?? []
  ok(names.length === 29, `tools/list returns all 29 tools`, `(${names.length})`)

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
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
}
main().catch((e) => { console.error('\nError:', e instanceof Error ? e.message : e); failed++ }).finally(() => { rl.close(); process.exit(failed ? 1 : 0) })
