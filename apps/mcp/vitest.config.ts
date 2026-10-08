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
            MCP_ORIGIN: 'http://localhost:8787',
            WEB_ORIGIN: 'https://seerah.test',
          },
        },
      }
    }),
  ],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
})
