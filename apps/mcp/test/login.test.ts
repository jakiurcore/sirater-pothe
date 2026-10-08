import { describe, it, expect, beforeAll } from 'vitest'
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { schema as s } from '@seerah/db'
import { hashPassword } from '@seerah/auth/password'
import { generateSecret, totp } from '@seerah/auth/totp'
import { db } from './helpers'
import { rateLimit } from '../src/auth/guard'

const worker = () => (exports as unknown as { default: { fetch: typeof fetch } }).default
const ORIGIN = env.MCP_ORIGIN
const REDIRECT = 'http://127.0.0.1:9999/cb'
const PASSWORD = 'correct horse battery staple'

let clientId: string
beforeAll(async () => {
  const r = await worker().fetch(new Request(`${ORIGIN}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Test <b>App</b>', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) }))
  clientId = ((await r.json()) as { client_id: string }).client_id
  await db().insert(s.users).values({ id: 'u-ali', username: 'ali', passwordHash: await hashPassword(PASSWORD), role: 'owner' })
})

const authorizeUrl = (ip = '1.1.1.1') => ({ ip, url: `${ORIGIN}/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=mcp&state=xyz&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256&resource=${encodeURIComponent(ORIGIN + '/mcp')}` })

/** GET the login page, return the hidden fields + the cookie jar for the POST. */
async function openLogin(ip: string) {
  const res = await worker().fetch(new Request(authorizeUrl(ip).url, { headers: { 'CF-Connecting-IP': ip } }))
  const html = await res.text()
  const field = (n: string) => new RegExp(`name="${n}" value="([^"]*)"`).exec(html)?.[1] ?? ''
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  return { res, html, cookies, form: { handle: field('handle'), csrf: field('csrf'), authq: field('authq').replaceAll('&#38;', '&').replaceAll('&#61;', '=') } }
}
async function post(ip: string, open: Awaited<ReturnType<typeof openLogin>>, body: Record<string, string>, cookies = open.cookies) {
  return worker().fetch(new Request(`${ORIGIN}/authorize`, {
    method: 'POST', redirect: 'manual',
    headers: { 'CF-Connecting-IP': ip, Cookie: cookies, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...open.form, scope: 'mcp', decision: 'approve', ...body }),
  }))
}
const user = () => db().query.users.findFirst({ where: eq(s.users.username, 'ali') })
const auditCount = async (tool: string) => (await db().query.auditLog.findMany()).filter((a) => a.tool === tool).length

