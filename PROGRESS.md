# PROGRESS

## ⛔ LAUNCH BLOCKERS
1. **Bangla translation licence** (`bn.bengali`, Muhiuddin Khan via Tanzil) is unverified. Kept for development only. Before production: confirm permission in writing, or swap the dataset (`packages/content/data/translation-bn.json` + `datasets.json`). Never ship with `license` still starting `UNVERIFIED`.
2. Seed content and gazetteer coordinates are `needs owner verification` / `verified:false`; owner verifies via MCP.

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

## Phase 2 — MCP server ⏳ IN PROGRESS (usage limit hit mid-phase)

Written, typechecked (not yet tested/run): `apps/mcp/src/*` — OAuthProvider (GitHub login, consent page, allow-list, live role resolution), API tokens (`resolveExternalToken`, hashed in D1), 35 tools (read, event write, place/route, ayah/hadith/source/recall, media, revisions/revert, tokens, publish gate), resources (guidelines, schema, outline), prompt `add_event_from_my_notes`, revision + audit system.

Decisions
- Used stateless `createMcpHandler` (MCP SDK 2.0.0), NOT `McpAgent`: current docs mark McpAgent deprecated/feature-frozen.
- `@cloudflare/vitest-pool-workers` is deprecated → `@cloudflare/vitest-plugin` (needs vitest 4.x in apps/mcp).
- OAuthProvider is built lazily on first request so MCP_ORIGIN comes from env.
- Added tools beyond spec: `verify_place`, `list_api_tokens`. Seed events need `confirm_verified` to publish.
- Image "no people" rule is enforced by kind tag + attestation + content sniffing; code cannot detect faces. Owner must still eyeball uploads.

TODO to finish Phase 2: write Vitest tests (workers pool: tools, role gates, revert, publish gate, token auth, Qur'an-text rejection; check SDK's invalid-input error message is clear and that Zod transforms convert to JSON Schema in tools/list); run MCP Inspector against `wrangler dev` with an API token; fix findings.
