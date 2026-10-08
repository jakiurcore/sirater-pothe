import type { McpServer } from '@modelcontextprotocol/server'
import type { z } from 'zod'
import { schema as s } from '@seerah/db'
import type { Db } from '@seerah/db'
import type { Actor, Env } from '../env'
import { ToolError } from '../util'

export interface ToolCtx {
  env: Env
  db: Db
  actor: Actor
}

type Access = 'read' | 'write' | 'owner'

interface ToolCfg<S extends z.ZodType> {
  title: string
  description: string
  input: S
  /** read: any signed-in user; write: owner + editor (editors limited to drafts inside the handler); owner: owner only. */
  access: Access
  readOnly?: boolean
  destructive?: boolean
}

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] })

/**
 * Registers a tool with uniform behaviour: role gate, ToolError → isError result the AI can act on,
 * and one audit_log row per call (tool name + outcome only; arguments are never logged because they can
 * contain tokens or base64 media).
 */
export function defineTool<S extends z.ZodType>(
  server: McpServer,
  ctx: ToolCtx,
  name: string,
  cfg: ToolCfg<S>,
  handler: (args: z.infer<S>) => Promise<unknown>,
) {
  server.registerTool(
    name,
    {
      title: cfg.title,
      description: cfg.description + (cfg.access === 'owner' ? ' (Owner only.)' : cfg.access === 'write' ? ' (Editors: drafts only.)' : ''),
      inputSchema: cfg.input as never,
      annotations: { readOnlyHint: cfg.readOnly ?? cfg.access === 'read', destructiveHint: cfg.destructive ?? false, openWorldHint: false },
    },
    (async (args: z.infer<S>) => {
      let ok = true
      let detail: string | null = null
      try {
        if (cfg.access === 'owner' && ctx.actor.role !== 'owner')
          throw new ToolError(`"${name}" is owner-only; you are signed in as an editor. Tell the owner what you prepared (e.g. the preview link) so they can do this.`)
        const result = await handler(args)
        return text(result)
      } catch (e) {
        ok = false
        if (e instanceof ToolError) {
          detail = e.message.slice(0, 300)
          return { ...text(e.message), isError: true }
        }
        detail = 'internal error'
        console.error(`tool ${name} failed`, e)
        return { ...text(`Internal error in ${name}. Nothing was changed if this was a write; try again or tell the owner.`), isError: true }
      } finally {
        if (cfg.access !== 'read' || !ok) {
          try {
            await ctx.db.insert(s.auditLog).values({ actor: ctx.actor.login, role: ctx.actor.role, tool: name, ok, detail })
          } catch (e) { console.error('audit log failed', e) }
        }
      }
    }) as never,
  )
}

/** Editors may only touch draft events. */
export function assertCanEdit(ctx: ToolCtx, status: string, what = 'event') {
  if (ctx.actor.role === 'editor' && status !== 'draft')
    throw new ToolError(`This ${what} is ${status}; editors can only modify drafts. Ask the owner to unpublish it or make the change.`)
}