describe('login page', () => {
  it('renders our form (bn + en), escapes client names, sets a __Host- CSRF cookie and no-store', async () => {
    const o = await openLogin('2.0.0.1')
    expect(o.res.status).toBe(200)
    expect(o.html).toContain('ব্যবহারকারীর নাম')
    expect(o.html).toContain('Username')
    expect(o.html).toContain('Test &#60;b&#62;App&#60;/b&#62;')
    expect(o.html).not.toContain('<b>App</b>')
    expect(o.html).not.toMatch(/github/i)
    expect(o.res.headers.get('cache-control')).toBe('no-store')
    expect(o.res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    const csrf = o.res.headers.getSetCookie().find((c) => c.startsWith('__Host-seerah_csrf='))!
    expect(csrf).toMatch(/Secure/)
    expect(csrf).toMatch(/HttpOnly/)
    expect(csrf).toMatch(/SameSite=Strict/)
  })
})

describe('login', () => {
  it('succeeds with the right password and redirects to the client with a code + state', async () => {
    const ip = '3.0.0.1'
    const o = await openLogin(ip)
    const r = await post(ip, o, { username: 'Ali ', password: PASSWORD })
    expect(r.status).toBe(302)
    const loc = new URL(r.headers.get('location')!)
    expect(loc.origin + loc.pathname).toBe(REDIRECT)
    expect(loc.searchParams.get('code')).toBeTruthy()
    expect(loc.searchParams.get('state')).toBe('xyz')
    expect((await user())!.lastLoginAt).toBeTruthy()
    expect(await auditCount('auth.login')).toBeGreaterThan(0)
  })

  it('rejects wrong password and unknown user with the SAME generic page', async () => {
    const a = await openLogin('3.0.0.2')
    const wrong = await post('3.0.0.2', a, { username: 'ali', password: 'nope-nope-nope-1' })
    const b = await openLogin('3.0.0.3')
    const unknown = await post('3.0.0.3', b, { username: 'nobody', password: 'nope-nope-nope-1' })
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    const strip = (h: string) => h.replace(/name="(handle|csrf)" value="[^"]*"/g, '').replace(/value="(ali|nobody)"/g, '')
    expect(strip(await wrong.text())).toBe(strip(await unknown.text()))
    expect((await user())!.failedAttempts).toBeGreaterThan(0)
  })

  it('locks the account for 15 minutes after 5 failures — even the right password is then refused', async () => {
    await db().update(s.users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(s.users.username, 'ali'))
    for (let i = 0; i < 5; i++) {
      const ip = `4.0.0.${i + 1}` // different IPs so only the account lock is exercised
      const o = await openLogin(ip)
      expect((await post(ip, o, { username: 'ali', password: 'wrong-wrong-wrong' + i })).status).toBe(401)
    }
    const u = (await user())!
    expect(u.lockedUntil).toBeTruthy()
    const mins = (Date.parse(u.lockedUntil!) - Date.now()) / 60_000
    expect(mins).toBeGreaterThan(14)
    expect(mins).toBeLessThanOrEqual(15.01)
    const o = await openLogin('4.0.0.9')
    const r = await post('4.0.0.9', o, { username: 'ali', password: PASSWORD })
    expect(r.status).toBe(401)
    expect(r.headers.get('location')).toBeNull()
    expect((await db().query.auditLog.findMany()).some((a) => a.tool === 'auth.login' && a.detail?.includes('locked'))).toBe(true)
    // lock expiry → works again
    await db().update(s.users).set({ lockedUntil: new Date(Date.now() - 1000).toISOString() }).where(eq(s.users.username, 'ali'))
    const o2 = await openLogin('4.0.0.10')
    expect((await post('4.0.0.10', o2, { username: 'ali', password: PASSWORD })).status).toBe(302)
  })

  it('a disabled account cannot sign in', async () => {
    await db().update(s.users).set({ disabledAt: new Date().toISOString() }).where(eq(s.users.username, 'ali'))
    const o = await openLogin('5.0.0.1')
    expect((await post('5.0.0.1', o, { username: 'ali', password: PASSWORD })).status).toBe(401)
    await db().update(s.users).set({ disabledAt: null }).where(eq(s.users.username, 'ali'))
  })

  it('deny returns access_denied to the client without a password', async () => {
    const o = await openLogin('5.0.0.2')
    const r = await post('5.0.0.2', o, { decision: 'deny' })
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toContain('error=access_denied')
  })
})

describe('CSRF', () => {
  it('rejects a POST without the cookie, with a wrong token, or without the token', async () => {
    const o = await openLogin('6.0.0.1')
    const base = { username: 'ali', password: PASSWORD }
    const hs = o.cookies.split('; ').filter((c) => !c.startsWith('__Host-seerah_csrf')).join('; ')
    expect((await post('6.0.0.1', o, base, hs)).status).toBe(403) // no csrf cookie
    expect((await post('6.0.0.1', o, { ...base, csrf: 'x'.repeat(64) })).status).toBe(403) // wrong token
    expect((await post('6.0.0.1', o, { ...base, csrf: '' })).status).toBe(403) // missing token
    expect(await auditCount('auth.csrf')).toBeGreaterThanOrEqual(3)
  })
})

describe('rate limit on /authorize', () => {
  it('blocks the 11th POST from one IP (429 + Retry-After) but not other IPs', async () => {
    const ip = '7.0.0.1'
    const o = await openLogin(ip)
    const codes: number[] = []
    for (let i = 0; i < 11; i++) codes.push((await post(ip, o, { username: 'nobody', password: 'x'.repeat(14) })).status)
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true)
    expect(codes[10]).toBe(429)
    const other = await openLogin('7.0.0.2')
    expect((await post('7.0.0.2', other, { username: 'nobody', password: 'x'.repeat(14) })).status).toBe(401)
  })
  it('window resets and the limiter itself is exact', async () => {
    const lim = { max: 3, windowMs: 1000 }
    const t = 10_000
    const r = [] as boolean[]
    for (let i = 0; i < 5; i++) r.push((await rateLimit(env.DB, 'k', lim, t)).allowed)
    expect(r).toEqual([true, true, true, false, false])
    expect((await rateLimit(env.DB, 'k', lim, t + 1000)).allowed).toBe(true)
  })
})

describe('TOTP at login', () => {
  const secret = generateSecret()
  beforeAll(async () => {
    await db().insert(s.users).values({ id: 'u-bea', username: 'bea', passwordHash: await hashPassword(PASSWORD), role: 'editor', totpSecret: secret })
  })
  it('requires a valid code; accepts it once (no replay)', async () => {
    const ip = '8.0.0.1'
    let o = await openLogin(ip)
    expect((await post(ip, o, { username: 'bea', password: PASSWORD })).status).toBe(401) // no code
    o = await openLogin(ip)
    expect((await post(ip, o, { username: 'bea', password: PASSWORD, code: '000000' })).status).toBe(401)
    o = await openLogin(ip)
    const code = await totp(secret)
    const ok = await post(ip, o, { username: 'bea', password: PASSWORD, code })
    expect(ok.status).toBe(302)
    o = await openLogin(ip)
    expect((await post(ip, o, { username: 'bea', password: PASSWORD, code })).status).toBe(401) // replayed
  })
  it('a wrong code with the right password counts toward the lockout', async () => {
    const u = await db().query.users.findFirst({ where: eq(s.users.username, 'bea') })
    expect(u!.failedAttempts).toBeGreaterThan(0)
  })
  it('wrong password never reveals whether 2FA is on', async () => {
    const ip = '8.0.0.2'
    const o = await openLogin(ip)
    const r = await post(ip, o, { username: 'bea', password: 'wrong-wrong-wrong' })
    expect(await r.text()).toContain('Incorrect username, password or code.')
  })
})

describe('Workers PBKDF2', () => {
  it('100,000 iterations (the Workers production maximum) runs in workerd', async () => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('x'), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(16), iterations: 100_000 }, key, 256)
    expect(bits.byteLength).toBe(32)
  })
})
