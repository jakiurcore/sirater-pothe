#!/usr/bin/env node
/**
 * Live check of list_sources + the citation-locator publish gate against production, without the owner's login:
 * a 10-minute owner API token is inserted into D1 (only its hash), used over /mcp, and deleted together with the
 * throw-away draft zz-smoke-src-delete-me and this run's audit rows.   node apps/web/scripts/smoke-sources-live.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MCP = process.env.MCP ?? 'https://mcp.siraterpotehe.com'
const SLUG = 'zz-smoke-src-delete-me'
const mcpDir = new URL('../../mcp/', import.meta.url).pathname
const token = 'sk_seerah_' + randomBytes(24).toString('hex')
const hash = createHash('sha256').update(token).digest('hex')
const started = new Date().toISOString()
const wr = (a) => execFileSync('pnpm', ['exec', 'wrangler', ...a], { cwd: mcpDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const sql = (q) => { const f = join(tmpdir(), `ss-${process.pid}.sql`); writeFileSync(f, q, { mode: 0o600 }); try { return wr(['d1', 'execute', 'seerah', '--remote', '--yes', '--file', f]) } finally { rmSync(f, { force: true }) } }
let id = 1, failed = 0
const ok = (c, m, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); if (!c) failed++ }
async function tool(name, args) {
  const r = await fetch(`${MCP}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }) })
  const raw = await r.text(); let b; try { b = JSON.parse(raw) } catch { b = JSON.parse(/data: (.*)/.exec(raw)[1]) }
  const text = b.result?.content?.[0]?.text ?? JSON.stringify(b.error ?? b)
  let json = null; try { json = JSON.parse(text) } catch { /* plain text */ }
  return { isError: !!b.result?.isError || !!b.error, text, json }
}
try {
  sql(`INSERT INTO api_tokens (id, token_hash, label, role, owner, expires_at) VALUES ('zz-smoke-src-tok', '${hash}', 'smoke-src', 'owner', 'onset', '${new Date(Date.now() + 600e3).toISOString()}');`)
  const list = await tool('tools/list'.replace('tools/list', 'list_sources'), {})
  ok(!list.isError && Array.isArray(list.json?.sources), 'list_sources works in production', list.isError ? list.text : `(${list.json.sources.length} books: ${list.json.sources.map((x) => `${x.slug}${x.edition ? ' [' + x.edition + ']' : ''}`).join(', ') || 'none registered yet'})`)
  ok(/Never guess/.test(list.json?.locator_rules ?? ''), 'it carries the locator rules')
  const c = await tool('create_event_draft', { slug: SLUG, era_slug: 'prophethood-in-makkah', hijri_year: -10, place_slug: 'zamzam', translation: { lang: 'bn', title: 'স্মোক টেস্ট: সূত্র (মুছে ফেলা হবে)', summary: 'এটি স্বয়ংক্রিয় পরীক্ষার খসড়া।' } })
  ok(!c.isError, 'throw-away draft created', c.isError ? c.text.slice(0, 200) : '')
  // a book to cite: register a temporary one if the owner has none (removed afterwards)
  let book = list.json.sources[0]?.slug, tempBook = false
  if (!book) { book = 'zz-smoke-book'; tempBook = true; ok(!(await tool('create_source', { slug: book, book: 'স্মোক বই', author: 'লেখক', edition: 'সংস্করণ' })).isError, 'temporary book registered') }
  await tool('set_certainty', { slug: SLUG, certainty: 'agreed' })
  const noSrc = await tool('publish_event', { slug: SLUG, confirm_verified: true })
  ok(noSrc.isError && /At least one source/.test(noSrc.text) && /list_sources/.test(noSrc.text), 'publishing without a source is blocked, message points to list_sources')
  for (const bad of [{ page: 'n/a' }, { page: 'TBD' }, { page: '0' }, { page: '?' }, { volume: '1' }, {}]) {
    const r = await tool('add_source_citation', { event_slug: SLUG, source_slug: book, ...bad })
    ok(r.isError, `locator ${JSON.stringify(bad)} refused`, r.isError ? '' : 'ACCEPTED!')
  }
  ok(/never guess/i.test((await tool('add_source_citation', { event_slug: SLUG, source_slug: book })).text), 'the refusal tells the AI never to guess')
  ok(!(await tool('add_source_citation', { event_slug: SLUG, source_slug: book, section: 'পরীক্ষামূলক অধ্যায়ের শিরোনাম' })).isError, 'chapter/section title accepted')
  ok(!(await tool('add_source_citation', { event_slug: SLUG, source_slug: book, volume: '2', page: '15-17' })).isError, 'volume + page range accepted')
  const ev = await tool('get_event', { slug: SLUG })
  ok(ev.json?.sources?.length === 2 && ev.json.sources.some((x) => x.section) && ev.json.sources.some((x) => x.page === '15-17'), 'get_event shows both citations with section / page')
  ok(!ev.json?.publish_blockers?.some((b) => /source/i.test(b)), 'no source blocker remains', JSON.stringify(ev.json?.publish_blockers))
  const h = await tool('attach_hadith_ref', { event_slug: SLUG, collection: 'Sahih al-Bukhari', number: 'tbd', grading: 'Sahih' })
  ok(h.isError, 'placeholder hadith number refused')
} finally {
  try {
    sql(`DELETE FROM event_sources WHERE event_id IN (SELECT id FROM events WHERE slug = '${SLUG}');
DELETE FROM event_translations WHERE event_id IN (SELECT id FROM events WHERE slug = '${SLUG}');
DELETE FROM event_places WHERE event_id IN (SELECT id FROM events WHERE slug = '${SLUG}');
DELETE FROM revisions WHERE created_at >= '${started}' AND (entity_id IN (SELECT id FROM events WHERE slug = '${SLUG}') OR entity = 'source');
DELETE FROM events WHERE slug = '${SLUG}';
DELETE FROM sources WHERE slug = 'zz-smoke-book';
DELETE FROM api_tokens WHERE id = 'zz-smoke-src-tok';
DELETE FROM audit_log WHERE created_at >= '${started}' AND actor = 'onset';`)
    const left = wr(['d1', 'execute', 'seerah', '--remote', '--command', `SELECT (SELECT count(*) FROM events WHERE slug LIKE 'zz-%') e, (SELECT count(*) FROM api_tokens WHERE id LIKE 'zz-%') t, (SELECT count(*) FROM sources WHERE slug LIKE 'zz-%') s, (SELECT count(*) FROM events) total, (SELECT count(*) FROM event_sources) cites;`])
    console.log('\ncleanup:', ['e', 't', 's'].every((k) => new RegExp(`"${k}":\\s*0\\b`).test(left)) ? `clean. ${/"total":\s*(\d+)/.exec(left)?.[1]} events, ${/"cites":\s*(\d+)/.exec(left)?.[1]} citations remain` : 'CHECK LEFTOVERS\n' + left)
  } catch (e) { console.error('CLEANUP FAILED: remove zz-smoke-src-* rows and the token manually', e.message) }
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
