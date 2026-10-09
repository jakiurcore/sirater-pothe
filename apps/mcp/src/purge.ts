import { and, eq, lt, inArray, isNull } from 'drizzle-orm'
import { getDb, schema as s } from '@seerah/db'
import type { Env } from './env'

/** How long a deleted draft can be brought back with revert_revision. */
export const RESTORE_DAYS = 30
const DAY = 86_400_000

type Snap = { event?: { id: string }; media?: { media: { id: string; r2Key: string; variants?: Record<string, string> | null } }[] }
const keysOf = (snap: Snap | null): string[] =>
  (snap?.media ?? []).flatMap((m) => [m.media.r2Key, ...Object.values(m.media.variants ?? {})])

/**
 * Nightly clean-up (cron). Everything here only ever removes data that can no longer be used:
 *  1. deleted drafts older than RESTORE_DAYS that were not restored: their R2 files, and their history (the event is gone for good);
 *     the `delete_draft` revision stays as an audit marker (action → delete_draft_purged, snapshots emptied);
 *  2. expired preview tokens, used/expired upload links, abandoned chunk sessions with their temporary chunks;
 *  3. orphaned R2 pictures: media/<id>… files older than 2 days whose id is in no media row.
 */
export async function purgeDeleted(env: Env, now = new Date()) {
  const db = getDb(env.DB)
  const iso = now.toISOString()
  const out = { drafts: 0, files: 0, orphans: 0, previewTokens: 0, uploadTokens: 0, uploadSessions: 0 }

  const old = await db.select().from(s.revisions).where(and(eq(s.revisions.entity, 'event'), eq(s.revisions.action, 'delete_draft'), isNull(s.revisions.revertedBy), lt(s.revisions.createdAt, new Date(now.getTime() - RESTORE_DAYS * DAY).toISOString())))
  for (const r of old) {
    if (await db.query.events.findFirst({ where: eq(s.events.id, r.entityId) })) {
      await db.update(s.revisions).set({ revertedBy: 'system:purge' }).where(eq(s.revisions.id, r.id)) // the event exists again: nothing to purge
      continue
    }
    const keys = new Set(keysOf(r.beforeJson as Snap | null))
    // Files of pictures removed from the draft earlier belong to older snapshots whose rows are gone: the orphan sweep below takes them.
    const stillUsed = keys.size ? new Set((await db.select({ k: s.media.r2Key }).from(s.media).where(inArray(s.media.r2Key, [...keys]))).map((x) => x.k)) : new Set<string>()
    const del = [...keys].filter((k) => !stillUsed.has(k))
    for (let i = 0; i < del.length; i += 1000) await env.MEDIA.delete(del.slice(i, i + 1000))
    out.files += del.length
    // The event is gone for good: drop its history (text snapshots) and keep one audit marker.
    await db.batch([
      db.delete(s.revisions).where(and(eq(s.revisions.entity, 'event'), eq(s.revisions.entityId, r.entityId))),
      db.insert(s.revisions).values({ id: crypto.randomUUID(), entity: 'event', entityId: r.entityId, action: 'delete_draft_purged', beforeJson: null, afterJson: null, actor: 'system:purge' }),
    ])
    out.drafts++
  }

  out.previewTokens = (await db.delete(s.previewTokens).where(lt(s.previewTokens.expiresAt, iso)).returning({ h: s.previewTokens.tokenHash })).length
  out.uploadTokens = (await db.delete(s.uploadTokens).where(lt(s.uploadTokens.expiresAt, new Date(now.getTime() - DAY).toISOString())).returning({ h: s.uploadTokens.tokenHash })).length
  const dead = await db.delete(s.uploadSessions).where(lt(s.uploadSessions.expiresAt, new Date(now.getTime() - DAY).toISOString())).returning({ id: s.uploadSessions.id })
  for (const d of dead) {
    const l = await env.MEDIA.list({ prefix: `tmp/${d.id}/` })
    if (l.objects.length) await env.MEDIA.delete(l.objects.map((o) => o.key))
  }
  out.uploadSessions = dead.length

  // Orphan sweep: media/<uuid>[-w].ext with no media row, older than 2 days (a fresh upload writes the file just before its row).
  let cursor: string | undefined
  const ids = new Map<string, string[]>()
  do {
    const l = await env.MEDIA.list({ prefix: 'media/', cursor })
    for (const o of l.objects) {
      if (now.getTime() - o.uploaded.getTime() < 2 * DAY) continue
      const m = /^media\/([0-9a-f-]{36})(?:-\d+)?\.[a-z]+$/.exec(o.key)
      if (m) ids.set(m[1]!, [...(ids.get(m[1]!) ?? []), o.key])
    }
    cursor = l.truncated ? l.cursor : undefined
  } while (cursor)
  const all = [...ids.keys()]
  for (let i = 0; i < all.length; i += 80) {
    const part = all.slice(i, i + 80)
    const known = new Set((await db.select({ id: s.media.id }).from(s.media).where(inArray(s.media.id, part))).map((x) => x.id))
    const orphan = part.filter((x) => !known.has(x)).flatMap((x) => ids.get(x)!)
    if (orphan.length) { await env.MEDIA.delete(orphan); out.orphans += orphan.length }
  }
  return out
}
