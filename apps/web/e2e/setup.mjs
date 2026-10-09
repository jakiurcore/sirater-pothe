// Prepares the LOCAL D1 for e2e: migrations + dev seed (published sample events) + a draft event with preview tokens.
// Usage: node e2e/setup.mjs   (from apps/web; wrangler must be installed)
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

/** One-time upload LINK tokens (mode link) for the upload page tests. */
export const UPLOAD = { valid: 'up_e2e_valid_link_token_0123456789abcdefghij', expired: 'up_e2e_expired_link_token_0123456789abcdefgh', used: 'up_e2e_used_link_token_0123456789abcdefghijkl', locked: 'up_e2e_locked_link_token_0123456789abcdefghij' }
export const TOKENS = { valid: 'e2e-valid-preview-token-0123456789', expired: 'e2e-expired-preview-token-0123456789', other: 'e2e-other-event-token-0123456789', long: 'e2e-long-title-preview-token-0123456789', media: 'e2e-media-draft-preview-token-0123456789', site: 'e2e-site-only-preview-token-0123456789', region: 'e2e-region-only-preview-token-0123456789', far: 'e2e-far-site-preview-token-0123456789', nodate: 'e2e-nodate-preview-token-0123456789' }
const h = (t) => createHash('sha256').update(t).digest('hex')
const future = new Date(Date.now() + 24 * 3600e3).toISOString()
const past = new Date(Date.now() - 3600e3).toISOString()

/** Pictures for the gallery fixtures: abstract geometric patterns (no people), distinct sizes and colours. */
export const PICS = [
  { id: 'e2e-pic-hero', w: 1200, h: 675, color: '#2E6A61', placement: 'hero', idx: null, order: 0, alt: 'নকশা: সবুজ জ্যামিতিক প্যাটার্ন (হিরো)', caption: 'হিরো ছবির ক্যাপশন', credit: 'নকশা: পরীক্ষামূলক' },
  { id: 'e2e-pic-sum0', w: 900, h: 450, color: '#6B8F71', placement: 'in_summary', idx: 0, order: 0, alt: 'নকশা: প্রথম অনুচ্ছেদের পরে', caption: 'প্রথম অনুচ্ছেদের পরের ছবি', credit: null },
  { id: 'e2e-pic-summary', w: 1000, h: 500, color: '#B48A3C', placement: 'after_summary', idx: null, order: 0, alt: 'নকশা: সোনালি প্যাটার্ন (সারাংশের পরে)', caption: null, credit: null },
  { id: 'e2e-pic-key0', w: 800, h: 800, color: '#22514A', placement: 'in_key_details', idx: 0, order: 0, alt: 'নকশা: প্রথম বিবরণের পরে', caption: 'প্রথম বিবরণের পরের ছবি', credit: null },
  { id: 'e2e-pic-key2', w: 1000, h: 600, color: '#755819', placement: 'in_key_details', idx: 2, order: 0, alt: 'নকশা: তৃতীয় বিবরণের পরে', caption: null, credit: 'নকশা: পরীক্ষামূলক' },
  { id: 'e2e-pic-lessons', w: 900, h: 450, color: '#9A4B3A', placement: 'before_lessons', idx: null, order: 0, alt: 'নকশা: শিক্ষার আগে', caption: 'শিক্ষার আগের ছবি', credit: null },
  { id: 'e2e-pic-les1', w: 800, h: 500, color: '#4B3A9A', placement: 'in_lessons', idx: 1, order: 0, alt: 'নকশা: দ্বিতীয় শিক্ষার পরে', caption: 'দ্বিতীয় শিক্ষার পরের ছবি', credit: null },
  { id: 'e2e-pic-end', w: 700, h: 350, color: '#3A6B9A', placement: 'end', idx: null, order: 0, alt: 'নকশা: শেষে', caption: null, credit: null },
  { id: 'e2e-pic-gal1', w: 600, h: 400, color: '#5B5047', placement: 'gallery', idx: null, order: 0, alt: 'নকশা: গ্যালারি ১', caption: 'গ্যালারি ১', credit: null },
  { id: 'e2e-pic-gal2', w: 400, h: 600, color: '#8A7D6C', placement: 'gallery', idx: null, order: 1, alt: 'নকশা: গ্যালারি ২ (লম্বা)', caption: null, credit: 'নকশা: পরীক্ষামূলক' },
]
/** Ayat sharing slots with the pictures above (they sort together by order; pictures come first at equal order). */
export const AYAT = [
  { ref: '96:1', placement: 'in_summary', idx: 0, order: 1, note: 'এই আয়াতে প্রথম ওহীর উল্লেখ আছে।' },
  { ref: '105:1', placement: 'in_key_details', idx: 0, order: 1, note: 'এই আয়াতে হাতিবাহিনীর উল্লেখ আছে।' },
  { ref: '9:40', placement: 'in_lessons', idx: 1, order: 1, note: null },
  { ref: '105:2', placement: 'end', idx: null, order: 1, note: 'শেষ কথার সাথে সম্পর্কিত।' },
]
const png = (w, h, color) => sharp({ create: { width: w, height: h, channels: 3, background: color } })
  .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><g fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3"><rect x="${w * 0.3}" y="${h * 0.25}" width="${w * 0.4}" height="${h * 0.5}"/><rect x="${w * 0.3}" y="${h * 0.25}" width="${w * 0.4}" height="${h * 0.5}" transform="rotate(45 ${w / 2} ${h / 2})"/></g></svg>`) }])
  .png().toBuffer()
