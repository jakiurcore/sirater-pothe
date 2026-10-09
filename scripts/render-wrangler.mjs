#!/usr/bin/env node
/**
 * Renders deploy-ready wrangler configs from the committed ones + environment. No domain is hardcoded anywhere in git.
 *
 *   DOMAIN=example.com node scripts/render-wrangler.mjs
 *
 * Writes apps/{mcp,web}/wrangler.deploy.jsonc (git-ignored). Deploy with `wrangler deploy -c wrangler.deploy.jsonc`.
 *   DOMAIN                 required. Site = DOMAIN, MCP = mcp.DOMAIN (override with MCP_DOMAIN).
 *   INDEXING=on            lets search engines in (default: site is noindex + robots disallow).
 *   NAME_SUFFIX            e.g. "-pr-12" for per-PR preview Workers (no custom domain is attached then).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const need = (k) => {
  const v = process.env[k]
  if (!v) { console.error(`render-wrangler: ${k} is required`); process.exit(1) }
  return v
}
const strip = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/,(\s*[}\]])/g, '$1')
const read = (app) => JSON.parse(strip(readFileSync(join(root, 'apps', app, 'wrangler.jsonc'), 'utf8')))

const domain = need('DOMAIN')
const mcpDomain = process.env.MCP_DOMAIN || `mcp.${domain}`
const suffix = process.env.NAME_SUFFIX || ''
const indexing = process.env.INDEXING === 'on' ? 'on' : 'off'
const site = `https://${domain}`
const mcp = `https://${mcpDomain}`
const preview = suffix !== ''

const web = read('web')
web.name += suffix
web.services = [{ binding: 'WORKER_SELF_REFERENCE', service: web.name }]
web.vars = { ...web.vars, WEB_ORIGIN: site, MCP_ORIGIN: mcp, INDEXING: indexing }
if (!preview) web.routes = [{ pattern: domain, custom_domain: true }]

const api = read('mcp')
api.name += suffix
api.vars = { ...api.vars, MCP_ORIGIN: mcp, WEB_ORIGIN: site }
if (!preview) api.routes = [{ pattern: mcpDomain, custom_domain: true }]

for (const [app, cfg] of [['web', web], ['mcp', api]]) {
  writeFileSync(join(root, 'apps', app, 'wrangler.deploy.jsonc'), JSON.stringify(cfg, null, 2) + '\n')
  console.log(`apps/${app}/wrangler.deploy.jsonc  (${cfg.name})`)
}
