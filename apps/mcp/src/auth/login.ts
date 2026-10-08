import { AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider'
import type { Env } from '../env'
import { GET_LIMIT, POST_LIMIT, attemptLogin, audit, clientKey, csrfCookie, csrfValid, newCsrf, normalizeUsername, rateLimit, CSRF_COOKIE } from './guard'
import { esc, layout, loginPage } from './page'

const GENERIC = 'ব্যবহারকারীর নাম, পাসওয়ার্ড বা কোড সঠিক নয়। / Incorrect username, password or code.'

function failure(e: unknown): Response {
  if (e instanceof AuthorizationError) {
    if (e.redirectTo) return Response.redirect(e.redirectTo, 302)
    return layout('Authorization error', `<h1>Cannot authorize</h1><p class="sub">${esc(e.description ?? 'The request is invalid or has expired.')} Please start again from your AI app.</p>`, 400)
  }
  if (e instanceof CimdFetchError) return layout('Authorization error', '<h1>Cannot authorize</h1><p class="sub">This app could not be verified.</p>', 400)
  throw e
}

/** Renders the login form for an authorize request URL (used for the first GET and for failed attempts). */
async function renderLogin(env: Env, authorizeUrl: string, o: { username?: string; error?: string }, status = 200): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER
  const req = await oauth.parseAuthRequest(new Request(authorizeUrl))
  const details = await oauth.describeConsent(req)
  const consent = await oauth.beginConsent(req)
  const csrf = newCsrf()
  consent.headers.append('Set-Cookie', csrfCookie(csrf))
  return loginPage(details, { handle: consent.handle, csrf, scope: details.scope, authq: new URL(authorizeUrl).search, ...o }, status, consent.headers)
}

const tooMany = (retry: number) => {
  const r = layout('Too many attempts', `<h1>অনেকবার চেষ্টা হয়েছে</h1><p class="sub">Too many attempts. Please wait a few minutes and try again.</p>`, 429)
  r.headers.set('Retry-After', String(retry))
  return r
}

/** The OAuth provider's defaultHandler: /authorize shows our own login form (backed by D1), then completes the grant. */
export const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const oauth = env.OAUTH_PROVIDER
    try {
      if (url.pathname === '/authorize' && request.method === 'GET') {
        const rl = await rateLimit(env.DB, `authz-get:${await clientKey(request)}`, GET_LIMIT)
        if (!rl.allowed) return tooMany(rl.retryAfterSec)
        return await renderLogin(env, request.url, {})
      }

      if (url.pathname === '/authorize' && request.method === 'POST') {
        const ip = await clientKey(request)
        const rl = await rateLimit(env.DB, `authz-post:${ip}`, POST_LIMIT)
        if (!rl.allowed) {
          await audit(env.DB, { actor: '-', tool: 'auth.rate_limited', ok: false, detail: { ip } })
          return tooMany(rl.retryAfterSec)
        }
        const form = await request.formData()
        const field = (k: string) => (typeof form.get(k) === 'string' ? (form.get(k) as string) : '')
        if (!csrfValid(request, field('csrf'))) {
          await audit(env.DB, { actor: '-', tool: 'auth.csrf', ok: false, detail: { ip } })
          return layout('Request rejected', '<h1>অনুরোধ বাতিল</h1><p class="sub">The form expired or was not submitted from this site. Please start again from your AI app.</p>', 403)
        }
        const handle = field('handle')

        if (field('decision') !== 'approve') {
          const denied = await oauth.denyConsent(request, handle)
          return new Response(null, { status: 302, headers: denied.headers })
        }

        const username = normalizeUsername(field('username'))
        const res = await attemptLogin(env.DB, { username, password: field('password').slice(0, 256), code: field('code') })
        await audit(env.DB, { actor: username || '-', role: res.ok ? res.user.role : null, tool: 'auth.login', ok: res.ok, detail: res.ok ? { ip } : { ip, reason: res.reason } })
        if (!res.ok) {
          // Same page and message for every failure (unknown user, wrong password, wrong code, locked, disabled).
          // A fresh consent handle is issued; the original authorize query is re-validated by the provider.
          return await renderLogin(env, `${url.origin}/authorize${field('authq').startsWith('?') ? field('authq') : ''}`, { username, error: GENERIC }, 401)
        }
        const approved = await oauth.approveConsent(request, handle, { scope: form.getAll('scope').map(String) })
        const { redirectTo } = await oauth.completeAuthorization({
          request: approved.request,
          userId: res.user.id,
          metadata: { login: res.user.username },
          scope: approved.request.scope,
          props: { login: res.user.username, via: 'oauth' },
        })
        const headers = new Headers(approved.headers)
        headers.append('Set-Cookie', `${CSRF_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`)
        headers.set('Location', redirectTo)
        return new Response(null, { status: 302, headers })
      }

      if (url.pathname === '/' || url.pathname === '/health')
        return new Response(url.pathname === '/health' ? 'ok' : 'Seerah Timeline MCP server. Connect an MCP client to /mcp.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      return new Response('Not found', { status: 404 })
    } catch (e) {
      return failure(e)
    }
  },
}
