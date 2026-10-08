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
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | Token with Workers Scripts:Edit, D1:Edit, R2:Edit, Workers KV:Edit, Zone:Read, Workers Routes:Edit (account + the zone). |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | `wrangler whoami` |

The MCP server has **no secrets at all**: logins live in D1 (`users`: PBKDF2 password hashes, optional TOTP seed), preview tokens
are stored only as SHA-256 hashes, and the OAuth provider encrypts its grants itself with keys kept in KV.

GitHub Actions **variables** (Settings → Secrets and variables → Actions → Variables): `DOMAIN`, `INDEXING` (leave unset until launch). Create an Actions environment named `production`.

## First deploy (exact commands)

```bash
pnpm install
export DOMAIN=example.com
node scripts/render-wrangler.mjs

# database
(cd apps/mcp && npx wrangler d1 migrations apply seerah --remote)
pnpm --filter @seerah/db seed:sql --prod        # eras + gazetteer places only (places verified = 0). No events.
(cd apps/mcp && npx wrangler d1 execute seerah --remote --yes --file ../../packages/db/seed/seed.prod.sql)

# map tiles (needs the pmtiles CLI: https://github.com/protomaps/go-pmtiles/releases), ~32 MB
scripts/build-tiles.sh
(cd apps/web && npx wrangler r2 object put seerah-tiles/arabia.pmtiles --file tiles/arabia.pmtiles --remote)

# workers: mcp, web, backup
(cd apps/mcp && npx wrangler deploy -c wrangler.deploy.jsonc)
(cd apps/web && pnpm exec opennextjs-cloudflare build && pnpm exec opennextjs-cloudflare deploy -c wrangler.deploy.jsonc)
(cd apps/backup && npx wrangler deploy)
```

Custom domains (`<DOMAIN>` and `mcp.<DOMAIN>`) are attached by the deploy; the zone must be on the same account and must not
already have DNS records with those names.

## Users (there is no signup)

Accounts are created only by CLI scripts, run on your machine against the **remote** D1 (add `--local` for the dev database).
All prompts are interactive; passwords are never accepted as arguments and never appear in process arguments (SQL goes through a
0600 temp file).

```bash
pnpm user:create            # username, role (owner can publish, editor cannot), password twice
pnpm user:enable-2fa        # prints a QR code in the terminal, asks for a confirming code
pnpm user:reset-password    # also clears a lockout
pnpm user:disable-2fa       # lost phone
pnpm user:disable           # add --enable to undo; takes effect immediately for sessions and API tokens
```

Sign-in is the `/authorize` page of the MCP server (Bangla + English): username, password, authenticator code if enabled.
Lockout: 5 wrong attempts lock the account for 15 minutes. `/authorize` is also rate limited per IP (10 POSTs / 15 min).
Every attempt is written to `audit_log` (`auth.login`, `auth.csrf`, `auth.rate_limited`, `cli.user.*`).
Passwords use PBKDF2-SHA256 with 100,000 iterations (the Workers maximum) and a per-user random salt; see
`packages/auth/src/password.ts` for why not argon2id.

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
