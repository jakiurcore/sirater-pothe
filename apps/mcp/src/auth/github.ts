import { AuthorizationError, CimdFetchError, authorizationErrorRedirect, type ConsentDescription } from '@cloudflare/workers-oauth-provider'
import type { Env } from '../env'
import { csv } from '../util'

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const page = (title: string, body: string, status = 200, headers?: Headers) => {
  const h = new Headers(headers)
  h.set('Content-Type', 'text/html; charset=utf-8')
  h.set('X-Content-Type-Options', 'nosniff')
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1e1a16;background:#f3ebdd}
button{font:inherit;padding:.6rem 1.2rem;border-radius:.5rem;border:1px solid #2e6a61;background:#2e6a61;color:#fff;cursor:pointer}
button[value=deny]{background:transparent;color:#2e6a61}code{background:#ece2cf;padding:.1rem .3rem;border-radius:.25rem}
@media(prefers-color-scheme:dark){body{background:#0d1524;color:#eee5d1}}</style>${body}`, { status, headers: h })
}

function consentPage(d: ConsentDescription, handle: string): string {
  const origin = d.clientDomain ? `Published by <strong>${esc(d.clientDomain)}</strong>.` : 'This app registered itself; its name is not verified.'
  return `<h1>Allow ${esc(d.clientName)}?</h1>
<p>This lets the app read and write <strong>Seerah Timeline</strong> content on your behalf (drafts, and publishing if you are an owner). ${origin}</p>
<p>After you sign in with GitHub, access is sent to <code>${esc(d.redirectHost)}</code>.</p>
${d.redirectIsLoopback ? '<p><strong>This sends access to an app on your own computer.</strong> Continue only if you just started signing in from it.</p>' : ''}
<form method="post"><input type="hidden" name="handle" value="${esc(handle)}">
${d.scope.map((sc) => `<input type="hidden" name="scope" value="${esc(sc)}">`).join('')}
<p><button name="decision" value="approve">Continue with GitHub</button> <button name="decision" value="deny">Deny</button></p></form>`
}

const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function s256(v: string) { return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))) }

function failure(e: unknown): Response {
  if (e instanceof AuthorizationError) {
    if (e.redirectTo) return Response.redirect(e.redirectTo, 302)
    return page('Authorization error', `<h1>Cannot authorize</h1><p>${esc(e.description ?? 'The request is invalid or has expired.')} Please start again from your AI app.</p>`, 400)
  }
  if (e instanceof CimdFetchError) return page('Authorization error', '<h1>Cannot authorize</h1><p>This app could not be verified.</p>', 400)
  throw e
}

/** The OAuth provider's defaultHandler: /authorize (consent → GitHub) and /callback. */
export const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const oauth = env.OAUTH_PROVIDER
    try {
      if (url.pathname === '/authorize' && request.method === 'GET') {
        const req = await oauth.parseAuthRequest(request)
        const details = await oauth.describeConsent(req)
        const consent = await oauth.beginConsent(req)
        return page('Authorize', consentPage(details, consent.handle), 200, consent.headers)
      }

      if (url.pathname === '/authorize' && request.method === 'POST') {
        const form = await request.formData()
        const handle = String(form.get('handle') ?? '')
        if (form.get('decision') !== 'approve') {
          const denied = await oauth.denyConsent(request, handle)
          return new Response(null, { status: 302, headers: denied.headers })
        }
        const approved = await oauth.approveConsent(request, handle, { scope: form.getAll('scope').map(String) })
        const verifier = crypto.randomUUID() + crypto.randomUUID()
        const { state, headers } = await oauth.beginUpstream(approved.request, { data: { verifier }, headers: approved.headers })
        const gh = new URL('https://github.com/login/oauth/authorize')
        gh.search = new URLSearchParams({
          client_id: env.GITHUB_CLIENT_ID, redirect_uri: `${env.MCP_ORIGIN}/callback`, scope: 'read:user', state,
          code_challenge: await s256(verifier), code_challenge_method: 'S256', allow_signup: 'false',
        }).toString()
        headers.set('Location', gh.toString())
        return new Response(null, { status: 302, headers })
      }

      if (url.pathname === '/callback' && request.method === 'GET') {
        const { request: original, data, headers } = await oauth.finishUpstream<{ verifier: string }>(request)
        const code = url.searchParams.get('code')
        if (url.searchParams.get('error') || !code) {
          headers.set('Location', authorizationErrorRedirect(original, 'access_denied'))
          return new Response(null, { status: 302, headers })
        }
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'seerah-mcp' },
          body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${env.MCP_ORIGIN}/callback`, code_verifier: data.verifier }),
        })
        const tok = (await tokenRes.json()) as { access_token?: string }
        if (!tok.access_token) return page('Sign-in failed', '<h1>GitHub sign-in failed</h1><p>Please start again from your AI app.</p>', 502, headers)
        const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${tok.access_token}`, 'User-Agent': 'seerah-mcp', Accept: 'application/vnd.github+json' } })
        const user = (await userRes.json()) as { login?: string; id?: number }
        if (!user.login) return page('Sign-in failed', '<h1>GitHub sign-in failed</h1>', 502, headers)
        // The GitHub token is only used to learn the username; it is discarded, not stored.
        if (!csv(env.ALLOWED_GITHUB_USERS).includes(user.login.toLowerCase()))
          return page('Not allowed', `<h1>Not allowed</h1><p>The GitHub account <strong>${esc(user.login)}</strong> is not on this server's allow-list.</p>`, 403, headers)
        const { redirectTo } = await oauth.completeAuthorization({
          request: original, userId: user.login.toLowerCase(), metadata: { login: user.login }, scope: original.scope,
          props: { login: user.login, via: 'oauth' },
        })
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
