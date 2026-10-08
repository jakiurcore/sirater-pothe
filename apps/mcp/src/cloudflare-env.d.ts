import type { Env as AppEnv } from './env'

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: never
    }
  }
}
