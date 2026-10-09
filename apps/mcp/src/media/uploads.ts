import { eq } from 'drizzle-orm'
import { schema as s } from '@seerah/db'
import type { Db } from '@seerah/db'
import { MAX_MEDIA_BYTES } from '@seerah/content'
import type { Env } from '../env'
import { ToolError, nowIso, randomToken, sha256Hex } from '../util'
import { rateLimit, clientKey, audit } from '../auth/guard'
import { ingestImage, sha256Bytes, type IngestMeta } from './ingest'

export const PUT_TTL_MS = 15 * 60_000
export const LINK_TTL_MS = 30 * 60_000
export const MAX_ATTEMPTS = 5
export const CHUNK_SIZE = 32 * 1024
export const SESSION_TTL_MS = 60 * 60_000
export const TOKEN_PREFIX = 'up_'

export interface TokenMeta extends Omit<IngestMeta, 'alt' | 'caption'> {
  alt: Record<string, string | undefined>
  caption?: Record<string, string | undefined>
}

/** Creates a single-use upload credential. Only its SHA-256 is stored; the token itself is shown once. */
export async function createUploadToken(db: Db, o: { mode: 'put' | 'link'; createdBy: string; eventId: string | null; meta: TokenMeta; now?: number }) {
  const token = TOKEN_PREFIX + randomToken(32)
  const expiresAt = new Date((o.now ?? Date.now()) + (o.mode === 'put' ? PUT_TTL_MS : LINK_TTL_MS)).toISOString()
  await db.insert(s.uploadTokens).values({
    tokenHash: await sha256Hex(token), mode: o.mode, createdBy: o.createdBy, eventId: o.eventId, kind: o.meta.kind, placement: o.meta.placement,
    afterIndex: o.meta.after_index ?? null, orderIndex: o.meta.order ?? null, alt: o.meta.alt as Record<string, string>, caption: (o.meta.caption ?? null) as Record<string, string> | null,
    credit: o.meta.credit ?? null, expiresAt,
  })
  return { token, expiresAt }
}

type TokenRow = typeof s.uploadTokens.$inferSelect
export type Claim = { ok: true; row: TokenRow } | { ok: false; reason: 'invalid' | 'used' | 'expired' | 'attempts' }

/** What is wrong with a token, without consuming an attempt (for the upload page and for tests). */
export async function inspectToken(db: Db, token: string, now = Date.now()): Promise<Claim> {
  const row = await db.query.uploadTokens.findFirst({ where: eq(s.uploadTokens.tokenHash, await sha256Hex(token)) })
  if (!row) return { ok: false, reason: 'invalid' }
  if (row.usedAt) return { ok: false, reason: 'used' }
  if (Date.parse(row.expiresAt) <= now) return { ok: false, reason: 'expired' }
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'attempts' }
  return { ok: true, row }
}

/** Atomically takes one attempt on an unused, unexpired token. Two concurrent uploads cannot both pass. */
export async function claimToken(d1: D1Database, token: string, now = Date.now()): Promise<Claim> {
  const hash = await sha256Hex(token)
  const row = await d1.prepare(
    `UPDATE upload_tokens SET attempts = attempts + 1
     WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2 AND attempts < ?3
     RETURNING token_hash AS tokenHash, mode, created_by AS createdBy, event_id AS eventId, kind, placement, after_index AS afterIndex, order_index AS orderIndex,
               alt, caption, credit, expires_at AS expiresAt, used_at AS usedAt, attempts, media_id AS mediaId, created_at AS createdAt`,
  ).bind(hash, new Date(now).toISOString(), MAX_ATTEMPTS).first<Record<string, unknown>>()
  if (!row) return { ok: false, reason: 'invalid' }
  return { ok: true, row: { ...row, alt: JSON.parse(row.alt as string), caption: row.caption ? JSON.parse(row.caption as string) : null } as TokenRow }
}

export const finishToken = (d1: D1Database, token: Promise<string> | string, mediaId: string) =>
  Promise.resolve(token).then(async (t) => d1.prepare('UPDATE upload_tokens SET used_at = ?1, media_id = ?2 WHERE token_hash = ?3').bind(nowIso(), mediaId, await sha256Hex(t)).run())