/** Real media ids are UUIDs (the /media route only accepts those), so the fixtures use fixed UUID-shaped ids. */
export const mediaId = (i, pub) => `e2e0000${i}-0000-4000-a000-00000000000${pub ? 'b' : 'a'}`
const picRows = (eventId, pub) => PICS.map((p, i) => `INSERT INTO media (id, r2_key, kind, mime, bytes, event_id, placement, after_index, order_index, credit, width, height) VALUES ('${mediaId(i, pub)}', 'media/${p.id}.png', 'pattern', 'image/png', 1000, '${eventId}', '${p.placement}', ${p.idx ?? 'NULL'}, ${p.order}, ${p.credit ? `'${p.credit}'` : 'NULL'}, ${p.w}, ${p.h});
INSERT INTO media_alt (media_id, lang, alt, caption) VALUES ('${mediaId(i, pub)}', 'bn', '${p.alt}', ${p.caption ? `'${p.caption}'` : 'NULL'});`).join('\n')
const KD = JSON.stringify(['প্রথম বিবরণ: জমজম কূপের পুনরুদ্ধার।', 'দ্বিতীয় বিবরণ: কূপ খননের স্থান নির্ণয়।', 'তৃতীয় বিবরণ: কূপের পানি নিয়ে মানুষের আগ্রহ।'])
const LS = JSON.stringify(['প্রথম শিক্ষা: ধৈর্য ও অধ্যবসায়ের ফল পাওয়া যায়।', 'দ্বিতীয় শিক্ষা: সত্য একদিন প্রকাশ পায়।', 'তৃতীয় শিক্ষা: আল্লাহর ওপর ভরসা।'])
const SUMMARY = 'এই ঘটনাটি কেবল পরীক্ষার জন্য: একাধিক স্থান ও সব অবস্থানে ছবি ও আয়াত।\n\nদ্বিতীয় অনুচ্ছেদ: ঘটনার পটভূমি।\n\nতৃতীয় অনুচ্ছেদ: ঘটনার ফল।'
const ayatRows = (eventId) => AYAT.map((a) => `INSERT INTO event_ayat (event_id, ayah_id, order_index, placement, after_index) VALUES ('${eventId}', '${a.ref}', ${a.order}, '${a.placement}', ${a.idx ?? 'NULL'});${a.note ? `\nINSERT INTO event_ayat_notes (event_id, ayah_id, lang, note) VALUES ('${eventId}', '${a.ref}', 'bn', '${a.note}');` : ''}`).join('\n')
const fixtureEvent = (id, order, status, extra = '', dates = '-50, 575, 3') => `INSERT INTO events (id, slug, era_id, order_index, hijri_year, gregorian_approx, prophet_age, place_id, certainty, status, needs_verification${status === 'published' ? ', published_at' : ''})
  VALUES ('${id}', '${id}', 'seed-era-childhood-and-youth', ${order}, ${dates}, ${extra || 'NULL'}, 'agreed', '${status}', ${status === 'published' ? 0 : 1}${status === 'published' ? ", '2026-01-01T00:00:00.000Z'" : ''});
INSERT INTO event_translations (event_id, lang, title, summary, key_details, lessons, status)
  VALUES ('${id}', 'bn', 'ছবি ও স্থানের পরীক্ষা (${id})', '${SUMMARY}', '${KD}', '${LS}', '${status === 'published' ? 'published' : 'draft'}');`

