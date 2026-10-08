import { eq, sql } from 'drizzle-orm'
import { getDb, schema as s } from '@seerah/db'
import { dummyHash, timingSafeEqual, verifyPassword } from '@seerah/auth/password'
import { verifyTotp } from '@seerah/auth/totp'
import type { Role } from '../env'
import { nowIso, sha256Hex } from '../util'

export const MAX_FAILED = 5
export const LOCK_MS = 15 * 60_000
export const POST_LIMIT = { max: 10, windowMs: 15 * 60_000 }
export const GET_LIMIT = { max: 60, windowMs: 15 * 60_000 }

export type LoginFailure = 'unknown_user' | 'disabled' | 'locked' | 'bad_password' | 'bad_totp'
export type LoginResult = { ok: true; user: { id: string; username: string; role: Role } } | { ok: false; reason: LoginFailure }

/** Fixed-window counter in D1. Returns whether this request is still within the limit. */
export async function rateLimit(db: D1Database, key: string, limit: { max: number; windowMs: number }, now = Date.now()): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const windowStart = Math.floor(now / limit.windowMs) * limit.windowMs
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start < ?2 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start < ?2 THEN ?2 ELSE window_start END
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>()
  if (row?.count === 1) await db.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(now - 86_400_000).run()
  return { allowed: (row?.count ?? 1) <= limit.max, retryAfterSec: Math.max(1, Math.ceil((windowStart + limit.windowMs - now) / 1000)) }
}

export const clientKey = async (request: Request) =>
  (await sha256Hex(request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown')).slice(0, 24)

export const normalizeUsername = (u: string) => u.trim().toLowerCase().slice(0, 64)

/** Verifies username + password (+ TOTP when the account has it), with lockout. Always spends a password hash's worth of time. */
export async function attemptLogin(
  d1: D1Database,
  input: { username: string; password: string; code?: string },
  now = Date.now(),
): Promise<LoginResult> {
  const db = getDb(d1)
  const username = normalizeUsername(input.username)
  const user = username ? await db.query.users.findFirst({ where: eq(s.users.username, username) }) : undefined
  const fail = async (reason: LoginFailure): Promise<LoginResult> => {
    await verifyPassword(input.password, await dummyHash()) // equalise timing for unknown / locked / disabled accounts
    return { ok: false, reason }
  }
  if (!user) return fail('unknown_user')
  if (user.disabledAt) return fail('disabled')
  if (user.lockedUntil && Date.parse(user.lockedUntil) > now) return fail('locked')

  const passwordOk = await verifyPassword(input.password, user.passwordHash)
  let totpStep: number | null = null
  if (passwordOk && user.totpSecret) totpStep = await verifyTotp(user.totpSecret, input.code ?? '', now, user.totpLastStep ?? -1)
  const ok = passwordOk && (!user.totpSecret || totpStep !== null)

  if (!ok) {
    // Atomic increment; at MAX_FAILED the account locks and the counter restarts for the next window.
    await db.run(sql`UPDATE users SET
      failed_attempts = CASE WHEN failed_attempts + 1 >= ${MAX_FAILED} THEN 0 ELSE failed_attempts + 1 END,
      locked_until = CASE WHEN failed_attempts + 1 >= ${MAX_FAILED} THEN ${new Date(now + LOCK_MS).toISOString()} ELSE locked_until END
      WHERE id = ${user.id}`)
    return { ok: false, reason: passwordOk ? 'bad_totp' : 'bad_password' }
  }
  await db.update(s.users).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(now).toISOString(), ...(totpStep !== null ? { totpLastStep: totpStep } : {}) }).where(eq(s.users.id, user.id))
  return { ok: true, user: { id: user.id, username: user.username, role: user.role } }
}

// ── CSRF: double-submit token. The cookie is __Host- prefixed (Secure, Path=/, no Domain), HttpOnly, SameSite=Strict. ──
export const CSRF_COOKIE = '__Host-seerah_csrf'
export const newCsrf = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
export const csrfCookie = (token: string) => `${CSRF_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=900`

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

export function csrfValid(request: Request, formToken: string | null): boolean {
  const cookie = readCookie(request, CSRF_COOKIE)
  if (!cookie || !formToken || cookie.length < 32) return false
  const enc = new TextEncoder()
  return timingSafeEqual(enc.encode(cookie), enc.encode(formToken))
}

export async function audit(d1: D1Database, e: { actor: string; role?: string | null; tool: string; ok: boolean; detail?: unknown }) {
  try {
    await getDb(d1).insert(s.auditLog).values({ actor: e.actor.slice(0, 64) || '-', role: e.role ?? null, tool: e.tool, ok: e.ok, detail: e.detail === undefined ? null : JSON.stringify(e.detail), createdAt: nowIso() })
  } catch (err) {
    console.error('audit failed', err) // never block or leak on audit failure
  }
}
