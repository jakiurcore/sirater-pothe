import { McpServer } from '@modelcontextprotocol/server'
import { getDb } from '@seerah/db'
import type { Actor, Env } from './env'
import type { ToolCtx } from './tools/kit'
import { registerReadTools } from './tools/read'
import { registerEventTools } from './tools/events'
import { registerPlaceTools } from './tools/places'
import { registerContentTools } from './tools/content'
import { registerMediaTools } from './tools/media'
import { registerAdminTools } from './tools/admin'
import { registerPrompts, registerResources } from './resources'

export function buildServer(env: Env, actor: Actor): McpServer {
  const server = new McpServer(
    { name: 'seerah-timeline', version: '0.1.0' },
    { instructions: 'Content server for the Seerah Timeline site. Read the seerah://content-guidelines resource before writing anything. You create drafts; only the owner publishes. Qur\'an text and hadith text are never written by you, only referenced.' },
  )
  const ctx: ToolCtx = { env, db: getDb(env.DB), actor }
  registerReadTools(server, ctx)
  registerEventTools(server, ctx)
  registerPlaceTools(server, ctx)
  registerContentTools(server, ctx)
  registerMediaTools(server, ctx)
  registerAdminTools(server, ctx)
  registerResources(server, ctx)
  registerPrompts(server)
  return server
}
