import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'

export interface Env {
  DB: D1Database
  OAUTH_KV: KVNamespace
  MEDIA: R2Bucket
  OAUTH_PROVIDER: OAuthHelpers
  /** Public origins, e.g. https://mcp.example.com and https://example.com (no trailing slash). */
  MCP_ORIGIN: string
  WEB_ORIGIN: string
}

export type Role = 'owner' | 'editor'

/** What the OAuth provider stores with a grant (encrypted) and hands us as ctx.props. */
export interface AuthProps extends Record<string, unknown> {
  login: string
  via: 'oauth' | 'token'
  /** For API tokens: the cap on the role (never above the creator's live role). */
  tokenRole?: Role
  tokenId?: string
}

export interface Actor {
  login: string
  role: Role
  via: 'oauth' | 'token'
}