const mediaSql = `
DELETE FROM media WHERE id LIKE 'e2e%' OR r2_key LIKE 'media/e2e-pic-%';
DELETE FROM upload_tokens WHERE created_by = 'e2e';
-- local test fixture only: a 4th ayah row (the text is a stand-in copied from 105:1; nothing here ships)
INSERT OR IGNORE INTO ayat (id, surah, ayah, arabic_text, arabic_source) SELECT '105:2', 105, 2, arabic_text, arabic_source FROM ayat WHERE id = '105:1';
DELETE FROM events WHERE id IN ('e2e-media-pub', 'e2e-media', 'e2e-site', 'e2e-region', 'e2e-far', 'e2e-nodate');
${fixtureEvent('e2e-media', 999001, 'draft', "'seed-place-zamzam'")}
INSERT INTO event_places (event_id, place_id, role, order_index) VALUES ('e2e-media', 'seed-place-zamzam', 'primary', 0), ('e2e-media', 'seed-place-masjid-al-haram', 'related', 1), ('e2e-media', 'seed-place-makkah', 'related', 2);
${picRows('e2e-media', false)}
${ayatRows('e2e-media')}
-- The PUBLISHED media fixture reuses the seed event battle-of-badr (so the timeline's event count stays untouched).
UPDATE event_translations SET summary = '${SUMMARY}', key_details = '${KD}', lessons = '${LS}' WHERE event_id = 'seed-event-battle-of-badr' AND lang = 'bn';
DELETE FROM event_ayat WHERE event_id = 'seed-event-battle-of-badr';
DELETE FROM event_places WHERE event_id = 'seed-event-battle-of-badr';
INSERT INTO event_places (event_id, place_id, role, order_index) VALUES ('seed-event-battle-of-badr', 'seed-place-zamzam', 'primary', 0), ('seed-event-battle-of-badr', 'seed-place-masjid-al-haram', 'related', 1), ('seed-event-battle-of-badr', 'seed-place-makkah', 'related', 2);
${PICS.map((p, i) => `INSERT INTO media (id, r2_key, kind, mime, bytes, event_id, placement, after_index, order_index, credit, width, height) VALUES ('${mediaId(i, true)}', 'media/${p.id}-pub.png', 'pattern', 'image/png', 1000, 'seed-event-battle-of-badr', '${p.placement}', ${p.idx ?? 'NULL'}, ${p.order}, ${p.credit ? `'${p.credit}'` : 'NULL'}, ${p.w}, ${p.h});
INSERT INTO media_alt (media_id, lang, alt, caption) VALUES ('${mediaId(i, true)}', 'bn', '${p.alt}', ${p.caption ? `'${p.caption}'` : 'NULL'});`).join('\n')}
${ayatRows('seed-event-battle-of-badr')}
${fixtureEvent('e2e-site', 999003, 'draft', "'seed-place-zamzam'")}
INSERT INTO event_places (event_id, place_id, role, order_index) VALUES ('e2e-site', 'seed-place-zamzam', 'primary', 0);
${fixtureEvent('e2e-far', 999005, 'draft', "'seed-place-badr'")}
INSERT INTO event_places (event_id, place_id, role, order_index) VALUES ('e2e-far', 'seed-place-badr', 'primary', 0);
INSERT INTO preview_tokens (token_hash, event_id, expires_at, created_by) VALUES ('${h(TOKENS.far)}', 'e2e-far', '2099-01-01T12:00:00.000Z', 'e2e');
${fixtureEvent('e2e-nodate', 999006, 'draft', "'seed-place-makkah'", 'NULL, NULL, NULL')}
INSERT INTO event_places (event_id, place_id, role, order_index) VALUES ('e2e-nodate', 'seed-place-makkah', 'primary', 0);
INSERT INTO preview_tokens (token_hash, event_id, expires_at, created_by) VALUES ('${h(TOKENS.nodate)}', 'e2e-nodate', '2099-01-01T12:00:00.000Z', 'e2e');
${fixtureEvent('e2e-region', 999004, 'draft', "'seed-place-banu-sad'")}
INSERT INTO event_places (event_id, place_id, role, order_index) VALUES ('e2e-region', 'seed-place-banu-sad', 'primary', 0);
INSERT INTO upload_tokens (token_hash, mode, created_by, event_id, kind, placement, after_index, alt, expires_at, used_at, attempts) VALUES
  ('${h(UPLOAD.valid)}', 'link', 'e2e', 'e2e-media', 'landscape', 'in_summary', 1, '{"bn":"পরীক্ষামূলক ছবির বর্ণনা","en":"A test picture"}', '2099-01-01T12:00:00.000Z', NULL, 0),
  ('${h(UPLOAD.expired)}', 'link', 'e2e', 'e2e-media', 'landscape', 'hero', NULL, '{"bn":"মেয়াদোত্তীর্ণ"}', '2000-01-01T00:00:00.000Z', NULL, 0),
  ('${h(UPLOAD.used)}', 'link', 'e2e', 'e2e-media', 'landscape', 'hero', NULL, '{"bn":"ব্যবহৃত"}', '2099-01-01T12:00:00.000Z', '2026-01-01T00:00:00.000Z', 1),
  ('${h(UPLOAD.locked)}', 'link', 'e2e', 'e2e-media', 'landscape', 'hero', NULL, '{"bn":"তালাবদ্ধ"}', '2099-01-01T12:00:00.000Z', NULL, 5);
INSERT INTO preview_tokens (token_hash, event_id, expires_at, created_by) VALUES ('${h(TOKENS.media)}', 'e2e-media', '2099-01-01T12:00:00.000Z', 'e2e');
INSERT INTO preview_tokens (token_hash, event_id, expires_at, created_by) VALUES ('${h(TOKENS.site)}', 'e2e-site', '2099-01-01T12:00:00.000Z', 'e2e');
INSERT INTO preview_tokens (token_hash, event_id, expires_at, created_by) VALUES ('${h(TOKENS.region)}', 'e2e-region', '2099-01-01T12:00:00.000Z', 'e2e');
`
const baseSql = `
DELETE FROM preview_tokens WHERE created_by = 'e2e';
DELETE FROM events WHERE id IN ('e2e-draft', 'e2e-long');
INSERT INTO events (id, slug, era_id, order_index, hijri_year, gregorian_approx, prophet_age, place_id, certainty, status, needs_verification)
  VALUES ('e2e-draft', 'e2e-draft', 'seed-era-life-in-madinah', 999999, 3, 625, 55, 'seed-place-uhud', 'agreed', 'draft', 1);
INSERT INTO event_translations (event_id, lang, title, summary, key_details, lessons, status)
  VALUES ('e2e-draft', 'bn', 'খসড়া ঘটনা (পরীক্ষা)', 'এটি কেবল প্রিভিউয়ের জন্য একটি খসড়া।', '[]', '[]', 'draft');
INSERT INTO events (id, slug, era_id, order_index, hijri_year, gregorian_approx, prophet_age, place_id, certainty, status, needs_verification)
  VALUES ('e2e-long', 'e2e-long-title', 'seed-era-life-in-madinah', 999998, 3, 625, 55, 'seed-place-uhud', 'agreed', 'draft', 1);
INSERT INTO event_translations (event_id, lang, title, summary, key_details, lessons, status)
  VALUES ('e2e-long', 'bn', 'আসহাবে সুফ্ফা, মসজিদে নববীর প্রাঙ্গণে জ্ঞানার্জনে নিবেদিত সাহাবীদের অসাধারণ সংগ্রাম ও আত্মত্যাগের বিস্তারিত ইতিহাস', 'দীর্ঘ শিরোনামের পরীক্ষা: যুক্তাক্ষর যেমন ক্ষ, ত্ম, ন্ত্র, স্ক্র, ঙ্ক্ষ, ষ্ট্র, র‍্য, ব্ধ ও দ্ব্য-সহ বাক্য যেন কখনও কাটা না পড়ে এবং ছোট পর্দায় সুন্দরভাবে ভেঙে যায়।', '["অত্যন্ত দীর্ঘ একটি বিষয়বস্তু যার মধ্যে যুক্তাক্ষর রয়েছে: সংস্কৃতি, বিশ্বাস, প্রত্যাশা, ধর্মগ্রন্থ, উজ্জ্বল।"]', '[]', 'draft');
INSERT INTO preview_tokens (token_hash, event_id, expires_at, created_by) VALUES ('${h(TOKENS.long)}', 'e2e-long', '2099-01-01T12:00:00.000Z', 'e2e');
INSERT INTO preview_tokens (token_hash, event_id, expires_at, created_by) VALUES ('${h(TOKENS.valid)}', 'e2e-draft', '${future}', 'e2e');
INSERT INTO preview_tokens (token_hash, event_id, expires_at, created_by) VALUES ('${h(TOKENS.expired)}', 'e2e-draft', '${past}', 'e2e');
INSERT INTO preview_tokens (token_hash, event_id, expires_at, created_by) VALUES ('${h(TOKENS.other)}', 'seed-event-battle-of-badr', '${future}', 'e2e');
`

const sql = baseSql + mediaSql

const run = (...args) => execFileSync('pnpm', ['exec', 'wrangler', ...args], { stdio: 'inherit' })
if (import.meta.url === `file://${process.argv[1]}`) {
  run('d1', 'migrations', 'apply', 'seerah', '--local')
  run('d1', 'execute', 'seerah', '--local', '--file', '../../packages/db/seed/seed.dev.sql')
  const f = join(tmpdir(), 'seerah-e2e.sql')
  writeFileSync(f, sql)
  run('d1', 'execute', 'seerah', '--local', '--file', f)
  for (const t of ['arabia', 'makkah', 'terrain']) run('r2', 'object', 'put', `seerah-tiles/${t}.pmtiles`, '--file', `tiles/${t}.pmtiles`, '--local')
  // Pictures for the gallery fixtures (local R2 "seerah-media"): abstract patterns, no people.
  for (const p of PICS) {
    const file = join(tmpdir(), `${p.id}.png`)
    writeFileSync(file, await png(p.w, p.h, p.color))
    for (const key of [`media/${p.id}.png`, `media/${p.id}-pub.png`]) run('r2', 'object', 'put', `seerah-media/${key}`, '--file', file, '--content-type', 'image/png', '--local')
  }
}
