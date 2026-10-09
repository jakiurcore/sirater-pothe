# PROGRESS

## ⛔ LAUNCH BLOCKERS
1. **Bangla translation licence** (`bn.bengali`, Muhiuddin Khan via Tanzil) is unverified. Kept for development only. Before production: confirm permission in writing, or swap the dataset (`packages/content/data/translation-bn.json` + `datasets.json`). Never ship with `license` still starting `UNVERIFIED`.
2. Seed content and gazetteer coordinates are `needs owner verification` / `verified:false`; owner verifies via MCP. Seed event texts come from the design mock-up (not checked against sources); the production seed has **no citations and no page numbers** (none are invented), so publishing is blocked until the owner adds them. The dev seed (`seed:sql --dev`) publishes them with `(dev placeholder)` citations — LOCAL ONLY, never run against production.
3. Surah names are not shown yet (captions read "কুরআন ১০৫:১"): a 114-name table in Bangla needs owner-verified spelling before it goes in.
4. English and Arabic UI strings (`apps/web/src/messages/en.json`, `ar.json`) were written by the assistant: have a native speaker review them before launch.

## Phase 1 — Monorepo, DB schema, Zod, Qur'an dataset ✅ (2026-10-08)

Done
- pnpm workspace: `apps/web`, `apps/mcp` (empty, phases 2–3), `packages/db`, `packages/content`.
- `packages/db`: Drizzle schema (27 tables, all from the spec plus `place_translations`, `route_translations`, `person_translations`, `ayah_translations`, `media_alt`, `api_tokens`, `content_datasets`) and `migrations/0000_init.sql` (drizzle-kit, applied by wrangler via `migrations_dir`).
- `packages/content`: Zod schemas for every planned tool input, publish gate (`publishBlockers`), ﷺ auto-insertion, Arabia bbox, gazetteer seed (20 places), Qur'an module (`checkRef`, `getAyat`).
- Qur'an: Tanzil Uthmani v1.1 + Bangla (Muhiuddin Khan, `bn.bengali`) downloaded verbatim into `data/source/`, reshaped to JSON by `scripts/build-quran.mjs`, SHA-256 recorded in `data/datasets.json`.
- Tests: 61 (Vitest): dataset ↔ independent 114-surah count table, source checksums, ref validation, rules (no Qur'an/hadith text accepted, no-people media kinds, bbox, dispute, honorific, publish gate), migrations applied to in-memory SQLite (node:sqlite) incl. FK/unique/cascade.

Decisions
- Bismillah check (owner review): the source has it on ayah 1 of 113 surahs (1 and 2–8, 10–114); 9 has none. Build strips 112 (2–8, 10–114, incl. variant spelling in 95/97), keeps 1:1 (it IS the ayah) and 9:1 verbatim; verified against source. An earlier "110" was only an exact-spelling diagnostic.
- Honorific is skipped after *and* before ibn/bin (Muhammad ibn Maslamah, Abdullah ibn Muhammad); tests cover no-doubling and other-Muhammad cases.
- **Tanzil quirk found and fixed**: the plain-text export prepends the Bismillah to ayah 1 of 110 surahs (95 and 97 with a variant mark order). The build strips exactly those four words after verifying they are the Bismillah; a test guards it. Without this, 96:1 would have shown the wrong text.
- Zod 4 (`z.strictObject` for "reject client Qur'an/hadith text", `z.partialRecord` for per-language maps).
- ﷺ is inserted by Zod transforms on every text field written, and will be applied again at render time. Names followed by `ibn/bin/ইবনে/বিন` are skipped (Muhammad ibn Ishaq).
- Hijri years before the Hijrah are negative; year 0 is rejected.
- SVG uploads rejected (script risk). Media limited to 5 MB.
- Drizzle enums are TypeScript-only (SQLite has no enum); Zod is the enforcement layer, DB has FK/unique constraints.
- pnpm 12 needs `allowBuilds` in `pnpm-workspace.yaml` for esbuild/workerd.

Open questions for the owner
1. **Bangla translation licence is unverified.** Tanzil distributes Muhiuddin Khan's translation, but the copyright is the translator's/publisher's, not public domain. It is recorded as `UNVERIFIED` in `datasets.json` and (later) in the DB. Before public launch either confirm permission or swap to a licensed/PD dataset (the loader takes any `{id,name,license,text[][]}`).
2. Gazetteer coordinates are approximate (hudaybiyyah, hunayn, abwa especially); all flagged `verified: false`.
3. Is a Bangla ayah translation required at all in v1, or Arabic-only until licensing is settled?

## Phase 2 — MCP server ✅ (2026-10-08)

Built (`apps/mcp`): OAuth 2.1 provider (originally GitHub upstream login; replaced in Phase 5b by our own D1 login, see below), API tokens (hashed, capped at creator's role, revocable), 29 tools, 3 resources (content-guidelines, schema, timeline outline), prompt `add_event_from_my_notes`, revisions with revert, audit log of every write/failed call.

Tests: 24 integration tests in workerd (real D1/R2/KV via `@cloudflare/vitest-plugin`) calling the Worker over HTTP with bearer tokens: auth (401/403), draft→publish gate (source required, needs_verification gate), disputed note, ayah by reference only (client text rejected, bad ranges), hadith ref-only, editor restrictions, token hash-only storage + revoke, preview token hashing, bbox/[lng,lat] checks, media kind/svg/sniffing rejection, ordering, partial translation update, publish→revert→re-revert refusal, audit log, resources/prompt.
MCP Inspector (official CLI) against `wrangler dev`: tools/list (29), tools/call, resources/list, prompts/list, error text all OK; OAuth discovery docs (`/.well-known/oauth-protected-resource/mcp`) correct.

Decisions
- Stateless `createMcpHandler` (MCP SDK 2.0.0), not deprecated `McpAgent`. `@cloudflare/vitest-plugin` replaces deprecated pool-workers (needs vitest 4 in apps/mcp).
- OAuthProvider built lazily so origins come from env. Hostnames validated by `allowedHostnames`.
- Extra tools: `verify_place`, `list_api_tokens`. Editors cannot publish/unpublish/verify and can only edit drafts.
- Image "no people" rule = kind tag + attestation + magic-byte sniffing (PNG/JPEG/WebP/AVIF; SVG refused). Code cannot detect faces; owner must eyeball uploads.
- Revisions: `before` snapshot is atomic with the change; `after` is filled right after (informational). Revert of a creation deletes the draft only; places/routes/sources can't be un-created.

Not yet verified (needs real credentials, Phase 6): the interactive GitHub login + consent flow end to end.
Local note: port 8787 is used by another app on this machine; use `wrangler dev --port 8799 --var MCP_ORIGIN:http://localhost:8799`.


## Phase 3 — Website ✅ (2026-10-08)

Built `apps/web` (Next 16.3.8 via @opennextjs/cloudflare 1.20.9) from `/design`: home (hero, continue card, era list), timeline (mobile list; desktop split with the list as the left column), event detail (map with fly-to and animated route, meta, certainty badge, ayat Arabic + Bangla with translation source, summary/key points/lessons/hadith/sources, notes, mark-as-read, prev/next), light/dark, reduced motion, logical properties (RTL-ready). Real data from D1 on every request (no rebuild needed after MCP publishes).
Routes: `/[lang]` · `/[lang]/timeline` · `/[lang]/events/[slug]` · `/[lang]/preview/[slug]?token=` · `/[lang]/review|progress` (placeholders until phase 4) · `/[lang]/sitemap.xml` + `/sitemap.xml` index · `/robots.txt` · `/tiles/arabia.pmtiles` (R2, Range) · OG image per event.
Seed: `pnpm --filter @seerah/db seed:sql [--dev]` generates 5 eras, the 20-place gazetteer, 7 approximate routes and 5 sample events (see launch blockers). `pnpm --filter @seerah/web db:local` loads migrations + dev seed + tiles into local D1/R2.

Verification
- Unit: 60 content (incl. new Bangla-inflection honorific tests) + 4 db + 24 mcp + 10 web.
- Playwright e2e (28 = 14 × mobile/desktop) passes against `next dev` AND against the production OpenNext build running in workerd (`opennextjs-cloudflare preview`): reading flow, persistence of read state and notes, resume, theme, timeline, draft invisible (URL, list, sitemap), preview-token rules (valid / expired / other event's token / garbage / missing), SEO, tile Range requests, 404s.
- Visual check against the design with screenshots (mobile 390, desktop 1280, dark).
- Worker size: 2.36 MiB gzip (limit 3 MiB free / 10 MiB paid).

Decisions and findings
- **Bug found and fixed (phase 1 code):** the honorific inserted ﷺ inside inflected Bangla words ("নবীজি ﷺর", doubled with an existing mark). Now the name is matched with the rest of its Bengali word, ﷺ goes after the word; tests added.
- Next 16.4.0 does not work with OpenNext 1.20.9 (`Unexpected loadManifest(preview-props.json)`); pinned Next 16.3.8. Revisit when OpenNext supports 16.4.
- The map is MapLibre + Protomaps PMTiles (34 MB, zoom 0–10, bbox 34,12,60,33) on R2, styled with the design palette; labels are HTML markers so Bangla uses the page fonts. `scripts/build-tiles.sh` rebuilds the file; upload command is in the script header. MapLibre 6's module worker is not bundled correctly by Turbopack, so `scripts/copy-maplibre.mjs` serves it from `public/vendor` (runs in predev/prebuild).
- Map markers are the event's place plus gazetteer places lying on its route (e.g. Thawr on the Hijrah path). Route line is smoothed (Catmull-Rom, like the design) and drawn progressively; the `isra` route is dotted.
- Pages render dynamically (D1 each request) with no ISR cache; tiles are cached hard. Add `Cache-Control` at the edge in phase 5 if load requires.
- Reader state (read, notes, last event) lives behind a `Backend` interface in `lib/store.ts` (localStorage with try/catch + in-memory fallback, cross-tab sync); swap the backend when accounts arrive. The UI says so when storage is unavailable.
- Preview: token hash lookup (SHA-256), expiry and event binding checked before any draft is loaded; every failure renders the same message; `noindex`, `no-referrer`.
- Event translations in other languages fall back to Bangla with a notice; a language only lists events that have a published translation (or Bangla).
- **OG images are Latin-only.** Satori (next/og) can neither shape Bengali nor parse Hind Siliguri/Amiri GSUB tables (`lookupType: 5 - substFormat: 3`), so the card shows "Seerah Timeline", era number and years; the Bangla title is in og:title/description. A proper Bangla card needs a different renderer (e.g. resvg with HarfBuzz shaping in a separate Worker).
- Design deviations: 3D terrain toggle is shown disabled ("শীঘ্রই") exactly as in the design; mobile uses a tab bar, desktop a top bar. Language menu lists only languages that have UI catalogues (Bangla only until phase 4).
- Not done in this phase on purpose: review (spaced repetition) and progress screens (phase 4), real i18n catalogues beyond Bangla (phase 4), CI and deploy (phase 5).

Local run: `pnpm --filter @seerah/web db:local` then `pnpm --filter @seerah/web dev` (port 3000) or `... preview`. If `3000` is taken use `next dev -p 3100`.


## Phase 4 — Progress, notes, recall review, i18n ✅ (2026-10-08)

Built
- **Review (spaced repetition)** at `/[lang]/review`: questions come from the MCP-created `recall_questions` of events the reader has marked read. Wrong answer → tomorrow. Right answer → reader rates Hard / Remembered / Very easy and the next date follows (new card 2/5/12 days, then SM-2-style growth, ease ≥ 1.3, cap 365 days). Button labels are computed by the same function that schedules. Options are shuffled with a stable seed. The queue is fixed when a session starts. A day counts for the streak when a session is completed. Due badge on the tab bar / desktop nav, gold banner on home, done / nothing-due / nothing-yet states.
- **Progress** at `/[lang]/progress`: ring, events and eras done, 7-day streak strip, per-era bars, notes list (newest first, links to the event), and **backup export / import** (JSON, validated like stored data) because everything lives in one browser.
- **Reader store** now also holds SRS cards and review days; every stored value is validated on load (malformed entries are dropped, never trusted). Same `Backend` seam for future accounts.
- **i18n plumbing:** catalogues `bn` (source), `en`, `ar` in `src/messages`; fallback chain requested → en → bn; ICU-style plurals (`{n, plural, one{…} other{…}}`, all six Arabic categories via `Intl.PluralRules`); numbers and percents formatted per locale (Bengali / Arabic-Indic digits); `dir` from the language, layout uses logical properties (verified mirrored in Arabic, no overflow); `/` negotiates language (remembered choice cookie → Accept-Language → Bangla); language menu keeps you on the same page and remembers the choice; sitemaps list only real translations per language and hreflang only real translations; pages that fall back to Bangla text carry a notice, `lang="bn"` on the article, and `noindex`. To add a language: add `src/messages/<code>.json` with the same keys and register it in `lib/i18n.ts` (a test enforces key and placeholder parity and that the Prophet is never named without ﷺ).

Verification
- Unit: 60 content + 4 db + 24 mcp + 29 web (SRS maths incl. month/leap/DST day handling, due list, streak, shuffle, state validation, catalogue parity, plurals, negotiation).
- Playwright e2e **52 passing on both `next dev` and the production OpenNext build in workerd**: review flows (nothing yet, due → badge/banner/review, wrong answer, right answer + rating dates and streak, multi-question session), progress (ring, notes, backup export → clear → import round-trip, bad backups rejected), English and Arabic UI (lang/dir, plural, digits, RTL mirroring, fallback notice + noindex), language negotiation, language menu keeps the theme, sitemaps.
- Visual check against the design (review, progress, Arabic RTL).

Decisions and findings
- **Bug found and fixed:** switching language re-created `<html>` and dropped `data-theme` (dark mode reset). `ThemeSync` re-applies the stored theme after every language change; e2e covers it.
- UI strings that name the Prophet follow the ﷺ rule too (the hero line reads "… রাসূল ﷺ"); the test scans every catalogue with `missingHonorific`.
- Qur'an *translations* from the dataset are shown verbatim (Tanzil's licence forbids changing them), so a translation that names the Prophet is not given an inserted ﷺ; the Arabic is never touched either.
- Review questions have no explanation text or "type" tag (the design mock-up had both): the data model has only question / answer / distractors. The feedback shows the correct answer and a link to the event. If you want explanations, add a `why` field (migration + MCP tool) in a later phase.
- Arabic and English UI strings were written by me and need a native-speaker read before launch (added to launch blockers). Other languages in `SUPPORTED_LANGS` have no UI catalogue yet and fall back to English.
- Mobile keeps the design's placement of the language menu and theme toggle (home screen only); desktop has them in the top bar on every page.
- The theme init script now uses `next/script` (beforeInteractive). React still logs a dev-only "script tag" warning when the language switch re-renders the root layout; harmless in production.


## Phase 5 — production deploy, CI/CD, backups ✅ (2026-10-09)

Resources (account `4e29…3b84`): D1 `seerah`, R2 `seerah-tiles` / `seerah-media` / `seerah-backups`, KV `seerah-oauth`, Workers `seerah-mcp`, `seerah-web`, `seerah-backup` (cron 02:00 UTC, 30-day retention, dump through the D1 binding). Domains come from `DOMAIN` via `scripts/render-wrangler.mjs`. Site is noindex + robots disallow until `INDEXING=on`. Production seed = 5 eras + 20 places (unverified), no events. CI: `.github/workflows/ci.yml`, `preview-cleanup.yml`. Details: `SETUP.md`.

## Phase 5b — own login instead of GitHub; design audit ✅ (2026-10-09)

Auth: `/authorize` is now our login page backed by D1 `users` (migration `0001_users.sql`). workers-oauth-provider is kept for the MCP client side. PBKDF2-SHA256, 100k iterations (Workers maximum; argon2id is not viable on Workers: no runtime WASM compilation, memory cost vs CPU limit), per-user salt, constant-time compare, dummy hash for unknown users. Lockout 5 → 15 min, per-IP rate limit (D1 fixed window), CSRF double-submit `__Host-` cookie, generic error, audit log. Optional TOTP (RFC 6238 vectors tested, replay protection). Accounts only via `pnpm user:*` CLI. Live role/disabled state is re-read from `users` on every MCP request, so `user:disable` cuts off sessions and API tokens immediately. All GitHub code, env vars and secrets removed.

Tests: auth package 11 (hashing, TOTP vectors), mcp 37+ (login flow end to end in workerd: success, same page for wrong/unknown, lockout + expiry, disabled, CSRF ×3, rate limit, TOTP incl. replay, escaping). Caveat: the local runtime does not enforce the Workers production PBKDF2 cap (100,000), so that limit is from Cloudflare's documentation, not from a test here.

Design: see `DESIGN_AUDIT.md`. New Playwright spec `e2e/design.spec.ts` (overflow / 44px / clipping checks, visual snapshots at 390 and 1280, dropdown behaviour).

## Phase 6a — several places per event, site places, media placement ✅ (2026-10-09; deploy: see below)

**Places.** `event_places` (event, place, role primary|related|route_start|route_end, order) replaces the single `events.place_id`. A partial unique index makes a second primary impossible at the database level; `events.place_id` stays as a deprecated mirror of the primary (kept in sync by every MCP write, and the web reads event_places first, `place_id` only as fallback) so a deploy in two steps never shows a blank place. Place types are now `region | city | site`; `parent_place_id` (site → city → region) and an optional `zoom_override`. Default zoom: region 6, city 12, site 17 (`packages/content/src/geo.ts`). Migrations: `0002` schema, `0003` data (moves every `place_id` to a primary row; legacy types → site, with zoom_override cave 15 / mountain 14 / plain, valley, battlefield 13; inserts the two Makkah sites where Makkah exists), `0004` content (the Zamzam event's primary place → `zamzam`, Makkah kept as related; touches only that slug, only while its primary is still Makkah, writes an audit_log row). Migration tests run the real SQL against a copy of the old schema with old-style data (including idempotency and a fresh database).

**Seed sites (all `verified: false`, flagged for the owner).** `masjid-al-haram` (the Kaaba) 21.4225079, 39.826189: OpenStreetMap way 103914569, checked via Nominatim. `zamzam` 21.4220, 39.8260: Wikipedia "Zamzam Well" (only 3 decimals ≈ 100 m) and its own text says "20 m east of the Kaaba", which disagrees with those numbers by ~40 m; I could not get a second source (Overpass was down), so **the owner must verify Zamzam** (`verify_place`). Both are 55–100 m from Makkah's city point, so at zoom 17 all three fit in one view.

**Map.** One place → `flyTo` at its zoom; several places/route → `fitBounds` capped at the primary's zoom; related places are secondary (hollow) markers. Zoom is capped where only coarse tiles exist: the peninsula archive stops at zoom 10, so outside the detailed area the cap is 12 (Badr's override of 13 shows at 12). New `makkah.pmtiles` (bbox 39.70,21.30,40.05,21.55, zoom 0–15, 3.8 MB) adds streets and buildings (drawn in the existing map palette) so a site at zoom 17 has surroundings; Madinah and other cities have no detail archive yet (add an entry to `TILE_DETAIL_AREAS` + `scripts/build-tiles.sh`). Reduced motion: the camera jumps instead of flying. Found and fixed while testing: the pulsing marker ring ignored reduced motion (`::after` was not covered).

**Media placement.** `media.placement` hero | after_summary | in_key_details | before_lessons | gallery (default), `after_key_detail_index` (0-based), `order_index`, plus `credit`, `width`/`height` (read from the file header so space is reserved) and per-language `caption`. Rendered exactly at the placement, identically in preview (same component); lazy images, caption/credit, responsive 360–1440. A new web route `/media/<uuid>` (R2 `MEDIA` binding, read-only) serves a picture only for a published event, or with the event's valid preview token for a draft; everything else is 404 (no id probing). A key-detail index that stops existing (details edited) clamps to the last detail on the page; publishing is blocked until it is fixed, and shrinking the details under a picture is refused on a published event.

**MCP.** New: `add_event_place`, `remove_event_place`, `set_primary_place`, `set_media_placement` (as asked) and two I added because the flows need them: `attach_media` (attach an earlier upload to an event) and `update_place` (owner: type / parent / zoom, e.g. to give an old place a parent). `create_place` takes `type`, `parent_place_slug` (slug, not an id: slugs are the only identifier an AI ever sees) and `zoom`. `get_event` returns every place with role/zoom/parent and every picture with placement. Publishing requires exactly one primary place and valid placements. Pictures and places are part of the revision snapshot, so `revert_revision` restores them and removes orphaned R2 files (reverting a draft's creation deletes its pictures and files too). Resources/guidelines updated.

**Not done / known.** There is still no tool to delete an uploaded picture on its own (revert the upload revision). The migration does not set parents on the 18 older places (use `update_place`). Elephant event is untouched, see the report.

## Phase 6b — map 3D/controls/other places, numerals font, mobile top area ✅ (2026-10-09, deployed)

**Map.** 2D/3D toggle is the design's "মানচিত্র | ভূখণ্ড ৩D" control (the disabled "soon" chip is now live). 3D = MapLibre terrain + hillshade, 55° tilt, rotate/tilt gestures only in 3D. DEM: Mapterhorn terrarium WebP tiles (512 px, built from Copernicus GLO-30), self-hosted as `terrain.pmtiles` (bounds 34,12,60,33, zoom 0–9, 159,562,674 bytes = 152 MiB) in R2 `seerah-tiles`. Licence: Copernicus "full, free and open" licence (redistribution allowed with attribution; the producer credit is in the map attribution while 3D is on); Mapterhorn's code is BSD-3, its tiles carry per-source licences listed in `attribution.json`. Zoom ≤ 9 data is coarse for close-ups (hills are smooth at site zoom); Makkah/Madinah-level DEM at zoom 10–12 would be 1.5 GB for the whole peninsula, so it was not done. Route events fly along the route (20–45 s, bearing follows the path); any press/wheel/touch/key stops it; reduced motion: 3D stays static. 3D is opt-in everywhere (default 2D, which is also the design), the choice is remembered in localStorage (`seerah:map:mode`, try/catch), and the 3D button is disabled when WebGL2 is missing. Controls: + / − / reset-to-event, compass/tilt reset (3D only), 44 px targets, Bangla aria-labels, surface/line styling from the design tokens, light and dark. "Other places" chip (default off): all places from `/api/places` (published events only), clustered with supercluster, labels hidden when they would collide; a tapped marker opens a card (name, type, "যাচাই বাকি" badge, links to its published events). Fixed on the way: pulsing marker ignored reduced motion; MapLibre's white attribution pill ignored dark mode.

**Numerals.** Hind Siliguri's "১" is half the height of the other digits (0.43 em vs 0.64 em of "৬" at 12–14 px) and reads as ৬/৭/a dash. Compared Noto Sans Bengali, Anek Bangla, Baloo Da 2, Tiro Bangla (`design-audit/fonts/font-comparison.png`, light + dark, 12/13/14 px, plus a pixel-similarity measurement): chose **Noto Sans Bengali** (500–700, Bengali glyphs only, Latin falls back to the UI font) via the single variable `--f-meta` and one CSS rule listing the meta selectors (eyebrow, facts row, era labels, counters, timeline meta, progress numbers, banners, badges). Body, serif reading text and headings are unchanged.

**Mobile top area.** In emulation at 360/390/430 (both themes, bn/en/ar) the header never overflowed; real defects fixed: phones in landscape (e.g. 932×430) got the desktop header and split layout (now: desktop layout needs ≥900×520), no `viewport-fit=cover`/safe-area insets, an orphan word in the home title. There is no hamburger in the design, none was added.

**Meta row without dates.** Hidden empty facts; a lineage event with no date shows one "সময়: নির্দিষ্ট সময় নেই" cell (the same label in timeline cards), the place cell stays.

**Test-suite finding.** My earlier "dark" Playwright/audit captures used the wrong localStorage key (`seerah-theme` instead of `seerah:theme`), so they were light mode; fixed and the dark snapshots regenerated.


## Phase 6c — one placement model for ayat and pictures, four upload paths ✅ (2026-10-09, deployed)

**Placement (shared).** One model for ayat and media: `hero | in_summary | after_summary | in_key_details | in_lessons | before_lessons | end | gallery` (gallery = pictures only), `after_index` (0-based; required for the three `in_` ones, null otherwise) and `order` (ayat and pictures share slots; lowest first, pictures before ayat at equal order). One validator (`packages/content/src/placement.ts`) used by every tool and the upload tokens; the error always gives the valid range. The summary is stored as before (one string) and split into paragraphs on blank lines, so nothing needed converting. If an editor later removes the paragraph / key detail / lesson an index pointed at, the page does NOT break: the item shows at the end of that section (an emptied section falls back to the neighbouring fixed slot) and `get_event` / `get_event_layout` list it under `needs_placement_review` (per language). Migration 0005–0007: `event_ayat` gets `placement`, `after_index` (existing rows → `hero` with order 1000+, which is exactly where they rendered, so nothing moved), `event_ayat_notes` (one short sentence per language above the card), `media.after_key_detail_index` → `after_index` (data copied, old column dropped), media licence/author/source/variants/sha256, `upload_tokens`, `upload_sessions`.

**Ayat tools.** `attach_ayah` takes placement / after_index / order / placement_note (default `after_summary`); new `set_ayah_placement` (single ayah or a range like `96:1-5`, note replace/clear). Qur'an text still comes only from the bundled dataset. The page renders ayah cards in the same slots as pictures with the design's card (Arabic RTL in Amiri, translation, surah:ayah) and the note small above it.

**Four ways to add a picture** (all end in one pipeline: size → magic-byte sniff → EXIF/XMP/IPTC/comment strip → rotation baked in or refused → SHA-256 → responsive webp copies → R2 → DB + revision; png/jpeg/webp only, 10 MB, no-people `kind` rule unchanged, everything audited):
1. `upload_media` with `media_url`: server-side download from Wikimedia Commons only (upload.wikimedia.org / commons.wikimedia.org; redirects checked), licence + author + credit from the Commons API, refused unless CC0 / public domain / CC BY / CC BY-SA. `base64` stays for small images.
2. `create_upload_url`: single-use signed PUT URL on the MCP Worker (15 min, 5 attempts, event/kind/placement/alt bound to the token; only the token's hash is stored).
3. `create_upload_link`: 30-minute single-use link to `/<lang>/upload/<token>` on the site, Bangla page (preview, "no people" tick, confirm). Not an admin panel: no login, one file per link.
4. `upload_media_begin / _chunk / _finish`: 32 KiB chunks, per-chunk and whole-file SHA-256, resend on mismatch.
Resizing uses Cloudflare's Images binding (`env.IMAGES`); if it is missing or fails, the stripped original is stored alone (the page still works). Verified in production: 2400×1400 JPEG → 480/960/1600 webp copies, rotated JPEG baked upright.

**MCP context.** New `get_event_layout` (numbered paragraphs / key details / lessons with the first ~80 characters and what is placed after each); guidelines now tell AIs to call it first, pick the slot the item directly supports, explain the choice to the owner before saving, never dump everything in one place, write every field in correct standard Bangla (never Banglish), keep honorifics, and keep `placement_note` to one sentence in the page language; new MCP prompt `place_ayat_and_media`. 42 tools.

**Known limits.** Upload tokens for the link page are created by the tool, so the page is only reachable with a fresh token; the 3D/terrain and other earlier limits are unchanged. `scripts/smoke-live.ts` (needs the owner's login) covers the authenticated paths end to end; `apps/web/scripts/smoke-upload-live.mjs` covers PUT, the page, EXIF stripping and the Images binding without a login.

## Phase 6d — citation locators and list_sources ✅ (2026-10-09, deployed)
- A citation's locator is ONE of: volume + page, page, or chapter/section title (`event_sources.section`, `page` now nullable; migration 0008). Volume alone is not a locator. A `hadith_ref` (collection + number) on the event also satisfies "at least one source".
- Empty or placeholder locators (n/a, tbd, ?, 0, xxx, "(page)", Bangla "অজানা" …, non-numeric "pages") are refused at entry (`add_source_citation`, `attach_hadith_ref`) AND re-checked at publish: a stored citation or hadith ref with a bad locator blocks publishing and does not count as the source.
- New `list_sources` (read access): registered books with author, edition/translator, citation count, optional filter, plus the locator rules. 43 tools.
- Guidelines rule 5 + prompt step 3: never guess a page, volume, section or hadith number; call list_sources, ask the owner only for the locator, wait.
- Live checks: `apps/web/scripts/smoke-sources-live.mjs` (temporary owner token + throw-away draft, all removed afterwards); `pnpm smoke:live` extended (`sourcesGate`, 43 tools).
