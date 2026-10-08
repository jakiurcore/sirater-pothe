import { defineConfig } from 'drizzle-kit'

// SQL files land in ./migrations, which wrangler applies via `migrations_dir` (wrangler d1 migrations apply).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './migrations',
})
