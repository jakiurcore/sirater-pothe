import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, '../../packages/db/migrations'))
      return {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ALLOWED_GITHUB_USERS: 'owner-user,editor-user',
            OWNER_GITHUB_USERS: 'owner-user',
            GITHUB_CLIENT_ID: 'test-client',
            GITHUB_CLIENT_SECRET: 'test-secret',
            MCP_ORIGIN: 'http://localhost:8787',
            WEB_ORIGIN: 'https://seerah.test',
          },
        },
      }
    }),
  ],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
})
