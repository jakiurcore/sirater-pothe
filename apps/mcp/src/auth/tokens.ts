import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@seerah/db'
import { schema as s } from '@seerah/db'
import type { AuthProps, Env } from '../env'
import { nowIso, sha256Hex } from '../util'

export const TOKEN_PREFIX = 'sk_seerah_'

/** Looks up a long-lived API token (hash compare). Returns the auth props for the owner, or null. */
export async function resolveApiToken(env: Env, token: string): Promise<AuthProps | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null
  const db = getDb(env.DB)
  const hash = await sha256Hex(token)
  const row = await db.query.apiTokens.findFirst({ where: and(eq(s.apiTokens.tokenHash, hash), isNull(s.apiTokens.revokedAt)) })
  if (!row || row.expiresAt < nowIso()) return null
  await db.update(s.apiTokens).set({ lastUsedAt: nowIso() }).where(eq(s.apiTokens.id, row.id))
  return { login: row.owner, via: 'token', tokenRole: row.role, tokenId: row.id }
}
