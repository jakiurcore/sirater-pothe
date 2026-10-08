import type { ConsentDescription } from '@cloudflare/workers-oauth-provider'

export const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Design tokens from /design (light + dark). Fonts load from Google Fonts like the site's next/font set (Hind Siliguri, Noto Serif Bengali). */
const CSS = `
:root{--bg:#F3EBDD;--surface:#FAF6EE;--surface-2:#ECE2CF;--ink:#1E1A16;--ink-2:#5B5047;--ink-3:#8A7D6C;--line:#DCCFB8;--primary:#2E6A61;--primary-strong:#22514A;--primary-tint:#DCE7DF;--on-primary:#FAF6EE;--gold:#B48A3C;--wrong:#9A4B3A;--wrong-tint:#F3DFD6;--pattern-op:.10;--pc:%232E6A61;color-scheme:light}
@media(prefers-color-scheme:dark){:root{--bg:#0D1524;--surface:#142035;--surface-2:#1A2841;--ink:#EEE5D1;--ink-2:#B8AD98;--ink-3:#7F8AA0;--line:#27354F;--primary:#7FBFB2;--primary-strong:#A3D6CA;--primary-tint:#173537;--on-primary:#0D1524;--gold:#D6B46A;--wrong:#E6A08C;--wrong-tint:#3A2323;--pattern-op:.13;--pc:%23D6B46A;color-scheme:dark}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100dvh;background:var(--bg);color:var(--ink);font:400 16px/1.6 'Hind Siliguri','Noto Sans Bengali',system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px}
.pat{position:fixed;inset:0;opacity:var(--pattern-op);pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Cg fill='none' stroke='var(--pc)' stroke-width='1'%3E%3Crect x='14' y='14' width='20' height='20'/%3E%3Crect x='14' y='14' width='20' height='20' transform='rotate(45 24 24)'/%3E%3Cpath d='M0 0l14 14M48 0L34 14M0 48l14-14M48 48L34 34M24 0v10M24 38v10M0 24h10M38 24h10'/%3E%3C/g%3E%3C/svg%3E")}
main{position:relative;width:100%;max-width:420px;background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:24px 20px;display:flex;flex-direction:column;gap:16px}
h1{margin:0;font:600 24px/1.5 'Noto Serif Bengali','Hind Siliguri',serif;color:var(--ink)}
.sub{margin:0;color:var(--ink-2);font-size:15px;line-height:1.6}
.brand{margin:0;color:var(--gold);font:600 13px/1.5 'Hind Siliguri',sans-serif;letter-spacing:.04em}
label{display:flex;flex-direction:column;gap:6px;font:600 15px/1.5 'Hind Siliguri',sans-serif;color:var(--ink)}
label small{font-weight:400;color:var(--ink-3);font-size:13px}
input[type=text],input[type=password]{font:400 17px/1.4 'Hind Siliguri',system-ui,sans-serif;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:14px;min-height:48px;padding:10px 14px;width:100%}
input:focus-visible,button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.btn{min-height:50px;border:0;border-radius:999px;background:var(--primary);color:var(--on-primary);font:600 16px/1 'Hind Siliguri',sans-serif;cursor:pointer;width:100%}
.btn:hover{filter:brightness(1.06)}
.btn.ghost{background:transparent;color:var(--primary);border:1px solid var(--line);min-height:44px}
.err{margin:0;padding:10px 14px;border-radius:14px;background:var(--wrong-tint);color:var(--wrong);font-size:15px;line-height:1.6}
.note{margin:0;color:var(--ink-3);font-size:13px;line-height:1.6}
.row{display:flex;flex-direction:column;gap:10px}
code{background:var(--surface-2);padding:1px 6px;border-radius:6px;font-size:.9em}
`

export function layout(title: string, body: string, status = 200, extra?: Headers): Response {
  const h = new Headers(extra)
  h.set('Content-Type', 'text/html; charset=utf-8')
  h.set('Cache-Control', 'no-store')
  h.set('X-Content-Type-Options', 'nosniff')
  h.set('Referrer-Policy', 'no-referrer')
  h.set('X-Robots-Tag', 'noindex, nofollow')
  h.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; frame-ancestors 'none'; base-uri 'none'")
  return new Response(
    `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600&family=Noto+Serif+Bengali:wght@600&display=swap">
<style>${CSS}</style></head><body><div class="pat" aria-hidden="true"></div><main>${body}</main></body></html>`,
    { status, headers: h },
  )
}

export function loginPage(d: ConsentDescription, o: { handle: string; csrf: string; scope: string[]; authq: string; username?: string; error?: string }, status = 200, headers?: Headers): Response {
  const who = d.clientDomain ? `${esc(d.clientName)} <small>(${esc(d.clientDomain)})</small>` : `${esc(d.clientName)} <small>(unverified app)</small>`
  return layout(
    'সাইন ইন · Sign in',
    `<p class="brand">সীরাতের পথে · Seerah Timeline</p>
<h1>সাইন ইন করুন <br><span style="font-weight:400;font-size:18px;color:var(--ink-2)">Sign in</span></h1>
<p class="sub">${who} আপনার হয়ে কনটেন্ট সার্ভারে পড়তে ও লিখতে চাইছে।<br><span style="color:var(--ink-3)">wants to read and write content on your behalf. After you sign in it is sent to <code>${esc(d.redirectHost)}</code>.</span></p>
${d.redirectIsLoopback ? '<p class="err">এটি আপনার নিজের কম্পিউটারের একটি অ্যাপে অ্যাক্সেস পাঠাবে। / This sends access to an app on your own computer.</p>' : ''}
${o.error ? `<p class="err" role="alert">${esc(o.error)}</p>` : ''}
<form method="post" action="/authorize" class="row" autocomplete="on">
<input type="hidden" name="handle" value="${esc(o.handle)}"><input type="hidden" name="csrf" value="${esc(o.csrf)}"><input type="hidden" name="authq" value="${esc(o.authq)}">
${o.scope.map((sc) => `<input type="hidden" name="scope" value="${esc(sc)}">`).join('')}
<label>ব্যবহারকারীর নাম <small>Username</small><input type="text" name="username" value="${esc(o.username ?? '')}" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="64"></label>
<label>পাসওয়ার্ড <small>Password</small><input type="password" name="password" autocomplete="current-password" required maxlength="256"></label>
<label>ভেরিফিকেশন কোড (২-ফ্যাক্টর চালু থাকলে) <small>Authenticator code (only if 2FA is enabled)</small><input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="8"></label>
<button class="btn" type="submit" name="decision" value="approve">সাইন ইন ও অনুমতি দিন · Sign in &amp; allow</button>
<button class="btn ghost" type="submit" name="decision" value="deny" formnovalidate>বাতিল · Cancel</button>
</form>
<p class="note">নতুন অ্যাকাউন্ট খোলার সুযোগ নেই; অ্যাকাউন্ট কেবল মালিক তৈরি করেন। / There is no sign-up; accounts are created by the owner.</p>`,
    status,
    headers,
  )
}
