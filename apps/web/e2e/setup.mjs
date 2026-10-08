// Prepares the LOCAL D1 for e2e: migrations + dev seed (published sample events) + a draft event with preview tokens.
// Usage: node e2e/setup.mjs   (from apps/web; wrangler must be installed)
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const TOKENS = { valid: 'e2e-valid-preview-token-0123456789', expired: 'e2e-expired-preview-token-0123456789', other: 'e2e-other-event-token-0123456789' }
const h = (t) => createHash('sha256').update(t).digest('hex')
const future = new Date(Date.now() + 24 * 3600e3).toISOString()
const past = new Date(Date.now() - 3600e3).toISOString()

const sql = `
DELETE FROM preview_tokens WHERE created_by = 'e2e';
DELETE FROM events WHERE id = 'e2e-draft';
INSERT INTO events (id, slug, era_id, order_index, hijri_year, gregorian_approx, prophet_age, place_id, certainty, status, needs_verification)
  VALUES ('e2e-draft', 'e2e-draft', 'seed-era-life-in-madinah', 999999, 3, 625, 55, 'seed-place-uhud', 'agreed', 'draft', 1);
INSERT INTO event_translations (event_id, lang, title, summary, key_details, lessons, status)
  VALUES ('e2e-draft', 'bn', 'খসড়া ঘটনা (পরীক্ষা)', 'এটি কেবল প্রিভিউয়ের জন্য একটি খসড়া।', '[]', '[]', 'draft');
INSERT INTO preview_tokens (token_hash, event_id, expires_at, created_by) VALUES ('${h(TOKENS.valid)}', 'e2e-draft', '${future}', 'e2e');
INSERT INTO preview_tokens (token_hash, event_id, expires_at, created_by) VALUES ('${h(TOKENS.expired)}', 'e2e-draft', '${past}', 'e2e');
INSERT INTO preview_tokens (token_hash, event_id, expires_at, created_by) VALUES ('${h(TOKENS.other)}', 'seed-event-battle-of-badr', '${future}', 'e2e');
`

const run = (...args) => execFileSync('pnpm', ['exec', 'wrangler', ...args], { stdio: 'inherit' })
if (import.meta.url === `file://${process.argv[1]}`) {
  run('d1', 'migrations', 'apply', 'seerah', '--local')
  run('d1', 'execute', 'seerah', '--local', '--file', '../../packages/db/seed/seed.dev.sql')
  const f = join(tmpdir(), 'seerah-e2e.sql')
  writeFileSync(f, sql)
  run('d1', 'execute', 'seerah', '--local', '--file', f)
  run('r2', 'object', 'put', 'seerah-tiles/arabia.pmtiles', '--file', 'tiles/arabia.pmtiles', '--local')
}
