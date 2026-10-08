import { eq } from 'drizzle-orm'
import { getDb, schema as s } from '@seerah/db'
import type { Actor, AuthProps, Env, Role } from './env'

/**
 * The actor behind a grant or API token, resolved live from the `users` table on every request: disabling a user
 * (`pnpm user:disable`) or changing their role takes effect immediately, for existing OAuth grants and API tokens alike.
 * Returns null when the user no longer exists or is disabled.
 */
export async function resolveActor(env: Env, props: AuthProps): Promise<Actor | null> {
  const user = await getDb(env.DB).query.users.findFirst({ where: eq(s.users.username, props.login.toLowerCase()) })
  if (!user || user.disabledAt) return null
  const role: Role = props.tokenRole === 'editor' ? 'editor' : user.role
  return { login: user.username, role, via: props.via }
}
