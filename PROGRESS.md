# PROGRESS

## Phase 1 — Monorepo, DB schema, Zod, Qur'an dataset ✅ (2026-10-08)

Done
- pnpm workspace: `apps/web`, `apps/mcp` (empty, phases 2–3), `packages/db`, `packages/content`.
- `packages/db`: Drizzle schema (27 tables, all from the spec plus `place_translations`, `route_translations`, `person_translations`, `ayah_translations`, `media_alt`, `api_tokens`, `content_datasets`) and `migrations/0000_init.sql` (drizzle-kit, applied by wrangler via `migrations_dir`).
- `packages/content`: Zod schemas for every planned tool input, publish gate (`publishBlockers`), ﷺ auto-insertion, Arabia bbox, gazetteer seed (20 places), Qur'an module (`checkRef`, `getAyat`).
- Qur'an: Tanzil Uthmani v1.1 + Bangla (Muhiuddin Khan, `bn.bengali`) downloaded verbatim into `data/source/`, reshaped to JSON by `scripts/build-quran.mjs`, SHA-256 recorded in `data/datasets.json`.
- Tests: 61 (Vitest): dataset ↔ independent 114-surah count table, source checksums, ref validation, rules (no Qur'an/hadith text accepted, no-people media kinds, bbox, dispute, honorific, publish gate), migrations applied to in-memory SQLite (node:sqlite) incl. FK/unique/cascade.

Decisions
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
