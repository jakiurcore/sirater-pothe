import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { createMcpHandler } from 'agents/mcp/server'
import type { AuthProps, Env } from './env'
import { resolveActor } from './access'
import { resolveApiToken } from './auth/tokens'
import { defaultHandler } from './auth/login'
import { buildServer } from './server'

const apiHandler = {
  async fetch(request: Request, env: Env, rawCtx: ExecutionContext): Promise<Response> {
    const ctx = rawCtx as ExecutionContext & { props: AuthProps }
    const actor = await resolveActor(env, ctx.props)
    if (!actor) return Response.json({ error: 'forbidden', message: 'This account no longer exists or has been disabled.' }, { status: 403 })
    // Stateless: a fresh server per request, bound to the verified actor. Auth is already done by OAuthProvider.
    return createMcpHandler(() => buildServer(env, actor), { route: '/mcp', corsOptions: false, allowedHostnames: [new URL(env.MCP_ORIGIN).hostname] })(request, env, ctx)
  },
}

// OAuthProvider needs the canonical resource URL at construction, which comes from env, so it is built once per isolate on first request.
let provider: OAuthProvider<Env> | undefined
const build = (env: Env) => {
  const resource = `${env.MCP_ORIGIN.replace(/\/$/, '')}/mcp`
  return new OAuthProvider<Env>({
    apiRoute: '/mcp',
    apiHandler,
    defaultHandler,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    scopesSupported: ['mcp'],
    requiredScopes: ['mcp'],
    resourceMetadata: { resource, authorization_servers: [env.MCP_ORIGIN.replace(/\/$/, '')], resource_name: 'Seerah Timeline content server' },
    clientIdMetadataDocumentEnabled: true,
    // Long-lived API tokens (created with create_api_token) for clients that can only send a header.
    resolveExternalToken: async ({ token, env }) => {
      const props = await resolveApiToken(env as Env, token)
      if (!props) return null
      return { props, audience: resource }
    },
  })
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    provider ??= build(env)
    return provider.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>

