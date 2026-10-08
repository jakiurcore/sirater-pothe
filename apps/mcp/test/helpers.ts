import { env, exports } from 'cloudflare:workers'
import { getDb, schema as s } from '@seerah/db'
import { sha256Hex } from '../src/util'
import { TOKEN_PREFIX } from '../src/auth/tokens'

export const db = () => getDb(env.DB)

/** Test users. 'stranger' deliberately has no row. */
export async function ensureUser(username: string, role: 'owner' | 'editor', extra: Partial<typeof s.users.$inferInsert> = {}) {
  await db().insert(s.users).values({ id: `u-${username}`, username, passwordHash: 'x', role, ...extra }).onConflictDoNothing()
}

export async function makeToken(login: string, role: 'owner' | 'editor') {
  if (login === 'owner-user' || login === 'editor-user') await ensureUser(login, login === 'owner-user' ? 'owner' : 'editor')
  const token = TOKEN_PREFIX + crypto.randomUUID().replace(/-/g, '')
  await db().insert(s.apiTokens).values({ id: crypto.randomUUID(), tokenHash: await sha256Hex(token), label: 't', role, owner: login, expiresAt: new Date(Date.now() + 86400000).toISOString() })
  return token
}

let rpcId = 1
export async function rpc(token: string | null, method: string, params: unknown = {}) {
  const res = await (exports as unknown as { default: { fetch: typeof fetch } }).default.fetch(new Request(`${env.MCP_ORIGIN}/mcp`, {
    method: 'POST',
    headers: { Host: new URL(env.MCP_ORIGIN).host, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  }))
  const raw = await res.text()
  let body: any = null
  try { body = JSON.parse(raw) } catch { const m = /data: (.*)/.exec(raw); if (m) body = JSON.parse(m[1]!) }
  return { status: res.status, body, raw }
}

export async function call(token: string, name: string, args: unknown) {
  const r = await rpc(token, 'tools/call', { name, arguments: args })
  const result = r.body?.result
  const text: string = result?.content?.[0]?.text ?? r.body?.error?.message ?? r.raw
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { isError: !!result?.isError || !!r.body?.error, text, json, status: r.status }
}

export async function seedEra() {
  await db().insert(s.eras).values({ id: 'era1', slug: 'makkan-early', orderIndex: 1 }).onConflictDoNothing()
  await db().insert(s.eraTranslations).values({ eraId: 'era1', lang: 'bn', title: 'প্রাথমিক মক্কী যুগ' }).onConflictDoNothing()
}
