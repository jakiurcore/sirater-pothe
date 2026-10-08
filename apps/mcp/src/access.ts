import type { Actor, AuthProps, Env, Role } from './env'
import { csv } from './util'

/**
 * Role is computed live from env on every request, so removing someone from ALLOWED_GITHUB_USERS
 * (or OWNER_GITHUB_USERS) takes effect immediately, even for existing grants and API tokens.
 * Returns null when the user is no longer allowed.
 */
export function resolveActor(env: Env, props: AuthProps): Actor | null {
  const login = props.login.toLowerCase()
  if (!csv(env.ALLOWED_GITHUB_USERS).includes(login)) return null
  const liveRole: Role = csv(env.OWNER_GITHUB_USERS).includes(login) ? 'owner' : 'editor'
  const role: Role = props.tokenRole === 'editor' ? 'editor' : liveRole
  return { login, role, via: props.via }
}
