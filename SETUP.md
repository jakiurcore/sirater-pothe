# Setup and deployment

Nothing domain-specific is committed. Domains come from the environment (`DOMAIN`, optionally `MCP_DOMAIN`), and
`scripts/render-wrangler.mjs` renders `apps/*/wrangler.deploy.jsonc` (git-ignored) from the committed `wrangler.jsonc` files.

## Cloudflare resources (created once)

| Resource | Name | Used by |
|---|---|---|
| D1 database | `seerah` (id in `apps/*/wrangler.jsonc`) | web, mcp, backup |
| R2 bucket | `seerah-tiles` (`arabia.pmtiles`) | web |
| R2 bucket | `seerah-media` (uploads, map/landscape/etc. only) | mcp |
| R2 bucket | `seerah-backups` (`d1/YYYY-MM-DD.jsonl.gz`, 30 days) | backup |
| KV namespace | `seerah-oauth` | mcp (OAuth provider) |
| Workers | `seerah-mcp`, `seerah-web`, `seerah-backup` | |

```bash
cd apps/mcp
npx wrangler d1 create seerah            # put the id into apps/{mcp,web,backup}/wrangler.jsonc
npx wrangler r2 bucket create seerah-tiles
npx wrangler r2 bucket create seerah-media
npx wrangler r2 bucket create seerah-backups
npx wrangler kv namespace create seerah-oauth   # id into apps/mcp/wrangler.jsonc
```

## Secrets

| Secret | Where | How |
|---|---|---|
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Worker `seerah-mcp` | `cd apps/mcp && npx wrangler secret put GITHUB_CLIENT_ID -c wrangler.deploy.jsonc` (same for `_SECRET`). Typed at the prompt, never stored in files. |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | Token with Workers Scripts:Edit, D1:Edit, R2:Edit, Workers KV:Edit, Zone:Read, Workers Routes:Edit (account + the zone). |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | `wrangler whoami` |

There are **no other secrets**: preview tokens are stored only as SHA-256 hashes in D1, and the OAuth provider encrypts its
grants itself with keys kept in KV.

GitHub Actions **variables** (Settings → Secrets and variables → Actions → Variables): `DOMAIN`, `ALLOWED_GITHUB_USERS`,
`OWNER_GITHUB_USERS`, `INDEXING` (leave unset until launch). Create an Actions environment named `production`.

GitHub OAuth App: callback URL `https://mcp.<DOMAIN>/callback`; homepage `https://<DOMAIN>`.

## First deploy (exact commands)

```bash
pnpm install
export DOMAIN=example.com ALLOWED_GITHUB_USERS=alice OWNER_GITHUB_USERS=alice
node scripts/render-wrangler.mjs

# database
(cd apps/mcp && npx wrangler d1 migrations apply seerah --remote)
pnpm --filter @seerah/db seed:sql --prod        # eras + gazetteer places only (places verified = 0). No events.
(cd apps/mcp && npx wrangler d1 execute seerah --remote --yes --file ../../packages/db/seed/seed.prod.sql)

# map tiles (needs the pmtiles CLI: https://github.com/protomaps/go-pmtiles/releases), ~32 MB
scripts/build-tiles.sh
(cd apps/web && npx wrangler r2 object put seerah-tiles/arabia.pmtiles --file tiles/arabia.pmtiles --remote)

# workers: mcp first, then secrets, then web, then backup
(cd apps/mcp && npx wrangler deploy -c wrangler.deploy.jsonc)
(cd apps/mcp && npx wrangler secret put GITHUB_CLIENT_ID -c wrangler.deploy.jsonc && npx wrangler secret put GITHUB_CLIENT_SECRET -c wrangler.deploy.jsonc)
(cd apps/web && pnpm exec opennextjs-cloudflare build && pnpm exec opennextjs-cloudflare deploy -c wrangler.deploy.jsonc)
(cd apps/backup && npx wrangler deploy)
```

Custom domains (`<DOMAIN>` and `mcp.<DOMAIN>`) are attached by the deploy; the zone must be on the same account and must not
already have DNS records with those names.

## Launch

The site is `noindex` (`X-Robots-Tag`, meta robots, `robots.txt` disallow-all) until `INDEXING=on` is set at both build time
(GitHub variable `INDEXING`, or `export INDEXING=on` before the build) and in the rendered vars, then redeployed.
Do **not** do this before the launch blockers in `PROGRESS.md` are closed (Bangla translation licence first).

## Backups and restore

`seerah-backup` runs at 02:00 UTC, dumps every table to `d1/YYYY-MM-DD.jsonl.gz` in `seerah-backups` and deletes files older
than 30 days. First line is `{"schema":[...]}`; the following lines are `{"table":..., "rows":[...]}`.
Trigger one by hand: `cd apps/backup && npx wrangler dev --test-scheduled` then `curl "http://localhost:8787/__scheduled"`.
Restore into an empty D1: apply migrations, then re-insert the rows of each line (`INSERT OR REPLACE`).

## CI/CD

`.github/workflows/ci.yml`: every PR runs typecheck + vitest + Playwright, and deploys a preview of the web Worker
(`seerah-web-pr-N`, `*.workers.dev`, noindex; reads production D1, which the web app never writes). The MCP server is
deliberately not previewed per PR. On `main`: D1 migrations, then MCP, web and backup deploys. `preview-cleanup.yml`
deletes the preview Worker when the PR closes.

## Local development

```bash
pnpm --filter @seerah/db seed:sql --dev && cd apps/web && pnpm db:local && pnpm dev
```
