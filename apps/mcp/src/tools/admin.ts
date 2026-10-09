import { z } from 'zod'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/server'
import { schema as s } from '@seerah/db'
import { CreateApiTokenSchema, SlugSchema } from '@seerah/content'
import { defineTool, type ToolCtx } from './kit'
import { loadSnapshot, restoreEventStatements, restoreStatements, eventBySlug, type Entity } from '../data'
import { RESTORE_DAYS } from '../purge'
import { TOKEN_PREFIX } from '../auth/tokens'
import { ToolError, nowIso, randomToken, sha256Hex, uuid } from '../util'

const ENTITIES = ['event', 'place', 'route', 'source'] as const

const slugOf = (entity: string, snap: any): string | null =>
  !snap ? null : entity === 'event' ? snap.event?.slug : entity === 'place' ? snap.place?.slug : entity === 'route' ? snap.route?.slug : snap.slug ?? null

export function registerAdminTools(server: McpServer, ctx: ToolCtx) {
  const { db, actor } = ctx

  defineTool(server, ctx, 'list_revisions', {
    title: 'List revisions', description: 'Recent changes (newest first), optionally for one event. Each has a revision_id for revert_revision.', access: 'read',
    input: z.object({ event_slug: SlugSchema.optional(), entity: z.enum(ENTITIES).optional(), limit: z.number().int().min(1).max(100).default(20) }),
  }, async ({ event_slug, entity, limit }) => {
    const where = []
    if (event_slug) where.push(eq(s.revisions.entity, 'event'), eq(s.revisions.entityId, (await eventBySlug(db, event_slug)).id))
    else if (entity) where.push(eq(s.revisions.entity, entity))
    const rows = await db.select().from(s.revisions).where(where.length ? and(...where) : undefined).orderBy(desc(s.revisions.createdAt), desc(s.revisions.id)).limit(limit)
    return {
      revisions: rows.map((r) => ({
        revision_id: r.id, entity: r.entity, slug: slugOf(r.entity, r.afterJson ?? r.beforeJson), action: r.action, actor: r.actor, at: r.createdAt,
        reverted_by: r.revertedBy ?? undefined,
      })),
    }
  })

  const dropFiles = async (keys: string[]) => {
    if (keys.length) await ctx.env.MEDIA.delete(keys)
  }

  defineTool(server, ctx, 'revert_revision', {
    title: 'Revert revision',
    description: 'Undo one change by restoring the state before it (for an event: its fields, translations, citations, ayat, hadith, questions, places and pictures). Reverting a creation deletes the draft. Writes a new revision, so a revert can itself be reverted. Owner only unless both the current and the restored state are drafts.',
    access: 'write', destructive: true,
    input: z.object({ revision_id: z.string().min(8).max(64) }),
  }, async ({ revision_id }) => {
    const rev = await db.query.revisions.findFirst({ where: eq(s.revisions.id, revision_id) })
    if (!rev) throw new ToolError(`No revision "${revision_id}". Use list_revisions.`)
    if (rev.revertedBy) throw new ToolError(`That revision was already reverted by ${rev.revertedBy}.`)
    if (rev.action === 'revert') throw new ToolError('To undo a revert, revert the revert\'s own earlier change: use list_revisions and pick the original revision.')
    const entity = rev.entity as Entity
    const current: any = await loadSnapshot(db, entity, rev.entityId)
    const before: any = rev.beforeJson
    const draftish = (snap: any) => entity !== 'event' || !snap || snap.event?.status === 'draft'
    if (actor.role !== 'owner' && !(draftish(current) && draftish(before)))
      throw new ToolError('Only the owner can revert changes that touch a published event. Ask the owner.')
    const newRev = uuid()
    if (!before) {
      // Revert of a creation: delete the entity, only while it is an unpublished draft.
      if (!current) throw new ToolError('That item no longer exists.')
      if (entity === 'event' && current.event.status !== 'draft') throw new ToolError(`"${current.event.slug}" is ${current.event.status}; unpublish it before reverting its creation.`)
      if (entity !== 'event') throw new ToolError(`Reverting the creation of a ${entity} is not supported (other items may reference it).`)
      await db.batch([
        db.insert(s.revisions).values({ id: newRev, entity, entityId: rev.entityId, action: 'revert', beforeJson: current, afterJson: null, actor: actor.login }),
        db.update(s.revisions).set({ revertedBy: actor.login }).where(eq(s.revisions.id, rev.id)),
        db.delete(s.media).where(eq(s.media.eventId, rev.entityId)), // the draft's pictures go with it (media_alt cascades)
        db.delete(s.events).where(eq(s.events.id, rev.entityId)),
      ])
      await dropFiles((current.media ?? []).map((m: any) => m.media.r2Key))
      return { ok: true, reverted: rev.id, result: 'deleted draft event', revision_id: newRev }
    }
    if (!current && entity === 'event' && rev.action === 'delete_draft' && before) {
      // Restore a deleted draft (delete_draft): owner only, within RESTORE_DAYS, if its slug is still free.
      if (actor.role !== 'owner') throw new ToolError('Only the owner can restore a deleted draft.')
      if (Date.now() - Date.parse(rev.createdAt) > RESTORE_DAYS * 86_400_000) throw new ToolError(`This draft was deleted more than ${RESTORE_DAYS} days ago and has been purged.`)
      if (await db.query.events.findFirst({ where: eq(s.events.slug, before.event.slug) })) throw new ToolError(`An event with the slug "${before.event.slug}" exists now; rename or remove it first.`)
      await db.batch([
        db.insert(s.revisions).values({ id: newRev, entity, entityId: rev.entityId, action: 'revert', beforeJson: null, afterJson: before, actor: actor.login }),
        db.update(s.revisions).set({ revertedBy: actor.login }).where(eq(s.revisions.id, rev.id)),
        ...restoreEventStatements(db, before, true),
      ] as never)
      return { ok: true, reverted: rev.id, result: `restored draft "${before.event.slug}" with its text, sources, ayat, places, questions and ${before.media?.length ?? 0} picture(s)`, revision_id: newRev }
    }
    if (!current) throw new ToolError('That item no longer exists, so there is nothing to restore into.')
    await db.batch([
      db.insert(s.revisions).values({ id: newRev, entity, entityId: rev.entityId, action: 'revert', beforeJson: current, afterJson: before, actor: actor.login }),
      db.update(s.revisions).set({ revertedBy: actor.login }).where(eq(s.revisions.id, rev.id)),
      ...restoreStatements(db, entity, before),
    ] as never)
    if (entity === 'event' && before.media !== undefined) {
      // Pictures that existed after the change but not before it are gone from the database: remove their files too.
      const keep = new Set(before.media.map((m: any) => m.media.r2Key))
      await dropFiles((current.media ?? []).map((m: any) => m.media.r2Key).filter((k: string) => !keep.has(k)))
    }
    return { ok: true, reverted: rev.id, restored_to: `state before "${rev.action}" by ${rev.actor} at ${rev.createdAt}`, revision_id: newRev }
  })

  defineTool(server, ctx, 'create_api_token', {
    title: 'Create API token',
    description: 'Create a long-lived API token for clients that cannot do OAuth (send as "Authorization: Bearer <token>"). The token is shown ONCE. A token can never exceed your own role, and stops working if you are removed from the allow-list.',
    access: 'write', readOnly: false,
    input: CreateApiTokenSchema,
  }, async (a) => {
    if (a.role === 'owner' && actor.role !== 'owner') throw new ToolError('Editors can only create editor tokens.')
    const token = TOKEN_PREFIX + randomToken(32)
    const id = uuid()
    const expires = new Date(Date.now() + a.expires_in_days * 86_400_000).toISOString()
    await db.insert(s.apiTokens).values({ id, tokenHash: await sha256Hex(token), label: a.label, role: a.role, owner: actor.login, expiresAt: expires })
    return { token_id: id, token, role: a.role, expires_at: expires, warning: 'Store this token now; it cannot be shown again.' }
  })

  defineTool(server, ctx, 'list_api_tokens', {
    title: 'List API tokens', description: 'Your API tokens (all tokens for the owner). Secrets are never shown.', access: 'read',
    input: z.object({}),
  }, async () => {
    const rows = await db.select().from(s.apiTokens).where(actor.role === 'owner' ? undefined : eq(s.apiTokens.owner, actor.login))
    return { tokens: rows.map((t) => ({ token_id: t.id, label: t.label, role: t.role, owner: t.owner, expires_at: t.expiresAt, revoked: !!t.revokedAt, last_used_at: t.lastUsedAt })) }
  })

  defineTool(server, ctx, 'revoke_api_token', {
    title: 'Revoke API token', description: 'Immediately disable an API token. The owner can revoke any token; editors only their own.', access: 'write', destructive: true,
    input: z.object({ token_id: z.string().min(8).max(64) }),
  }, async ({ token_id }) => {
    const t = await db.query.apiTokens.findFirst({ where: eq(s.apiTokens.id, token_id) })
    if (!t || (actor.role !== 'owner' && t.owner !== actor.login)) throw new ToolError('No such token (use list_api_tokens).')
    if (t.revokedAt) return { ok: true, note: 'already revoked' }
    await db.update(s.apiTokens).set({ revokedAt: nowIso() }).where(and(eq(s.apiTokens.id, token_id), isNull(s.apiTokens.revokedAt)))
    return { ok: true, token_id, revoked: true }
  })
}
