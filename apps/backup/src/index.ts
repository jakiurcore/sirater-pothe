/**
 * Nightly D1 backup. Reads every table through the D1 binding (no API token needed), writes one gzipped
 * JSON-lines file per night to R2 (d1/YYYY-MM-DD.jsonl.gz) and deletes backups older than RETENTION_DAYS.
 *
 * Line format: {"table":"events","rows":[{...},...]} per page, preceded by one {"schema":[sql...]} line,
 * so a restore can recreate tables (migrations also do) and re-insert rows.
 */
export interface Env {
  DB: D1Database
  BACKUPS: R2Bucket
  RETENTION_DAYS?: string
}

const PREFIX = 'd1/'
const PAGE = 500

export const backupKey = (d: Date) => `${PREFIX}${d.toISOString().slice(0, 10)}.jsonl.gz`

/** Keys whose date (from the file name) is older than `days` days before `now`. Unparseable names are never deleted. */
export function expiredKeys(keys: string[], now: Date, days: number): string[] {
  const cutoff = now.getTime() - days * 86_400_000
  return keys.filter((k) => {
    const m = /^d1\/(\d{4}-\d{2}-\d{2})\.jsonl\.gz$/.exec(k)
    if (!m) return false
    return Date.parse(`${m[1]}T00:00:00Z`) < cutoff
  })
}

async function* dump(db: D1Database): AsyncGenerator<string> {
  const objs = await db.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type DESC, name").all<{ name: string; sql: string }>()
  yield JSON.stringify({ schema: objs.results.map((o) => o.sql) }) + '\n'
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all<{ name: string }>()
  for (const { name } of tables.results) {
    if (!/^[A-Za-z0-9_]+$/.test(name)) continue
    for (let offset = 0; ; offset += PAGE) {
      const page = await db.prepare(`SELECT * FROM "${name}" ORDER BY rowid LIMIT ${PAGE} OFFSET ${offset}`).all()
      if (page.results.length === 0) break
      yield JSON.stringify({ table: name, rows: page.results }) + '\n'
      if (page.results.length < PAGE) break
    }
  }
}

export async function runBackup(env: Env, now = new Date()): Promise<{ key: string; deleted: string[] }> {
  const enc = new TextEncoder()
  const gen = dump(env.DB)
  const source = new ReadableStream<Uint8Array>({
    async pull(c) {
      const { value, done } = await gen.next()
      if (done) c.close()
      else c.enqueue(enc.encode(value))
    },
  })
  const gz = source.pipeThrough(new CompressionStream('gzip'))
  // R2 needs a known length for a stream: buffer the (small) compressed result.
  const body = await new Response(gz).arrayBuffer()
  const key = backupKey(now)
  await env.BACKUPS.put(key, body, { httpMetadata: { contentType: 'application/gzip' }, customMetadata: { createdAt: now.toISOString() } })

  const days = Number(env.RETENTION_DAYS ?? 30)
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const l = await env.BACKUPS.list({ prefix: PREFIX, cursor })
    keys.push(...l.objects.map((o) => o.key))
    cursor = l.truncated ? l.cursor : undefined
  } while (cursor)
  const deleted = expiredKeys(keys, now, days)
  if (deleted.length) await env.BACKUPS.delete(deleted)
  return { key, deleted }
}

export default {
  async scheduled(_ev, env, ctx) {
    ctx.waitUntil(runBackup(env).then((r) => console.log(JSON.stringify({ backup: r.key, deleted: r.deleted.length }))))
  },
} satisfies ExportedHandler<Env>