const metaFromRow = (r: TokenRow): IngestMeta => ({
  kind: r.kind, alt: r.alt, caption: r.caption ?? undefined, credit: r.credit ?? undefined, placement: r.placement as IngestMeta['placement'],
  after_index: r.afterIndex, order: r.orderIndex ?? undefined,
})

/** Only an explicit image/* Content-Type is a claim worth checking; curl's default (form-urlencoded) says nothing about the file. */
const imageTypeOf = (r: Request) => { const t = r.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase(); return t?.startsWith('image/') ? t : undefined }

const json = (o: unknown, status: number, h: HeadersInit = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h } })

/** Reads a request body, refusing more than the limit without buffering it all first. */
export async function readLimited(req: Request, limit = MAX_MEDIA_BYTES): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > limit) throw new ToolError(`The file is ${declared} bytes; the limit is ${limit} (10 MB).`)
  const reader = req.body?.getReader()
  if (!reader) throw new ToolError('Empty request body.')
  const chunks: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    got += value.length
    if (got > limit) { await reader.cancel(); throw new ToolError(`The file is larger than the ${limit}-byte limit (10 MB).`) }
    chunks.push(value)
  }
  const out = new Uint8Array(got)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

/**
 * PUT /upload/<token> on the MCP Worker: the body is the image. Used by `create_upload_url` (curl) and by the site's upload page
 * (cross-origin, so CORS is allowed for the site origin only). The token is the only credential and works once.
 */
export async function handleUpload(request: Request, env: Env, token: string): Promise<Response> {
  const cors: Record<string, string> = { 'Access-Control-Allow-Origin': env.WEB_ORIGIN, Vary: 'Origin' }
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-People-Confirmed', 'Access-Control-Max-Age': '600' } })
  if (request.method !== 'PUT') return json({ ok: false, error: 'Use PUT with the image as the request body.' }, 405, { ...cors, Allow: 'PUT, OPTIONS' })
  const ip = await clientKey(request)
  const rl = await rateLimit(env.DB, `upload:${ip}`, { max: 30, windowMs: 15 * 60_000 })
  if (!rl.allowed) return json({ ok: false, error: 'Too many upload attempts. Wait a few minutes.' }, 429, { ...cors, 'Retry-After': String(rl.retryAfterSec) })
  const db = (await import('@seerah/db')).getDb(env.DB)
  const claim = await claimToken(env.DB, token)
  if (!claim.ok) {
    await audit(env.DB, { actor: '-', tool: 'upload.rejected', ok: false, detail: { ip, reason: claim.reason } })
    return json({ ok: false, error: 'This upload link is invalid, expired or already used. Ask for a new one.' }, 410, cors)
  }
  const row = claim.row
  try {
    if (row.mode === 'link' && request.headers.get('X-People-Confirmed') !== 'no-people')
      return json({ ok: false, error: 'Please confirm that the picture shows no people.' }, 400, cors)
    const bytes = await readLimited(request)
    const user = await db.query.users.findFirst({ where: eq(s.users.username, row.createdBy) })
    if (!user || user.disabledAt) return json({ ok: false, error: 'The account that created this link is no longer active.' }, 403, cors)
    const out = await ingestImage(env, db, { bytes, declaredMime: imageTypeOf(request), meta: metaFromRow(row), eventId: row.eventId, actor: { login: user.username, role: user.role }, via: `upload.${row.mode}` })
    await finishToken(env.DB, token, out.media_id)
    await audit(env.DB, { actor: user.username, role: user.role, tool: `upload.${row.mode}`, ok: true, detail: { media_id: out.media_id, bytes: out.bytes, placement: out.placement } })
    return json({ ok: true, ...out }, 200, cors)
  } catch (e) {
    const message = e instanceof ToolError ? e.message : 'The upload could not be processed.'
    if (!(e instanceof ToolError)) console.error('upload failed', e)
    await audit(env.DB, { actor: row.createdBy, tool: `upload.${row.mode}`, ok: false, detail: { message: message.slice(0, 200) } })
    return json({ ok: false, error: message }, e instanceof ToolError ? 422 : 500, cors)
  }
}

// ───────────── chunked uploads ─────────────
export const chunkKey = (id: string, i: number) => `tmp/${id}/${String(i).padStart(5, '0')}`
export const chunkCount = (total: number) => Math.ceil(total / CHUNK_SIZE)
export { sha256Bytes, rateLimit }
export { SESSION_TTL_MS as _SESSION_TTL }
